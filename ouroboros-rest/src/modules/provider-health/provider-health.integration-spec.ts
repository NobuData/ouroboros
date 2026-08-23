import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type request from "supertest";

import { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { VaultService } from "../vault/vault.service";
import { ProviderHealthService } from "./provider-health.service";
import { TRAFFIC_KEY } from "./snapshot";

/**
 * The health service against a migrated database and real providers
 * ([#196](https://github.com/NobuData/ouroboros/issues/196)).
 *
 * The unit suites run this code over recorded statements, hand-written rows and a stubbed
 * `fetch`, and that is exactly what makes this one necessary. Five things can only be
 * asserted here, and four of them are acceptance criteria:
 *
 *   * **A local provider reflects reachability within one cycle** — the ticket asks for this
 *     *compose-verified by stopping the Ollama stub*, and that is what happens below: a real
 *     HTTP server answers `/api/tags`, the chip goes green, the server is stopped, and the
 *     next sweep turns it amber with a reason.
 *   * **No completion request is issued.** The stub records every request it receives —
 *     method, path and body — across a sweep of all five kinds, and the assertion is over the
 *     whole record rather than over a representative call.
 *   * **The writes satisfy V015.** `provider_connections_health_measured` and
 *     `provider_connections_health_latency` are CHECKs, and a `health` object this service
 *     built wrong is an error from the server rather than a field a unit test forgot.
 *   * **The `health` jsonb accommodates AB.2 without a schema change.** A traffic window is
 *     written into the column by hand, a sweep runs over the row, and it is still there.
 *   * **The strip payload is what mockup 06 draws**, over the real pipeline — the guards, the
 *     tenant resolution and the serialisation included.
 *
 * ---------------------------------------------------------------------------
 * **The sweep is driven from the injector rather than by waiting for the scheduler.** The
 * loop's own behaviour is `provider-health.scheduler.spec.ts`'s, under fake timers; a suite
 * that waited a real jittered minute for each of these assertions would take a quarter of an
 * hour. The harness is started with an hour-long interval so the application's own loop
 * cannot fire a competing sweep mid-test.
 *
 * Rows are inserted with SQL, for the reason `registry.integration-spec.ts` gives: decision
 * **M2** leaves provider CRUD to mockup 07, and giving this module a writer for a test would
 * be exactly the pre-emption that decision exists to prevent.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The plaintext sealed onto the Anthropic connection. The stub asserts it arrived. */
const API_KEY = "sk-ant-api03-provider-health-000000000000000000";

/** The strip payload, as a client writes it. */
const STRIP_PATH = "/api/v1/routing/providers";

/** A workspace a test is acting in, and who it acts as. */
interface Space {
  id: string;
  slug: string;
  owner: Awaited<ReturnType<ApiHarness["signIn"]>>;
}

/** One request a provider stub received. */
interface Received {
  method: string | undefined;
  url: string | undefined;
  body: string;
  headers: NodeJS.Dict<string | string[]>;
}

/** A provider that answers on loopback, and remembers what it was asked. */
class ProviderStub {
  private constructor(
    private readonly server: Server,
    readonly baseUrl: string,
    /** Every request this stub was sent, in order — what the no-completions claim is read off. */
    readonly received: readonly Received[],
  ) {}

  /**
   * Start a stub answering every path with one JSON body.
   *
   * @param body - What to answer with, or a function of the path for a stub that serves two
   *   routes.
   * @returns The started stub.
   */
  static async start(body: (url: string) => unknown): Promise<ProviderStub> {
    const received: Received[] = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];

      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({
          method: request.method,
          url: request.url,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: request.headers,
        });

        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(body(request.url ?? "")));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const { port } = server.address() as AddressInfo;

    return new ProviderStub(server, `http://127.0.0.1:${port.toString()}`, received);
  }

  /** Stop answering — a daemon somebody turned off. */
  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

describe("provider health, against a migrated database", () => {
  let api: ApiHarness;
  let health: ProviderHealthService;
  let vault: VaultService;

  let ollama: ProviderStub;
  let vllm: ProviderStub;
  let anthropic: ProviderStub;

  beforeAll(async () => {
    // An hour, so the application's own loop cannot fire a sweep in the middle of a test. The
    // loop itself is asserted under fake timers in `provider-health.scheduler.spec.ts`.
    api = await ApiHarness.start({ OURO_PROVIDER_HEALTH_INTERVAL_SECONDS: "3600" });
    health = api.nest.get(ProviderHealthService);
    vault = api.nest.get(VaultService);
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    ollama = await ProviderStub.start(() => ({
      models: [{ name: "qwen3-coder:32b" }, { name: "llama3.1:8b" }, { name: "nomic-embed" }],
    }));
    vllm = await ProviderStub.start(() => ({ data: [{ id: "a" }, { id: "b" }] }));
    anthropic = await ProviderStub.start(() => ({ data: [{ id: "claude-fable-5" }] }));
  });

  afterEach(async () => {
    await Promise.all(
      [ollama.stop(), vllm.stop(), anthropic.stop()].map((done) => done.catch(() => undefined)),
    );
    await api.truncate();
  });

  /**
   * A workspace with an owner.
   *
   * @returns Its id, its slug — which is what `X-Ouro-Tenant` names — and its owner.
   */
  async function workspace(): Promise<Space> {
    const owner = await api.signIn();
    const space = await api.workspace(owner);

    return { id: space.id, slug: space.slug, owner };
  }

  /**
   * The strip, as this workspace's owner reads it.
   *
   * The workspace is named per request with `X-Ouro-Tenant` rather than made active, which is
   * the lighter of the two and the one every other suite here uses: the header and the
   * session's active organization go through the same resolver, and choosing one per request
   * keeps a test that uses two workspaces from having to switch between them.
   *
   * @param space - Whose strip.
   * @returns The pending request.
   */
  function strip(space: Space): request.Test {
    return api.as(space.owner)("get", STRIP_PATH).set(TENANT_HEADER, space.slug);
  }

  /**
   * Insert one provider connection, taking V015's defaults for everything not named.
   *
   * @param organizationId - The workspace.
   * @param row - The columns that differ per connection.
   * @returns The connection's id.
   */
  async function connection(
    organizationId: string,
    row: {
      kind: string;
      displayName: string;
      baseUrl?: string | null;
      sealed?: string | null;
      status?: string;
      health?: Record<string, unknown>;
      lastCheckedAt?: Date | null;
    },
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.provider_connections
         (organization_id, kind, display_name, base_url, credentials_encrypted,
          status, health, last_checked_at)
       values ($1, $2, $3, $4, $5, coalesce($6, 'unknown'), coalesce($7::jsonb, '{}'::jsonb), $8)
       returning id`,
      [
        organizationId,
        row.kind,
        row.displayName,
        row.baseUrl ?? null,
        row.sealed ?? null,
        row.status ?? null,
        row.health === undefined ? null : JSON.stringify(row.health),
        row.lastCheckedAt ?? null,
      ],
    );

    return rows[0].id;
  }

  /** One connection's health columns, straight from the table. */
  async function stored(
    connectionId: string,
  ): Promise<{ status: string; health: Record<string, unknown>; last_checked_at: Date | null }> {
    const { rows } = await api.sql.query<{
      status: string;
      health: Record<string, unknown>;
      last_checked_at: Date | null;
    }>(
      `select status, health, last_checked_at from ${SCHEMA_NAME}.provider_connections where id = $1`,
      [connectionId],
    );

    return rows[0];
  }

  /** An instant far enough ahead that every row is due again. */
  function later(): Date {
    return new Date(Date.now() + 3_600_000);
  }

  describe("a local provider, within one cycle", () => {
    it("goes green with its model count — the mockup's `workstation · 3 models`", async () => {
      const { id } = await workspace();
      const daemon = await connection(id, {
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: ollama.baseUrl,
      });

      await health.sweep();

      const row = await stored(daemon);
      expect(row.status).toBe("active");
      expect(row.health).toEqual({ check: "reachability", models: 3 });
      expect(row.last_checked_at).toBeInstanceOf(Date);
    });

    it("goes amber with a reason when the daemon is stopped", async () => {
      // The ticket's compose-verified criterion. Nothing about the row changes; the daemon
      // stops answering, and the next cycle says so.
      const { id } = await workspace();
      const daemon = await connection(id, {
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: ollama.baseUrl,
      });

      await health.sweep();
      expect((await stored(daemon)).status).toBe("active");

      await ollama.stop();
      await health.sweep(later());

      const row = await stored(daemon);
      expect(row.status).toBe("error");
      expect(row.health).toEqual({
        check: "reachability",
        detail: "unreachable (ECONNREFUSED)",
      });
    });

    it("reports what a vLLM is serving", async () => {
      const { id } = await workspace();
      const served = await connection(id, {
        kind: "openai_compatible",
        displayName: "OpenAI-compatible",
        baseUrl: vllm.baseUrl,
      });

      await health.sweep();

      expect((await stored(served)).health).toEqual({ check: "reachability", models: 2 });
      expect(vllm.received.map((request) => request.url)).toEqual(["/v1/models"]);
    });
  });

  describe("a cloud provider's credential", () => {
    it("is presented, validated, and reported with the latency it took", async () => {
      const { id } = await workspace();
      const cloud = await connection(id, {
        kind: "anthropic",
        displayName: "Anthropic",
        baseUrl: anthropic.baseUrl,
      });
      // Sealed against the connection's own id, which is what the envelope's additional data
      // is bound to — the same record id `registry.secrets.ts` re-seals under.
      await api.sql.query(
        `update ${SCHEMA_NAME}.provider_connections set credentials_encrypted = $2 where id = $1`,
        [cloud, await vault.encryptText(id, cloud, API_KEY)],
      );

      await health.sweep();

      expect(anthropic.received).toHaveLength(1);
      expect(anthropic.received[0].url).toBe("/v1/models?limit=1");
      expect(anthropic.received[0].headers["x-api-key"]).toBe(API_KEY);
      expect(anthropic.received[0].headers["anthropic-version"]).toBe("2023-06-01");

      const row = await stored(cloud);
      expect(row.status).toBe("active");
      expect(row.health).toMatchObject({ check: "key_validation" });
      expect(typeof row.health.latency_ms).toBe("number");
    });

    it("is left alone entirely when no key has been entered yet", async () => {
      // A row mockup 07 has not finished. Marking it `error` would put an administrator's
      // unfinished setup on the strip as an outage.
      const { id } = await workspace();
      const cloud = await connection(id, {
        kind: "anthropic",
        displayName: "Anthropic",
        baseUrl: anthropic.baseUrl,
      });

      await health.sweep();

      expect(anthropic.received).toHaveLength(0);
      expect(await stored(cloud)).toMatchObject({
        status: "unknown",
        health: {},
        last_checked_at: null,
      });
    });
  });

  describe("the providers this service has nothing honest to ask", () => {
    it("leaves Copilot and Cursor exactly as it found them", async () => {
      const { id } = await workspace();
      const copilot = await connection(id, { kind: "copilot", displayName: "GitHub Copilot" });
      const cursor = await connection(id, { kind: "cursor", displayName: "Cursor" });

      await health.sweep();
      await health.sweep(later());

      for (const untouched of [copilot, cursor]) {
        expect(await stored(untouched)).toMatchObject({
          status: "unknown",
          health: {},
          last_checked_at: null,
        });
      }
    });

    it("leaves a paused connection uncontacted, because that is what pausing means", async () => {
      const { id } = await workspace();
      const paused = await connection(id, {
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: ollama.baseUrl,
        status: "paused",
      });

      await health.sweep();

      expect(ollama.received).toHaveLength(0);
      expect(await stored(paused)).toMatchObject({ status: "paused", last_checked_at: null });
    });
  });

  describe("no synthetic completions, over a sweep of every kind", () => {
    it("asks every provider for a listing, with a GET and no body", async () => {
      const { id } = await workspace();
      await connection(id, { kind: "ollama", displayName: "Ollama", baseUrl: ollama.baseUrl });
      await connection(id, {
        kind: "openai_compatible",
        displayName: "OpenAI-compatible",
        baseUrl: vllm.baseUrl,
      });
      const cloud = await connection(id, {
        kind: "anthropic",
        displayName: "Anthropic",
        baseUrl: anthropic.baseUrl,
      });
      await api.sql.query(
        `update ${SCHEMA_NAME}.provider_connections set credentials_encrypted = $2 where id = $1`,
        [cloud, await vault.encryptText(id, cloud, API_KEY)],
      );
      await connection(id, { kind: "copilot", displayName: "GitHub Copilot" });
      await connection(id, { kind: "cursor", displayName: "Cursor" });

      await health.sweep();

      const everything = [...ollama.received, ...vllm.received, ...anthropic.received];
      expect(everything).toHaveLength(3);

      for (const request of everything) {
        expect(request.method).toBe("GET");
        expect(request.body).toBe("");
        expect(request.url).toMatch(/^\/(api\/tags|v1\/models)/);
      }
    });
  });

  describe("the health column", () => {
    it("keeps a traffic window written beside it, which is AB.2's reservation", async () => {
      const traffic = { error_rate: 0.02, p95_latency_ms: 910, window: "1h" };
      const { id } = await workspace();
      const daemon = await connection(id, {
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: ollama.baseUrl,
        // V015 refuses content without a stamp, which is the constraint AB.2's writer will
        // meet too — so the fixture sets both, exactly as that writer would.
        health: { [TRAFFIC_KEY]: traffic },
        lastCheckedAt: new Date("2026-08-23T09:00:00.000Z"),
      });

      await health.sweep(later());

      expect((await stored(daemon)).health).toEqual({
        [TRAFFIC_KEY]: traffic,
        check: "reachability",
        models: 3,
      });
    });

    it("satisfies the CHECKs that keep a measurement a measurement", async () => {
      // `provider_connections_health_measured` refuses content without a stamp, and
      // `provider_connections_health_latency` refuses a latency that is not a non-negative
      // number. A write this service built wrong is an error from the server, not a field a
      // unit test forgot — which is why this assertion lives here.
      const { id } = await workspace();
      const cloud = await connection(id, {
        kind: "anthropic",
        displayName: "Anthropic",
        baseUrl: anthropic.baseUrl,
      });
      await api.sql.query(
        `update ${SCHEMA_NAME}.provider_connections set credentials_encrypted = $2 where id = $1`,
        [cloud, await vault.encryptText(id, cloud, API_KEY)],
      );

      await expect(health.sweep()).resolves.toMatchObject({ checked: 1, active: 1 });

      const row = await stored(cloud);
      expect(row.last_checked_at).toBeInstanceOf(Date);
      expect(row.health.latency_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe("the strip, over the real pipeline", () => {
    /**
     * Mockup 06's five chips, as rows.
     *
     * @param organizationId - The workspace.
     */
    async function mockupSix(organizationId: string): Promise<void> {
      await connection(organizationId, {
        kind: "anthropic",
        displayName: "Anthropic",
        // No address: the mockup's Anthropic chip reads `42ms` and nothing else, because the
        // vendor's own endpoint is not a fact worth a chip's width.
        baseUrl: null,
        status: "active",
        health: { check: "key_validation", latency_ms: 42 },
        lastCheckedAt: new Date("2026-08-23T09:58:12.004Z"),
      });
      await connection(organizationId, { kind: "cursor", displayName: "Cursor" });
      await connection(organizationId, {
        kind: "copilot",
        displayName: "GitHub Copilot",
        status: "error",
        health: { detail: "degraded · elevated latency" },
        lastCheckedAt: new Date("2026-08-23T09:41:00.000Z"),
      });
      await connection(organizationId, {
        kind: "openai_compatible",
        displayName: "OpenAI-compatible",
        baseUrl: "http://vllm-local:8000",
        status: "active",
        health: { check: "reachability", models: 2 },
        lastCheckedAt: new Date("2026-08-23T09:59:41.902Z"),
      });
      await connection(organizationId, {
        kind: "ollama",
        displayName: "Ollama",
        baseUrl: "http://workstation:11434",
        status: "active",
        health: { check: "reachability", models: 3 },
        lastCheckedAt: new Date("2026-08-23T09:59:41.882Z"),
      });
    }

    it("draws the five chips the design specifies", async () => {
      const space = await workspace();
      await mockupSix(space.id);

      const response = await strip(space).expect(200);
      const body = response.body as {
        providers: { displayName: string; status: string; meta: string | null }[];
      };

      expect(body.providers.map((chip) => [chip.displayName, chip.status, chip.meta])).toEqual([
        ["Anthropic", "active", "42ms"],
        ["Cursor", "unknown", null],
        ["GitHub Copilot", "error", "degraded · elevated latency"],
        ["Ollama", "active", "workstation · 3 models"],
        ["OpenAI-compatible", "active", "vllm-local · 2 models"],
      ]);
    });

    it("never renders an unchecked provider as healthy, or as fast", async () => {
      const space = await workspace();
      await mockupSix(space.id);

      const response = await strip(space).expect(200);
      const body = response.body as {
        providers: { status: string; latencyMs: number | null; checkedAt: string | null }[];
      };
      const unchecked = body.providers.filter((chip) => chip.status === "unknown");

      expect(unchecked).not.toHaveLength(0);
      for (const chip of unchecked) {
        expect(chip.latencyMs).toBeNull();
        expect(chip.checkedAt).toBeNull();
      }
    });

    it("is one workspace's, and never another's", async () => {
      const mine = await workspace();
      const theirs = await workspace();
      await connection(mine.id, { kind: "ollama", displayName: "Mine", baseUrl: ollama.baseUrl });
      await connection(theirs.id, { kind: "ollama", displayName: "Theirs", baseUrl: vllm.baseUrl });

      const response = await strip(mine).expect(200);
      const body = response.body as { providers: { displayName: string }[] };

      expect(body.providers.map((chip) => chip.displayName)).toEqual(["Mine"]);
    });

    it("carries no credential, in any form", async () => {
      const space = await workspace();
      const cloud = await connection(space.id, {
        kind: "anthropic",
        displayName: "Anthropic",
        baseUrl: anthropic.baseUrl,
      });
      const sealed = await vault.encryptText(space.id, cloud, API_KEY);
      await api.sql.query(
        `update ${SCHEMA_NAME}.provider_connections set credentials_encrypted = $2 where id = $1`,
        [cloud, sealed],
      );

      await health.sweep();
      const response = await strip(space).expect(200);
      const serialised = JSON.stringify(response.body);

      expect(serialised).not.toContain(API_KEY);
      expect(serialised).not.toContain(sealed);
      expect(serialised).not.toContain("ouro.v1");
    });

    it("is refused without a session", async () => {
      await api.anonymous("get", STRIP_PATH).expect(401);
    });

    it("is an empty strip for a workspace that has configured nothing", async () => {
      const space = await workspace();

      const response = await strip(space).expect(200);

      expect(response.body).toEqual({ providers: [] });
    });
  });
});

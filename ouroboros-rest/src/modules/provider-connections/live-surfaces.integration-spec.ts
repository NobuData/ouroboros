/**
 * AE.4's live surfaces ([#230](https://github.com/NobuData/ouroboros/issues/230)), against a
 * migrated database and two real loopback providers.
 *
 * The unit suites prove the shapes; what only this can prove is that the statements V017 wrote
 * out actually run — the upsert does not double a chip, the delete does not take the alias with
 * it, the snapshot the strip reads is the one the test wrote — and that a pull streamed by a
 * daemon over HTTP is tracked by the process and read back at its real percentage.
 *
 * Two servers stand in for two providers, and each is the smallest thing that answers the
 * adapter's own requests: an OpenAI-compatible listing whose contents a case can change or
 * break, and an Ollama daemon that answers a version, a tags listing, and a pull as the NDJSON
 * stream `ollama.recordings.fixture.ts` captured — with a delay between lines, so a second
 * request can find the first still running. No socket reaches anything but `127.0.0.1`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { ProviderHealthStripResource } from "../provider-health/resources";
import { BASE_URL_FIELD } from "../providers/provider.config";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { ProviderTestResource } from "./connection-test";
import type { ProviderDiscoveryResource, ProviderModelsResource } from "./models";
import type { ModelPullResource, ModelPullsResource } from "./pulls";
import type { ProviderConnectionResource } from "./resources";

const PROVIDERS = "/api/v1/providers";
const STRIP = "/api/v1/routing/providers";
const ALIASES = "/api/v1/registry/aliases";

/** A pulled model's size, in bytes — `9.1 GB`, as the recording has phi4. */
const PHI4_BYTES = 9_053_116_800;

/** How long the daemon stub waits between stream lines, so a pull is observably in flight. */
const STREAM_STEP_MS = 40;

type Method = "get" | "post" | "patch" | "delete";

/** One `/api/tags` entry, in the daemon's own shape. */
function tag(name: string, size: number): Record<string, unknown> {
  return {
    name,
    model: name,
    modified_at: "2026-07-19T09:14:02.118374Z",
    size,
    digest: "b5f1e0d2196a3c4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5",
    details: { format: "gguf", family: "phi4", parameter_size: "14.7B" },
  };
}

/** The lines a pull streams, for a model of one size. */
function pullLines(total: number): Record<string, unknown>[] {
  const digest = "sha256:c6a2f1e3287b4d5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6";

  return [
    { status: "pulling manifest" },
    { status: "pulling c6a2f1e3287b", digest, total, completed: 0 },
    { status: "pulling c6a2f1e3287b", digest, total, completed: Math.floor(total * 0.61) },
    { status: "pulling c6a2f1e3287b", digest, total, completed: total },
    { status: "verifying sha256 digest" },
    { status: "success" },
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("the live surfaces, against a migrated database and live providers", () => {
  let api: ApiHarness;

  /** The OpenAI-compatible listing, and the two dials a case turns. */
  let vllm: Server;
  let vllmUrl: string;
  let vllmModels: string[];
  let vllmStatus: number;

  /** The Ollama daemon, its shelf, and the pulls it has been asked for. */
  let ollama: Server;
  let ollamaUrl: string;
  let shelf: Map<string, number>;
  let pullsAsked: string[];

  beforeAll(async () => {
    vllm = createServer((_request: IncomingMessage, response: ServerResponse) => {
      if (vllmStatus !== 200) {
        response.writeHead(vllmStatus, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "upstream unavailable" } }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          object: "list",
          data: vllmModels.map((id) => ({ id, object: "model", owned_by: "vllm" })),
        }),
      );
    });

    ollama = createServer((request: IncomingMessage, response: ServerResponse) => {
      if (request.method === "GET" && request.url === "/api/version") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ version: "0.12.3" }));
        return;
      }

      if (request.method === "GET" && request.url === "/api/tags") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ models: [...shelf.entries()].map(([name, size]) => tag(name, size)) }),
        );
        return;
      }

      if (request.method === "POST" && request.url === "/api/pull") {
        let body = "";
        request.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        request.on("end", () => {
          const { model } = JSON.parse(body) as { model: string };
          pullsAsked.push(model);
          response.writeHead(200, { "content-type": "application/x-ndjson" });

          const lines = pullLines(PHI4_BYTES);
          let index = 0;
          const tick = (): void => {
            if (index === lines.length) {
              response.end();
              return;
            }
            // The model is on the shelf by the time the daemon says `success`, as it is on a
            // real one — which is what makes the refresh a successful pull triggers find it.
            if (index === lines.length - 1) {
              shelf.set(model, PHI4_BYTES);
            }
            response.write(`${JSON.stringify(lines[index])}\n`);
            index += 1;
            setTimeout(tick, STREAM_STEP_MS);
          };
          tick();
        });
        return;
      }

      response.writeHead(404);
      response.end();
    });

    await new Promise<void>((resolve) => vllm.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => ollama.listen(0, "127.0.0.1", resolve));
    vllmUrl = `http://127.0.0.1:${(vllm.address() as AddressInfo).port.toString()}/v1`;
    ollamaUrl = `http://127.0.0.1:${(ollama.address() as AddressInfo).port.toString()}`;

    api = await ApiHarness.start();
  });

  afterAll(async () => {
    await api.close();
    for (const server of [vllm, ollama]) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  beforeEach(async () => {
    await api.truncate();
    vllmModels = ["llama-4-maverick", "deepseek-v3.2"];
    vllmStatus = 200;
    shelf = new Map([["qwen3-coder:32b", 18_997_469_184]]);
    pullsAsked = [];
  });

  async function owned(): Promise<{ owner: Person; space: Workspace }> {
    const owner = await api.signUp();

    return { owner, space: await api.workspace(owner) };
  }

  const acting = (person: Person, space: Workspace) => (method: Method, path: string) =>
    api.as(person)(method, path).set(TENANT_HEADER, space.slug);

  async function connectVllm(
    person: Person,
    space: Workspace,
  ): Promise<ProviderConnectionResource> {
    return bodyOf<ProviderConnectionResource>(
      await acting(person, space)("post", PROVIDERS)
        .send({
          kind: "openai_compatible",
          displayName: "OpenAI-compatible · local vLLM",
          config: { [BASE_URL_FIELD]: vllmUrl },
        })
        .expect(201),
    );
  }

  async function connectOllama(
    person: Person,
    space: Workspace,
  ): Promise<ProviderConnectionResource> {
    return bodyOf<ProviderConnectionResource>(
      await acting(person, space)("post", PROVIDERS)
        .send({
          kind: "ollama",
          displayName: "Ollama · test",
          config: { [BASE_URL_FIELD]: ollamaUrl },
        })
        .expect(201),
    );
  }

  async function storedModels(connectionId: string): Promise<string[]> {
    const { rows } = await api.sql.query<{ model_id: string }>(
      `select model_id from ${SCHEMA_NAME}.provider_models
        where provider_connection_id = $1 order by model_id`,
      [connectionId],
    );

    return rows.map((row) => row.model_id);
  }

  /** Poll one connection's pulls until every one is terminal, or give up. */
  async function settled(
    request: (method: Method, path: string) => ReturnType<ReturnType<typeof acting>>,
    connectionId: string,
  ): Promise<ModelPullResource[]> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { pulls } = bodyOf<ModelPullsResource>(
        await request("get", `${PROVIDERS}/${connectionId}/pulls`).expect(200),
      );

      if (pulls.length > 0 && pulls.every((pull) => pull.finishedAt !== null)) {
        return [...pulls];
      }

      await sleep(STREAM_STEP_MS);
    }

    throw new Error("the pulls never settled");
  }

  describe("discovery", () => {
    it("upserts the provider's models into provider_models, and a second pass doubles nothing", async () => {
      const { owner, space } = await owned();
      const connection = await connectVllm(owner, space);
      const request = acting(owner, space);

      const first = bodyOf<ProviderDiscoveryResource>(
        await request("post", `${PROVIDERS}/${connection.id}/discover`).expect(200),
      );

      expect(first.added).toEqual(["deepseek-v3.2", "llama-4-maverick"]);
      expect(first.removed).toEqual([]);
      expect(first.models.map((model) => model.modelId)).toEqual([
        "deepseek-v3.2",
        "llama-4-maverick",
      ]);
      expect(first.discoveredAt).not.toBeNull();

      const second = bodyOf<ProviderDiscoveryResource>(
        await request("post", `${PROVIDERS}/${connection.id}/discover`).expect(200),
      );

      expect(second.added).toEqual([]);
      expect(second.models).toHaveLength(2);
      await expect(storedModels(connection.id)).resolves.toEqual([
        "deepseek-v3.2",
        "llama-4-maverick",
      ]);
    });

    it("removes a model the host no longer serves, and flags the alias that still names it", async () => {
      const { owner, space } = await owned();
      const connection = await connectVllm(owner, space);
      const request = acting(owner, space);

      await request("post", `${PROVIDERS}/${connection.id}/discover`).expect(200);
      await request("post", ALIASES)
        .send({ alias: "local-ds", connectionId: connection.id, modelId: "deepseek-v3.2" })
        .expect(201);

      vllmModels = ["llama-4-maverick"];

      const discovery = bodyOf<ProviderDiscoveryResource>(
        await request("post", `${PROVIDERS}/${connection.id}/discover`).expect(200),
      );

      expect(discovery.removed).toEqual(["deepseek-v3.2"]);
      expect(discovery.models.map((model) => model.modelId)).toEqual(["llama-4-maverick"]);
      expect(discovery.unlisted).toEqual([
        {
          modelId: "deepseek-v3.2",
          aliases: [{ id: expect.any(String) as string, alias: "local-ds" }],
        },
      ]);

      // The row is gone — the catalog is discovery's report — and the flag survives a read.
      await expect(storedModels(connection.id)).resolves.toEqual(["llama-4-maverick"]);
      const read = bodyOf<ProviderModelsResource>(
        await request("get", `${PROVIDERS}/${connection.id}/models`).expect(200),
      );
      expect(read.unlisted.map((flag) => flag.modelId)).toEqual(["deepseek-v3.2"]);
    });

    it("flags nothing on a connection nothing has discovered on — a gap, not a mismatch", async () => {
      const { owner, space } = await owned();
      const connection = await connectVllm(owner, space);
      const request = acting(owner, space);

      await request("post", ALIASES)
        .send({ alias: "local-ds", connectionId: connection.id, modelId: "deepseek-v3.2" })
        .expect(201);

      const read = bodyOf<ProviderModelsResource>(
        await request("get", `${PROVIDERS}/${connection.id}/models`).expect(200),
      );

      expect(read.models).toEqual([]);
      expect(read.unlisted).toEqual([]);
      expect(read.discoveredAt).toBeNull();
    });

    it("leaves the catalog unchanged, and answers 502, when the host does not answer", async () => {
      const { owner, space } = await owned();
      const connection = await connectVllm(owner, space);
      const request = acting(owner, space);

      await request("post", `${PROVIDERS}/${connection.id}/discover`).expect(200);
      vllmStatus = 503;

      const refusal = bodyOf<ErrorEnvelope>(
        await request("post", `${PROVIDERS}/${connection.id}/discover`).expect(502),
      );

      expect(refusal.code).toBe("provider_discovery_failed");
      expect(refusal.details).toMatchObject({ errorClass: "upstream" });
      await expect(storedModels(connection.id)).resolves.toHaveLength(2);
    });

    it("is a member's to read and an administrator's to run", async () => {
      const { owner, space } = await owned();
      const connection = await connectVllm(owner, space);
      const member = await api.signUp();
      await api.join(space.id, member, "member");

      await acting(member, space)("get", `${PROVIDERS}/${connection.id}/models`).expect(200);
      await acting(member, space)("post", `${PROVIDERS}/${connection.id}/discover`).expect(403);
      await acting(member, space)("post", `${PROVIDERS}/${connection.id}/test`).expect(403);
    });

    it("answers 404 for another workspace's connection, never 403", async () => {
      const { owner, space } = await owned();
      const connection = await connectVllm(owner, space);
      const { owner: stranger, space: elsewhere } = await owned();

      await acting(stranger, elsewhere)("get", `${PROVIDERS}/${connection.id}/models`).expect(404);
      await acting(stranger, elsewhere)("get", `${PROVIDERS}/${connection.id}/pulls`).expect(404);
    });
  });

  describe("testing a connection", () => {
    it("measures a working host and writes the snapshot the routing strip reads", async () => {
      const { owner, space } = await owned();
      const connection = await connectVllm(owner, space);
      const request = acting(owner, space);

      const result = bodyOf<ProviderTestResource>(
        await request("post", `${PROVIDERS}/${connection.id}/test`).expect(200),
      );

      expect(result).toMatchObject({
        connectionId: connection.id,
        status: "active",
        pill: { tone: "ok", label: "connected" },
        errorClass: null,
        retryable: false,
      });
      expect(result.latencyMs).toEqual(expect.any(Number));

      const strip = bodyOf<ProviderHealthStripResource>(await request("get", STRIP).expect(200));
      const chip = strip.providers.find((provider) => provider.id === connection.id);

      expect(chip).toMatchObject({
        status: "active",
        check: "reachability",
        checkedAt: result.checkedAt,
        errorClass: null,
      });
    });

    it("flips the pill and the strip honestly when the host stops answering — within one test", async () => {
      const { owner, space } = await owned();
      const connection = await connectVllm(owner, space);
      const request = acting(owner, space);

      vllmStatus = 503;

      const result = bodyOf<ProviderTestResource>(
        await request("post", `${PROVIDERS}/${connection.id}/test`).expect(200),
      );

      expect(result).toMatchObject({
        status: "error",
        pill: { tone: "warn", label: "degraded upstream" },
        errorClass: "upstream",
        retryable: true,
        latencyMs: null,
      });
      expect(result.note).toMatch(/· retrying$/);

      const read = bodyOf<ProviderConnectionResource>(
        await request("get", `${PROVIDERS}/${connection.id}`).expect(200),
      );
      expect(read.status).toBe("error");

      const strip = bodyOf<ProviderHealthStripResource>(await request("get", STRIP).expect(200));
      expect(strip.providers.find((provider) => provider.id === connection.id)).toMatchObject({
        status: "error",
        errorClass: "upstream",
        detail: result.detail,
      });
    });

    it("records provider.tested with what it found, both ways", async () => {
      const { owner, space } = await owned();
      const connection = await connectVllm(owner, space);
      const request = acting(owner, space);

      await request("post", `${PROVIDERS}/${connection.id}/test`).expect(200);
      vllmStatus = 503;
      await request("post", `${PROVIDERS}/${connection.id}/test`).expect(200);

      const { rows } = await api.sql.query<{ detail: Record<string, unknown> }>(
        `select detail from ${SCHEMA_NAME}.audit_events
          where action = 'provider.tested' and subject_id = $1 order by occurred_at`,
        [connection.id],
      );

      expect(rows.map((row) => row.detail.outcome)).toEqual(["success", "failure"]);
      expect(rows[0].detail).toMatchObject({ latency_ms: expect.any(Number) as number });
      expect(rows[1].detail).toMatchObject({ error_class: "upstream" });
    });
  });

  describe("pulling a model", () => {
    it("streams a pull to done, readable at its real percentage by any later request", async () => {
      const { owner, space } = await owned();
      const connection = await connectOllama(owner, space);
      const request = acting(owner, space);

      const started = bodyOf<ModelPullResource>(
        await request("post", `${PROVIDERS}/${connection.id}/pulls`)
          .send({ modelId: "phi4:14b" })
          .expect(202),
      );

      expect(started).toMatchObject({ modelId: "phi4:14b", state: "running", finishedAt: null });

      // Somewhere in the middle: a *different* request, as a reload would be, reads progress.
      const seen: (number | null)[] = [];
      let last: ModelPullResource | undefined;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const { pulls } = bodyOf<ModelPullsResource>(
          await request("get", `${PROVIDERS}/${connection.id}/pulls`).expect(200),
        );
        [last] = pulls;
        seen.push(last?.percent ?? null);
        if (last?.state === "succeeded") {
          break;
        }
        await sleep(STREAM_STEP_MS / 2);
      }

      // The daemon's own percentages, read back by later requests: 61% mid-stream, 100% when
      // the last layer landed. The `success` line carries no counts, and the record says so
      // rather than inventing a figure — a finished pull is `succeeded`, not `100%`.
      expect(seen).toContain(61);
      expect(seen).toContain(100);
      expect(last).toMatchObject({ state: "succeeded", status: "success" });
      expect(pullsAsked).toEqual(["phi4:14b"]);
    });

    it("queues a second model while the first runs, and asks the daemon for it only afterwards", async () => {
      const { owner, space } = await owned();
      const connection = await connectOllama(owner, space);
      const request = acting(owner, space);

      const first = bodyOf<ModelPullResource>(
        await request("post", `${PROVIDERS}/${connection.id}/pulls`)
          .send({ modelId: "llama4:scout" })
          .expect(202),
      );
      const second = bodyOf<ModelPullResource>(
        await request("post", `${PROVIDERS}/${connection.id}/pulls`)
          .send({ modelId: "phi4:14b" })
          .expect(202),
      );

      expect(first.state).toBe("running");
      expect(second).toMatchObject({ state: "queued", status: "queued", startedAt: null });
      expect(pullsAsked).toEqual(["llama4:scout"]);

      const pulls = await settled(request, connection.id);

      expect(pulls.map((pull) => [pull.modelId, pull.state])).toEqual([
        ["llama4:scout", "succeeded"],
        ["phi4:14b", "succeeded"],
      ]);
      expect(pullsAsked).toEqual(["llama4:scout", "phi4:14b"]);
    });

    it("refreshes the catalog when the pull lands, so the list shows the model with its size", async () => {
      const { owner, space } = await owned();
      const connection = await connectOllama(owner, space);
      const request = acting(owner, space);

      await request("post", `${PROVIDERS}/${connection.id}/discover`).expect(200);
      await expect(storedModels(connection.id)).resolves.toEqual(["qwen3-coder:32b"]);

      await request("post", `${PROVIDERS}/${connection.id}/pulls`)
        .send({ modelId: "phi4:14b" })
        .expect(202);
      await settled(request, connection.id);

      let read: ProviderModelsResource | undefined;
      for (
        let attempt = 0;
        attempt < 50 && !read?.models.some((m) => m.modelId === "phi4:14b");
        attempt += 1
      ) {
        await sleep(STREAM_STEP_MS);
        read = bodyOf<ProviderModelsResource>(
          await request("get", `${PROVIDERS}/${connection.id}/models`).expect(200),
        );
      }

      expect(read?.models.map((model) => [model.modelId, model.sizeBytes])).toEqual([
        ["phi4:14b", PHI4_BYTES],
        ["qwen3-coder:32b", 18_997_469_184],
      ]);
    });

    it("refuses a kind that stores nothing to pull into, before anything is queued", async () => {
      const { owner, space } = await owned();
      const connection = await connectVllm(owner, space);
      const request = acting(owner, space);

      const refusal = bodyOf<ErrorEnvelope>(
        await request("post", `${PROVIDERS}/${connection.id}/pulls`)
          .send({ modelId: "phi4:14b" })
          .expect(422),
      );

      expect(refusal.code).toBe("provider_kind_cannot_pull");
      const { pulls } = bodyOf<ModelPullsResource>(
        await request("get", `${PROVIDERS}/${connection.id}/pulls`).expect(200),
      );
      expect(pulls).toEqual([]);
    });

    it("refuses a blank model id as the validation pipe's own 422", async () => {
      const { owner, space } = await owned();
      const connection = await connectOllama(owner, space);

      const refusal = bodyOf<ErrorEnvelope>(
        await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/pulls`)
          .send({ modelId: " phi4:14b" })
          .expect(422),
      );

      expect(refusal.code).toBe("validation_failed");
    });
  });
});

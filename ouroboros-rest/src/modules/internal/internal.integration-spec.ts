import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { INTERNAL_ERRORS } from "./internal.errors";
import { INTERNAL_INVOKE_PATH, INTERNAL_LEASE_PATH } from "./internal.paths";
import { LEASE_TTL_SECONDS } from "./lease";
import { LEASE_GRANTED_EVENT } from "./lease.audit";
import type { LeaseResource } from "./lease.resources";
import { CLOUD_PROVIDER_KINDS } from "./providers";

/**
 * **The engine-facing surface, over a socket and against a migrated database**
 * ([#224](https://github.com/NobuData/ouroboros/issues/224)).
 *
 * Every acceptance criterion this ticket has that is about *what a worker actually gets* is
 * here, because none of them exists at any smaller scale:
 *
 *   * a lease for a local provider returns **host/base-URL details only** — inspected in the
 *     payload that came back over the wire, not in a value a mapper returned;
 *   * a lease for a cloud provider is **403 by policy**, for each cloud adapter kind;
 *   * every grant writes **`credential.lease_granted`**;
 *   * leases are **TTL-bounded** and **authenticated per the #51 pattern**;
 *   * the proxy contract answers, and says who implements it.
 *
 * The per-run scoping is the one worth reading twice. Two workspaces are seeded and a lease
 * is taken against a run in one of them; what proves the scope is real is that the answer
 * names *that* workspace, which the request never mentioned.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** Where the deployment says its local providers are, for this suite's application. */
const OLLAMA = "http://localhost:11434";
const VLLM = "http://localhost:8001/v1";

describe("the internal surface", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({
      OURO_LOCAL_PROVIDER_URLS: `ollama=${OLLAMA},openai_compatible=${VLLM}`,
    });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** The shared secret the engine would send, from the configuration this stack was built with. */
  const key = (): string => api.configuration.engineSharedSecret;

  /**
   * A run in a fresh workspace, which is what a lease is scoped to.
   *
   * @returns The run's id and the workspace it belongs to.
   */
  async function seedRun(): Promise<{ run: string; workspace: SeededWorkspace }> {
    const owner = await api.signUp();
    const workspace = await workspaceWithRepo(api, owner);
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                   workflow_tag, model, status, stage_label, stage_index,
                                   stage_total)
       values ($1, $2, 224, 'Worker credential delivery', 'standard-fix', 'qwen3-coder:32b',
               'coding', 'Analyse', 1, 6)
       returning id`,
      [workspace.id, workspace.repoId],
    );

    return { run: rows[0].id, workspace };
  }

  /** Ask for a lease as the engine would. */
  function lease(body: unknown, withKey = true): ReturnType<ApiHarness["anonymous"]> {
    const pending = api.anonymous("post", INTERNAL_LEASE_PATH);

    return (withKey ? pending.set(INTERNAL_KEY_HEADER, key()) : pending).send(body as object);
  }

  describe("a lease for a local provider", () => {
    it("answers with an address, and with nothing that could be a credential", async () => {
      // The first acceptance criterion, inspected in the bytes that crossed the boundary.
      const { run, workspace } = await seedRun();

      const response = await lease({ provider: "ollama", run }).expect(200);
      const granted = bodyOf<LeaseResource>(response);

      expect(granted.baseUrl).toBe(OLLAMA);
      expect(granted.provider).toBe("ollama");
      expect(granted.run).toBe(run);
      expect(granted.organizationId).toBe(workspace.id);

      for (const [field, value] of Object.entries(granted)) {
        expect(field).not.toMatch(/key|token|secret|credential|password/i);
        expect(["string", "number"]).toContain(typeof value);
      }
    });

    it("carries a TTL, and an expiry that agrees with it", async () => {
      const { run } = await seedRun();

      const granted = bodyOf<LeaseResource>(await lease({ provider: "ollama", run }).expect(200));

      expect(granted.ttlSeconds).toBe(LEASE_TTL_SECONDS);
      expect(Date.parse(granted.expiresAt) - Date.parse(granted.grantedAt)).toBe(
        LEASE_TTL_SECONDS * 1000,
      );
      expect(Date.parse(granted.expiresAt)).toBeGreaterThan(Date.now());
    });

    it("resolves the workspace from the run rather than from the caller", async () => {
      // Per-run scoping, end to end. Two workspaces exist and the request names neither; the
      // answer names the one the run belongs to, which is the only place it could have come
      // from.
      const first = await seedRun();
      const second = await seedRun();

      const one = bodyOf<LeaseResource>(
        await lease({ provider: "ollama", run: first.run }).expect(200),
      );
      const two = bodyOf<LeaseResource>(
        await lease({ provider: "ollama", run: second.run }).expect(200),
      );

      expect(one.organizationId).toBe(first.workspace.id);
      expect(two.organizationId).toBe(second.workspace.id);
      expect(one.organizationId).not.toBe(two.organizationId);
    });

    it("serves the second leasable kind from its own address", async () => {
      // Two kinds are leasable and they are configured separately; a service that answered
      // both from one entry would be one address away from sending every local call to the
      // wrong daemon.
      const { run } = await seedRun();

      const granted = bodyOf<LeaseResource>(
        await lease({ provider: "openai_compatible", run }).expect(200),
      );

      expect(granted.baseUrl).toBe(VLLM);
    });

    it("gives each grant its own id", async () => {
      const { run } = await seedRun();

      const first = bodyOf<LeaseResource>(await lease({ provider: "ollama", run }).expect(200));
      const second = bodyOf<LeaseResource>(await lease({ provider: "ollama", run }).expect(200));

      expect(first.id).not.toBe(second.id);
    });
  });

  describe("a lease for a cloud provider", () => {
    it.each([...CLOUD_PROVIDER_KINDS])("is 403 by policy: %s", async (provider) => {
      // The criterion, per cloud adapter kind rather than on a representative one.
      const { run } = await seedRun();

      const response = await lease({ provider, run }).expect(403);
      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe(INTERNAL_ERRORS.providerNotLeasable);
      expect(envelope.details).toEqual({ provider });
      expect(envelope.message).toContain(INTERNAL_INVOKE_PATH);
    });

    it("is refused even when the run does not exist", async () => {
      // Policy first: the refusal cannot be made to depend on state, and a caller cannot
      // learn whether a run exists by asking about a provider they may not have.
      const response = await lease({
        provider: "anthropic",
        run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
      }).expect(403);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(INTERNAL_ERRORS.providerNotLeasable);
    });
  });

  describe("the requests this surface refuses for other reasons", () => {
    it("answers 404 for a run that does not exist", async () => {
      const response = await lease({
        provider: "ollama",
        run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
      }).expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(INTERNAL_ERRORS.runNotFound);
    });

    it("answers 422 for a provider kind that does not exist", async () => {
      const { run } = await seedRun();

      const response = await lease({ provider: "openai-compatible", run }).expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
    });

    it("answers 422 for a body carrying a field this surface does not define", async () => {
      // The pipe's whitelist. A worker sending an unknown field is a worker built against a
      // different version of the contract, and finding out immediately is cheaper than
      // finding out through behaviour.
      const { run } = await seedRun();

      await lease({ provider: "ollama", run, apiKey: "sk-live-nope" }).expect(422);
    });
  });

  describe("the #51 authentication", () => {
    it("refuses a caller with no key, in the envelope", async () => {
      const { run } = await seedRun();

      const response = await lease({ provider: "ollama", run }, false).expect(401);

      expect(bodyOf<ErrorEnvelope>(response)).toEqual({
        code: INTERNAL_ERRORS.unauthenticated,
        message: expect.any(String) as string,
        details: {},
      });
    });

    it("refuses a caller with the wrong key", async () => {
      const { run } = await seedRun();

      await api
        .anonymous("post", INTERNAL_LEASE_PATH)
        .set(INTERNAL_KEY_HEADER, "not-the-shared-secret")
        .send({ provider: "ollama", run })
        .expect(401);
    });

    it("refuses before the validation pipe, so a stranger learns nothing about the shape", async () => {
      // A guard runs before a pipe. Without that ordering a malformed body would be a `422`
      // that told an unauthenticated caller which fields exist.
      await api
        .anonymous("post", INTERNAL_LEASE_PATH)
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ nonsense: true }))
        .expect(401);
    });

    it("refuses a signed-in person, because a cookie is not a shared secret", async () => {
      // The most privileged browser in the installation gets exactly what a stranger gets.
      const owner = await api.signUp();
      const { run } = await seedRun();

      await api
        .as(owner)("post", INTERNAL_LEASE_PATH)
        .send({ provider: "ollama", run })
        .expect(401);
    });
  });

  describe("the audit trail", () => {
    /**
     * Every `credential.lease_granted` row this workspace has, read outside the application.
     *
     * Read from the table rather than from a `Logger` spy since AD.4
     * ([#225](https://github.com/NobuData/ouroboros/issues/225)) landed `audit_events`: the
     * seam this suite used to observe emitted a log line because there was no table to write
     * to, and its own header said the method body would become an insert. It has. What is
     * asserted is what survived the change of sink — one row per grant, naming the lease, the
     * run and the workspace it was attributed to.
     *
     * @param organizationId - The workspace whose trail to read.
     * @returns Every lease-grant row, oldest first.
     */
    async function grantsFor(organizationId: string) {
      const { rows } = await api.sql.query<{
        actor_id: string | null;
        subject_type: string;
        subject_id: string;
        detail: Record<string, unknown>;
      }>(
        `select actor_id, subject_type, subject_id, detail
           from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action = $2
          order by occurred_at, id`,
        [organizationId, LEASE_GRANTED_EVENT],
      );

      return rows;
    }

    it("writes one credential.lease_granted event per grant", async () => {
      const { run, workspace } = await seedRun();

      const granted = bodyOf<LeaseResource>(await lease({ provider: "ollama", run }).expect(200));

      const events = await grantsFor(workspace.id);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ subject_type: "run", subject_id: run });
      expect(events[0].detail).toMatchObject({ lease: granted.id, provider: "ollama" });
    });

    it("attributes it to nobody, because a worker is not a person", async () => {
      // The one event class in the vocabulary with no actor: this request authenticated with
      // the internal service key rather than as somebody. `audit_events.actor_id` is nullable
      // for exactly this, and naming a user here would be inventing one.
      const { run, workspace } = await seedRun();

      await lease({ provider: "ollama", run }).expect(200);

      expect((await grantsFor(workspace.id))[0].actor_id).toBeNull();
    });

    it("writes none for a refused lease", async () => {
      const { run, workspace } = await seedRun();

      await lease({ provider: "anthropic", run }).expect(403);

      expect(await grantsFor(workspace.id)).toEqual([]);
    });
  });

  describe("the invocation proxy", () => {
    it("answers 501, naming the issue that implements it", async () => {
      const response = await api
        .anonymous("post", INTERNAL_INVOKE_PATH)
        .set(INTERNAL_KEY_HEADER, key())
        .send({ alias: "reasoning-primary", payload: {}, runCtx: { run: "r" } })
        .expect(501);

      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe(INTERNAL_ERRORS.invocationNotImplemented);
      expect(envelope.message).toContain("#235");
    });

    it("requires the key before it says even that", async () => {
      await api.anonymous("post", INTERNAL_INVOKE_PATH).send({}).expect(401);
    });
  });

  describe("a deployment that declares no local providers", () => {
    it("answers 404 naming the variable an operator sets", async () => {
      // The common posture — most installations run no local model server — and the answer
      // has to send an operator to the right place rather than reading as a permission
      // problem.
      const bare = await ApiHarness.start();

      try {
        const owner = await bare.signUp();
        const workspace = await workspaceWithRepo(bare, owner);
        const { rows } = await bare.sql.query<{ id: string }>(
          `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                       workflow_tag, model, status, stage_label, stage_index,
                                       stage_total)
           values ($1, $2, 224, 'No local providers', 'standard-fix', 'claude-fable-5',
                   'coding', 'Analyse', 1, 6)
           returning id`,
          [workspace.id, workspace.repoId],
        );

        const response = await bare
          .anonymous("post", INTERNAL_LEASE_PATH)
          .set(INTERNAL_KEY_HEADER, bare.configuration.engineSharedSecret)
          .send({ provider: "ollama", run: rows[0].id })
          .expect(404);

        const envelope = bodyOf<ErrorEnvelope>(response);

        expect(envelope.code).toBe(INTERNAL_ERRORS.localProviderNotConfigured);
        expect(envelope.message).toContain("OURO_LOCAL_PROVIDER_URLS");
      } finally {
        await bare.truncate();
        await bare.close();
      }
    });
  });
});

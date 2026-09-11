import { ENGINE_ESTIMATE_BODY, ESTIMATE_REQUEST } from "../modules/engine/engine.fixture";
import { estimateRequestBody } from "../modules/engine/engine.contract";
import { INTERNAL_KEY_HEADER } from "../modules/engine/engine.contract";
import {
  ENGINE_STUB_SECRET,
  ESTIMATE_PATH,
  LIVENESS_PATH,
  STATUS_PATH,
  contractViolation,
  engineFailure,
  estimateAnswer,
  offContractAnswer,
  startEngineStub,
  type EngineStub,
} from "./engine.stub.fixture";

/**
 * The stub, held to the same standard it holds everything else to — L.5
 * ([#109](https://github.com/NobuData/ouroboros/issues/109)).
 *
 * A fake nobody tests is a second implementation of the contract with no tests, and this one
 * carries an acceptance criterion of its own: *the stub validates its own responses against the
 * committed L.1 schema.* That claim is only worth writing down if something fails when it stops
 * being true, which is what this file is.
 *
 * It needs no database, so it lives in the unit suite: the checks below are about a document on
 * disk (`ouroboros-engine/openapi.yaml`) and a server on loopback, and a developer running
 * `yarn test` on save should find out here that a contract changed rather than twenty seconds
 * into a container start.
 */
describe("the contract-faithful engine stub", () => {
  let engine: EngineStub;

  beforeEach(async () => {
    engine = await startEngineStub();
  });

  afterEach(async () => {
    await engine.stop();
  });

  /**
   * Ask the stub to size something, the way `EngineClient` asks.
   *
   * @param body - The request body, in the engine's own names. Defaults to a well-formed one.
   * @param key - The shared secret to send, or `null` to send none. Deliberately not
   *   `undefined`: a default parameter treats that as *not supplied* and would send the secret,
   *   which is the one thing a test about a missing header must not do.
   * @returns The status and the parsed body.
   */
  async function estimate(
    body: unknown = estimateRequestBody(ESTIMATE_REQUEST),
    key: string | null = ENGINE_STUB_SECRET,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${engine.url}${ESTIMATE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key === null ? {} : { [INTERNAL_KEY_HEADER]: key }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  describe("what it publishes", () => {
    it("answers a well-formed request with the estimate it was told to give", async () => {
      const answered = await estimate();

      expect(answered.status).toBe(200);
      expect(answered.body).toEqual(ENGINE_ESTIMATE_BODY);
      expect(engine.requests).toHaveLength(1);
      expect(engine.violations).toEqual([]);
    });

    it("answers the open liveness route without a key — #51", async () => {
      const response = await fetch(`${engine.url}${LIVENESS_PATH}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });
      expect(engine.violations).toEqual([]);
    });

    it("answers the build-identity route, which does need one", async () => {
      const response = await fetch(`${engine.url}${STATUS_PATH}`, {
        headers: { [INTERNAL_KEY_HEADER]: ENGINE_STUB_SECRET },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ service: "ouroboros-engine" });
      expect(engine.violations).toEqual([]);
    });

    it("answers 404 for a route the engine does not publish, and says so", async () => {
      const response = await fetch(`${engine.url}/v0/tasks/estimate`, {
        method: "POST",
        headers: { [INTERNAL_KEY_HEADER]: ENGINE_STUB_SECRET },
        body: "{}",
      });

      expect(response.status).toBe(404);
      expect(engine.violations).toEqual([
        "POST /v0/tasks/estimate is not a route ouroboros-engine publishes",
      ]);
    });

    it("answers 404 rather than 401 for a route it does not have, key or no key", async () => {
      // Routing happens before the key is read, which is FastAPI's order and therefore the
      // engine's. A stub that answered `401` here would teach a reader that an unknown path is
      // a credential problem.
      const response = await fetch(`${engine.url}/v0/estimate/42`);

      expect(response.status).toBe(404);
      expect(engine.violations).toEqual([
        "GET /v0/estimate/42 is not a route ouroboros-engine publishes",
      ]);
    });
  });

  describe("the shared secret", () => {
    it("refuses a call carrying none, in the envelope the engine uses", async () => {
      const refused = await estimate(estimateRequestBody(ESTIMATE_REQUEST), null);

      expect(refused.status).toBe(401);
      expect(refused.body).toMatchObject({ code: "unauthenticated" });
      expect(engine.requests).toHaveLength(0);
      expect(engine.violations).toEqual([
        `POST ${ESTIMATE_PATH} arrived with no ${INTERNAL_KEY_HEADER}`,
      ]);
    });

    it("refuses a call carrying the wrong one", async () => {
      const refused = await estimate(estimateRequestBody(ESTIMATE_REQUEST), "not-the-secret");

      expect(refused.status).toBe(401);
      expect(engine.violations).toEqual([
        `POST ${ESTIMATE_PATH} arrived with the wrong ${INTERNAL_KEY_HEADER}`,
      ]);
    });
  });

  describe("what a caller may send", () => {
    it("refuses a body the EstimateRequest schema does not allow, naming the field", async () => {
      // The failure this half exists for: a caller that stopped translating one key. The
      // engine's schema is closed, so `workflowTags` is not a tolerated extra — it is a
      // missing `workflow_tags` and an unknown property, and the stub says both.
      const refused = await estimate({
        issue: ESTIMATE_REQUEST.issue,
        context: { workflowTags: ["standard-fix"], modelDefaults: { default: "m" } },
      });

      expect(refused.status).toBe(422);
      expect(engine.requests).toHaveLength(0);
      expect(engine.violations).toHaveLength(1);
      expect(engine.violations[0]).toContain("workflow_tags");
    });

    it("refuses a repository that is not `owner/name`", async () => {
      const refused = await estimate({
        ...estimateRequestBody(ESTIMATE_REQUEST),
        issue: { ...ESTIMATE_REQUEST.issue, repo: "helios-firmware" },
      });

      expect(refused.status).toBe(422);
      expect(engine.violations[0]).toContain("/issue/repo");
    });

    it("refuses a body that is not JSON at all", async () => {
      const refused = await estimate("not json");

      expect(refused.status).toBe(422);
      expect(engine.violations).toEqual([`POST ${ESTIMATE_PATH} carried a body that is not JSON`]);
    });
  });

  describe("what it will serve", () => {
    it("refuses to serve a 200 the Estimate schema does not allow", async () => {
      // The acceptance criterion. A test that scripts an answer the engine could never give is
      // a test asserting against fiction, and the stub is the thing that notices.
      engine.respond(() => ({
        status: 200,
        body: { ...ENGINE_ESTIMATE_BODY, effort: "enormous" },
      }));

      const answered = await estimate();

      expect(answered.status).toBe(500);
      expect(engine.violations).toHaveLength(1);
      expect(engine.violations[0]).toContain("Estimate schema");
      expect(engine.violations[0]).toContain("/effort");
    });

    it("refuses to serve a 200 missing a field the contract requires", async () => {
      const { trace: _dropped, ...withoutTrace } = ENGINE_ESTIMATE_BODY;

      engine.respond(() => ({ status: 200, body: withoutTrace }));

      const answered = await estimate();

      expect(answered.status).toBe(500);
      expect(engine.violations[0]).toContain("trace");
    });

    it("serves an off-contract body when a test says that is the point", async () => {
      engine.respond(() => offContractAnswer());

      const answered = await estimate();

      expect(answered.status).toBe(200);
      expect(answered.body).toMatchObject({ effort: "enormous" });
      expect(engine.violations).toEqual([]);
    });

    it("holds a failure to the engine's error envelope too", async () => {
      engine.respond(() => ({ status: 503, body: { oops: true } }));

      const answered = await estimate();

      expect(answered.status).toBe(500);
      expect(engine.violations[0]).toContain("Error schema");
    });

    it("serves the envelope `engineFailure` builds, unremarked", async () => {
      engine.respond(() => engineFailure());

      const answered = await estimate();

      expect(answered.status).toBe(503);
      expect(answered.body).toMatchObject({ code: "unavailable", details: {} });
      expect(engine.violations).toEqual([]);
    });

    it("counts attempts so a responder can answer a retry differently", async () => {
      engine.respond((attempt) => (attempt === 1 ? engineFailure() : estimateAnswer()));

      expect((await estimate()).status).toBe(503);
      expect((await estimate()).status).toBe(200);
      expect(engine.violations).toEqual([]);
    });

    it("forgets everything on reset", async () => {
      engine.respond(() => engineFailure());
      await estimate(estimateRequestBody(ESTIMATE_REQUEST), null);

      engine.reset();

      expect(engine.requests).toEqual([]);
      expect(engine.violations).toEqual([]);
      expect((await estimate()).status).toBe(200);
    });
  });

  describe("the committed schema is the standard", () => {
    it("reads it from ouroboros-engine/openapi.yaml, and the mockup's estimate satisfies it", () => {
      expect(contractViolation("estimate", ENGINE_ESTIMATE_BODY)).toBeUndefined();
    });

    it("holds this service's own request translation to it", () => {
      // `estimateRequestBody` is the only place `camelCase` becomes `snake_case`. Its output
      // being a valid `EstimateRequest` is the whole of the L.1 boundary, checked here without
      // a socket.
      expect(contractViolation("request", estimateRequestBody(ESTIMATE_REQUEST))).toBeUndefined();
    });

    it("rejects a body the document forbids, so the check is not vacuous", () => {
      expect(contractViolation("estimate", { ...ENGINE_ESTIMATE_BODY, extra: 1 })).toContain(
        "Estimate schema",
      );
      expect(contractViolation("estimate", {})).toContain("effort");
    });

    it("refuses to start at all when the default answer has drifted from it", async () => {
      // What a contract change looks like from here: not a failing assertion in one pipeline
      // test, but a stub that will not come up, naming the field.
      await expect(
        startEngineStub({ answer: { status: 200, body: { effort: "m" } } }),
      ).rejects.toThrow(/default answer does not satisfy the engine's Estimate schema/);
    });
  });
});

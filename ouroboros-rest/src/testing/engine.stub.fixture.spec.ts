import {
  ENGINE_ESTIMATE_BODY,
  ESTIMATE_REQUEST,
  PLAN_REQUEST,
  planGoldenCase,
} from "../modules/engine/engine.fixture";
import {
  estimateRequestBody,
  planRequestBody,
  workflowValidateRequestBody,
} from "../modules/engine/engine.contract";
import { INTERNAL_KEY_HEADER } from "../modules/engine/engine.contract";
import {
  ENGINE_STUB_SECRET,
  ESTIMATE_PATH,
  LIVENESS_PATH,
  PLAN_PATH,
  STATUS_PATH,
  WORKFLOW_DRY_RUN_PATH,
  WORKFLOW_VALIDATE_PATH,
  contractViolation,
  dryRunAnswer,
  dryRunExample,
  engineFailure,
  estimateAnswer,
  offContractAnswer,
  planAnswer,
  startEngineStub,
  validationFindings,
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

  describe("the workflow validation route", () => {
    /** A definition. What it holds is the engine's business, and never the stub's. */
    const DEFINITION = { dsl_version: "1.0", nodes: [], edges: [] };

    /**
     * Ask the stub to validate, the way `EngineClient.validateWorkflow` asks.
     *
     * @param body - The request body. Defaults to a well-formed one.
     * @returns The status and the parsed body.
     */
    async function validate(
      body: unknown = workflowValidateRequestBody(DEFINITION),
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const response = await fetch(`${engine.url}${WORKFLOW_VALIDATE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_KEY_HEADER]: ENGINE_STUB_SECRET },
        body: JSON.stringify(body),
      });

      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    }

    it("is published, answers green, and records what the gate sent", async () => {
      expect(await validate()).toEqual({ status: 200, body: { findings: [] } });
      expect(engine.validations).toEqual([{ definition: DEFINITION }]);
      expect(engine.requests).toEqual([]);
      expect(engine.violations).toEqual([]);
    });

    it("refuses a body the engine's WorkflowValidateRequest does not describe", async () => {
      const refused = await validate({ document: DEFINITION });

      expect(refused.status).toBe(422);
      expect(engine.validations).toEqual([]);
      expect(engine.violations).toHaveLength(1);
      expect(engine.violations[0]).toContain(`The body of POST ${WORKFLOW_VALIDATE_PATH}`);
      expect(engine.violations[0]).toContain("WorkflowValidateRequest schema");
    });

    it("still requires the shared secret", async () => {
      const response = await fetch(`${engine.url}${WORKFLOW_VALIDATE_PATH}`, {
        method: "POST",
        body: JSON.stringify(workflowValidateRequestBody(DEFINITION)),
      });

      expect(response.status).toBe(401);
      expect(engine.violations).toEqual([
        `POST ${WORKFLOW_VALIDATE_PATH} arrived with no ${INTERNAL_KEY_HEADER}`,
      ]);
    });

    it("forgets its validations on reset", async () => {
      await validate();

      engine.reset();

      expect(engine.validations).toEqual([]);
    });

    it("holds this service's request translation and its own answer to the engine's schemas", () => {
      expect(
        contractViolation("validateRequest", workflowValidateRequestBody(DEFINITION)),
      ).toBeUndefined();
      expect(contractViolation("validation", { findings: [] })).toBeUndefined();
      expect(
        contractViolation("validation", { findings: [{ code: "node.unreachable" }] }),
      ).toContain("WorkflowValidation schema");
    });
  });

  /**
   * Post a body to one of the stub's routes, the way `EngineClient` posts.
   *
   * @param path - The route.
   * @param body - The body, serialised here.
   * @param key - The shared secret to send, or `null` to send none — for {@link estimate}'s reason.
   * @returns The status and the parsed body.
   */
  async function post(
    path: string,
    body: unknown,
    key: string | null = ENGINE_STUB_SECRET,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${engine.url}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key === null ? {} : { [INTERNAL_KEY_HEADER]: key }),
      },
      body: JSON.stringify(body),
    });

    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  describe("a scripted workflow validation — R.4 (#146)", () => {
    /** A body the validation route accepts. What the definition holds is not the stub's business. */
    const REQUEST = workflowValidateRequestBody({ dsl_version: "1.0", nodes: [], edges: [] });

    /** A finding the engine's document itself uses as its example. */
    const UNREACHABLE = {
      code: "node.unreachable",
      message: "No path of edges reaches this stage from the trigger.",
      path: "/nodes/2",
      node_id: "orphan",
    };

    it("serves the findings a suite scripts, counting attempts per operation", async () => {
      engine.respondToValidation((attempt) =>
        attempt === 1 ? validationFindings(UNREACHABLE) : validationFindings(),
      );

      expect(await post(WORKFLOW_VALIDATE_PATH, REQUEST)).toEqual({
        status: 200,
        body: { findings: [UNREACHABLE] },
      });
      expect(await post(WORKFLOW_VALIDATE_PATH, REQUEST)).toEqual({
        status: 200,
        body: { findings: [] },
      });
      expect(engine.validations).toHaveLength(2);
      expect(engine.violations).toEqual([]);
    });

    it("serves the engine's own failure envelope, unremarked", async () => {
      engine.respondToValidation(() => engineFailure());

      const answered = await post(WORKFLOW_VALIDATE_PATH, REQUEST);

      expect(answered.status).toBe(503);
      expect(answered.body).toMatchObject({ code: "unavailable" });
      expect(engine.violations).toEqual([]);
    });

    it("refuses to serve a finding the engine could never send", async () => {
      // No `path`: `WorkflowFinding` requires one, so a gate that relied on its absence would be
      // relying on an engine that does not exist.
      engine.respondToValidation(() => ({
        status: 200,
        body: { findings: [{ code: "node.unreachable", message: "Unanchored." }] },
      }));

      const answered = await post(WORKFLOW_VALIDATE_PATH, REQUEST);

      expect(answered.status).toBe(500);
      expect(engine.violations).toHaveLength(1);
      expect(engine.violations[0]).toContain("WorkflowValidation schema");
      expect(engine.violations[0]).toContain("path");
    });

    it("goes back to green on reset", async () => {
      engine.respondToValidation(() => validationFindings(UNREACHABLE));

      engine.reset();

      expect(await post(WORKFLOW_VALIDATE_PATH, REQUEST)).toEqual({
        status: 200,
        body: { findings: [] },
      });
    });
  });

  describe("the dry-run route — R.4 (#146)", () => {
    it("is published, answers the committed example, and records what was sent", async () => {
      const { request, answer } = dryRunExample();

      expect(await post(WORKFLOW_DRY_RUN_PATH, request)).toEqual({ status: 200, body: answer });
      expect(engine.dryRuns).toEqual([request]);
      expect(engine.requests).toEqual([]);
      expect(engine.validations).toEqual([]);
      expect(engine.violations).toEqual([]);
    });

    it("refuses a ticket in this service's names rather than the engine's", async () => {
      // The translation S.6 will have to write, refused the way the engine refuses it: its
      // `DryRunTicket` is closed, so `externalKey` is an unknown property *and* a missing
      // `external_key`.
      const { request } = dryRunExample();

      const refused = await post(WORKFLOW_DRY_RUN_PATH, {
        ...request,
        ticket: { externalKey: "#485", source: "github", labels: [], estimate: null },
      });

      expect(refused.status).toBe(422);
      expect(engine.dryRuns).toEqual([]);
      expect(engine.violations).toHaveLength(1);
      expect(engine.violations[0]).toContain("WorkflowDryRunRequest schema");
      expect(engine.violations[0]).toContain("external_key");
    });

    it("still requires the shared secret", async () => {
      const refused = await post(WORKFLOW_DRY_RUN_PATH, dryRunExample().request, null);

      expect(refused.status).toBe(401);
      expect(engine.violations).toEqual([
        `POST ${WORKFLOW_DRY_RUN_PATH} arrived with no ${INTERNAL_KEY_HEADER}`,
      ]);
    });

    it("serves a scripted walk — an invalid definition's findings, and nothing walked", async () => {
      engine.respondToDryRun(() =>
        dryRunAnswer({
          findings: [
            {
              code: "node.unreachable",
              message: "Unreachable.",
              path: "/nodes/2",
              node_id: "orphan",
            },
          ],
          steps: [],
          verdicts: [],
          highlight_path: [],
        }),
      );

      const answered = await post(WORKFLOW_DRY_RUN_PATH, dryRunExample().request);

      expect(answered.status).toBe(200);
      expect(answered.body).toMatchObject({ steps: [], highlight_path: [] });
      expect(engine.violations).toEqual([]);
    });

    it("refuses to serve a walk the WorkflowDryRun schema does not allow", async () => {
      engine.respondToDryRun(() => dryRunAnswer({ highlight_path: [{ from: "issue-queued" }] }));

      const answered = await post(WORKFLOW_DRY_RUN_PATH, dryRunExample().request);

      expect(answered.status).toBe(500);
      expect(engine.violations).toHaveLength(1);
      expect(engine.violations[0]).toContain("WorkflowDryRun schema");
      expect(engine.violations[0]).toContain("/highlight_path/0");
    });

    it("forgets its dry-runs and its scripted walk on reset", async () => {
      engine.respondToDryRun(() => engineFailure());
      await post(WORKFLOW_DRY_RUN_PATH, dryRunExample().request);

      engine.reset();

      expect(engine.dryRuns).toEqual([]);
      expect((await post(WORKFLOW_DRY_RUN_PATH, dryRunExample().request)).status).toBe(200);
    });

    it("hands out a fresh copy of the example every time", () => {
      const first = dryRunExample();
      (first.answer.findings as unknown[]).push("mutated");

      expect(dryRunExample().answer.findings).toEqual([]);
    });
  });

  describe("the plan route — AL.4 (#280)", () => {
    /** @returns AL.1's golden request, in the engine's names. */
    function planRequest(): Record<string, unknown> {
      return planGoldenCase().request;
    }

    it("is published, answers the golden OTA batch, and records what was sent", async () => {
      expect(await post(PLAN_PATH, planRequest())).toEqual({
        status: 200,
        body: planGoldenCase().response,
      });
      expect(engine.plans).toEqual([planRequest()]);
      expect(engine.requests).toEqual([]);
      expect(engine.violations).toEqual([]);
    });

    it("refuses a request in this service's names rather than the engine's", async () => {
      const refused = await post(PLAN_PATH, {
        narrative: "OTA",
        outline: null,
        context: { workflowTags: ["feature-loop"], milestone: null, localKeyPrefix: "OTA" },
      });

      expect(refused.status).toBe(422);
      expect(engine.plans).toEqual([]);
      expect(engine.violations[0]).toContain("PlanRequest schema");
    });

    it("still requires the shared secret", async () => {
      expect((await post(PLAN_PATH, planRequest(), null)).status).toBe(401);
    });

    it("serves a scripted batch, and refuses to serve one without a planner", async () => {
      engine.respondToPlan(() => planAnswer({ notes: ["Add a structured outline."] }));

      expect((await post(PLAN_PATH, planRequest())).body).toMatchObject({
        notes: ["Add a structured outline."],
      });

      engine.respondToPlan(() => planAnswer({ planner: "" }));

      expect((await post(PLAN_PATH, planRequest())).status).toBe(500);
      expect(engine.violations[0]).toContain("Plan schema");
    });

    it("forgets its plans and its scripted batch on reset", async () => {
      engine.respondToPlan(() => engineFailure());
      await post(PLAN_PATH, planRequest());

      engine.reset();

      expect(engine.plans).toEqual([]);
      expect((await post(PLAN_PATH, planRequest())).status).toBe(200);
    });

    it("holds this service's request translation to the engine's schema", () => {
      expect(contractViolation("planRequest", planRequestBody(PLAN_REQUEST))).toBeUndefined();
      expect(contractViolation("plan", planGoldenCase().response)).toBeUndefined();
    });
  });

  describe("the committed schema is the standard", () => {
    it("reads it from ouroboros-engine/openapi.yaml, and the mockup's estimate satisfies it", () => {
      expect(contractViolation("estimate", ENGINE_ESTIMATE_BODY)).toBeUndefined();
    });

    it("carries a dry-run example whose request and answer both satisfy it", () => {
      const { request, answer } = dryRunExample();

      expect(contractViolation("dryRunRequest", request)).toBeUndefined();
      expect(contractViolation("dryRun", answer)).toBeUndefined();
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

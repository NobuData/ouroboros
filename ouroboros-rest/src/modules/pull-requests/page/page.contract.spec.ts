import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import type { RunControlResource } from "../../controls/controls.resources";
import { criteriaCounts } from "../criteria/criteria.resources";
import { mergePlanResource } from "../merge/merge.resources";
import { PageActionsService } from "./page.actions";
import { PageService } from "./page.service";
import { FakePageStore, KEN, ORG, PR, REV_1, totals } from "./page.store.fixture";

/**
 * The OpenAPI document and what the PR page's routes actually send (AX.5,
 * [#361](https://github.com/NobuData/ouroboros/issues/361)). `openapi.spec.ts` sees these routes only
 * unauthenticated, so this is where a `200` body is held to its schema — every schema is
 * `additionalProperties: false`, so a field the code adds and the document does not list fails here.
 */

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns A function answering Ajv's complaint, or undefined when the value validates.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/** A value as the client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** The matrix and plan the page composes, as their own services answer them. */
const MATRIX = { prId: PR, counts: criteriaCounts([]), criteria: [] };
const PLAN = mergePlanResource({
  id: "5eed0041-0000-4000-8000-000000000514",
  prId: PR,
  strategy: "squash",
  deleteBranch: true,
  commitMessage: "fix(can): preserve ISR frame order in telemetry path\n\nCloses #482.",
  closeTicket: true,
  commentEvidence: true,
  backAnnotateEpic: false,
  epicId: null,
  armed: false,
  armedBy: null,
  armedAt: null,
  armedAgainstRevisionId: null,
  disarmReason: null,
  mergedResult: null,
  updatedAt: new Date("2026-09-27T14:31:00Z"),
});

/**
 * @param store - The store.
 * @returns The read service.
 */
function pages(store: FakePageStore): PageService {
  return new PageService(
    store,
    { matrix: () => Promise.resolve(MATRIX) },
    { plan: () => Promise.resolve(PLAN) },
  );
}

/**
 * @param store - The store.
 * @returns The actions service, over a queue that answers a full control.
 */
function actions(store: FakePageStore): PageActionsService {
  const control: RunControlResource = {
    id: "c0000000-0000-4000-8000-000000000001",
    runId: "5eed0009-0000-4000-8000-000000000482",
    kind: "steer",
    state: "pending",
    requestedBy: KEN.id,
    requestedAt: "2026-09-27T15:00:00.000Z",
    deliveredAt: null,
    ackedAt: null,
    expiresAt: "2026-09-27T15:10:00.000Z",
    detail: null,
    hasPayload: true,
    remember: false,
    retryStage: true,
  };

  return new PageActionsService(
    store,
    { correctionRound: () => Promise.resolve(control) },
    { notify: () => Promise.resolve() },
    { requestReview: () => Promise.resolve({ requested: ["priya"] }) },
    { record: () => Promise.resolve("1") },
  );
}

const ACTOR = { id: KEN.id, name: KEN.name, roles: ["member" as const] };

describe("the PR page keeps its OpenAPI contract", () => {
  it("GET /pull-requests/{id} sends a PullRequestPage", async () => {
    expect(
      validatorFor("PullRequestPage")(wire(await pages(new FakePageStore()).page(ORG, PR))),
    ).toBeUndefined();
  });

  it("…with a review, a loop return, an unpriced ledger and no cap too", async () => {
    const store = new FakePageStore();
    store.ledger = { loop: totals(284_000, null, 6), verification: totals(0, null) };
    store.route = undefined;
    await actions(store).returnToLoop(ORG, PR, ACTOR, {
      gates: ["physical_hil"],
      revisionId: REV_1,
    });
    await actions(store).requestReview(ORG, PR, ACTOR, { reviewer: "priya" });

    const page = wire(await pages(store).page(ORG, PR));

    expect(validatorFor("PullRequestPage")(page)).toBeUndefined();
    expect(page).toMatchObject({ spend: { loop: { costCents: null }, withinCap: null } });
  });

  it("…for a PR with no run and no revision", async () => {
    const store = new FakePageStore();
    store.head514 = { ...store.head514, run: null, ticket: null };
    store.revisionRows = [];
    store.gates = [];

    expect(validatorFor("PullRequestPage")(wire(await pages(store).page(ORG, PR)))).toBeUndefined();
  });

  it("GET /pull-requests sends a PullRequestList", async () => {
    expect(
      validatorFor("PullRequestList")(wire(await pages(new FakePageStore()).list(ORG, {}))),
    ).toBeUndefined();
  });

  it("POST …/return-to-loop sends a ReturnToLoop", async () => {
    const body = await actions(new FakePageStore()).returnToLoop(ORG, PR, ACTOR, {
      gates: ["test_suite", "physical_hil"],
      revisionId: REV_1,
      note: "keep the PID loop on its own timer",
    });

    expect(validatorFor("ReturnToLoop")(wire(body))).toBeUndefined();
  });

  it("POST …/request-review and …/approvals send a PrReviewOutcome", async () => {
    const store = new FakePageStore();

    expect(
      validatorFor("PrReviewOutcome")(
        wire(await actions(store).requestReview(ORG, PR, ACTOR, { reviewer: "priya" })),
      ),
    ).toBeUndefined();
    expect(
      validatorFor("PrReviewOutcome")(
        wire(await actions(store).decide(ORG, PR, ACTOR, { decision: "decline", note: "thermal" })),
      ),
    ).toBeUndefined();
  });

  it("documents every head action's refusals by code", () => {
    const paths = document().paths as Record<
      string,
      Record<string, { responses: Record<string, { description: string }> }>
    >;
    const text = (path: string, status: string) =>
      paths[`/api/v1/pull-requests/{id}/${path}`].post.responses[status].description;

    expect(text("return-to-loop", "422")).toContain("pr_gate_not_red");
    expect(text("return-to-loop", "409")).toContain("pull_request_has_no_run");
    expect(text("approvals", "422")).toContain("pr_decline_note_required");
    expect(text("request-review", "409")).toContain("pull_request_not_open");
  });
});

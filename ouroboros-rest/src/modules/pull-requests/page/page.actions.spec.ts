import type { AuditRecord } from "../../audit/audit.events";
import type { RunControlResource } from "../../controls/controls.resources";
import type { Requester } from "../../controls/controls.service";
import type { GateEvidenceEvent } from "../gates/gate.evidence";
import {
  MAX_HOST_DETAIL_LENGTH,
  PageActionsService,
  hostDetail,
  type PageHost,
} from "./page.actions";
import { FakePageStore, KEN, ORG, OTHER_ORG, PR, REV_1, REV_2, RUN } from "./page.store.fixture";

/**
 * The head actions over fakes (AX.5, [#361](https://github.com/NobuData/ouroboros/issues/361),
 * decision **V5**): *Return to loop* is AP.4's correction round carrying the selected red gates'
 * evidence; *Request human review* opens the approval slot and re-evaluates the gate; an approval
 * answers it and can flip the aggregate.
 */

const ACTOR: Requester = { id: KEN.id, name: KEN.name, roles: ["member"] };

/** AP.4's queue, answering every correction round as its state says. */
class FakeControls {
  state: RunControlResource["state"] = "pending";
  readonly calls: { runId: string; requester: Requester; note: string; key?: string }[] = [];

  correctionRound(
    _organizationId: string,
    runId: string,
    requester: Requester,
    note: string,
    idempotencyKey?: string,
  ): Promise<RunControlResource> {
    this.calls.push({
      runId,
      requester,
      note,
      ...(idempotencyKey === undefined ? {} : { key: idempotencyKey }),
    });

    return Promise.resolve({
      id: `control-${idempotencyKey ?? String(this.calls.length)}`,
      runId,
      kind: "steer",
      state: this.state,
      requestedBy: requester.id,
      requestedAt: "2026-09-27T15:00:00.000Z",
      deliveredAt: null,
      ackedAt: null,
      expiresAt: "2026-09-27T15:10:00.000Z",
      detail: this.state === "rejected" ? "the run has already merged" : null,
      hasPayload: true,
      remember: false,
    } as RunControlResource);
  }
}

/**
 * The gate engine: on `approval_recorded` it does what the real one does to human approval on the
 * latest revision — the newest slot's verdict, required.
 */
class FakeGates {
  readonly events: GateEvidenceEvent[] = [];

  constructor(private readonly store: FakePageStore) {}

  async notify(_organizationId: string, event: GateEvidenceEvent): Promise<void> {
    this.events.push(event);
    const slot = await this.store.approval(PR);
    const verdict =
      slot === undefined
        ? "not_required"
        : slot.state === "requested"
          ? "pending"
          : slot.state === "approved"
            ? "green"
            : "red";

    this.store.gates = this.store.gates.map((row) =>
      row.revisionId === REV_2 && row.key === "human_approval"
        ? { ...row, verdict, evidence: `${verdict} (fake engine)` }
        : row,
    );
  }
}

/** The world a case runs in. */
function world() {
  const store = new FakePageStore();
  const controls = new FakeControls();
  const gates = new FakeGates(store);
  const audit: AuditRecord[] = [];
  const host = {
    requestReview: jest.fn<
      ReturnType<PageHost["requestReview"]>,
      Parameters<PageHost["requestReview"]>
    >(() => Promise.resolve({ requested: ["priya"] })),
  };
  const actions = new PageActionsService(store, controls, gates, host, {
    record: (event) => {
      audit.push(event);
      return Promise.resolve(String(audit.length));
    },
  });

  return { store, controls, gates, audit, host, actions };
}

describe("Return to loop", () => {
  it("sends the selected red gates' evidence as the correction round's steer", async () => {
    const { actions, controls } = world();

    const result = await actions.returnToLoop(ORG, PR, ACTOR, {
      gates: ["physical_hil"],
      revisionId: REV_1,
    });

    expect(controls.calls).toEqual([
      {
        runId: RUN,
        requester: ACTOR,
        note: "physical_hil: overshoot 2.4% > 2.0% · rig helios-rig-02",
      },
    ]);
    expect(result).toMatchObject({
      payload: "physical_hil: overshoot 2.4% > 2.0% · rig helios-rig-02",
      revisionId: REV_1,
      gates: ["physical_hil"],
      control: { state: "pending", kind: "steer" },
      loopReturn: {
        revisionId: REV_1,
        gateKeys: ["physical_hil"],
        expected: { stageKey: "implement", attempt: 4 },
      },
      skipped: [],
    });
  });

  it("changes the steer with the selection, in the card's order whatever the click order", async () => {
    const { actions } = world();

    const one = await actions.returnToLoop(ORG, PR, ACTOR, {
      gates: ["test_suite"],
      revisionId: REV_1,
    });
    const both = await actions.returnToLoop(ORG, PR, ACTOR, {
      gates: ["physical_hil", "test_suite"],
      revisionId: REV_1,
      note: "keep the PID loop on its own timer",
    });

    expect(one.payload).toBe("test_suite: 61/63 after attempt 3");
    expect(both.payload).toBe(
      "test_suite: 61/63 after attempt 3\n" +
        "physical_hil: overshoot 2.4% > 2.0% · rig helios-rig-02\n\n" +
        "note: keep the PID loop on its own timer",
    );
    expect(both.gates).toEqual(["test_suite", "physical_hil"]);
  });

  it("judges the latest revision by default, and refuses a gate that is not red there", async () => {
    const { actions, controls } = world();

    await expect(
      actions.returnToLoop(ORG, PR, ACTOR, { gates: ["physical_hil"] }),
    ).rejects.toMatchObject({
      response: {
        code: "pr_gate_not_red",
        details: { revisionId: REV_2, gates: [{ key: "physical_hil", verdict: "green" }] },
      },
    });
    await expect(
      actions.returnToLoop(ORG, PR, ACTOR, { gates: ["custom:bench"], revisionId: REV_1 }),
    ).rejects.toMatchObject({
      response: { details: { gates: [{ key: "custom:bench", verdict: null }] } },
    });
    expect(controls.calls).toEqual([]);
  });

  it("records nothing when the queue rejects the control — the run has finished", async () => {
    const { actions, controls, store } = world();
    controls.state = "rejected";

    const result = await actions.returnToLoop(ORG, PR, ACTOR, {
      gates: ["physical_hil"],
      revisionId: REV_1,
    });

    expect(result.loopReturn).toBeNull();
    expect(result.skipped).toEqual([
      "The run has finished, so no correction round was queued: the run has already merged.",
    ]);
    expect(store.returns).toEqual([]);
  });

  it("records one expectation per control — a replay under the same key is the same record", async () => {
    const { actions, store } = world();
    const request = { gates: ["physical_hil"], revisionId: REV_1, idempotencyKey: "click-1" };

    const first = await actions.returnToLoop(ORG, PR, ACTOR, request);
    const again = await actions.returnToLoop(ORG, PR, ACTOR, request);

    expect(again.loopReturn).toEqual(first.loopReturn);
    expect(store.returns).toHaveLength(1);
  });

  it("expects no attempt when no stage of the run has started", async () => {
    const { actions, store } = world();
    store.stage = undefined;

    const result = await actions.returnToLoop(ORG, PR, ACTOR, {
      gates: ["physical_hil"],
      revisionId: REV_1,
    });

    expect(result.loopReturn?.expected).toBeNull();
    expect(result.skipped).toHaveLength(1);
  });

  it("refuses what it cannot return", async () => {
    const cases: [string, (store: FakePageStore) => void, string, Record<string, unknown>][] = [
      ["another workspace's PR", () => undefined, "pull_request_not_found", {}],
      [
        "a merged PR",
        (store) => (store.head514 = { ...store.head514, state: "merged" }),
        "pull_request_not_open",
        {},
      ],
      [
        "a PR no loop opened",
        (store) => (store.head514 = { ...store.head514, run: null }),
        "pull_request_has_no_run",
        {},
      ],
      [
        "a PR with no revision",
        (store) => (store.revisionRows = []),
        "pull_request_has_no_revision",
        {},
      ],
      [
        "another PR's revision",
        () => undefined,
        "pr_revision_not_found",
        { revisionId: "9b1e0000-0000-4000-8000-000000000000" },
      ],
    ];

    for (const [name, arrange, code, extra] of cases) {
      const { actions, store } = world();
      arrange(store);
      const org = name === "another workspace's PR" ? OTHER_ORG : ORG;

      await expect(
        actions.returnToLoop(org, PR, ACTOR, { gates: ["physical_hil"], ...extra }),
      ).rejects.toMatchObject({ response: { code } });
    }
  });
});

describe("Request human review", () => {
  it("opens the slot, flips human approval to pending, and records who asked", async () => {
    const { actions, gates, audit } = world();

    const outcome = await actions.requestReview(ORG, PR, ACTOR, {});

    expect(outcome).toMatchObject({
      created: true,
      review: { state: "requested", requestedBy: KEN, requestedRevisionId: REV_2, host: null },
      humanApproval: { key: "human_approval", verdict: "pending" },
      aggregate: { satisfiedCount: 5, mergeReady: false },
    });
    expect(gates.events).toEqual([{ kind: "approval_recorded", prId: PR }]);
    expect(audit).toEqual([
      expect.objectContaining({
        action: "pr_approval.requested",
        actorId: KEN.id,
        subjectType: "pr_approval",
        subjectId: outcome.review.id,
        detail: { pr_id: PR, revision_id: REV_2, host_reviewer_asked: false },
      }),
    ]);
  });

  it("answers a second request with the open slot — one question, not a queue", async () => {
    const { actions, audit, store } = world();

    const first = await actions.requestReview(ORG, PR, ACTOR, {});
    const second = await actions.requestReview(ORG, PR, ACTOR, {});

    expect(second.created).toBe(false);
    expect(second.review.id).toBe(first.review.id);
    expect(store.approvals).toHaveLength(1);
    expect(audit).toHaveLength(1);
  });

  it("is the needs-you item — the listing's reviewRequested feed finds it", async () => {
    const { actions, store } = world();

    await actions.requestReview(ORG, PR, ACTOR, {});

    expect((await store.list(ORG, { reviewRequested: true }, { limit: 25, offset: 0 })).total).toBe(
      1,
    );
  });

  it("asks a host login when named, and records how it landed", async () => {
    const { actions, host, store } = world();

    const asked = await actions.requestReview(ORG, PR, ACTOR, { reviewer: "priya" });

    expect(host.requestReview).toHaveBeenCalledWith(ORG, store.head514.sourceId, 514, "priya");
    expect(asked.review.host).toEqual({ reviewer: "priya", state: "requested", detail: null });
  });

  it("records a host without reviews as unsupported, and a refusal as failed — never thrown", async () => {
    const unsupported = world();
    unsupported.host.requestReview.mockResolvedValueOnce(null);

    expect(
      (await unsupported.actions.requestReview(ORG, PR, ACTOR, { reviewer: "priya" })).review.host,
    ).toEqual({ reviewer: "priya", state: "unsupported", detail: null });

    const refused = world();
    refused.host.requestReview.mockRejectedValueOnce(
      new Error("Reviews may only be requested from collaborators."),
    );
    const warn = jest.spyOn(refused.actions["logger"], "warn").mockImplementation(() => undefined);

    const outcome = await refused.actions.requestReview(ORG, PR, ACTOR, { reviewer: "stranger" });

    expect(outcome.review).toMatchObject({
      state: "requested",
      host: {
        reviewer: "stranger",
        state: "failed",
        detail: "Reviews may only be requested from collaborators.",
      },
    });
    expect(warn).toHaveBeenCalled();
  });

  it("refuses a merged PR, a PR with no revision, and another workspace's", async () => {
    const merged = world();
    merged.store.head514 = { ...merged.store.head514, state: "closed" };
    await expect(merged.actions.requestReview(ORG, PR, ACTOR, {})).rejects.toMatchObject({
      response: { code: "pull_request_not_open" },
    });

    const empty = world();
    empty.store.revisionRows = [];
    await expect(empty.actions.requestReview(ORG, PR, ACTOR, {})).rejects.toMatchObject({
      response: { code: "pull_request_has_no_revision" },
    });

    const other = world();
    await expect(other.actions.requestReview(OTHER_ORG, PR, ACTOR, {})).rejects.toMatchObject({
      response: { code: "pull_request_not_found" },
    });
    expect(other.gates.events).toEqual([]);
  });
});

describe("Approve and decline", () => {
  it("approving the open slot re-evaluates the gate green and flips the aggregate", async () => {
    const { actions, store, audit } = world();
    // Model review is advisory here, so human approval is the last unsatisfied gate.
    store.gates = store.gates.map((row) =>
      row.key === "model_review" ? { ...row, required: false } : row,
    );
    const requested = await actions.requestReview(ORG, PR, ACTOR, {});

    expect(requested.aggregate?.mergeReady).toBe(false);

    const approved = await actions.decide(ORG, PR, ACTOR, {
      decision: "approve",
      note: "bench numbers look right",
    });

    expect(approved).toMatchObject({
      created: false,
      review: {
        id: requested.review.id,
        state: "approved",
        decidedBy: KEN,
        decidedRevisionId: REV_2,
        note: "bench numbers look right",
      },
      humanApproval: { verdict: "green" },
      aggregate: { mergeReady: true },
    });
    expect(audit.map((event) => event.action)).toEqual([
      "pr_approval.requested",
      "pr_approval.approved",
    ]);
  });

  it("opens a slot and answers it when nobody asked first — a policy that routes to a person", async () => {
    const { actions, store } = world();

    const declined = await actions.decide(ORG, PR, ACTOR, {
      decision: "decline",
      note: "needs the thermal run",
    });

    expect(declined).toMatchObject({
      created: true,
      review: { state: "declined", note: "needs the thermal run", requestedBy: KEN },
      humanApproval: { verdict: "red" },
    });
    expect(store.approvals).toHaveLength(1);
  });

  it("refuses a decline without a note, before anything is written", async () => {
    const { actions, store, gates } = world();

    await expect(actions.decide(ORG, PR, ACTOR, { decision: "decline" })).rejects.toMatchObject({
      response: { code: "pr_decline_note_required" },
    });
    expect(store.approvals).toEqual([]);
    expect(gates.events).toEqual([]);
  });

  it("refuses another workspace's PR as not found", async () => {
    const { actions } = world();

    await expect(
      actions.decide(OTHER_ORG, PR, ACTOR, { decision: "approve" }),
    ).rejects.toMatchObject({
      response: { code: "pull_request_not_found" },
    });
  });
});

describe("hostDetail", () => {
  it("is the refusal's message, bounded and never empty", () => {
    expect(hostDetail(new Error("  nope  "))).toBe("nope");
    expect(hostDetail(new Error(""))).toBe("the host refused the review request");
    expect(hostDetail("x".repeat(600))).toHaveLength(MAX_HOST_DETAIL_LENGTH);
  });
});

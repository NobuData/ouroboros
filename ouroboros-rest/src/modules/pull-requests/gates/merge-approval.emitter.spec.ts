import { Logger } from "@nestjs/common";

import { recordingDatabase } from "../../db/database.fixture";
import { MOCKUP_PROSE, SHIPPED_KINDS } from "../../decisions/decision.kinds.fixture";
import { registryHarness, type RegistryHarness } from "../../decisions/decision.store.fixture";
import { renderDecision } from "../../decisions/decision.templates";
import { DecisionSourceWatcher } from "../../decisions/decision.watchers";
import { GateListeners, type GateEvaluated } from "./gate.listeners";
import {
  MERGE_APPROVAL_KIND,
  MergeApprovalEmitter,
  MergeApprovalFactsReader,
  matrixStateOf,
  mergeApprovalEmission,
  type MergeApprovalFacts,
} from "./merge-approval.emitter";

/**
 * The merge-approval emitter (#461, AX.5 + the #358 amendment): the gate engine's policy match
 * becomes *"Approve merge for a refactor PR?"*, naming the policy, one card per PR.
 */

const ORG = "acme-robotics";
const PR = "0a1b2c3d-0000-4000-8000-000000000509";
const RUN = "0a1b2c3d-0000-4000-8000-000000001843";
const TICKET = "0a1b2c3d-0000-4000-8000-000000000465";

/** PR #509 as mockup 16 draws it: 14/14 green, matrix all ✓, +214 −180 across 6 files. */
function pr509(overrides: Partial<MergeApprovalFacts> = {}): MergeApprovalFacts {
  return {
    organizationId: ORG,
    prId: PR,
    prNumber: 509,
    prState: "verifying",
    runId: RUN,
    loopSeq: 1843,
    ticketId: TICKET,
    ticketKey: "#465",
    policyLabel: "refactor",
    checks: Array.from({ length: 14 }, () => ({ verdict: "green" as const })),
    criteria: ["verified", "waived"],
    additions: 214,
    deletions: 180,
    changedFiles: 6,
    approved: false,
    ...overrides,
  };
}

/** An evaluation the gate engine reports for PR #509. */
function evaluated(overrides: Partial<GateEvaluated> = {}): GateEvaluated {
  return {
    prId: PR,
    organizationId: ORG,
    revisionId: "rev-2",
    state: "verifying",
    mergeReady: false,
    redCount: 0,
    humanReview: { required: true, label: "refactor" },
    ...overrides,
  };
}

describe("matrixStateOf", () => {
  it("is all ✓ only when every criterion is verified or waived", () => {
    expect(matrixStateOf(["verified", "waived"])).toBe("all ✓");
    expect(matrixStateOf(["verified", "unverified"])).toBe("incomplete");
    expect(matrixStateOf([])).toBe("incomplete");
  });
});

describe("mergeApprovalEmission", () => {
  it("composes mockup 16's card from PR #509's facts, naming the policy", () => {
    const emission = mergeApprovalEmission(pr509());

    expect(emission).toEqual({
      organizationId: ORG,
      kindId: MERGE_APPROVAL_KIND,
      payload: {
        pr_kind: "refactor",
        policy_label: "refactor",
        checks_passed: 14,
        checks_total: 14,
        matrix_state: "all ✓",
        added: 214,
        removed: 180,
        files: 6,
      },
      refs: [
        { type: "run", id: RUN, label: "loop #1843" },
        { type: "pr", id: PR, label: "PR #509" },
        { type: "ticket", id: TICKET, label: "issue #465" },
      ],
      key: { plane: "pr.gates", sourceRef: `pr:${PR}` },
    });
    expect(renderDecision(SHIPPED_KINDS.merge_approval, emission?.payload ?? {})).toEqual(
      MOCKUP_PROSE.merge_approval,
    );
  });

  it("counts waived and not-required checks as passed, and pending or red ones as not", () => {
    const emission = mergeApprovalEmission(
      pr509({
        checks: [
          { verdict: "green" },
          { verdict: "waived" },
          { verdict: "not_required" },
          { verdict: "pending" },
          { verdict: null },
        ],
      }),
    );

    expect(emission?.payload).toMatchObject({ checks_passed: 3, checks_total: 5 });
  });

  it("omits the ticket tag when the PR names no ticket", () => {
    expect(mergeApprovalEmission(pr509({ ticketId: null, ticketKey: null }))?.refs).toHaveLength(2);
  });

  it("asks nothing of a PR that ended, has no run, is already approved, or matched a non-slug label", () => {
    expect(mergeApprovalEmission(pr509({ prState: "merged" }))).toBeNull();
    expect(mergeApprovalEmission(pr509({ prState: "closed" }))).toBeNull();
    expect(mergeApprovalEmission(pr509({ runId: null }))).toBeNull();
    expect(mergeApprovalEmission(pr509({ approved: true }))).toBeNull();
    expect(mergeApprovalEmission(pr509({ policyLabel: "Needs Review" }))).toBeNull();
  });
});

describe("MergeApprovalEmitter", () => {
  let harness: RegistryHarness;
  let listeners: GateListeners;
  let read: jest.Mock;

  beforeEach(() => {
    harness = registryHarness();
    listeners = new GateListeners();
    read = jest.fn().mockResolvedValue(pr509());
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  /** An emitter over the harness and a stubbed reader. */
  function emitter(watcher?: DecisionSourceWatcher): MergeApprovalEmitter {
    return new MergeApprovalEmitter(
      listeners,
      { read } as unknown as MergeApprovalFactsReader,
      harness.registry,
      watcher,
    );
  }

  it("files the card the refactor policy asks for, once per PR however often the PR is evaluated", async () => {
    const subject = emitter();

    await subject.file(evaluated());
    await subject.file(evaluated());

    expect(read).toHaveBeenCalledWith(PR, "rev-2", "refactor");
    expect(harness.store.items).toHaveLength(1);
    expect(harness.store.items[0]).toMatchObject({ kindId: "merge_approval", plane: "pr.gates" });
    expect(harness.audit.map((record) => record.action)).toEqual(["decision.filed"]);
  });

  it("files nothing when the policy required nothing, matched no label, or there is no revision", async () => {
    const subject = emitter();

    await subject.file(evaluated({ humanReview: { required: false, label: null } }));
    await subject.file(evaluated({ humanReview: { required: true, label: null } }));
    await subject.file(evaluated({ humanReview: undefined }));
    await subject.file(evaluated({ revisionId: null }));

    expect(read).not.toHaveBeenCalled();
    expect(harness.store.items).toEqual([]);
  });

  it("never throws: a failed read is logged and the next evaluation files", async () => {
    read.mockRejectedValueOnce(new Error("db down"));

    await expect(emitter().file(evaluated())).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      `Could not file the merge approval for pr ${PR}; the next evaluation will.`,
      expect.anything(),
    );
  });

  it("hears the gate engine once initialised, in order per PR, and registers its PR-settled detector", async () => {
    const watcher = new DecisionSourceWatcher(harness.store.asRepository(), harness.registry);
    const register = jest.spyOn(watcher, "register");
    const subject = emitter(watcher);

    subject.onModuleInit();
    listeners.emit(evaluated());
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.store.items).toHaveLength(1);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ name: "pr-settled", kinds: ["merge_approval"] }),
    );

    subject.onModuleDestroy();
    listeners.emit(evaluated({ prId: "another" }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("MergeApprovalFactsReader", () => {
  it("reads the PR, the revision's required gates but human approval, the criteria and the approval", async () => {
    const database = recordingDatabase();
    database.answers(
      {
        rows: [
          {
            id: PR,
            organization_id: ORG,
            external_number: 509,
            state: "verifying",
            run_id: RUN,
            ticket_id: TICKET,
            additions: 214,
            deletions: 180,
            changed_files: 6,
            loop_seq: 1843,
            external_key: "#465",
          },
        ],
      },
      {
        rows: [
          { gate_key: "build", required: true, verdict: "green" },
          { gate_key: "model_review", required: false, verdict: "pending" },
          { gate_key: "human_approval", required: true, verdict: "pending" },
        ],
      },
      { rows: [{ status: "verified" }] },
      { rows: [{ state: "approved", decided_revision_id: "rev-1" }] },
    );

    const facts = await new MergeApprovalFactsReader(database.service).read(
      PR,
      "rev-2",
      "refactor",
    );

    expect(facts).toEqual(
      pr509({ checks: [{ verdict: "green" }], criteria: ["verified"], approved: false }),
    );
  });

  it("reads an approval given on this revision as approved, and a missing PR as nothing", async () => {
    const database = recordingDatabase();
    database.answers(
      {
        rows: [
          {
            id: PR,
            organization_id: ORG,
            external_number: 509,
            state: "verifying",
            run_id: RUN,
            ticket_id: null,
            additions: 1,
            deletions: 0,
            changed_files: 1,
            loop_seq: 1,
            external_key: null,
          },
        ],
      },
      { rows: [] },
      { rows: [] },
      { rows: [{ state: "approved", decided_revision_id: "rev-2" }] },
    );

    expect(
      (await new MergeApprovalFactsReader(database.service).read(PR, "rev-2", "refactor"))
        ?.approved,
    ).toBe(true);
    expect(
      await new MergeApprovalFactsReader(recordingDatabase().service).read(PR, "rev-2", "refactor"),
    ).toBeUndefined();
  });
});

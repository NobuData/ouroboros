import { recordingDatabase } from "../../db/database.fixture";
import { MOCKUP_PROSE, SHIPPED_KINDS } from "../../decisions/decision.kinds.fixture";
import { registryHarness } from "../../decisions/decision.store.fixture";
import { renderDecision } from "../../decisions/decision.templates";
import { DecisionSourceWatcher, type AskingDecision } from "../../decisions/decision.watchers";
import {
  ClaimWaiverEmitter,
  claimWaiverEmission,
  claimWaiverSourceRef,
  criterionSettledDetector,
} from "./claim-waiver.emitter";

/**
 * The claim-waiver emitter (#461, AX.3): an unverifiable criterion becomes *"Waive a claim the bench
 * can't verify?"*, one card per criterion; waiving or verifying it on the PR page settles it.
 */

const ORG = "acme-robotics";
const PR = "0a1b2c3d-0000-4000-8000-000000000514";
const CRITERION = "0a1b2c3d-0000-4000-8000-00000000c001";
const RUN = "0a1b2c3d-0000-4000-8000-000000001847";
const CLAIM = "Flake must not reappear across temperature range";

describe("claimWaiverEmission", () => {
  it("composes mockup 16's third card, keyed by the criterion", () => {
    const emission = claimWaiverEmission({
      organizationId: ORG,
      prId: PR,
      prNumber: 514,
      criterionId: CRITERION,
      claim: CLAIM,
      missingCapability: "thermal chamber",
      runId: null,
      loopSeq: null,
    });

    expect(emission.refs).toEqual([{ type: "pr", id: PR, label: "PR #514" }]);
    expect(emission.key).toEqual({ plane: "pr.criteria", sourceRef: `pr:${PR}:criterion:${CRITERION}` });
    expect(renderDecision(SHIPPED_KINDS.claim_waiver, emission.payload)).toEqual(MOCKUP_PROSE.claim_waiver);
  });

  it("tags the run too when the PR has one", () => {
    expect(
      claimWaiverEmission({
        organizationId: ORG,
        prId: PR,
        prNumber: 514,
        criterionId: CRITERION,
        claim: CLAIM,
        missingCapability: "thermal chamber",
        runId: RUN,
        loopSeq: 1847,
      }).refs,
    ).toContainEqual({ type: "run", id: RUN, label: "loop #1847" });
  });
});

describe("criterionSettledDetector", () => {
  const item: AskingDecision = {
    id: "item-1",
    organizationId: ORG,
    kindId: "claim_waiver",
    refs: [{ type: "pr", id: PR, label: "PR #514" }],
    sourceRef: claimWaiverSourceRef(PR, CRITERION),
  };

  it("settles a card whose criterion was waived or verified on the PR page", async () => {
    const database = recordingDatabase();
    database.answers({ rows: [{ id: CRITERION }] });

    expect(await criterionSettledDetector().settled([item], database.service.db)).toEqual([
      { itemId: "item-1", organizationId: ORG, settlement: "criterion_settled", channel: "web" },
    ]);
    expect(database.statements[0].parameters).toEqual([CRITERION, "verified", "waived"]);
  });

  it("asks nothing about a source ref that names no criterion", async () => {
    const database = recordingDatabase();

    expect(
      await criterionSettledDetector().settled([{ ...item, sourceRef: "pr:x" }], database.service.db),
    ).toEqual([]);
    expect(database.statements).toEqual([]);
  });
});

describe("ClaimWaiverEmitter", () => {
  it("files the card for an unverified criterion of the workspace", async () => {
    const harness = registryHarness();
    const database = recordingDatabase();
    database.answers({
      rows: [
        { id: CRITERION, claim: CLAIM, status: "unverified", pr_id: PR, external_number: 514, run_id: null, loop_seq: null },
      ],
    });

    const outcome = await new ClaimWaiverEmitter(database.service, harness.registry).unverifiable(
      ORG,
      CRITERION,
      "thermal chamber",
    );

    expect(outcome?.status).toBe("filed");
    expect(harness.store.items[0]).toMatchObject({ kindId: "claim_waiver", plane: "pr.criteria" });
    expect(database.statements[0].parameters).toEqual([CRITERION, ORG]);
  });

  it("asks nothing for a criterion that is settled already, or not this workspace's", async () => {
    const harness = registryHarness();
    const settled = recordingDatabase();
    settled.answers({
      rows: [{ id: CRITERION, claim: CLAIM, status: "waived", pr_id: PR, external_number: 514, run_id: null, loop_seq: null }],
    });

    expect(await new ClaimWaiverEmitter(settled.service, harness.registry).unverifiable(ORG, CRITERION, "x")).toBeNull();
    expect(
      await new ClaimWaiverEmitter(recordingDatabase().service, harness.registry).unverifiable(ORG, CRITERION, "x"),
    ).toBeNull();
    expect(harness.store.items).toEqual([]);
  });

  it("registers both settlement detectors on init, and unregisters them", () => {
    const harness = registryHarness();
    const watcher = new DecisionSourceWatcher(harness.store.asRepository(), harness.registry);
    const stop = jest.fn();
    const register = jest.spyOn(watcher, "register").mockReturnValue(stop);
    const subject = new ClaimWaiverEmitter(recordingDatabase().service, harness.registry, watcher);

    subject.onModuleInit();
    subject.onModuleDestroy();

    expect(register.mock.calls.map(([detector]) => detector.name)).toEqual(["pr-settled", "criterion-settled"]);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});

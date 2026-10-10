import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { MOCKUP_PROSE, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import { registryHarness, type RegistryHarness } from "../decisions/decision.store.fixture";
import { renderDecision } from "../decisions/decision.templates";
import { DecisionSourceWatcher } from "../decisions/decision.watchers";
import { PlanSignOffEmitter, planSignOffEmission } from "./plan-sign-off.emitter";
import {
  RUN_MOVED_ON_STATUSES,
  RunNeedsHumanEmitter,
  runNeedsHumanEmission,
} from "./run-needs-human.emitter";
import { SpendApprovalEmitter, dollars, spendApprovalEmission } from "./spend-approval.emitter";

/**
 * The run plane's other three hooks (#461): a plan waiting on a sign-off, a run handed to a person,
 * and a spend past its cap — the last registered but dormant until AF.4.
 */

const ORG = "acme-robotics";
const RUN = "0a1b2c3d-0000-4000-8000-000000001851";

/** A run's card facts. */
const RUN_FACTS = {
  runId: RUN,
  organizationId: ORG,
  subject: "OTA rollback flag is never cleared",
  stageLabel: "Build",
  refs: [{ type: "run" as const, id: RUN, label: "loop #1851" }],
};

let harness: RegistryHarness;
let database: RecordingDatabase;

/** Queue `runCardFacts`' two reads: the run, and no ticket. */
function runRow(): void {
  database.answers(
    {
      rows: [
        {
          id: RUN,
          organization_id: ORG,
          loop_seq: 1851,
          issue_title: RUN_FACTS.subject,
          stage_label: "Build",
        },
      ],
    },
    { rows: [] },
  );
}

beforeEach(() => {
  harness = registryHarness();
  database = recordingDatabase();
});

describe("plan_sign_off", () => {
  it("composes its card from the run, the stage and the plan's size", () => {
    const emission = planSignOffEmission({
      run: { ...RUN_FACTS, subject: "Rework the OTA bootloader handoff" },
      stageKey: "plan_review",
      stageLabel: "Plan review",
      planFiles: 9,
    });

    expect(emission.key).toEqual({ plane: "workflows", sourceRef: `run:${RUN}:stage:plan_review` });
    expect(renderDecision(SHIPPED_KINDS.plan_sign_off, emission.payload)).toEqual(
      MOCKUP_PROSE.plan_sign_off,
    );
  });

  it("files one card per run and stage when the run plane calls the hook", async () => {
    const emitter = new PlanSignOffEmitter(database.service, harness.registry);

    runRow();
    database.answers(
      { rows: [{ stage_label: "Plan review" }] },
      { rows: [{ breakdown: { files: ["a.c", "b.c"] } }] },
    );

    const outcome = await emitter.stageEntered(RUN, "plan_review");

    expect(outcome?.status).toBe("filed");
    expect(harness.store.items[0]).toMatchObject({
      kindId: "plan_sign_off",
      payload: { subject: RUN_FACTS.subject, stage_label: "Plan review", plan_files: 2 },
    });
  });

  it("files nothing for an unknown run or stage", async () => {
    expect(
      await new PlanSignOffEmitter(database.service, harness.registry).stageEntered(RUN, "x"),
    ).toBeNull();
    expect(harness.store.items).toEqual([]);
  });

  it("registers a run-ended detector", () => {
    const watcher = new DecisionSourceWatcher(harness.store.asRepository(), harness.registry);
    const register = jest.spyOn(watcher, "register");

    new PlanSignOffEmitter(database.service, harness.registry, watcher).onModuleInit();

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["plan_sign_off"] }));
  });
});

describe("run_needs_human", () => {
  it("composes its card from the run and why it stopped", () => {
    const emission = runNeedsHumanEmission(RUN_FACTS, "attempt limit reached");

    expect(emission.key).toEqual({ plane: "runs", sourceRef: `run:${RUN}` });
    expect(renderDecision(SHIPPED_KINDS.run_needs_human, emission.payload)).toEqual(
      MOCKUP_PROSE.run_needs_human,
    );
  });

  it("files the card for a run that is needs_human, and nothing for one that is not", async () => {
    const emitter = new RunNeedsHumanEmitter(database.service, harness.registry);

    database.answers({ rows: [{ status: "coding" }] });
    expect(await emitter.handedOver(RUN, "x")).toBeNull();

    database.answers({ rows: [{ status: "needs_human" }] });
    runRow();
    expect((await emitter.handedOver(RUN, "attempt limit reached"))?.status).toBe("filed");
    expect(harness.store.items[0]).toMatchObject({ kindId: "run_needs_human", severity: "err" });
  });

  it("is settled by the run moving to any status but needs_human", () => {
    const watcher = new DecisionSourceWatcher(harness.store.asRepository(), harness.registry);
    const register = jest.spyOn(watcher, "register");

    new RunNeedsHumanEmitter(database.service, harness.registry, watcher).onModuleInit();

    expect(RUN_MOVED_ON_STATUSES).not.toContain("needs_human");
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: "run-run_moved_on" }));
  });
});

describe("spend_approval — registered and dormant", () => {
  it("prints integer cents as the card's dollars", () => {
    expect(dollars(261)).toBe("$2.61");
    expect(dollars(250)).toBe("$2.50");
    expect(dollars(5)).toBe("$0.05");
    expect(dollars(60000)).toBe("$600.00");
  });

  it("has the shape fixed now — the emission renders the card", () => {
    expect(
      renderDecision(
        SHIPPED_KINDS.spend_approval,
        spendApprovalEmission(RUN_FACTS, 261, 250).payload,
      ),
    ).toEqual(MOCKUP_PROSE.spend_approval);
  });

  it("emits nothing: the registry answers dormant and files no item", async () => {
    runRow();

    const outcome = await new SpendApprovalEmitter(database.service, harness.registry).capCrossed(
      RUN,
      261,
      250,
    );

    expect(outcome).toEqual({ status: "dormant", itemId: null });
    expect(harness.store.items).toEqual([]);
    expect(harness.audit).toEqual([]);
  });
});

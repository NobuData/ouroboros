import type { BacklogQueueService } from "../../backlog/queue.service";
import type { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import type { BatchesService } from "../../planning/batches.service";
import type { BisectView, CodeBisectService } from "../code/code-bisect.service";
import { CodeRefusal } from "../code/code.reader";
import type { ResearchEstimateService } from "../estimate.service";
import type { InvestigationDispatchService } from "../loop/investigation-dispatch.service";
import type { ResearchToolRegistry } from "../tools/research-tool.registry";
import type { ResearchToolRepository } from "../tools/research-tool.repository";
import {
  FIX_LOCAL_KEY,
  NEEDS_REPRO_NO_TEST,
  RegressionWatchChain,
  WATCH_PLANNER,
  bisectResultOf,
  fixBody,
  fixTitle,
} from "./watch.chain";
import {
  BISECT_RESULT,
  CULPRIT,
  FakeTelemetry,
  MemoryWatchStore,
  ORG,
  REPO,
  hoverMetric,
  item,
  callArg,
} from "./watch.fixture";
import type { WatchItemRow, WatchRepository } from "./watch.repository";

/**
 * The chain an item walks (CM.4, #623), one step at a time, over an in-memory store and
 * stand-ins for the planes it composes.
 */

const DRAFT = "d4af7000-0000-4000-8000-000000000001";
const TICKET = "71c4e700-0000-4000-8000-000000000517";
const JOBS = BISECT_RESULT.farm_job_ids;

/** A bisect as #617 reports one. */
function bisect(
  status: BisectView["bisect"]["status"],
  overrides: Partial<BisectView["bisect"]> = {},
): BisectView {
  return {
    bisect: {
      id: "b15ec700-0000-4000-8000-000000000001",
      organizationId: ORG,
      investigationId: null,
      githubRepoId: "r1",
      repository: REPO,
      pool: "hil-rig",
      testRef: "watch:hover_drift_cm",
      command: ["west", "twister"],
      goodRef: "v2.0.4",
      badRef: "nightly",
      goodSha: "0".repeat(40),
      badSha: "f".repeat(40),
      buildRef: "refs/heads/nightly",
      commits: Array.from({ length: 12 }, (_, n) => n.toString(16).padStart(40, "c")),
      lo: 0,
      hi: 11,
      maxSteps: 4,
      status,
      culpritSha: status === "converged" ? CULPRIT : null,
      note: null,
      createdAt: new Date(0),
      finishedAt: null,
      ...overrides,
    },
    steps:
      status === "running"
        ? []
        : JOBS.map((job, index) => ({
            step: index + 1,
            candidate: index,
            commitSha: CULPRIT,
            buildJobId: job,
            jobNumber: 40 + index,
            jobStatus: "succeeded" as const,
            verdict: index === 0 ? ("good" as const) : ("bad" as const),
            decidedAt: new Date(0),
          })),
  };
}

function harness(
  row: WatchItemRow = item(),
  settings: {
    autoBisect?: boolean;
    autoFile?: boolean;
    replay?: boolean;
    fixSourceId?: string | null;
  } = {},
) {
  const store = new MemoryWatchStore();
  store.rows = [row];
  store.stored.set(ORG, {
    thresholds: { classes: {}, metrics: {} },
    metrics: [hoverMetric(settings.replay === false ? { replay: null } : {})],
    autoBisect: settings.autoBisect ?? true,
    autoFile: settings.autoFile ?? false,
    fixSourceId: settings.fixSourceId ?? null,
    lastComparedAt: null,
  });
  const bisects = {
    start: jest.fn().mockResolvedValue(bisect("running")),
    get: jest.fn().mockResolvedValue(bisect("running")),
  };
  const ledger = { archiveSources: jest.fn().mockResolvedValue([]) };
  const estimates = { storeEstimate: jest.fn().mockResolvedValue({}) };
  const dispatch = { dispatch: jest.fn().mockResolvedValue({}) };
  const batches = {
    compose: jest
      .fn()
      .mockResolvedValue({ id: "batch-1", drafts: [{ id: DRAFT, localKey: FIX_LOCAL_KEY }] }),
    push: jest.fn().mockResolvedValue({}),
  };
  const queue = { queueSelection: jest.fn().mockResolvedValue({}) };
  const decisions = { emit: jest.fn().mockResolvedValue({ status: "filed", itemId: "d1" }) };
  const chain = new RegressionWatchChain(
    store as unknown as WatchRepository,
    bisects as unknown as CodeBisectService,
    new FakeTelemetry().registry() as unknown as ResearchToolRegistry,
    ledger as unknown as ResearchToolRepository,
    estimates as unknown as ResearchEstimateService,
    dispatch as unknown as InvestigationDispatchService,
    batches as unknown as BatchesService,
    queue as unknown as BacklogQueueService,
    decisions as unknown as DecisionKindRegistry,
  );
  const logger = (chain as unknown as { logger: Record<string, () => void> }).logger;
  for (const level of ["warn", "error", "debug"])
    jest.spyOn(logger, level).mockImplementation(() => undefined);
  const step = () => chain.advance(store.get(row.id));

  return {
    store,
    chain,
    bisects,
    ledger,
    estimates,
    dispatch,
    batches,
    queue,
    decisions,
    step,
    id: row.id,
  };
}

afterEach(() => jest.restoreAllMocks());

describe("detected → bisecting", () => {
  it("starts a bisect: good the release, bad the nightly ref, the test the metric's replay", async () => {
    const { step, bisects, store, id } = harness();

    expect(await step()).toEqual({ moved: "bisecting" });
    expect(bisects.start).toHaveBeenCalledWith({
      organizationId: ORG,
      repository: REPO,
      good: "v2.0.4",
      bad: "nightly",
      testRef: "watch:hover_drift_cm",
      pool: "hil-rig",
      command: ["west", "twister"],
      createdBy: null,
    });
    expect(store.get(id)).toMatchObject({
      status: "bisecting",
      bisectId: "b15ec700-0000-4000-8000-000000000001",
    });
  });

  it("stops a metric with no replayable test at detected, needs repro", async () => {
    const { step, bisects, store, id } = harness(item(), { replay: false });

    expect(await step()).toEqual({ rested: NEEDS_REPRO_NO_TEST });
    expect(store.get(id)).toMatchObject({ status: "detected", note: NEEDS_REPRO_NO_TEST });
    expect(await step()).toEqual({ waiting: "resting with a note" });
    expect(bisects.start).not.toHaveBeenCalled();
  });

  it("treats a metric that is no longer watched as having no replay test", async () => {
    const { step, store } = harness();
    store.stored.set(ORG, { ...store.stored.get(ORG)!, metrics: [] });

    expect(await step()).toEqual({ rested: NEEDS_REPRO_NO_TEST });
  });

  it("does nothing when automatic bisects are off, or the drift is gone", async () => {
    const off = harness(item(), { autoBisect: false });
    expect(await off.step()).toEqual({ waiting: "automatic bisects are off" });
    expect(off.bisects.start).not.toHaveBeenCalled();

    const gone = harness(item({ severity: "ok" }));
    expect(await gone.step()).toEqual({ waiting: "the drift is no longer there" });
    expect(gone.bisects.start).not.toHaveBeenCalled();
  });

  it("rests with the reason when the bisect's own request is wrong", async () => {
    const { step, bisects, store, id } = harness();
    bisects.start.mockRejectedValue(new CodeRefusal("unsupported", "v2.0.4 names no commit"));

    expect(await step()).toEqual({
      rested: "needs repro: the bisect could not start — v2.0.4 names no commit",
    });
    expect(store.get(id).status).toBe("detected");
  });

  it.each([new CodeRefusal("network", "the clone could not be fetched"), new Error("engine down")])(
    "tries again next pass when the bisect could not start yet (%s)",
    async (failure) => {
      const { step, bisects, store, id } = harness();
      bisects.start.mockRejectedValue(failure);

      expect(await step()).toEqual({ waiting: "the bisect could not start yet" });
      expect(store.get(id)).toMatchObject({ status: "detected", note: null });
    },
  );
});

describe("bisecting → bisected", () => {
  const bisecting = () =>
    item({ status: "bisecting", bisectId: "b15ec700-0000-4000-8000-000000000001" });

  it("waits while the bisect runs", async () => {
    const { step, decisions } = harness(bisecting());

    expect(await step()).toEqual({ waiting: "the bisect is still running" });
    expect(decisions.emit).not.toHaveBeenCalled();
  });

  it("records the culprit and its farm jobs, and files one bisect card", async () => {
    const { step, bisects, store, decisions, id } = harness(bisecting());
    bisects.get.mockResolvedValue(bisect("converged"));

    expect(await step()).toEqual({ moved: "bisected" });
    expect(store.get(id).bisectResult).toEqual({
      culprit_sha: CULPRIT,
      farm_job_ids: JOBS,
      steps: 2,
      confidence_basis: {
        method: "first_parent_bisect",
        inputs: {
          good: "0".repeat(40),
          bad: "f".repeat(40),
          candidates: 12,
          test: "watch:hover_drift_cm",
          pool: "hil-rig",
        },
      },
    });
    expect(decisions.emit).toHaveBeenCalledTimes(1);
    expect(callArg(decisions.emit, 0, 0)).toMatchObject({
      kindId: "bisect_complete",
      key: { plane: "research.watch", sourceRef: `item:${id}:bisected` },
      payload: { metric: "hover_drift_cm", culprit: "a41f2c9", steps: 2, release: "v2.0.4" },
    });
  });

  it.each(["inconclusive", "failed", "canceled"] as const)(
    "returns to detected, needs repro, when the bisect ends %s",
    async (status) => {
      const { step, bisects, store, decisions, id } = harness(bisecting());
      bisects.get.mockResolvedValue(bisect(status, { note: "step 2's job was canceled" }));

      expect(await step()).toEqual({
        rested: `needs repro: the bisect ended ${status} without isolating a commit — step 2's job was canceled`,
      });
      expect(store.get(id)).toMatchObject({ status: "detected", bisectResult: null });
      expect(decisions.emit).not.toHaveBeenCalled();
    },
  );

  it("returns to detected when the bisect is gone", async () => {
    const { step, bisects, store, id } = harness(bisecting());
    bisects.get.mockResolvedValue(undefined);

    expect(await step()).toMatchObject({ rested: expect.stringContaining("is gone") as string });
    expect(store.get(id).status).toBe("detected");
  });

  it("moves on even when the card cannot be filed", async () => {
    const { step, bisects, decisions, store, id } = harness(bisecting());
    bisects.get.mockResolvedValue(bisect("converged"));
    decisions.emit.mockRejectedValue(new Error("inbox down"));

    expect(await step()).toEqual({ moved: "bisected" });
    expect(store.get(id).status).toBe("bisected");
  });
});

describe("bisectResultOf", () => {
  it("is null for a bisect that did not converge, or converged on no decided step", () => {
    expect(bisectResultOf(bisect("running"))).toBeNull();
    expect(bisectResultOf(bisect("inconclusive"))).toBeNull();
    expect(bisectResultOf({ ...bisect("converged"), steps: [] })).toBeNull();
    expect(bisectResultOf(bisect("converged", { culpritSha: null }))).toBeNull();
  });

  it("counts decided steps and names each job once", () => {
    const view = bisect("converged");
    const twice = {
      ...view,
      steps: [
        ...view.steps,
        { ...view.steps[0], step: 3 },
        { ...view.steps[0], step: 4, verdict: null },
      ],
    };

    expect(bisectResultOf(twice)).toMatchObject({ steps: 3, farm_job_ids: JOBS });
  });
});

describe("bisected → investigation_open", () => {
  const bisected = () =>
    item({
      status: "bisected",
      bisectId: "b15ec700-0000-4000-8000-000000000001",
      bisectResult: BISECT_RESULT,
    });

  it("opens the forensics, seeds its ledger with the comparison and the bisect, and dispatches it", async () => {
    const { step, bisects, store, ledger, estimates, dispatch, id } = harness(bisected());
    bisects.get.mockResolvedValue(bisect("converged"));

    expect(await step()).toEqual({ moved: "investigation_open" });
    expect(store.opened).toEqual([
      {
        organizationId: ORG,
        question:
          "Regression forensics: hover_drift_cm drifted +14% in acme/helios-firmware since v2.0.4, " +
          "bisected to a41f2c9. What in that commit caused it, and what is the right fix?",
        tools: [],
      },
    ]);
    const investigation = "1e500000-0000-4000-8000-000000000131";
    expect(
      (ledger.archiveSources.mock.calls as unknown[][]).map((call) => [call[0], call[1]]),
    ).toEqual([
      [investigation, "telemetry"],
      [investigation, "code"],
    ]);
    expect((callArg(ledger.archiveSources, 1, 2) as { locator: string }[])[0].locator).toMatch(
      /^bisect:\/\//,
    );
    expect(estimates.storeEstimate).toHaveBeenCalledWith(ORG, investigation);
    expect(dispatch.dispatch).toHaveBeenCalledWith(ORG, investigation);
    expect(store.get(id)).toMatchObject({
      status: "investigation_open",
      investigationId: investigation,
    });
  });

  it("stays open and queued when the loop cannot take it", async () => {
    const { step, dispatch, store, id } = harness(bisected());
    dispatch.dispatch.mockRejectedValue(new Error("engine_unavailable"));

    expect(await step()).toEqual({ moved: "investigation_open" });
    expect(store.get(id).status).toBe("investigation_open");
  });

  it("opens it even when its evidence cannot be archived", async () => {
    const { step, ledger, store, id } = harness(bisected());
    ledger.archiveSources.mockRejectedValue(new Error("ledger down"));

    expect(await step()).toEqual({ moved: "investigation_open" });
    expect(store.get(id).investigationId).not.toBeNull();
  });

  it("waits in a workspace with no forensics kind", async () => {
    const { step, store, id } = harness(bisected());
    store.hasForensicsKind = false;

    expect(await step()).toEqual({
      waiting: "this workspace has no regression_forensics investigation kind",
    });
    expect(store.get(id).status).toBe("bisected");
  });
});

describe("investigation_open → fix_drafted", () => {
  const open = () =>
    item({
      status: "investigation_open",
      bisectResult: BISECT_RESULT,
      investigationId: "inv",
      investigationDisplayId: "RS-131",
    });

  it("composes one Planning draft for the workspace's only ticket source", async () => {
    const { step, batches, store, id } = harness(open());

    expect(await step()).toEqual({ moved: "fix_drafted" });
    expect(batches.compose).toHaveBeenCalledWith(ORG, null, {
      prompt: "Regression watch: hover_drift_cm +14% since v2.0.4",
      planner: WATCH_PLANNER,
      targetSourceId: store.sources[0],
      drafts: [
        {
          localKey: "FIX-1",
          title: "Fix regression: hover_drift_cm +14% since v2.0.4",
          body: expect.stringContaining(CULPRIT) as string,
        },
      ],
    });
    expect(store.get(id)).toMatchObject({
      status: "fix_drafted",
      fixTicketRef: { kind: "draft", id: DRAFT, key: "FIX-1" },
    });
    // Drafted, never filed: that is the opt-in's.
    expect(batches.push).not.toHaveBeenCalled();
  });

  it("uses the configured ticket source when there are several", async () => {
    const chosen = "50000000-0000-4000-8000-000000000002";
    const { step, batches, store } = harness(open(), { fixSourceId: chosen });
    store.sources.push(chosen);

    await step();

    expect(callArg(batches.compose, 0, 2)).toMatchObject({ targetSourceId: chosen });
  });

  it("rests, saying what is missing, with no source or an unchosen one", async () => {
    const none = harness(open());
    none.store.sources = [];
    expect(await none.step()).toEqual({
      rested: "the fix is not drafted: this workspace has no ticket source to draft it for",
    });

    const several = harness(open());
    several.store.sources.push("50000000-0000-4000-8000-000000000002");
    expect(await several.step()).toEqual({
      rested:
        "the fix is not drafted: choose which ticket source fix drafts go to in the regression watch settings",
    });
    expect(several.batches.compose).not.toHaveBeenCalled();
    expect(several.store.get(several.id).status).toBe("investigation_open");
    // Resting on the same note twice writes nothing more.
    const move = jest.spyOn(several.store, "move");
    await several.step();
    expect(move).not.toHaveBeenCalled();
  });

  it("rests with Planning's refusal, and drafts once the note is cleared by a retry", async () => {
    const { step, batches, store, id } = harness(open());
    batches.compose.mockRejectedValueOnce(
      Object.assign(new Error("ro"), { code: "planning_target_read_only" }),
    );

    expect(await step()).toEqual({
      rested: "the fix is not drafted: Planning refused it (planning_target_read_only)",
    });
    expect(await step()).toEqual({ moved: "fix_drafted" });
    expect(store.get(id).note).toBeNull();
  });
});

describe("fix_drafted — the opt-in", () => {
  const drafted = () =>
    item({
      status: "fix_drafted",
      bisectResult: BISECT_RESULT,
      fixTicketRef: { kind: "draft", id: DRAFT, key: "FIX-1" },
    });
  const sized = {
    draftId: DRAFT,
    localKey: "FIX-1",
    batchId: "batch-1",
    batchStatus: "sized",
    ticket: null,
  };

  it("never files without the opt-in", async () => {
    const { step, batches, queue, store } = harness(drafted(), { autoFile: false });
    store.drafts.set(DRAFT, sized);

    for (let pass = 0; pass < 3; pass += 1) {
      expect(await step()).toEqual({ waiting: "the draft waits for a person to file it" });
    }
    expect(batches.push).not.toHaveBeenCalled();
    expect(queue.queueSelection).not.toHaveBeenCalled();
  });

  it("files a sized draft with the opt-in, and waits for sizing first", async () => {
    const { step, batches, store } = harness(drafted(), { autoFile: true });
    store.drafts.set(DRAFT, { ...sized, batchStatus: "drafting" });
    expect(await step()).toEqual({ waiting: "the draft is not sized yet" });
    expect(batches.push).not.toHaveBeenCalled();

    store.drafts.set(DRAFT, sized);
    expect(await step()).toEqual({ waiting: "the draft is being filed" });
    expect(batches.push).toHaveBeenCalledWith(ORG, "batch-1");
  });

  it("tries again next pass when the push is refused", async () => {
    const { step, batches, store } = harness(drafted(), { autoFile: true });
    store.drafts.set(DRAFT, sized);
    batches.push.mockRejectedValue(new Error("throttled"));

    expect(await step()).toEqual({ waiting: "the draft is being filed" });
  });

  it("follows a draft a person filed to its ticket, with or without the opt-in", async () => {
    const { step, store, id } = harness(drafted());
    store.drafts.set(DRAFT, {
      ...sized,
      batchStatus: "pushed",
      ticket: { id: TICKET, key: "#517" },
    });

    await step();

    expect(store.get(id)).toMatchObject({
      status: "fix_drafted",
      fixTicketRef: { kind: "ticket", id: TICKET, key: "#517" },
    });
  });

  it("waits when the draft is gone or no ticket is named", async () => {
    expect(await harness(drafted()).step()).toEqual({ waiting: "the fix draft is gone" });
    expect(await harness(item({ status: "fix_drafted" })).step()).toEqual({
      waiting: "no fix ticket is named",
    });
  });
});

describe("fix_drafted → fix_running → fixed_merged", () => {
  const filed = () =>
    item({
      status: "fix_drafted",
      bisectResult: BISECT_RESULT,
      fixTicketRef: { kind: "ticket", id: TICKET, key: "#517" },
    });
  const progress = {
    issueId: "155e0000-0000-4000-8000-000000000517",
    queued: false,
    activeRunId: null,
    ranBefore: false,
    mergedPr: null,
  };

  it("queues the mirrored ticket only with the opt-in, and only once it is not queued", async () => {
    const off = harness(filed(), { autoFile: false });
    off.store.progress.set(TICKET, progress);
    expect(await off.step()).toEqual({ waiting: "the fix ticket has no run yet" });
    expect(off.queue.queueSelection).not.toHaveBeenCalled();

    const on = harness(filed(), { autoFile: true });
    on.store.progress.set(TICKET, progress);
    expect(await on.step()).toEqual({ waiting: "the fix ticket was queued" });
    expect(on.queue.queueSelection).toHaveBeenCalledWith(ORG, { issueIds: [progress.issueId] });

    on.store.progress.set(TICKET, { ...progress, queued: true });
    await on.step();
    expect(on.queue.queueSelection).toHaveBeenCalledTimes(1);

    const unmirrored = harness(filed(), { autoFile: true });
    expect(await unmirrored.step()).toEqual({ waiting: "the fix ticket has no run yet" });
    expect(unmirrored.queue.queueSelection).not.toHaveBeenCalled();
  });

  it("does not force a ticket the queue will not take yet", async () => {
    const { step, queue, store } = harness(filed(), { autoFile: true });
    store.progress.set(TICKET, progress);
    queue.queueSelection.mockRejectedValue(new Error("queue_issues_not_sized"));

    expect(await step()).toEqual({ waiting: "the fix ticket has no run yet" });
  });

  it("reads fixing while a run is in flight on the ticket", async () => {
    const { step, store, id } = harness(filed());
    store.progress.set(TICKET, { ...progress, activeRunId: "run-1" });

    expect(await step()).toEqual({ moved: "fix_running" });
    expect(await step()).toEqual({ waiting: "the fix loop is running" });
    expect(store.get(id).status).toBe("fix_running");
  });

  it("flips to merged through the pull request's reference", async () => {
    const { step, store, id } = harness(filed());
    store.progress.set(TICKET, { ...progress, activeRunId: "run-1" });
    await step();
    store.progress.set(TICKET, { ...progress, mergedPr: { id: "pr-641", number: 641 } });

    expect(await step()).toEqual({ moved: "fixed_merged" });
    expect(store.get(id)).toMatchObject({
      status: "fixed_merged",
      prRef: { pull_request_id: "pr-641", key: "#641" },
    });
    expect(await step()).toEqual({ waiting: "fixed_merged is final" });
  });

  it("goes straight from drafted to merged when the run was never seen", async () => {
    const { step, store, id } = harness(filed());
    store.progress.set(TICKET, { ...progress, mergedPr: { id: "pr-641", number: 641 } });

    expect(await step()).toEqual({ moved: "fixed_merged" });
    expect(store.get(id).status).toBe("fixed_merged");
  });

  it("returns to drafted when the loop ended without a merge", async () => {
    const { step, store, id } = harness(
      item({ status: "fix_running", fixTicketRef: { kind: "ticket", id: TICKET, key: "#517" } }),
    );
    store.progress.set(TICKET, { ...progress, ranBefore: true });

    expect(await step()).toEqual({ moved: "fix_drafted" });
    expect(store.get(id).status).toBe("fix_drafted");
  });

  it("leaves a running item alone when no run was ever recorded for its ticket", async () => {
    const { step, store, id } = harness(
      item({ status: "fix_running", fixTicketRef: { kind: "ticket", id: TICKET, key: "#512" } }),
    );

    expect(await step()).toEqual({ waiting: "no run is recorded for the fix ticket" });
    expect(store.get(id).status).toBe("fix_running");
  });

  it("does nothing when a person dismissed the item meanwhile", async () => {
    const { chain, store, id } = harness(filed());
    store.progress.set(TICKET, { ...progress, activeRunId: "run-1" });
    const stale = store.get(id);
    store.patch(ORG, id, { status: "dismissed" });

    expect(await chain.advance(stale)).toEqual({ waiting: "the item moved meanwhile" });
    expect(await chain.advance(store.get(id))).toEqual({ waiting: "dismissed is final" });
  });
});

describe("the fix draft", () => {
  const full = item({
    bisectResult: BISECT_RESULT,
    investigationId: "inv",
    investigationDisplayId: "RS-131",
  });

  it("is titled by the metric, the drift and the release", () => {
    expect(fixTitle(full)).toBe("Fix regression: hover_drift_cm +14% since v2.0.4");
  });

  it("carries the drift, the culprit, every farm job, the forensics and the repro", () => {
    const body = fixBody(full, hoverMetric());

    expect(body).toContain(
      "**hover_drift_cm** drifted **+14%** in `acme/helios-firmware` since `v2.0.4`",
    );
    expect(body).toContain("- Baseline (`v2.0.4`): median 5 cm (n = 30)");
    expect(body).toContain("- Nightly: median 5.7 cm (n = 12)");
    expect(body).toContain(`Bisected to \`${CULPRIT}\` in 2 farm jobs`);
    for (const job of JOBS) expect(body).toContain(`- farm job \`${job}\``);
    expect(body).toContain("Investigation RS-131 holds the comparison and the bisect");
    expect(body).toContain("pool `hil-rig`");
    expect(body).toContain("west twister");
  });

  it("leaves out what it does not know, and invents nothing", () => {
    const bare = fixBody(item(), undefined);

    expect(bare).not.toContain("## Culprit");
    expect(bare).not.toContain("## Forensics");
    expect(bare).not.toContain("## Repro");
    expect(
      fixBody(
        item({ bisectResult: { ...BISECT_RESULT, steps: 1, farm_job_ids: [JOBS[0]] } }),
        hoverMetric({ replay: { pool: "p", command: null } }),
      ),
    ).toContain("in 1 farm job (");
  });
});

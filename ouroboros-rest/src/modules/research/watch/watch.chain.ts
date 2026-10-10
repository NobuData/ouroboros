/**
 * The chain a watch item walks once drift is detected (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623); decision V6):
 *
 * ```
 * detected ─▶ bisecting ─▶ bisected ─▶ investigation_open ─▶ fix_drafted ─▶ fix_running ─▶ fixed_merged
 *    └─ no replayable test, or a bisect that found nothing ─▶ stays `detected · needs repro`
 * ```
 *
 * {@link RegressionWatchChain.advance} takes one item **one step** and is safe to call again:
 * every move names the status it expects to leave, so a second pass — or a person dismissing
 * the item meanwhile — finds nothing to do. The scheduler calls it for every open item.
 *
 * Each step composes a plane that already exists and adds none of its own:
 *
 *   * **bisect** — CL.4's primitive (`CodeBisectService`, #617): good = the baseline's release
 *     tag, bad = the metric's nightly ref, test = the metric's replay test. The watch waits on
 *     the bisect's row; it builds nothing itself.
 *   * **forensics** — a `regression_forensics` investigation with `origin: regression_watch`,
 *     its ledger pre-seeded with the comparison (a `telemetry://` source) and the bisect (a
 *     `bisect://` source naming every farm job), then handed to the investigation loop — best
 *     effort: an investigation that cannot be dispatched stays queued with its evidence.
 *   * **fix draft** — one Planning draft (`BatchesService.compose`, planner
 *     `regression-watch-v1`) carrying the drift, the culprit and the repro. **Filed and queued
 *     only when the workspace opted in** (`auto_file`); otherwise it waits for a person.
 *   * **the fix's journey** — read from the draft's pushed ticket, the run on it and the pull
 *     request that merges it.
 *
 * **Honest stops.** A metric with no replay test, a ref the bisect cannot resolve, a bisect
 * that ends inconclusive, failed or canceled: each leaves the item at `detected` with a
 * `needs repro` note that says which. Nothing invents a culprit.
 */

import { Injectable, Logger } from "@nestjs/common";

import { BacklogQueueService } from "../../backlog/queue.service";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { describeForLog } from "../../errors/failure";
import { BatchesService } from "../../planning/batches.service";
import { CodeBisectService, type BisectView } from "../code/code-bisect.service";
import { CodeRefusal } from "../code/code.reader";
import { bisectSource } from "../code/code.sources";
import { ResearchEstimateService } from "../estimate.service";
import { InvestigationDispatchService } from "../loop/investigation-dispatch.service";
import { ResearchToolRegistry } from "../tools/research-tool.registry";
import { ResearchToolRepository } from "../tools/research-tool.repository";
import { windowPhrase } from "./watch.drift";
import { bisectCompleteEmission, metricLabel } from "./watch.inbox";
import { TELEMETRY_SLUG, WatchReadings } from "./watch.readings";
import {
  WatchRepository,
  type StoredBisectResult,
  type StoredMetric,
  type WatchItemRow,
  type WatchSettingsRow,
  type WatchStore,
} from "./watch.repository";
import { watchedMetric } from "./watch.service";

/** The planner name a fix draft's batch records as its provenance. */
export const WATCH_PLANNER = "regression-watch-v1";

/** The local key of the one draft a fix batch holds. */
export const FIX_LOCAL_KEY = "FIX-1";

/** The code tool's slug, for the bisect's citation. */
const CODE_SLUG = "code";

/** How the bisect's confidence is described — a method and its inputs, never a number. */
export const BISECT_METHOD = "first_parent_bisect";

/** The note of a metric that cannot be bisected because nothing replays it. */
export const NEEDS_REPRO_NO_TEST =
  "needs repro: no replayable test is configured for this metric, so it cannot be bisected";

/** What one step did. */
export type StepOutcome =
  /** The item moved to this status. */
  | { readonly moved: string }
  /** The item rests where it is, and this is why. */
  | { readonly rested: string }
  /** There was nothing to do this pass. */
  | { readonly waiting: string };

@Injectable()
export class RegressionWatchChain {
  private readonly logger = new Logger(RegressionWatchChain.name);
  private readonly store: WatchStore;
  private readonly readings: WatchReadings;

  /**
   * @param repository - The watch's tables.
   * @param bisects - CL.4's bisect primitive.
   * @param tools - The research tools, to cite the comparison.
   * @param ledger - Where an investigation's sources are archived.
   * @param estimates - CM.3's estimator, for the opened investigation's budget.
   * @param dispatch - CM.1's dispatch to the investigation loop.
   * @param batches - Planning's batches, for the fix draft and its push.
   * @param queue - The backlog queue, for the opt-in's queueing.
   * @param decisions - Where the bisection card is filed.
   */
  constructor(
    repository: WatchRepository,
    private readonly bisects: CodeBisectService,
    tools: ResearchToolRegistry,
    private readonly ledger: ResearchToolRepository,
    private readonly estimates: ResearchEstimateService,
    private readonly dispatch: InvestigationDispatchService,
    private readonly batches: BatchesService,
    private readonly queue: BacklogQueueService,
    private readonly decisions: DecisionKindRegistry,
  ) {
    this.store = repository;
    this.readings = new WatchReadings(tools);
  }

  /**
   * Take one item one step along the chain.
   *
   * @param item - An open item.
   * @returns What happened.
   */
  async advance(item: WatchItemRow): Promise<StepOutcome> {
    const settings = await this.store.settings(item.organizationId);

    switch (item.status) {
      case "detected":
        return this.startBisect(item, settings);
      case "bisecting":
        return this.settleBisect(item);
      case "bisected":
        return this.openForensics(item);
      case "investigation_open":
        return this.draftFix(item, settings);
      case "fix_drafted":
        return this.followDraft(item, settings);
      case "fix_running":
        return this.followRun(item);
      default:
        return { waiting: `${item.status} is final` };
    }
  }

  /**
   * `detected` → `bisecting`, when policy and the metric allow a bisect.
   *
   * @param item - The item.
   * @param settings - The workspace's settings.
   * @returns The move, or why the item rests.
   */
  private async startBisect(item: WatchItemRow, settings: WatchSettingsRow): Promise<StepOutcome> {
    if (item.note !== null) return { waiting: "resting with a note" };
    if (item.severity === "ok") return { waiting: "the drift is no longer there" };
    if (!settings.autoBisect) return { waiting: "automatic bisects are off" };

    const metric = watchedMetric(settings.metrics, item.baseline);
    if (metric?.replay == null) return this.rest(item, "detected", NEEDS_REPRO_NO_TEST);

    let view: BisectView;
    try {
      view = await this.bisects.start({
        organizationId: item.organizationId,
        repository: item.baseline.repo,
        good: item.baseline.releaseTag,
        bad: metric.nightly_ref,
        testRef: `watch:${metricLabel(item.baseline.metricKey)}`,
        pool: metric.replay.pool,
        command: metric.replay.command,
        createdBy: null,
      });
    } catch (error) {
      // What the request itself gets wrong will be wrong again tomorrow: say so and rest. A
      // clone that could not be reached, or an engine that is down, is tried again next pass.
      if (error instanceof CodeRefusal && error.refusalClass === "unsupported") {
        return this.rest(
          item,
          "detected",
          `needs repro: the bisect could not start — ${error.detail}`,
        );
      }
      this.logger.warn(
        `The bisect for watch item ${item.id} could not start; trying again next pass.`,
        describeForLog(error),
      );
      return { waiting: "the bisect could not start yet" };
    }

    const moved = await this.store.move(item.organizationId, item.id, "detected", {
      status: "bisecting",
      bisectId: view.bisect.id,
    });
    return moved ? { moved: "bisecting" } : { waiting: "the item moved meanwhile" };
  }

  /**
   * `bisecting` → `bisected` when the bisect names a culprit, or back to `detected`.
   *
   * @param item - The item.
   * @returns The move, or that the bisect is still running.
   */
  private async settleBisect(item: WatchItemRow): Promise<StepOutcome> {
    const view =
      item.bisectId === null
        ? undefined
        : await this.bisects.get(item.organizationId, item.bisectId);

    if (view === undefined) {
      return this.rest(
        item,
        "bisecting",
        "needs repro: the bisect this item was waiting on is gone",
        "detected",
      );
    }
    if (view.bisect.status === "running") return { waiting: "the bisect is still running" };

    const result = bisectResultOf(view);
    if (result === null) {
      const why = view.bisect.note === null ? "" : ` — ${view.bisect.note}`;
      return this.rest(
        item,
        "bisecting",
        `needs repro: the bisect ended ${view.bisect.status} without isolating a commit${why}`.slice(
          0,
          2000,
        ),
        "detected",
      );
    }

    if (
      !(await this.store.move(item.organizationId, item.id, "bisecting", {
        status: "bisected",
        bisectResult: result,
      }))
    ) {
      return { waiting: "the item moved meanwhile" };
    }

    const emission = bisectCompleteEmission(
      { ...item, bisectResult: result },
      "The watch is opening a forensics investigation and drafting a fix ticket.",
    );
    if (emission !== null) {
      try {
        await this.decisions.emit(emission);
      } catch (error) {
        this.logger.error(
          `Could not file the bisect card for watch item ${item.id}.`,
          describeForLog(error),
        );
      }
    }
    return { moved: "bisected" };
  }

  /**
   * `bisected` → `investigation_open`: open the forensics, seed its ledger, hand it to the loop.
   *
   * @param item - The item.
   * @returns The move.
   */
  private async openForensics(item: WatchItemRow): Promise<StepOutcome> {
    const culprit = item.bisectResult?.culprit_sha.slice(0, 7) ?? "an unknown commit";
    const label = metricLabel(item.baseline.metricKey);
    const opened = await this.store.openInvestigation(
      item.organizationId,
      `Regression forensics: ${label} drifted ${item.driftDisplay} in ${item.baseline.repo} since ` +
        `${item.baseline.releaseTag}, bisected to ${culprit}. What in that commit caused it, and what is the right fix?`,
      [],
    );
    if (opened === undefined) {
      return { waiting: "this workspace has no regression_forensics investigation kind" };
    }

    await this.seed(item, opened.id);

    if (
      !(await this.store.move(item.organizationId, item.id, "bisected", {
        status: "investigation_open",
        investigationId: opened.id,
      }))
    ) {
      return { waiting: "the item moved meanwhile" };
    }

    // Best effort from here: the investigation exists and holds its evidence whatever follows.
    try {
      await this.estimates.storeEstimate(item.organizationId, opened.id);
      await this.dispatch.dispatch(item.organizationId, opened.id);
    } catch (error) {
      this.logger.warn(
        `${opened.displayId} was opened for watch item ${item.id} and stays queued: it could not be dispatched.`,
        describeForLog(error),
      );
    }
    return { moved: "investigation_open" };
  }

  /**
   * Archive what the watch knows into the investigation's ledger. A source that cannot be
   * archived is logged and left out: the investigation is still worth opening.
   *
   * @param item - The item.
   * @param investigationId - The investigation.
   */
  private async seed(item: WatchItemRow, investigationId: string): Promise<void> {
    try {
      const comparison = await this.readings.compare(
        item.organizationId,
        item.baseline.metricKey,
        item.baseline.repo,
        item.baseline.releaseTag,
        `${item.current.from}..${item.current.to}`,
      );
      if (comparison.status === "ok" && comparison.sources.length > 0) {
        await this.ledger.archiveSources(investigationId, TELEMETRY_SLUG, comparison.sources);
      }

      const view =
        item.bisectId === null
          ? undefined
          : await this.bisects.get(item.organizationId, item.bisectId);
      if (view !== undefined) {
        await this.ledger.archiveSources(investigationId, CODE_SLUG, [bisectSource(view)]);
      }
    } catch (error) {
      this.logger.warn(
        `The evidence of watch item ${item.id} could not all be archived into its investigation.`,
        describeForLog(error),
      );
    }
  }

  /**
   * `investigation_open` → `fix_drafted`: compose the fix draft in Planning.
   *
   * @param item - The item.
   * @param settings - The workspace's settings.
   * @returns The move, or why there is no draft yet.
   */
  private async draftFix(item: WatchItemRow, settings: WatchSettingsRow): Promise<StepOutcome> {
    const sources = await this.store.ticketSources(item.organizationId);
    const target = settings.fixSourceId ?? (sources.length === 1 ? sources[0] : undefined);

    if (target === undefined) {
      return this.rest(
        item,
        "investigation_open",
        sources.length === 0
          ? "the fix is not drafted: this workspace has no ticket source to draft it for"
          : "the fix is not drafted: choose which ticket source fix drafts go to in the regression watch settings",
      );
    }

    const metric = watchedMetric(settings.metrics, item.baseline);
    let draftId: string | undefined;
    try {
      const batch = await this.batches.compose(item.organizationId, null, {
        prompt: `Regression watch: ${metricLabel(item.baseline.metricKey)} ${item.driftDisplay} since ${item.baseline.releaseTag}`,
        planner: WATCH_PLANNER,
        targetSourceId: target,
        drafts: [{ localKey: FIX_LOCAL_KEY, title: fixTitle(item), body: fixBody(item, metric) }],
      });
      draftId = batch.drafts.find((draft) => draft.localKey === FIX_LOCAL_KEY)?.id;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.logger.warn(
        `The fix for watch item ${item.id} could not be drafted.`,
        describeForLog(error),
      );
      return this.rest(
        item,
        "investigation_open",
        `the fix is not drafted: Planning refused it (${typeof code === "string" ? code : "an error"})`,
      );
    }
    if (draftId === undefined) return { waiting: "the draft was not stored" };

    const moved = await this.store.move(item.organizationId, item.id, "investigation_open", {
      status: "fix_drafted",
      fixTicketRef: { kind: "draft", id: draftId, key: FIX_LOCAL_KEY },
      note: null,
    });
    return moved ? { moved: "fix_drafted" } : { waiting: "the item moved meanwhile" };
  }

  /**
   * `fix_drafted`: follow the draft to its ticket, and the ticket to a run or a merge — filing
   * and queueing it first when, and only when, the workspace opted in.
   *
   * @param item - The item.
   * @param settings - The workspace's settings.
   * @returns What changed.
   */
  private async followDraft(item: WatchItemRow, settings: WatchSettingsRow): Promise<StepOutcome> {
    const ref = item.fixTicketRef;
    if (ref === null) return { waiting: "no fix ticket is named" };

    if (ref.kind === "draft") {
      const draft = await this.store.draftState(item.organizationId, ref.id);
      if (draft === undefined) return { waiting: "the fix draft is gone" };

      if (draft.ticket !== null) {
        await this.store.move(item.organizationId, item.id, "fix_drafted", {
          fixTicketRef: { kind: "ticket", id: draft.ticket.id, key: draft.ticket.key },
        });
        return { moved: "fix_drafted" };
      }
      if (!settings.autoFile) return { waiting: "the draft waits for a person to file it" };
      if (draft.batchStatus !== "sized") return { waiting: "the draft is not sized yet" };

      try {
        await this.batches.push(item.organizationId, draft.batchId);
      } catch (error) {
        this.logger.warn(
          `The fix draft of watch item ${item.id} could not be filed; trying again next pass.`,
          describeForLog(error),
        );
      }
      return { waiting: "the draft is being filed" };
    }

    const progress = await this.store.fixProgress(item.organizationId, ref.id);

    if (progress.mergedPr !== null || progress.activeRunId !== null) {
      const running = await this.store.move(item.organizationId, item.id, "fix_drafted", {
        status: "fix_running",
      });
      if (!running) return { waiting: "the item moved meanwhile" };
      return progress.mergedPr === null
        ? { moved: "fix_running" }
        : this.merged(item, progress.mergedPr);
    }

    if (settings.autoFile && progress.issueId !== null && !progress.queued) {
      try {
        await this.queue.queueSelection(item.organizationId, { issueIds: [progress.issueId] });
        return { waiting: "the fix ticket was queued" };
      } catch (error) {
        // The queue takes only a sized, mirrored issue: one that is not there yet is asked
        // about again next pass, not forced in.
        this.logger.debug(
          `The fix ticket of watch item ${item.id} is not queueable yet.`,
          describeForLog(error),
        );
      }
    }
    return { waiting: "the fix ticket has no run yet" };
  }

  /**
   * `fix_running` → `fixed_merged`, or back to `fix_drafted` when the loop ended without one.
   *
   * @param item - The item.
   * @returns The move, or that the loop is still running, or that no run was ever recorded.
   */
  private async followRun(item: WatchItemRow): Promise<StepOutcome> {
    const ref = item.fixTicketRef;
    if (ref === null || ref.kind !== "ticket") return { waiting: "no fix ticket is named" };

    const progress = await this.store.fixProgress(item.organizationId, ref.id);
    if (progress.mergedPr !== null) return this.merged(item, progress.mergedPr);
    if (progress.activeRunId !== null) return { waiting: "the fix loop is running" };
    // "Not running" means the loop ended only when a run was recorded at all: an item whose
    // run this deployment never saw is left as it is rather than demoted on a guess.
    if (!progress.ranBefore) return { waiting: "no run is recorded for the fix ticket" };

    const back = await this.store.move(item.organizationId, item.id, "fix_running", {
      status: "fix_drafted",
    });
    return back ? { moved: "fix_drafted" } : { waiting: "the item moved meanwhile" };
  }

  /**
   * `fix_running` → `fixed_merged`, naming the pull request.
   *
   * @param item - The item, in `fix_running`.
   * @param pr - The merged pull request.
   * @returns The move.
   */
  private async merged(
    item: WatchItemRow,
    pr: { readonly id: string; readonly number: number },
  ): Promise<StepOutcome> {
    const moved = await this.store.move(item.organizationId, item.id, "fix_running", {
      status: "fixed_merged",
      // The key is the pull request's own, as V115 holds it to; the card adds the "PR".
      prRef: { pull_request_id: pr.id, key: `#${pr.number.toString()}` },
    });
    return moved ? { moved: "fixed_merged" } : { waiting: "the item moved meanwhile" };
  }

  /**
   * Leave an item where it is (or return it to `detected`) with the reason on it.
   *
   * @param item - The item.
   * @param from - The status it is in.
   * @param note - Why it rests.
   * @param to - The status to return to, when not `from`.
   * @returns The rest.
   */
  private async rest(
    item: WatchItemRow,
    from: WatchItemRow["status"],
    note: string,
    to?: WatchItemRow["status"],
  ): Promise<StepOutcome> {
    if (item.note === note && to === undefined) return { rested: note };

    await this.store.move(item.organizationId, item.id, from, {
      note,
      ...(to === undefined ? {} : { status: to }),
    });
    return { rested: note };
  }
}

/**
 * A converged bisect as V115's `bisect_result`.
 *
 * @param view - The bisect and its steps.
 * @returns The result — the culprit, the farm jobs that decided it and how — or null for a
 *   bisect that did not converge, or converged with no decided step to stand on.
 */
export function bisectResultOf(view: BisectView): StoredBisectResult | null {
  const decided = view.steps.filter((step) => step.verdict !== null);

  if (
    view.bisect.status !== "converged" ||
    view.bisect.culpritSha === null ||
    decided.length === 0
  ) {
    return null;
  }

  return {
    culprit_sha: view.bisect.culpritSha,
    farm_job_ids: [...new Set(decided.map((step) => step.buildJobId))].slice(0, 64),
    steps: decided.length,
    confidence_basis: {
      method: BISECT_METHOD,
      inputs: {
        good: view.bisect.goodSha,
        bad: view.bisect.badSha,
        candidates: view.bisect.commits.length,
        test: view.bisect.testRef,
        pool: view.bisect.pool,
      },
    },
  };
}

/**
 * The fix draft's title.
 *
 * @param item - The item.
 * @returns One line naming the metric, the drift and the release.
 */
export function fixTitle(item: WatchItemRow): string {
  return `Fix regression: ${metricLabel(item.baseline.metricKey)} ${item.driftDisplay} since ${item.baseline.releaseTag}`.slice(
    0,
    200,
  );
}

/**
 * The fix draft's body: the drift, the culprit, the evidence and the repro.
 *
 * @param item - The item.
 * @param metric - The metric's configuration, for the repro command.
 * @returns Markdown.
 */
export function fixBody(item: WatchItemRow, metric: StoredMetric | undefined): string {
  const result = item.bisectResult;
  const lines = [
    `The regression watch found **${metricLabel(item.baseline.metricKey)}** drifted **${item.driftDisplay}** in \`${item.baseline.repo}\` since \`${item.baseline.releaseTag}\`.`,
    "",
    "## Drift",
    "",
    `- Baseline (\`${item.baseline.releaseTag}\`): ${windowPhrase(item.baseline.window)}, ${item.baseline.window.from} to ${item.baseline.window.to}`,
    `- Nightly: ${windowPhrase(item.current)}, ${item.current.from} to ${item.current.to}`,
    `- Severity: ${item.severity}`,
  ];

  if (result !== null) {
    lines.push(
      "",
      "## Culprit",
      "",
      `Bisected to \`${result.culprit_sha}\` in ${result.steps.toString()} farm job${result.steps === 1 ? "" : "s"} (first-parent bisect between the release and the nightly).`,
      "",
      ...result.farm_job_ids.map((job) => `- farm job \`${job}\``),
    );
  }
  if (item.investigationId !== null) {
    lines.push(
      "",
      "## Forensics",
      "",
      `Investigation ${item.investigationDisplayId ?? item.investigationId} holds the comparison and the bisect as cited sources.`,
    );
  }
  if (metric?.replay != null) {
    lines.push(
      "",
      "## Repro",
      "",
      `Run the metric's replay test on pool \`${metric.replay.pool}\` at the culprit and at its parent:`,
      "",
      "```",
      metric.replay.command === null
        ? "(the pool's default command)"
        : metric.replay.command.join(" "),
      "```",
      "",
      "It passes at the parent and fails at the culprit. A fix makes it pass at the tip of the branch.",
    );
  }

  return lines.join("\n");
}

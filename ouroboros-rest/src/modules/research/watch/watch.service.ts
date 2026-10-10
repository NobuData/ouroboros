/**
 * `RegressionWatchService` — baselines, the nightly comparison, and the card (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623); decision V6).
 *
 * ```
 * release tag (or by hand) ─▶ capture: each watched metric's window ─▶ regression_baselines
 * nightly ─▶ compare: the last days against the newest baseline, under the metric's rule
 *            ├─ within thresholds ─▶ nothing is opened
 *            └─ drift ─▶ watch item (signed drift · severity) ─▶ one inbox card
 * ```
 *
 * **Deterministic, with no model involved.** Reads are the telemetry tool's (`watch.readings.ts`);
 * the judgement is `evaluateDrift` (`watch.drift.ts`); what happens to an item afterwards is
 * the chain's (`watch.chain.ts`).
 *
 * **A baseline is captured once.** A release that already has a metric's baseline keeps it — a
 * baseline is a measurement, never edited (V115) — and the capture says which it skipped.
 *
 * **One open item per baseline.** A night that reads the drift again refreshes the open item's
 * window and severity; it does not open a second, and files no second card. A night that reads
 * the metric back inside its thresholds marks the open item `ok` and leaves its journey alone.
 */

import { Injectable, Logger } from "@nestjs/common";

import { AuditService } from "../../audit/audit.service";
import { RESEARCH_WATCH_POLICY_UPDATED_EVENT } from "../../audit/audit.events";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { describeForLog } from "../../errors/failure";
import { ResearchToolRegistry } from "../tools/research-tool.registry";
import { CodeBisectService } from "../code/code-bisect.service";
import { evaluateDrift, tidy } from "./watch.drift";
import { itemClosed, itemNotFound, nothingWatched, settingsInvalid } from "./watch.errors";
import { driftDetectedEmission } from "./watch.inbox";
import { WatchReadings } from "./watch.readings";
import {
  OPEN_STATUSES,
  WatchRepository,
  type BaselineRow,
  type StoredMetric,
  type WatchSettingsPatch,
  type WatchStore,
} from "./watch.repository";
import {
  baselineResource,
  cardResource,
  settingsResource,
  type CaptureResource,
  type ComparisonResource,
  type WatchCardResource,
  type WatchItemResource,
  type WatchSettingsResource,
  watchItemResource,
} from "./watch.resources";

/** The window a metric is read over when nothing configures one. */
export const DEFAULT_WINDOW_DAYS = 7;

/** The most items one card reads. */
export const CARD_LIMIT = 100;

/** What a capture is asked for. */
export interface CaptureRequest {
  /** `owner/name`. */
  readonly repository: string;
  readonly releaseTag: string;
  /** `release` for an announced tag, `manual` for a person's capture. */
  readonly via: "release" | "manual";
  /** Who captured by hand; null for a release. */
  readonly userId: string | null;
}

/**
 * The first instant of an instant's UTC day.
 *
 * @param now - An instant.
 * @returns Midnight UTC of that day.
 */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The watched metric a baseline belongs to, if it is still watched.
 *
 * @param metrics - The workspace's watched metrics.
 * @param baseline - The baseline.
 * @returns The entry with the same repository and key.
 */
export function watchedMetric(
  metrics: readonly StoredMetric[],
  baseline: Pick<BaselineRow, "repo" | "metricKey">,
): StoredMetric | undefined {
  return metrics.find(
    (metric) =>
      metric.key === baseline.metricKey &&
      metric.repo.toLowerCase() === baseline.repo.toLowerCase(),
  );
}

@Injectable()
export class RegressionWatchService {
  private readonly logger = new Logger(RegressionWatchService.name);
  private readonly store: WatchStore;
  private readonly readings: WatchReadings;

  /**
   * @param repository - The watch's tables.
   * @param tools - The research tools, for the telemetry reads.
   * @param decisions - Where the detection card is filed.
   * @param bisects - CL.4's bisect primitive, to cancel one when its item is dismissed.
   * @param audit - Where a policy change is recorded.
   */
  constructor(
    repository: WatchRepository,
    tools: ResearchToolRegistry,
    private readonly decisions: DecisionKindRegistry,
    private readonly bisects: CodeBisectService,
    private readonly audit: AuditService,
  ) {
    this.store = repository;
    this.readings = new WatchReadings(tools);
  }

  /**
   * Capture a release's baselines: one per watched metric of the repository.
   *
   * @param organizationId - The workspace.
   * @param request - The repository, the release and who is capturing.
   * @returns What was captured, and what was skipped with the reason.
   * @throws {InvalidRequestError} `regression_watch_nothing_watched` for a by-hand capture of
   *   a repository with no watched metric. An announced release of one captures nothing, quietly.
   */
  async capture(organizationId: string, request: CaptureRequest): Promise<CaptureResource> {
    const settings = await this.store.settings(organizationId);
    const metrics = settings.metrics.filter(
      (metric) => metric.repo.toLowerCase() === request.repository.toLowerCase(),
    );

    if (metrics.length === 0 && request.via === "manual") throw nothingWatched(request.repository);

    const captured: BaselineRow[] = [];
    const skipped: { metric: string; reason: string }[] = [];

    for (const metric of metrics) {
      const reading = await this.readings.window(
        organizationId,
        metric.key,
        metric.repo,
        metric.window_days,
      );

      if (reading.status === "no_data") {
        // No baseline of nothing: an empty window is not a measurement of zero.
        skipped.push({ metric: metric.key, reason: reading.reason });
        continue;
      }

      const stored = await this.store.insertBaseline({
        organizationId,
        repo: metric.repo,
        releaseTag: request.releaseTag,
        metricSource: metric.source,
        metricKey: metric.key,
        metricClass: metric.class,
        window: reading.window,
        capturedVia: request.via,
        capturedBy: request.via === "manual" ? request.userId : null,
      });

      if (stored === undefined) {
        skipped.push({
          metric: metric.key,
          reason: `release ${request.releaseTag} already has this metric's baseline, and a baseline is never re-measured`,
        });
      } else {
        captured.push(stored);
      }
    }

    return {
      repository: request.repository,
      releaseTag: request.releaseTag,
      captured: captured.map(baselineResource),
      skipped,
    };
  }

  /**
   * An announced release: capture for every workspace that watches the repository.
   *
   * @param repository - `owner/name`.
   * @param releaseTag - The tag.
   * @returns How many workspaces watch it and how many baselines were captured.
   */
  async released(
    repository: string,
    releaseTag: string,
  ): Promise<{ readonly workspaces: number; readonly captured: number }> {
    const workspaces = await this.store.workspacesWatching(repository);
    let captured = 0;

    for (const organizationId of workspaces) {
      try {
        const result = await this.capture(organizationId, {
          repository,
          releaseTag,
          via: "release",
          userId: null,
        });
        captured += result.captured.length;
      } catch (error) {
        // One workspace's failure must not lose the release for the others.
        this.logger.error(
          `Baselines of ${repository} ${releaseTag} could not be captured for ${organizationId}.`,
          describeForLog(error),
        );
      }
    }

    return { workspaces: workspaces.length, captured };
  }

  /**
   * The nightly comparison of one workspace: every newest baseline against its current window.
   *
   * @param organizationId - The workspace.
   * @param now - The clock.
   * @returns Per metric: opened, refreshed, cleared, or within thresholds and why.
   */
  async compare(organizationId: string, now: Date = new Date()): Promise<ComparisonResource> {
    const settings = await this.store.settings(organizationId);
    const results: ComparisonResource["results"][number][] = [];

    for (const baseline of await this.store.latestBaselines(organizationId)) {
      const metric = watchedMetric(settings.metrics, baseline);
      const days = metric?.window_days ?? DEFAULT_WINDOW_DAYS;
      const reading = await this.readings.compare(
        organizationId,
        baseline.metricKey,
        baseline.repo,
        baseline.releaseTag,
        `${days.toString()}d`,
      );
      const about = { repository: baseline.repo, metric: baseline.metricKey };

      if (reading.status === "no_data") {
        results.push({ ...about, outcome: "no_data", reason: reading.reason, itemId: null });
        continue;
      }

      const rule = await this.store.threshold(
        organizationId,
        baseline.metricKey,
        baseline.metricClass,
      );
      const verdict = evaluateDrift(baseline.window, reading.window, rule, baseline.metricClass);
      const open = await this.store.openItem(organizationId, baseline.id);

      if (verdict.status === "within") {
        if (open !== undefined && verdict.measured) {
          // The drift is no longer there. The item keeps its journey; its reading says so.
          await this.store.updateReading(organizationId, open.id, {
            current: reading.window,
            driftValue: tidy(reading.window.median - baseline.window.median),
            driftUnit: baseline.window.unit,
            severity: "ok",
          });
        }
        results.push({
          ...about,
          // A night with too little to compare says nothing about a drift already found.
          outcome: open === undefined || !verdict.measured ? "within" : "cleared",
          reason: verdict.reason,
          itemId: open?.id ?? null,
        });
        continue;
      }

      const measured = {
        current: reading.window,
        driftValue: verdict.driftValue,
        driftUnit: verdict.driftUnit,
        severity: verdict.severity,
      };

      if (open !== undefined) {
        await this.store.updateReading(organizationId, open.id, measured);
        results.push({ ...about, outcome: "refreshed", reason: null, itemId: open.id });
        continue;
      }

      const item = await this.store.insertItem(organizationId, baseline.id, measured);
      await this.announce(item, nextStepOf(settings.autoBisect, metric));
      results.push({ ...about, outcome: "opened", reason: null, itemId: item.id });
    }

    await this.store.markCompared(organizationId, now);

    return { comparedAt: now.toISOString(), results };
  }

  /**
   * The regression watch card.
   *
   * @param organizationId - The workspace.
   * @returns The items, open ones first, under the release the newest baselines belong to.
   */
  async card(organizationId: string): Promise<WatchCardResource> {
    const [items, baselines, settings] = await Promise.all([
      this.store.items(organizationId, CARD_LIMIT),
      this.store.latestBaselines(organizationId),
      this.store.settings(organizationId),
    ]);

    return cardResource(items, baselines, settings);
  }

  /**
   * The watch's settings.
   *
   * @param organizationId - The workspace.
   * @returns Thresholds over their defaults, the watched metrics and the two policy switches.
   */
  async settings(organizationId: string): Promise<WatchSettingsResource> {
    return settingsResource(await this.store.settings(organizationId));
  }

  /**
   * Save the watch's settings.
   *
   * @param organizationId - The workspace.
   * @param userId - Who is saving.
   * @param patch - What changed; an absent field keeps what is stored.
   * @returns The settings as they now stand.
   * @throws {InvalidRequestError} `regression_watch_settings_invalid` when the database refuses
   *   them — a metric id the insights catalogue lacks, a ticket source that does not exist.
   */
  async saveSettings(
    organizationId: string,
    userId: string,
    patch: WatchSettingsPatch,
  ): Promise<WatchSettingsResource> {
    const before = await this.store.settings(organizationId);

    if (
      patch.fixSourceId != null &&
      !(await this.store.ticketSources(organizationId)).includes(patch.fixSourceId)
    ) {
      throw settingsInvalid("fixSourceId names no ticket source of this workspace.", {
        fixSourceId: patch.fixSourceId,
      });
    }

    const unknown = await this.store.unknownMetrics(
      (patch.metrics ?? [])
        .filter((metric) => metric.source === "bi_metric")
        .map((metric) => metric.key),
    );
    if (unknown.length > 0) {
      // A baseline of an insights metric is held to the catalogue (V115); refuse it here, where
      // the person who typed it can read why, rather than at the next release.
      throw settingsInvalid("A watched insights metric is not in the metric catalogue.", {
        metrics: unknown,
      });
    }

    let after;
    try {
      after = await this.store.saveSettings(organizationId, patch, userId);
    } catch (error) {
      const constraint = (error as { constraint?: unknown } | null)?.constraint;
      if (typeof constraint === "string" && constraint.startsWith("regression_watch_settings_")) {
        throw settingsInvalid("The settings are not in a shape the watch can store.", {
          constraint,
        });
      }
      throw error;
    }

    if (before.autoBisect !== after.autoBisect || before.autoFile !== after.autoFile) {
      // The opt-in to file and queue without asking is a policy decision, and is recorded as one.
      await this.audit.record({
        organizationId,
        actorId: userId,
        action: RESEARCH_WATCH_POLICY_UPDATED_EVENT,
        subjectType: "regression_watch_settings",
        subjectId: organizationId,
        at: new Date(),
        detail: {
          previousAutoBisect: before.autoBisect,
          autoBisect: after.autoBisect,
          previousAutoFile: before.autoFile,
          autoFile: after.autoFile,
        },
      });
    }

    return settingsResource(after);
  }

  /**
   * Dismiss a watch item.
   *
   * @param organizationId - The workspace.
   * @param userId - Who is dismissing it.
   * @param itemId - The item.
   * @param reason - Why.
   * @returns The item, dismissed. A bisect it was waiting on is canceled.
   * @throws {NotFoundError} `regression_watch_item_not_found`.
   * @throws {ConflictError} `regression_watch_item_closed` once it is merged or dismissed.
   */
  async dismiss(
    organizationId: string,
    userId: string,
    itemId: string,
    reason: string,
  ): Promise<WatchItemResource> {
    const item = await this.store.item(organizationId, itemId);
    if (item === undefined) throw itemNotFound(itemId);
    if (!OPEN_STATUSES.includes(item.status)) throw itemClosed(itemId, item.status);

    if (!(await this.store.dismiss(organizationId, itemId, userId, reason))) {
      const now = await this.store.item(organizationId, itemId);
      throw now === undefined ? itemNotFound(itemId) : itemClosed(itemId, now.status);
    }
    if (item.status === "bisecting" && item.bisectId !== null) {
      try {
        await this.bisects.cancel(organizationId, item.bisectId);
      } catch (error) {
        this.logger.warn(
          `Bisect ${item.bisectId} of a dismissed watch item could not be canceled.`,
          describeForLog(error),
        );
      }
    }

    const dismissed = await this.store.item(organizationId, itemId);
    if (dismissed === undefined) throw itemNotFound(itemId);
    return watchItemResource(dismissed);
  }

  /**
   * File the detection card. Never throws: the item exists either way.
   *
   * @param item - The item just opened.
   * @param nextStep - What the watch does next.
   */
  private async announce(
    item: Parameters<typeof driftDetectedEmission>[0],
    nextStep: string,
  ): Promise<void> {
    try {
      await this.decisions.emit(driftDetectedEmission(item, nextStep));
    } catch (error) {
      this.logger.error(
        `Could not file the drift card for watch item ${item.id}.`,
        describeForLog(error),
      );
    }
  }
}

/**
 * What the watch does after detecting a drift, as the card says it.
 *
 * @param autoBisect - The workspace's policy.
 * @param metric - The metric's configuration, if it is still watched.
 * @returns One sentence.
 */
export function nextStepOf(autoBisect: boolean, metric: StoredMetric | undefined): string {
  if (metric?.replay == null) {
    return "No replayable test is configured for this metric, so it cannot be bisected: it needs a repro.";
  }
  return autoBisect
    ? "The watch is bisecting it to a commit on the build farm."
    : "Automatic bisects are off for this workspace; start one from the regression watch.";
}

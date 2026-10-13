/**
 * What the `/ouro` commands say back — pure formatting (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * Every sentence a binding replies with is composed here from values a plane returned, so the
 * wording has one home and `replies.spec.ts` can hold the two replies mockup 19 seeds to the
 * mockup's own text. Nothing here reads a clock, a service or a row.
 */

import { formatDuration } from "../../decisions/inbox.compose";
import type { DryRunStatus } from "../../db/schema";
import type { CommandReply, ReplyLink } from "../grammar.types";

/** The separator mockup 19's status line uses. */
const DOT = " · ";

/** Cents in a dollar. */
const CENTS = 100;

/** Milliseconds in a second. */
const MS = 1000;

/** The words `/ouro dry-run` acknowledges with — mockup 19's, verbatim. */
export const DRY_RUN_STARTED =
  "Dry run started — no writes, no PRs. Results in ~3 min → follow in Workflow Copilot";

/** The label of the link a dry-run reply carries. */
export const COPILOT_LABEL = "Workflow Copilot";

/**
 * Money as a reply prints it.
 *
 * @param cents - The amount in cents; fractions of a cent are rounded.
 * @returns `$18.60`.
 */
export function dollars(cents: number): string {
  return `$${(Math.round(cents) / CENTS).toFixed(2)}`;
}

/**
 * A count with its noun.
 *
 * @param count - How many.
 * @param singular - The noun for one.
 * @param plural - The noun otherwise.
 * @returns `1 loop`, `3 loops`.
 */
export function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/**
 * A large number of tokens, abbreviated.
 *
 * @param tokens - The count.
 * @returns `850`, `12k`, `1.2M`.
 */
export function tokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${String(Math.round(tokens / 1000))}k`;

  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** What the status line is composed from — one figure from each read. */
export interface StatusFigures {
  /** `stats.loopsLive.total` of the dashboard. */
  readonly loopsLive: number;
  /** `stats.queued.count` of the dashboard. */
  readonly queued: number;
  /** `stats.runnersOnline` of the farm page. */
  readonly runnersOnline: number;
  readonly runnersTotal: number;
  /** `stats.tokensToday.costCents` of the dashboard. */
  readonly spendTodayCents: number;
  /** `head.count` of the Needs-You queue. */
  readonly needsYou: number;
}

/**
 * Mockup 19's boxed line.
 *
 * @param figures - The five figures.
 * @returns `3 loops live · 12 queued · farm 4/5 online · spend today $18.60 · needs-you: 3`.
 */
export function statusLine(figures: StatusFigures): string {
  return [
    `${counted(figures.loopsLive, "loop")} live`,
    `${String(figures.queued)} queued`,
    `farm ${String(figures.runnersOnline)}/${String(figures.runnersTotal)} online`,
    `spend today ${dollars(figures.spendTodayCents)}`,
    `needs-you: ${String(figures.needsYou)}`,
  ].join(DOT);
}

/**
 * What a queue write answers.
 *
 * @param position - The row's place in the queue; `1` is next.
 * @param workflow - The workflow it was queued under.
 * @param version - The version pinned, or `null` when that workflow has nothing published.
 * @returns `queued at position 2 (pinned standard-fix@v14)`.
 */
export function queuedLine(position: number, workflow: string, version: number | null): string {
  return version === null
    ? `queued at position ${String(position)} (${workflow} — nothing published to pin)`
    : `queued at position ${String(position)} (pinned ${workflow}@v${String(version)})`;
}

/**
 * The Copilot page a dry run is followed on.
 *
 * @param appUrl - The public origin.
 * @param slug - The workflow.
 * @returns The link.
 */
export function copilotLink(appUrl: string, slug: string): ReplyLink {
  return { label: COPILOT_LABEL, url: `${appUrl}/workflows/${encodeURIComponent(slug)}/copilot` };
}

/** How a dry run ended, as the record has it. */
export interface DryRunEnding {
  readonly status: DryRunStatus;
  readonly failureReason: string | null;
  readonly durationMs: number | null;
  /** `null` when a stage ran on a model with no price — the cost is unknown, not zero. */
  readonly costCents: number | null;
  readonly guardsClean: boolean;
  /** How many entries the guard audit holds. */
  readonly guardBlocks: number;
  /** How many suggestions were filed, or `null` when that could not be read. */
  readonly suggestions: number | null;
}

/**
 * How a dry run ended, in the service's own terms.
 *
 * @param status - `dry_runs.status`.
 * @param failureReason - `dry_runs.failure_reason`.
 * @returns `complete`, `failed: <reason>`, `stopped at its budget`, `cancelled`.
 */
function endingWords(status: DryRunStatus, failureReason: string | null): string {
  switch (status) {
    case "complete":
      return "complete";
    case "failed":
      return failureReason === null ? "failed" : `failed: ${failureReason}`;
    case "budget_stopped":
      return "stopped at its budget";
    case "cancelled":
      return "cancelled";
    default:
      return status;
  }
}

/**
 * The message that follows a dry run's acknowledgement.
 *
 * @param subject - What ran — `standard-fix on #486`.
 * @param ending - How it ended.
 * @param link - Where its rows are.
 * @returns The result: status, duration, cost when priced, the guard audit, suggestions, the link.
 */
export function dryRunResult(subject: string, ending: DryRunEnding, link: ReplyLink): CommandReply {
  const parts = [`Dry run of ${subject} ${endingWords(ending.status, ending.failureReason)}`];

  if (ending.durationMs !== null) parts.push(formatDuration(ending.durationMs / MS));
  if (ending.costCents !== null) parts.push(dollars(ending.costCents));
  parts.push(
    ending.guardsClean
      ? "guards clean"
      : `${counted(ending.guardBlocks, "write")} blocked by the guards`,
  );
  if (ending.suggestions !== null && ending.suggestions > 0) {
    parts.push(counted(ending.suggestions, "suggestion"));
  }

  return { text: `${parts.join(DOT)} → open in ${COPILOT_LABEL}`, link };
}

/**
 * What is said when the harness deadline passes with no ending heard.
 *
 * @param subject - What is running.
 * @param link - Where to follow it.
 * @returns The reply — it names no result, because there is none.
 */
export function dryRunStillRunning(subject: string, link: ReplyLink): CommandReply {
  return {
    text: `Dry run of ${subject} has not reported an ending yet — follow it in ${COPILOT_LABEL}`,
    link,
  };
}

/** An estimate, as `/ouro estimate` reads it off the side panel's payload. */
export interface EstimateFigures {
  readonly effort: string;
  readonly cycleMin: number;
  readonly cycleMax: number;
  readonly estMinutes: number;
  readonly estTokens: number;
  /** 0–100. */
  readonly confidence: number;
  readonly suggestedWorkflow: string;
}

/**
 * An estimate in one line. **No dollar figure**: none is stored, so none is said.
 *
 * @param reference - The issue — `#490`.
 * @param estimate - The estimate in force.
 * @returns `#490 — effort M · cycle 20–45 min · est. 30 min · ~12k tokens · confidence 82% · suggests standard-fix`.
 */
export function estimateLine(reference: string, estimate: EstimateFigures): string {
  return `${reference} — ${[
    `effort ${estimate.effort.toUpperCase()}`,
    `cycle ${String(estimate.cycleMin)}–${String(estimate.cycleMax)} min`,
    `est. ${String(estimate.estMinutes)} min`,
    `~${tokenCount(estimate.estTokens)} tokens`,
    `confidence ${String(Math.round(estimate.confidence))}%`,
    `suggests ${estimate.suggestedWorkflow}`,
  ].join(DOT)}`;
}

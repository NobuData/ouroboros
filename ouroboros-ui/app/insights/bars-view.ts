/**
 * Every decision the interventions and stage-medians cards make, and every sentence they say
 * (BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445)).
 *
 * Mockup 15's **Where loops still need humans** and **Cycle time by stage · median** are both the
 * `HBars` primitive over one of BJ.2's bar cards (`InsightsBarCard`), each ending in an insight
 * line — and so are BK.5's ([#446](https://github.com/NobuData/ouroboros/issues/446)) **Test
 * failures by suite**, **Time to completion by effort** and **Tokens by stage**. What is decided here is small and each piece is a unit test on a value: which row is lifted
 * and which recede, how a value is spelled, the tag, and what a card says when its window is empty.
 *
 * **Framework-free and pure**, the way `app/insights/view.ts` is.
 *
 * ### The insight lines are the server's, never written here
 *
 * *"Fix the top row and interventions drop ~40%."* is the top cause over the total, and *"the
 * other five stages sum to 8m 20s"* is a sum of medians. Shipped as literals they would be true of
 * the seeded data and silently false on every real workspace, so the service computes them
 * (BJ.2, [#438](https://github.com/NobuData/ouroboros/issues/438)) and this module only passes
 * `line` through — `null` is no line at all, never a sentence composed in its place.
 *
 * BK.5's three lines are the same contract. *"33 failing cases total — 0.12% of everything that
 * ran"* divides the failures by the window's cases run; *"Estimator calibration: 89%…"* is #435's
 * report; *"≈ 4.6M tokens per merged PR · 31% served by local models"* divides tokens by merges
 * and local-model tokens by every token — real attribution, never a constant. The service drops
 * any part it cannot compute, so a fixture that changes the data changes each sentence.
 */

import type {
  InsightsBarCard,
  InsightsRange,
  Intervention,
  InterventionCause,
  MetricMethodology,
} from "@/app/api/insights";
import type { HBarRow } from "@/app/charts";
import { spanOfMs, tokenCount } from "@/app/format";
import type { Effort } from "@/app/ui";

import { type SeriesEmpty, dayLabel } from "./series-view";

/* ------------------------------------------------------------------ shared */

/** One drawn bar, with the stored key it came from — a cause id or a stage key. */
export interface KeyedBar extends HBarRow {
  /** The stored label — what a re-categorization names, and the React key. */
  readonly key: string;
}

/** What a bar card draws. */
export interface BarsView {
  /** The heading. */
  readonly title: string;
  /** The tag at the head's trailing edge — the window, and for counts the total. */
  readonly tag: string;
  /** The bars' accessible name, before `HBars` adds each row. */
  readonly label: string;
  /** The bars, in the service's order. */
  readonly rows: readonly KeyedBar[];
  /** The service's computed insight line, or `null` when it had nothing true to say. */
  readonly line: string | null;
  /** What to draw instead of bars when the window has none, or `null` when it has some. */
  readonly empty: SeriesEmpty | null;
  /** The registry entry behind the card's figures. */
  readonly methodology: MetricMethodology;
}

/* ------------------------------------------------------------------ interventions */

/** The interventions card's heading, from the mockup. */
export const INTERVENTIONS_TITLE = "Where loops still need humans";

/** The interventions card's empty state — a quiet window is good news, said so. */
export const NO_INTERVENTIONS: SeriesEmpty = {
  title: "No loop needed a human in this range",
  note: "Each needs-human handoff, waiver, policy stop or blocking vote lands here, by cause.",
};

/**
 * Every cause, in the card's vocabulary — what the re-categorize picker offers. A bar's own label
 * is the service's; these are for the causes with no bar this window, which a person may still
 * move an event to.
 */
export const CAUSE_NAMES: Readonly<Record<InterventionCause, string>> = {
  infra_rig: "Flaky env / rig",
  ambiguous_ticket: "Ambiguous ticket",
  policy_gate: "Policy gate",
  model_disagreement: "Model disagreement",
  other: "Other",
};

/** Every cause, in the picker's order. */
export const CAUSES: readonly InterventionCause[] = Object.keys(CAUSE_NAMES) as InterventionCause[];

/**
 * A row recedes once it is this share of the top row or less — mockup 15 dims `2` and `1` under
 * an `8`, and keeps `5` and `4` plain.
 */
export const DIM_SHARE = 0.25;

/**
 * Whether a stored key is one of the five causes.
 *
 * @param key A bar's key.
 * @returns `true` for a cause a re-categorization can name.
 */
export function isCause(key: string): key is InterventionCause {
  return key in CAUSE_NAMES;
}

/**
 * How the interventions card emphasises a row: the top cause is lifted — it is the row the line
 * is about — and a cause at a quarter of it or less recedes.
 *
 * @param value The row's count.
 * @param index Its place; the service orders the bars largest first.
 * @param top The top row's count.
 * @returns `top`, `dim` or nothing.
 */
function causeEmphasis(value: number, index: number, top: number): HBarRow["emphasis"] {
  if (index === 0) return "top";
  return value <= top * DIM_SHARE ? "dim" : undefined;
}

/**
 * The interventions card.
 *
 * @param card BJ.2's interventions bar card.
 * @param range The page's range — the first half of the tag.
 * @returns What the card draws.
 */
export function interventionsView(card: InsightsBarCard, range: InsightsRange): BarsView {
  const total = card.total ?? card.bars.reduce((sum, bar) => sum + bar.value, 0);
  const top = card.bars[0]?.value ?? 0;

  return {
    title: INTERVENTIONS_TITLE,
    tag: `${range} · ${total} total`,
    label: `Interventions by cause, ${total} total`,
    rows: card.bars.map((bar, index) => ({
      key: bar.key,
      name: bar.label,
      value: bar.value,
      emphasis: causeEmphasis(bar.value, index, top),
    })),
    line: card.line,
    empty: card.bars.length === 0 ? NO_INTERVENTIONS : null,
    methodology: card.methodology,
  };
}

/* ------------------------------------------------------------------ re-categorization */

/** What each source plane is called in the event picker. */
const SOURCE_NAMES: Readonly<Record<Intervention["source"], string>> = {
  needs_human_run: "Needs-human handoff",
  classification: "Failure classification",
  waiver: "Waiver",
  policy_gate: "Policy-gate stop",
  guardrail: "Guardrail stop",
  vote_block: "Blocking vote",
};

/**
 * One event, in words — what the picker lists under a bar.
 *
 * @param event The event.
 * @returns `Waiver · Sep 30`, with `· set by a person` once someone corrected it.
 */
export function eventLabel(event: Intervention): string {
  const parts = [SOURCE_NAMES[event.source], dayLabel(event.detectedAt.slice(0, 10))];

  if (event.causeOrigin === "human") parts.push("set by a person");

  return parts.join(" · ");
}

/**
 * The causes an event may be moved to — every cause but the one it has, since moving an event to
 * its own cause is a correction of nothing (the service's `intervention_cause_unchanged`).
 *
 * @param current The event's cause.
 * @returns The others, in the picker's order.
 */
export function targetCauses(current: InterventionCause): InterventionCause[] {
  return CAUSES.filter((cause) => cause !== current);
}

/**
 * The status line after a correction landed.
 *
 * @param cause Where the event was moved.
 * @returns `Moved to Ambiguous ticket. The bars and the line now count it there.`
 */
export function movedNote(cause: InterventionCause): string {
  return `Moved to ${CAUSE_NAMES[cause]}. The bars and the line now count it there.`;
}

/** Said when the service refuses a write for the caller's role. */
export const RECATEGORIZE_FORBIDDEN = "Only owners, admins and members can re-categorize an intervention.";

/** Said when the event is not this workspace's any more. */
export const RECATEGORIZE_GONE = "That intervention is no longer in this workspace.";

/** Said when the event already has the cause asked for. */
export const RECATEGORIZE_UNCHANGED = "It already has that cause.";

/** Said when the reason was refused — the only field a person types. */
export const RECATEGORIZE_INVALID = "Say why in a sentence — the reason is required.";

/** Said for any other failed write. */
export const RECATEGORIZE_FAILED = "The change could not be saved. Try again.";

/** Said for a list that could not be read. */
export const EVENTS_UNREADABLE = "The interventions could not be read. Try again.";

/**
 * The note under the picker when the bar's list was cut at the service's bound.
 *
 * @param listed How many events were listed.
 * @param total How many matched.
 * @returns `Showing the newest 50 of 64.`, or `null` when every event is listed.
 */
export function moreEventsNote(listed: number, total: number): string | null {
  return total > listed ? `Showing the newest ${listed} of ${total}.` : null;
}

/* ------------------------------------------------------------------ stage medians */

/** The stage card's heading, from the mockup. */
export const STAGES_TITLE = "Cycle time by stage · median";

/** The stage card's empty state. */
export const NO_STAGES: SeriesEmpty = {
  title: "No stage finished in this range",
  note: "Each stage's median time appears here once a loop has passed through it.",
};

/**
 * The stage-medians card: the dominant stage lifted — the one the line names — and every other
 * stage receded, as the mockup draws Implement against the rest.
 *
 * @param card BJ.2's stages bar card, in loop order, values in milliseconds.
 * @param range The page's range — the tag.
 * @returns What the card draws.
 */
export function stagesView(card: InsightsBarCard, range: InsightsRange): BarsView {
  const longest = Math.max(0, ...card.bars.map((bar) => bar.value));
  // The first stage at the longest median is the dominant one; a tie lifts only the first.
  const dominant = card.bars.findIndex((bar) => bar.value === longest);

  return {
    title: STAGES_TITLE,
    tag: range,
    label: "Median time per loop stage",
    rows: card.bars.map((bar, index) => ({
      key: bar.key,
      name: bar.label,
      value: bar.value,
      display: spanOfMs(bar.value),
      emphasis: card.bars.length > 1 ? (index === dominant ? "top" : "dim") : undefined,
    })),
    line: card.line,
    empty: card.bars.length === 0 ? NO_STAGES : null,
    methodology: card.methodology,
  };
}

/* ------------------------------------------------------------------ the ranked cards (#446) */

/** How many of the smallest rows recede on a ranked card — mockup 15 dims the bottom two. */
export const RECEDED_ROWS = 2;

/** A card needs at least this many rows before any recede — with fewer, every row is the story. */
export const RECEDE_FROM = 4;

/**
 * How a ranked card emphasises a row: the largest is lifted and the {@link RECEDED_ROWS} smallest
 * recede, as mockup 15 draws the suite, effort and token cards — whatever order the rows are in.
 *
 * @param values The rows' values, in drawn order.
 * @returns Each row's emphasis, in the same order.
 */
export function rankEmphasis(values: readonly number[]): HBarRow["emphasis"][] {
  const top = values.indexOf(Math.max(...values));
  const receded = new Set(
    values.length < RECEDE_FROM
      ? []
      : values
          .map((value, index) => ({ value, index }))
          .filter(({ index }) => index !== top)
          .sort((a, b) => a.value - b.value)
          .slice(0, RECEDED_ROWS)
          .map(({ index }) => index),
  );

  return values.map((_, index) => (index === top ? "top" : receded.has(index) ? "dim" : undefined));
}

/**
 * A ranked card's rows.
 *
 * @param card The bar card.
 * @param display How a value is drawn.
 * @returns The rows, in the service's order, emphasised by rank.
 */
function rankedRows(card: InsightsBarCard, display: (value: number) => string): KeyedBar[] {
  const emphasis = rankEmphasis(card.bars.map((bar) => bar.value));

  return card.bars.map((bar, index) => ({
    key: bar.key,
    name: bar.label,
    value: bar.value,
    display: display(bar.value),
    emphasis: emphasis[index],
  }));
}

/** The suites card's heading, from the mockup — the range is appended. */
export const SUITES_TITLE = "Test failures by suite";

/** The suites card's empty state — nothing failed, said as the good news it is. */
export const NO_SUITE_FAILURES: SeriesEmpty = {
  title: "No test failed in this range",
  note: "Failing cases appear here by suite once a run reports one.",
};

/**
 * The suites card.
 *
 * @param card BJ.2's suites bar card, largest first.
 * @param range The page's range — in the heading.
 * @returns What the card draws.
 */
export function suitesView(card: InsightsBarCard, range: InsightsRange): BarsView {
  const total = card.total ?? card.bars.reduce((sum, bar) => sum + bar.value, 0);

  return {
    title: `${SUITES_TITLE} · ${range}`,
    tag: `${total} ${total === 1 ? "case" : "cases"}`,
    label: `Failing test cases by suite, ${total} total`,
    rows: rankedRows(card, String),
    line: card.line,
    empty: card.bars.length === 0 ? NO_SUITE_FAILURES : null,
    methodology: card.methodology,
  };
}

/** The effort card's heading, from the mockup. */
export const EFFORT_TITLE = "Time to completion by effort";

/** The effort card's tag — what the medians are of. */
export const EFFORT_TAG = "median · issue→merge";

/** The effort card's empty state. */
export const NO_EFFORT: SeriesEmpty = {
  title: "No sized issue merged in this range",
  note: "Each effort's median time from issue to merge appears once one lands.",
};

/** The five sizes an effort chip can draw. */
const EFFORTS: ReadonlySet<string> = new Set<Effort>(["XS", "S", "M", "L", "XL"]);

/**
 * Whether a bar's label is one of the five effort sizes.
 *
 * @param label The bar's label — the service upper-cases the stored effort.
 * @returns `true` when an effort chip can stand in for it.
 */
export function isEffort(label: string): label is Effort {
  return EFFORTS.has(label);
}

/**
 * The effort card: effort chips as labels, durations as values, in the ladder's order.
 *
 * @param card BJ.2's effort bar card, XS to XL, values in milliseconds.
 * @returns What the card draws.
 */
export function effortView(card: InsightsBarCard): BarsView {
  return {
    title: EFFORT_TITLE,
    tag: EFFORT_TAG,
    label: "Median time from issue to merge, by effort",
    rows: rankedRows(card, spanOfMs).map((row) => (isEffort(row.name) ? { ...row, effort: row.name } : row)),
    line: card.line,
    empty: card.bars.length === 0 ? NO_EFFORT : null,
    methodology: card.methodology,
  };
}

/** The tokens card's heading, from the mockup — the range is appended. */
export const TOKENS_TITLE = "Tokens by stage";

/** The tokens card's empty state. */
export const NO_TOKENS: SeriesEmpty = {
  title: "No tokens used in this range",
  note: "Each stage's token use appears here once a loop calls a model.",
};

/**
 * The tokens card. Its total is every token in the window — usage with no task kind is in it and
 * in no bar — so the tag is the service's total, not the bars' sum.
 *
 * @param card BJ.2's tokens bar card, largest first.
 * @param range The page's range — in the heading.
 * @returns What the card draws.
 */
export function tokensView(card: InsightsBarCard, range: InsightsRange): BarsView {
  const total = card.total ?? card.bars.reduce((sum, bar) => sum + bar.value, 0);

  return {
    title: `${TOKENS_TITLE} · ${range}`,
    tag: `${tokenCount(total)} total`,
    label: `Tokens by stage, ${tokenCount(total)} total`,
    rows: rankedRows(card, tokenCount),
    line: card.line,
    empty: card.bars.length === 0 ? NO_TOKENS : null,
    methodology: card.methodology,
  };
}

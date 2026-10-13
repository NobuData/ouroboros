/**
 * What an event card's message row records, and how it is read back (CA.2,
 * [#542](https://github.com/NobuData/ouroboros/issues/542)) — pure.
 *
 * `chat_messages.facts` holds **the figures a card printed** and nothing else (V131): the
 * composer writes them when it posts, and the channel mirror (`chat-mirror/`) reads them to draw
 * the same card again. The two directions sit side by side here so they cannot drift apart:
 *
 * ```
 * post     LoopFinishedFacts ─▶ loopFinishedRecord ─▶ facts      BuildFacts ─▶ buildRecord ─▶ facts
 * mirror   facts + subject ─▶ recordedLoopFinished ─▶ LoopFinishedFacts ─▶ loopFinishedCard
 *          facts + subject ─▶ recordedBuild ────────▶ BuildFacts ────────▶ buildGreenCard / …
 *          facts ───────────▶ recordedDigest ───────▶ DigestRecordFacts ─▶ digestRecordCard
 * ```
 *
 * **A figure that was not printed is not on the record, and is not printed again.** A run that
 * was not fully priced records no `cost_cents`, so its mirrored card has no cost — the pricing
 * rule is applied once, when the card is posted, and the record carries its verdict.
 *
 * **Ids are not facts.** Which run and which pull request a card is about are the row's `refs`;
 * the mirror resolves them ({@link RecordSubject}) and hands them in.
 */

import type { BuildFacts, DigestRecordFacts, LoopFinishedFacts } from "./chat.cards.events";

/** What a row's refs say an event card is about, resolved to what its links and headline need. */
export interface RecordSubject {
  readonly runId: string;
  readonly loopSeq: number;
  /** The pull request's id here, when it is mirrored — what a link to its page needs. */
  readonly prId: string | null;
  /** The pull request's number, when the row or its refs name one. */
  readonly prNumber: number | null;
}

/**
 * A non-negative whole number, as a stored fact.
 *
 * @param value - The stored value.
 * @returns The number, or null for anything else.
 */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Non-empty text, as a stored fact.
 *
 * @param value - The stored value.
 * @returns The text, or null for anything else.
 */
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * What a finished loop's row records: only what its card printed.
 *
 * @param facts - What the card was composed from.
 * @returns `chat_messages.facts`. An unpriced or partly priced run records no cost key at all.
 */
export function loopFinishedRecord(facts: LoopFinishedFacts): Record<string, unknown> {
  return {
    outcome: "merged",
    ...(facts.issueNumber === null ? {} : { issue_number: facts.issueNumber }),
    ...(facts.issueTitle === null ? {} : { issue_title: facts.issueTitle }),
    ...(facts.prNumber === null ? {} : { pr_number: facts.prNumber }),
    ...(facts.checksPassed === null || facts.checksTotal === null
      ? {}
      : { checks_passed: facts.checksPassed, checks_total: facts.checksTotal }),
    ...(facts.cycleSeconds === null ? {} : { cycle_seconds: Math.round(facts.cycleSeconds) }),
    ...(facts.costCents === null || facts.unpricedEvents > 0
      ? {}
      : { cost_cents: Number(facts.costCents) }),
    ...(facts.model === null ? {} : { model: facts.model }),
  };
}

/**
 * A finished loop's card, read back from its row.
 *
 * @param facts - `chat_messages.facts`.
 * @param subject - The run and pull request the row's refs name.
 * @returns What {@link loopFinishedCard} takes. The pull request is the one the record names
 *   (`pr_number`); a row that names none says nothing was merged, whatever the refs resolve to.
 *   `cost_cents` is on the record only for a fully priced run, so it is read as priced.
 */
export function recordedLoopFinished(
  facts: Readonly<Record<string, unknown>>,
  subject: RecordSubject,
): LoopFinishedFacts {
  const prNumber = count(facts.pr_number);

  return {
    runId: subject.runId,
    loopSeq: subject.loopSeq,
    issueNumber: count(facts.issue_number),
    issueTitle: text(facts.issue_title),
    prNumber,
    prId: prNumber === null ? null : subject.prId,
    checksPassed: count(facts.checks_passed),
    checksTotal: count(facts.checks_total),
    cycleSeconds: count(facts.cycle_seconds),
    costCents: count(facts.cost_cents),
    unpricedEvents: 0,
    model: text(facts.model),
  };
}

/**
 * What a build's row records: its two counts, and which build and revision when the reporting
 * plane said.
 *
 * @param facts - What the card was composed from.
 * @returns `chat_messages.facts`.
 */
export function buildRecord(facts: BuildFacts): Record<string, unknown> {
  return {
    passed: facts.passed,
    total: facts.total,
    ...(facts.buildNumber === null ? {} : { build_number: facts.buildNumber }),
    ...(facts.revision === null ? {} : { revision: facts.revision }),
  };
}

/**
 * A build's card, read back from its row.
 *
 * @param facts - `chat_messages.facts`.
 * @param subject - The run and pull request the row's refs name.
 * @returns What the build cards take, or undefined when the row holds no counts to print. A row
 *   written before `build_number` and `revision` were recorded (#542) reads without them — its
 *   headline says *build* and *PR #514*, not *build 3* and *rev 2*.
 */
export function recordedBuild(
  facts: Readonly<Record<string, unknown>>,
  subject: RecordSubject,
): BuildFacts | undefined {
  const passed = count(facts.passed);
  const total = count(facts.total);

  if (passed === null || total === null || passed > total) {
    return undefined;
  }

  return {
    runId: subject.runId,
    loopSeq: subject.loopSeq,
    buildNumber: count(facts.build_number),
    passed,
    total,
    prNumber: subject.prNumber,
    prId: subject.prId,
    revision: count(facts.revision),
  };
}

/** A UTC day as a row stores it. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A digest's week, read back from its row.
 *
 * @param facts - `chat_messages.facts`.
 * @returns What {@link digestRecordCard} takes, or undefined when the row names no week.
 */
export function recordedDigest(
  facts: Readonly<Record<string, unknown>>,
): DigestRecordFacts | undefined {
  const from = text(facts.window_from);
  const to = text(facts.window_to);
  const mergedPrs = count(facts.merged_prs);
  const interventions = count(facts.interventions);

  if (
    from === null ||
    to === null ||
    !DAY.test(from) ||
    !DAY.test(to) ||
    mergedPrs === null ||
    interventions === null
  ) {
    return undefined;
  }

  return { window: { from, to }, mergedPrs, interventions };
}

/**
 * The first-issue card's words and pure rules (BC.4,
 * [#393](https://github.com/NobuData/ouroboros/issues/393), mockup 13's *"Your first issue"*).
 *
 * **The reasoning is the score, rendered.** `no code paths touched` is the path-risk term's own
 * label (BB.4, #387), `est. 4 min` the estimate's, and the cost fragment exists only when the
 * routed model is priced — {@link printableFragments} drops a cost the candidate does not carry,
 * so a placeholder or a zero never stands in for a number nobody has (decision **N10**).
 *
 * **The safety rows are read from state, not written into the component.** {@link safetyRows}
 * takes the dry-run policy as the service answered it (BA.3, #382) and says what holds *now*:
 * on, off, never set, or unread — each row naming the mechanism that keeps it, the way the head's
 * promise does (decision **O9**). The inbox row links the real Needs-You inbox (BO.1, #466) and
 * the policy row the flip in Settings.
 *
 * **The pick on screen is the stored one.** The wizard stores a pick (BB.2, #385); the picker only
 * suggests. {@link shownPick} prefers the stored ticket, resolved to its scored candidate so its
 * reasoning draws, and falls back to the picker's suggestion — which *Run my first loop* stores
 * before it launches (the user's decision on the ticket).
 *
 * Framework-free and pure.
 */

import type {
  FirstIssueCard,
  Onboarding,
  OnboardingFirstIssue,
  OnboardingFirstIssueAlternatives,
  OnboardingFirstIssueCandidate,
  OnboardingFirstIssueComponent,
  OnboardingFirstIssueFragment,
  OnboardingStep,
  PlanningReestimationStatus,
} from "@/app/api/onboarding";
import type { DryRunPolicy } from "@/app/api/policies";
import type { Reading } from "@/app/api/reading";
import { INBOX_PATH, POLICIES_PATH } from "@/app/paths";
import { lastRunPhrase } from "@/app/planning/health";
import { POLICIES_LINK_LABEL, dryRunUnread } from "@/app/policies/view";

/** The card's title, as the mockup sets it. */
export const FIRST_ISSUE_TITLE = "Your first issue";

/** The head's pill while step 4 is ahead, the one to do, and done. */
export const STEP_PREVIEW_TAG = "step 4 preview";
export const YOU_ARE_HERE = "step 4 · you are here";
export const STEP_DONE_TAG = "✓ step 4 done";

/** The head's corner link — the intake backlog (mockup 03). */
export const BROWSE_LINK = "Browse all issues →";

/** The line over the pick: the picker's own pick, or the person's. */
export const PICKED_LINE = "We picked a safe one:";
export const OWN_PICK_LINE = "Your pick:";

/** The two affordances under the pick. */
export const ANOTHER_LABEL = "↻ another";
export const OWN_PICK_LABEL = "or pick your own ▾";

/** The detail affordance — the score's breakdown. */
export const BREAKDOWN_LABEL = "how it scored";
export const COMPONENTS_LABEL = "Score components";

/** What separates the reasoning's fragments — the mockup's ` · `. */
export const FRAGMENT_SEPARATOR = " · ";

/** A pick in flight, and what a stored pick says. */
export const PICKING = "Picking…";

/** Why the pick cannot be changed. */
export const VIEWER_PICK_REASON = "Viewers can see the pick but not change it — ask an owner, admin or member.";
export const LAUNCHED_REASON = "Your first loop is already queued — the pick is what it runs.";
export const ONLY_CANDIDATE_REASON = "No other candidate qualifies — this is the one the backlog has.";
export const NO_CANDIDATES_REASON = "Nothing in the backlog qualifies yet.";

/** A stored pick the ranking does not hold — picked by hand, or disqualified since. */
export const UNRANKED_NOTE =
  "Picked by hand — it is not among the safety-ranked candidates, so there is no reasoning to show.";

/** The cold states. */
export const SIZING_TITLE = "We're sizing your backlog";
export const EMPTY_TITLE = "No open issues to pick from";
export const EMPTY_LINE =
  "The backlog has no open issues. Plan some work first — the safest sized one is picked from there.";
export const PLANNING_LINK = "Open Planning →";
export const NONE_SAFE_TITLE = "Nothing in the backlog is safe enough for a first loop";
export const NONE_SAFE_LINE =
  "The safety bar is a floor, not a curve: no candidate is offered as safe when none reaches it. You can still pick your own, with its reasoning in view.";

/** The nightly estimator's status line, in the sizing state. */
export const ESTIMATOR_LABEL = "Nightly estimator";

/** The sheet — *or pick your own*. */
export const SHEET_TITLE = "Pick your own first issue";
export const SHEET_LIST_LABEL = "Safety-ranked candidates";
export const SHEET_CANCEL = "Keep the current pick";
export const BELOW_BAR_TAG = "below the safety bar";
export const CURRENT_TAG = "current pick";

/** The safety rows' accessible name. */
export const SAFETY_ROWS_LABEL = "What keeps this safe";

/** The inbox row's link, and the dry-run row's. */
export const INBOX_LINK_LABEL = "Needs-you inbox";
export const POLICY_LINK_LABEL = "policy";
export const TURN_ON_LINK_LABEL = `turn it on in ${POLICIES_LINK_LABEL}`;

/** What the dry-run row says before the policy was read at all. */
export const POLICY_NOT_READ_YET =
  "Dry-run: not read yet — the policy decides whether the PR opens as a draft.";

/** What the card says when it could not be read. */
export const UNREACHABLE_FIRST_ISSUE =
  "The first-issue card could not be reached. It will be read again shortly.";
export const UNREADABLE_FIRST_ISSUE =
  "The first-issue card answered with something that could not be read.";

/** What a write says for an issue id that is not one. */
export const NOT_AN_ISSUE = "That is not an issue of this backlog.";

/** A `github_issues.id`, as the picker answers it — a uuid. */
const ISSUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A canonical ticket's external key for a GitHub issue — `#488`. */
const ISSUE_KEY = /^#(\d{1,9})$/;

/** The stored pick, as the wizard references it. */
export type PickedTicket = NonNullable<Onboarding["refs"]["pickedTicket"]>;

/**
 * Whether a selection may name this issue — the picker's id grammar.
 *
 * @param issueId What was passed.
 * @returns True for an id.
 */
export function isIssueId(issueId: unknown): issueId is string {
  return typeof issueId === "string" && ISSUE_ID.test(issueId);
}

/**
 * The head's pill for step 4's state on the rail.
 *
 * @param status Step 4's status, or null when the rail is not known.
 * @returns The pill's text and tone — the mockup's `step 4 preview` while the step is ahead.
 */
export function stepPill(
  status: OnboardingStep["status"] | null,
): { readonly text: string; readonly tone: "neutral" | "accent" | "ok" } | null {
  if (status === "todo") return { text: STEP_PREVIEW_TAG, tone: "neutral" };
  if (status === "active") return { text: YOU_ARE_HERE, tone: "accent" };
  if (status === "done") return { text: STEP_DONE_TAG, tone: "ok" };

  return null;
}

/**
 * The reasoning's fragments as the row prints them — the cost's only when the candidate carries
 * a cost. The service already leaves the fragment out for an unpriced model; this holds the same
 * rule on this side, so no spelling of the payload prints `$0` for "unknown".
 *
 * @param candidate The candidate.
 * @returns The fragments, in the service's order.
 */
export function printableFragments(
  candidate: Pick<OnboardingFirstIssueCandidate, "cost" | "reasoning">,
): readonly OnboardingFirstIssueFragment[] {
  return candidate.reasoning.fragments.filter(
    (fragment) => fragment.source !== "cost" || candidate.cost !== undefined,
  );
}

/**
 * The reasoning line — the printable fragments joined.
 *
 * @param candidate The candidate.
 * @returns `no code paths touched · est. 4 min`.
 */
export function reasoningLine(candidate: Pick<OnboardingFirstIssueCandidate, "cost" | "reasoning">): string {
  return printableFragments(candidate)
    .map((fragment) => fragment.text)
    .join(FRAGMENT_SEPARATOR);
}

/**
 * One term of the score, as the breakdown lists it.
 *
 * @param component The term.
 * @returns `XS effort — 35 of 35`.
 */
export function componentLine(component: OnboardingFirstIssueComponent): string {
  return `${component.label} — ${String(component.points)} of ${String(component.maxPoints)}`;
}

/**
 * The breakdown's total: the score against the bar, under the weights that produced it.
 *
 * @param candidate The candidate.
 * @param context The weights' version and the bar, as the picker named them.
 * @returns `99.4 in all under safety-v1 · safety bar 45 · clears it`.
 */
export function totalLine(
  candidate: Pick<OnboardingFirstIssueCandidate, "score" | "clearsBar">,
  context: { readonly weightsVersion: string; readonly safetyBar: number },
): string {
  return `${String(candidate.score)} in all under ${context.weightsVersion} · safety bar ${String(context.safetyBar)} · ${candidate.clearsBar ? "clears it" : "below it"}`;
}

/**
 * The breakdown control's accessible name.
 *
 * @param number The issue's number.
 * @returns `Score breakdown for #488`.
 */
export function breakdownName(number: number): string {
  return `Score breakdown for #${String(number)}`;
}

/**
 * A sheet row's accessible name.
 *
 * @param candidate The candidate.
 * @returns `#491 Add CRC32 to config persistence layer`.
 */
export function candidateName(candidate: Pick<OnboardingFirstIssueCandidate, "number" | "title">): string {
  return `#${String(candidate.number)} ${candidate.title}`;
}

/**
 * A sheet row's score, beside its reasoning.
 *
 * @param candidate The candidate.
 * @returns `score 49.9`.
 */
export function scoreLine(candidate: Pick<OnboardingFirstIssueCandidate, "score">): string {
  return `score ${String(candidate.score)}`;
}

/**
 * The issue number a canonical ticket's key names.
 *
 * @param externalKey The ticket's key — `#488`.
 * @returns The number, or null for a key that is not a GitHub issue's.
 */
export function issueNumberOf(externalKey: string): number | null {
  const match = ISSUE_KEY.exec(externalKey);

  return match === null ? null : Number(match[1]);
}

/** The pick the card draws. */
export type ShownPick =
  /** A scored candidate: the stored pick resolved in the ranking, or the picker's suggestion. */
  | {
      readonly kind: "ranked";
      readonly candidate: OnboardingFirstIssueCandidate;
      /** Whether the wizard stores it — false for the picker's suggestion. */
      readonly stored: boolean;
    }
  /** A stored pick the ranking does not hold — nothing scored it, so nothing explains it. */
  | { readonly kind: "unranked"; readonly key: string; readonly title: string };

/**
 * The pick on screen: the wizard's stored ticket first — found among the ranked candidates (or
 * as the picker's own pick) so its reasoning draws, else drawn as picked by hand — and, with
 * nothing stored, the picker's suggestion.
 *
 * @param card The card as read, or null before it was.
 * @param picked The wizard's stored pick, or null.
 * @returns The pick, or null when there is none to draw.
 */
export function shownPick(
  card: Pick<FirstIssueCard, "firstIssue" | "alternatives"> | null,
  picked: PickedTicket | null,
): ShownPick | null {
  if (picked !== null) {
    const number = issueNumberOf(picked.externalKey);
    const ranked =
      card === null || number === null
        ? undefined
        : (card.alternatives.candidates.find((candidate) => candidate.number === number) ??
          (card.firstIssue.pick?.number === number ? card.firstIssue.pick : undefined));

    return ranked === undefined
      ? { kind: "unranked", key: picked.externalKey, title: picked.title }
      : { kind: "ranked", candidate: ranked, stored: true };
  }

  const suggestion = card?.firstIssue.pick ?? null;

  return suggestion === null ? null : { kind: "ranked", candidate: suggestion, stored: false };
}

/**
 * The line over the pick — the picker's, or the person's own.
 *
 * @param shown The pick on screen.
 * @param firstIssue The picker's answer.
 * @returns `We picked a safe one:` when the pick is the picker's, else `Your pick:`.
 */
export function pickLine(shown: ShownPick, firstIssue: Pick<OnboardingFirstIssue, "pick">): string {
  return shown.kind === "ranked" && firstIssue.pick?.number === shown.candidate.number
    ? PICKED_LINE
    : OWN_PICK_LINE;
}

/**
 * *↻ another* — the candidate after the current one in safety order, wrapping round, or null
 * when the ranking holds nothing else.
 *
 * @param candidates The ranked candidates.
 * @param current The number of the pick on screen, or null.
 * @returns The next candidate, or null.
 */
export function nextCandidate(
  candidates: readonly OnboardingFirstIssueCandidate[],
  current: number | null,
): OnboardingFirstIssueCandidate | null {
  if (candidates.length === 0) return null;

  const index = current === null ? -1 : candidates.findIndex((candidate) => candidate.number === current);
  const next = candidates[(index + 1) % candidates.length]!;

  return next.number === current ? null : next;
}

/**
 * What a stored pick says under the actions.
 *
 * @param candidate The candidate picked.
 * @returns `#491 picked. Run your first loop when you're ready.`
 */
export function pickedLine(candidate: Pick<OnboardingFirstIssueCandidate, "number">): string {
  return `#${String(candidate.number)} picked. Run your first loop when you're ready.`;
}

/**
 * The count-and-noun a backlog line prints.
 *
 * @param count How many.
 * @param noun The singular.
 * @returns `1 issue`, `3 issues`.
 */
function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The sizing state's line — the real counts, and what happens next.
 *
 * @param backlog The repository's open issues by sizing status.
 * @returns `9 open issues, none sized yet — the nightly estimator sizes them, and the safest sized one is picked.`
 */
export function sizingLine(backlog: OnboardingFirstIssue["backlog"]): string {
  return `${counted(backlog.open, "open issue")}, none sized yet — the nightly estimator sizes them, and the safest sized one is picked.`;
}

/**
 * How many are still being sized, when any are — said under a cold state so a `none_safe` backlog
 * with unsized issues says more may be coming.
 *
 * @param backlog The counts.
 * @returns `1 more is still being sized.`, or null when nothing is.
 */
export function stillSizingLine(backlog: OnboardingFirstIssue["backlog"]): string | null {
  if (backlog.sizing === 0) return null;

  return `${String(backlog.sizing)} more ${backlog.sizing === 1 ? "is" : "are"} still being sized.`;
}

/**
 * What was set aside, and why — each count only when it is not zero.
 *
 * @param excluded The picker's exclusion counts.
 * @returns `2 are L or larger, 1 scored below the safety bar`, or null when nothing was.
 */
export function exclusionsPhrase(excluded: OnboardingFirstIssue["excluded"]): string | null {
  const parts = [
    excluded.protectedPath > 0
      ? `${String(excluded.protectedPath)} ${excluded.protectedPath === 1 ? "touches" : "touch"} a protected path`
      : null,
    excluded.tooLarge > 0 ? `${String(excluded.tooLarge)} ${excluded.tooLarge === 1 ? "is" : "are"} L or larger` : null,
    excluded.belowBar > 0 ? `${String(excluded.belowBar)} scored below the safety bar` : null,
  ].filter((part) => part !== null);

  return parts.length === 0 ? null : parts.join(", ");
}

/**
 * The `none_safe` state's line — the sized count and what was set aside.
 *
 * @param firstIssue The picker's answer.
 * @returns `Of 7 sized issues, 2 are L or larger, 5 scored below the safety bar.`
 */
export function noneSafeLine(firstIssue: Pick<OnboardingFirstIssue, "backlog" | "excluded">): string {
  const sized = counted(firstIssue.backlog.sized, "sized issue");
  const phrase = exclusionsPhrase(firstIssue.excluded);

  return phrase === null ? `Of ${sized}, none qualifies.` : `Of ${sized}, ${phrase}.`;
}

/**
 * The nightly estimator's real status (AL.5, #281): its last run as the Backlog Health footnote
 * says it, this workspace's counts, and when it runs.
 *
 * @param estimator The status.
 * @param now The instant the page was read.
 * @returns `Nightly estimator: last run 2h ago ✓ — 4 found here, 4 queued, 0 in flight · runs nightly at 02:00 UTC, up to 200 issues.`
 */
export function estimatorStatus(estimator: PlanningReestimationStatus, now: Date): string {
  const { schedule, lastRun } = estimator;
  const run = lastRunPhrase(lastRun, now);
  const counts =
    lastRun === null
      ? ""
      : ` — ${String(lastRun.found)} found here, ${String(lastRun.queued)} queued, ${String(lastRun.inFlight)} in flight`;
  const when = `runs nightly at ${String(schedule.hourUtc).padStart(2, "0")}:00 UTC, up to ${counted(schedule.batchLimit, "issue")}`;

  return `${ESTIMATOR_LABEL}: ${run}${counts} · ${when}.`;
}

/**
 * The sheet's note: how the list is ranked, and what was set aside.
 *
 * @param alternatives The ranking.
 * @returns `Safest first under safety-v1, each with its own reasoning; the safety bar is 45. 3 set aside: 2 are L or larger, 1 scored below the safety bar.`
 */
export function sheetNote(
  alternatives: Pick<OnboardingFirstIssueAlternatives, "weightsVersion" | "safetyBar" | "excluded">,
): string {
  const ranked = `Safest first under ${alternatives.weightsVersion}, each with its own reasoning; the safety bar is ${String(alternatives.safetyBar)}.`;
  const { excluded } = alternatives;
  const aside = excluded.protectedPath + excluded.tooLarge;
  const phrase = exclusionsPhrase({ ...excluded, belowBar: 0 });

  return aside === 0 || phrase === null ? ranked : `${ranked} ${String(aside)} set aside: ${phrase}.`;
}

/* ------------------------------------------------------------------ the safety rows */

/** Whether a row's claim holds now. */
export type SafetyMark = "ok" | "warn" | "pending" | "unknown";

/** The mark each state draws — the mockup's ✓, and the three it has no glyph for. */
export const SAFETY_GLYPHS: Readonly<Record<SafetyMark, string>> = {
  ok: "✓",
  warn: "!",
  pending: "○",
  unknown: "?",
};

/** How a screen reader hears each mark. */
export const SAFETY_MARK_NAMES: Readonly<Record<SafetyMark, string>> = {
  ok: "Holds",
  warn: "Does not hold",
  pending: "Pending",
  unknown: "Unknown",
};

/** One piece of a row's sentence. */
export type SafetySegment =
  | { readonly kind: "text"; readonly text: string }
  /** The one term set in bold — the mockup's **draft**. */
  | { readonly kind: "term"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

/** One safety row: a claim, whether it holds, and the mechanism that keeps it. */
export interface SafetyRow {
  readonly key: "dry_run" | "inbox" | "policy";
  readonly mark: SafetyMark;
  readonly segments: readonly SafetySegment[];
  /** What makes it true — named, so the words cannot widen without the mechanism widening. */
  readonly mechanism: string;
}

/** The mechanisms behind the rows, written once. */
const DRY_RUN_MECHANISM =
  "The PR opener forces a draft and arming or merging is refused while dry-run is active, re-checked at execution (BA.3, #382); the row reads GET /policies/dry-run live.";
const DRY_RUN_DEFAULT_MECHANISM =
  "The launch's completion turns dry-run on when the workspace never answered (BB.5, #388).";
const INBOX_MECHANISM =
  "Every decision a loop raises is a typed inbox item (BN.1, #461) listed at /inbox (BO.1, #466), and answering there resolves it (BN.2, #462).";
const POLICY_MECHANISM =
  "The flip is PATCH /policies/dry-run, owner or admin, in the settings hub's Policies section (BS.1, #491).";

/**
 * The dry-run row — what holds now, by the policy as read.
 *
 * @param policy The policy, why it could not be read, or null before it was read at all.
 * @returns The row.
 */
function dryRunRow(policy: Reading<DryRunPolicy> | null): SafetyRow {
  const link: SafetySegment = { kind: "link", text: POLICY_LINK_LABEL, href: POLICIES_PATH };
  const open: SafetySegment = { kind: "text", text: " (" };
  const close: SafetySegment = { kind: "text", text: ")" };

  if (policy === null) {
    return {
      key: "dry_run",
      mark: "unknown",
      segments: [{ kind: "text", text: POLICY_NOT_READ_YET }, open, link, close],
      mechanism: DRY_RUN_MECHANISM,
    };
  }

  if (!policy.ok) {
    return {
      key: "dry_run",
      mark: "unknown",
      segments: [{ kind: "text", text: dryRunUnread(policy.reason) }, open, link, close],
      mechanism: DRY_RUN_MECHANISM,
    };
  }

  if (policy.value.dryRun) {
    return {
      key: "dry_run",
      mark: "ok",
      segments: [
        { kind: "text", text: "Dry-run: opens a " },
        { kind: "term", text: "draft" },
        { kind: "text", text: " PR, never merges" },
        open,
        link,
        close,
      ],
      mechanism: DRY_RUN_MECHANISM,
    };
  }

  if (!policy.value.explicit) {
    return {
      key: "dry_run",
      mark: "pending",
      segments: [
        { kind: "text", text: "Dry-run is not set yet — running your first loop turns it on, so the PR opens as a " },
        { kind: "term", text: "draft" },
        { kind: "text", text: " and never merges" },
        open,
        link,
        close,
      ],
      mechanism: DRY_RUN_DEFAULT_MECHANISM,
    };
  }

  return {
    key: "dry_run",
    mark: "warn",
    segments: [
      {
        kind: "text",
        text: "Dry-run is off: PRs open ready for review, and a workflow that auto-merges will merge without a person — ",
      },
      { kind: "link", text: TURN_ON_LINK_LABEL, href: POLICIES_PATH },
    ],
    mechanism: DRY_RUN_MECHANISM,
  };
}

/**
 * The three safety rows, bound to what holds now: the dry-run row by the policy as read, the
 * inbox row to the real Needs-You inbox, the policy row to the flip.
 *
 * @param policy The dry-run policy as read, why it could not be, or null before the card was read.
 * @returns The rows, in the mockup's order.
 */
export function safetyRows(policy: Reading<DryRunPolicy> | null): readonly SafetyRow[] {
  const off = policy?.ok === true && policy.value.explicit && !policy.value.dryRun;

  return [
    dryRunRow(policy),
    {
      key: "inbox",
      mark: "ok",
      segments: [
        { kind: "text", text: "Decisions that need you wait in the " },
        { kind: "link", text: INBOX_LINK_LABEL, href: INBOX_PATH },
        { kind: "text", text: "." },
      ],
      mechanism: INBOX_MECHANISM,
    },
    {
      key: "policy",
      mark: "ok",
      segments: [
        { kind: "text", text: off ? "Turn dry-run back on any time — " : "Flip to auto-merge whenever you're ready — " },
        { kind: "link", text: POLICIES_LINK_LABEL, href: POLICIES_PATH },
      ],
      mechanism: POLICY_MECHANISM,
    },
  ];
}

/**
 * A row's sentence, for a test or a screen reader.
 *
 * @param row The row.
 * @returns The segments' text, joined.
 */
export function safetyRowText(row: SafetyRow): string {
  return row.segments.map((segment) => segment.text).join("");
}

/**
 * The Needs-You page's words and numbers, as pure functions (BN.4,
 * [#464](https://github.com/NobuData/ouroboros/issues/464)).
 *
 * ```
 * head        "3 decisions. About 90 seconds of your time." — count, noun, estimate (X8)
 * estimate    Σ over the queue of each kind's median answer time this week; a kind nobody
 *             answered this week costs the week's median; no week at all → no estimate
 * durations   41 → "41s", 360 → "6m", 95 → "1m 35s"; null → "—" (never a zero)
 * actions     the kind's row, each marked allowed — or disabled with role_required /
 *             capability_required — and a link action carrying where it leads (#467)
 * summary     "Split #490 into 6 tickets — approved", "Estimator re-size #486 L→M — auto-accepted
 *             by policy": a per-kind subject from the facts, and the outcome's words
 * ```
 *
 * Nothing here reads a database or a clock; the service hands in what it read.
 */

import type { ResolvedDecisionAction } from "./decision.actions";
import type { DecisionRef } from "./decision.types";
import { SOURCE_RESOLVED, navigationHref, type LinkContext } from "./inbox.links";

/** What the page shows for a figure it does not have. */
export const NO_FIGURE = "—";

/** The head: how many decisions wait, and what they will cost. */
export interface InboxHead {
  readonly count: number;
  /** `decision` or `decisions`. */
  readonly noun: string;
  /** The estimate in seconds, or null when no answer time is known yet. */
  readonly estimateSeconds: number | null;
  /** `About 90 seconds of your time.`, or null without an estimate. */
  readonly estimate: string | null;
  /** The whole sentence — `3 decisions. About 90 seconds of your time.` / `No decisions waiting.` */
  readonly sentence: string;
}

/**
 * The noun for a count.
 *
 * @param count - How many.
 * @returns `decision` for one, `decisions` otherwise.
 */
export function decisionNoun(count: number): string {
  return count === 1 ? "decision" : "decisions";
}

/**
 * What answering a queue will cost (X8): each item's kind median this week, falling back to the
 * week's median for a kind nobody answered this week.
 *
 * @param kinds - The open items' kinds, one entry per item.
 * @param perKind - This week's median answer time per kind, in seconds.
 * @param weekMedian - This week's overall median, or null when nothing was answered.
 * @returns The estimate in seconds, or null when no item's cost is known.
 */
export function estimateSeconds(
  kinds: readonly string[],
  perKind: Readonly<Record<string, number>>,
  weekMedian: number | null,
): number | null {
  if (kinds.length === 0) {
    return 0;
  }

  let total = 0;

  for (const kind of kinds) {
    const cost = perKind[kind] ?? weekMedian;

    if (cost === null || cost === undefined) {
      return null;
    }

    total += cost;
  }

  return total;
}

/**
 * An estimate as the head says it: seconds up to two minutes, rounded to ten, then minutes.
 *
 * @param seconds - The estimate.
 * @returns `About 90 seconds of your time.`, `About 4 minutes of your time.`
 */
export function estimatePhrase(seconds: number): string {
  if (seconds <= 120) {
    const rounded = Math.max(10, Math.round(seconds / 10) * 10);

    return `About ${String(rounded)} seconds of your time.`;
  }

  const minutes = Math.round(seconds / 60);

  return `About ${String(minutes)} minutes of your time.`;
}

/**
 * The head.
 *
 * @param count - Open items.
 * @param estimate - The estimate in seconds, or null.
 * @returns The head data and sentence.
 */
export function inboxHead(count: number, estimate: number | null): InboxHead {
  const noun = decisionNoun(count);

  if (count === 0) {
    return { count, noun, estimateSeconds: 0, estimate: null, sentence: "No decisions waiting." };
  }

  const phrase = estimate === null ? null : estimatePhrase(estimate);

  return {
    count,
    noun,
    estimateSeconds: estimate,
    estimate: phrase,
    sentence: `${String(count)} ${noun}.${phrase === null ? "" : ` ${phrase}`}`,
  };
}

/**
 * A duration as the stat card prints it.
 *
 * @param seconds - The duration, or null.
 * @returns `41s`, `6m`, `1m 35s`, `2h 5m`; `—` for null.
 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return NO_FIGURE;
  }

  const whole = Math.round(seconds);

  if (whole < 60) {
    return `${String(whole)}s`;
  }

  if (whole < 3600) {
    const minutes = Math.floor(whole / 60);
    const rest = whole % 60;

    return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`;
  }

  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);

  return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`;
}

/** Why an action is disabled for this person. */
export type DisabledReason = "role_required" | "capability_required";

/** One action, as the queue returns it. */
export interface InboxAction {
  readonly id: string;
  readonly label: string;
  readonly style: "primary" | "ghost" | "danger";
  readonly requiredRole: string;
  readonly consequenceText: string;
  readonly takesNote: boolean;
  /** A link — it decides nothing. */
  readonly navigates: boolean;
  /**
   * Where a link leads — an origin-relative UI path (#467). Null for an action that answers, and
   * for a link whose destination this item cannot name (the card shows it as unavailable).
   */
  readonly href: string | null;
  readonly allowed: boolean;
  /** Why it is disabled, or null when allowed. */
  readonly disabledReason: DisabledReason | null;
}

/**
 * A resolved action row, with each disabled entry's reason (`capability_required` for an
 * `approver` action — #485 — and `role_required` otherwise) and each link's destination.
 *
 * @param actions - The registry's resolved row.
 * @param context - The item's refs and source ref, which a link's destination is resolved from.
 * @returns The page's action row.
 */
export function inboxActions(
  actions: readonly ResolvedDecisionAction[],
  context: LinkContext,
): InboxAction[] {
  return actions.map((action) => ({
    id: action.id,
    label: action.label,
    style: action.style,
    requiredRole: action.required_role,
    consequenceText: action.consequence_text,
    takesNote: action.takes_note,
    navigates: action.navigates,
    href: navigationHref(action.handler_binding, context),
    allowed: action.allowed,
    disabledReason: action.allowed
      ? null
      : action.required_role === "approver"
        ? "capability_required"
        : "role_required",
  }));
}

/**
 * The item's typed refs, or none for a malformed value.
 *
 * @param refs - The stored column.
 * @returns The refs.
 */
export function refsOf(refs: unknown): DecisionRef[] {
  return Array.isArray(refs) ? (refs as DecisionRef[]) : [];
}

/**
 * A text fact.
 *
 * @param value - A payload value.
 * @returns The string, or `""`.
 */
function fact(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return typeof value === "number" ? String(value) : "";
}

/**
 * The first ref of a type's label, with a leading word (`issue `) dropped.
 *
 * @param refs - The refs.
 * @param type - The type.
 * @returns `#490`, `PR #504`, or null.
 */
function refLabel(refs: readonly DecisionRef[], type: DecisionRef["type"]): string | null {
  const ref = refs.find((candidate) => candidate.type === type);

  if (ref === undefined) {
    return null;
  }

  return type === "ticket" ? ref.label.replace(/^issue /, "") : ref.label;
}

/** Each kind's subject, from its facts and refs. */
const SUBJECTS: Readonly<
  Record<
    string,
    (payload: Readonly<Record<string, unknown>>, refs: readonly DecisionRef[]) => string
  >
> = {
  merge_approval: (_payload, refs) => `Merge ${refLabel(refs, "pr") ?? "the PR"}`,
  protected_path_allow_once: (payload) => `One-time edit to ${fact(payload.path)}`,
  claim_waiver: (payload) => `Waiver of “${fact(payload.claim)}”`,
  plan_sign_off: (payload) => `Plan sign-off for ${fact(payload.subject)}`,
  fact_review: (payload) => `Fact “${fact(payload.text)}”`,
  run_needs_human: (payload) => `${fact(payload.subject)} needed a human`,
  split_approval: (payload, refs) =>
    `Split ${refLabel(refs, "ticket") ?? fact(payload.subject)} into ${fact(payload.draft_count)} tickets`,
  resize_review: (payload) =>
    `Estimator re-size ${fact(payload.ticket_key)} ${fact(payload.from_effort)}→${fact(payload.to_effort)}`,
  spend_approval: (payload) =>
    `Spend ${fact(payload.spent)} past the ${fact(payload.cap)} cap on ${fact(payload.subject)}`,
};

/** A person's action, in the past tense. */
const ANSWERED: Readonly<Record<string, string>> = {
  approve_merge: "approved",
  return_to_loop: "returned to the loop",
  allow_once: "allowed once",
  deny: "denied",
  waive_annotate: "waived",
  require_bench_upgrade: "bench upgrade required",
  sign_off: "signed off",
  confirm: "confirmed",
  retire: "retired",
  retry_with_note: "retried with a note",
  cancel_run: "cancelled",
  approve_split: "approved",
  discard: "discarded",
  accept_resize: "accepted",
  keep_size: "kept the old size",
  approve_spend: "approved",
  stop_loop: "stopped",
};

/** The reserved out-of-band closure (V097) — defined once, beside the links that also read it. */
export { SOURCE_RESOLVED };

/**
 * How a resolution ended, in words.
 *
 * @param resolution - Who answered and with what.
 * @param resolution.resolver - `human` or `policy`.
 * @param resolution.policy - The policy, for `policy`.
 * @param resolution.actionId - The action.
 * @returns `approved`, `auto-accepted by policy`, `closed — settled elsewhere`.
 */
export function outcomeWords(resolution: {
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly actionId: string;
}): string {
  if (resolution.resolver === "policy") {
    return resolution.policy === SOURCE_RESOLVED
      ? "closed — settled elsewhere"
      : "auto-accepted by policy";
  }

  return ANSWERED[resolution.actionId] ?? resolution.actionId.replace(/_/g, " ");
}

/**
 * What a resolved row is about — `Split #490 into 6 tickets` — composed from the kind, its facts
 * and its refs, never stored (X2).
 *
 * @param kindId - The item's kind.
 * @param payload - Its facts.
 * @param refs - Its refs.
 * @param fallback - The rendered question, for a kind with no subject here.
 * @returns The subject.
 */
export function resolvedSubject(
  kindId: string,
  payload: Readonly<Record<string, unknown>>,
  refs: readonly DecisionRef[],
  fallback: string,
): string {
  return SUBJECTS[kindId]?.(payload, refs) ?? fallback;
}

/**
 * A resolved row's line — `Split #490 into 6 tickets — approved`: its subject
 * ({@link resolvedSubject}) and how it ended ({@link outcomeWords}).
 *
 * @param kindId - The item's kind.
 * @param payload - Its facts.
 * @param refs - Its refs.
 * @param fallback - The rendered question, for a kind with no subject here.
 * @param resolution - How it ended.
 * @param resolution.resolver - `human` or `policy`.
 * @param resolution.policy - The policy, for `policy`.
 * @param resolution.actionId - The action.
 * @returns The line.
 */
export function resolvedSummary(
  kindId: string,
  payload: Readonly<Record<string, unknown>>,
  refs: readonly DecisionRef[],
  fallback: string,
  resolution: {
    readonly resolver: "human" | "policy";
    readonly policy: string | null;
    readonly actionId: string;
  },
): string {
  return `${resolvedSubject(kindId, payload, refs, fallback)} — ${outcomeWords(resolution)}`;
}

/**
 * The UTC calendar day of an instant.
 *
 * @param at - The instant.
 * @returns `YYYY-MM-DD`.
 */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The UTC ISO week (Monday) an instant falls in — the metric views' grain.
 *
 * @param at - The instant.
 * @returns The Monday, `YYYY-MM-DD`.
 */
export function utcWeek(at: Date): string {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7;

  day.setUTCDate(day.getUTCDate() - offset);

  return utcDay(day);
}

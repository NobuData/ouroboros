/**
 * A decision card's words and pure rules (BO.2, [#467](https://github.com/NobuData/ouroboros/issues/467),
 * mockup 16).
 *
 * **Nothing here knows a kind.** A card is drawn from what BN.4 (#464) sends for *any* kind — the
 * rendered question and why, the facts they were composed from, typed refs with their
 * destinations, and the declared action row resolved against this reader — and every rule below
 * is a rule about those shapes: which why-words are set in mono, which action asks first, which
 * link is the quiet one. A kind added tomorrow renders through the same rules with no change here
 * or in the component (`__tests__/inbox/decision-card.fixture-kind.test.tsx` holds that).
 */

import type { InboxAction, InboxActionReceipt, InboxActionResult, InboxItem } from "@/app/api/inbox";
import { ageOfSeconds } from "@/app/format";
import { safeReturnTo } from "@/app/paths";

import { VIEWER_CANNOT_SNOOZE } from "./view";

/** What the in-flight line says while an answer is on its way. */
export const ANSWERING = "answering…";

/** What every other control on the card says while one answer is in flight. */
export const ANSWER_IN_FLIGHT = "An answer is on its way.";

/** What a failed answer says when the service gave no sentence a reader can use. */
export const ANSWER_FAILED = "The answer could not be delivered. The decision is still open — try again.";

/** What a failed snooze says when the service gave no sentence a reader can use. */
export const ITEM_SNOOZE_FAILED = "The decision could not be snoozed. Try again.";

/** The receipt's mark, and its accessible reading. */
export const RECEIPT_MARK = "✓";
export const RECEIPT_LABEL = "Answered";

/** The note panel: the field's label, its hint, and what an empty note is told. */
export const NOTE_LABEL = "Note";
export const NOTE_HINT = "It travels with your answer.";
export const NOTE_REQUIRED = "Write a note first — this answer carries one.";

/** The longest note the service takes (`InboxActionRequest.note`). */
export const NOTE_MAX_LENGTH = 2000;

/** The per-item snooze: its affordance, its group's name, and each duration on offer. */
export const SNOOZE_LABEL = "Snooze";
export const SNOOZE_GROUP_LABEL = "Snooze for";
export const SNOOZE_CHOICES: readonly { readonly minutes: number; readonly label: string }[] = [
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "1 day" },
];

/** Why the snooze is inert for a viewer — the same sentence *Snooze all* gives. */
export const VIEWER_CANNOT_SNOOZE_ITEM = VIEWER_CANNOT_SNOOZE;

/** Why a link with no destination cannot be followed. */
export const LINK_UNAVAILABLE = "This decision does not say where that leads.";

/** How the reader's standing is named when the action needs the approve capability (#485). */
export const NEEDS_APPROVER = "Needs the approve-loops capability — an owner or admin can grant it.";

/** A card with nothing pressed. */
export const IDLE: CardPhase = { kind: "idle" };

/** Where a card stands, as the reader has left it. */
export type CardPhase =
  /** Asking, untouched. */
  | { readonly kind: "idle" }
  /** A note-taking action's inline panel is open. */
  | { readonly kind: "noting"; readonly actionId: string }
  /** A danger action's confirmation is open. */
  | { readonly kind: "confirming"; readonly actionId: string }
  /** The snooze's durations are on offer. */
  | { readonly kind: "choosing-snooze" }
  /** An answer is on its way — the optimistic state. */
  | { readonly kind: "answering"; readonly actionId: string }
  /** A snooze is on its way. */
  | { readonly kind: "snoozing" }
  /** The last press failed; the card is open and answerable again. */
  | { readonly kind: "failed"; readonly reason: string }
  /** Answered here: the receipt. */
  | { readonly kind: "answered"; readonly actionId: string; readonly receipt: InboxActionReceipt }
  /** Someone else answered first. */
  | { readonly kind: "raced"; readonly winner: Winner }
  /** Snoozed here, until an instant. */
  | { readonly kind: "snoozed"; readonly untilMs: number };

/** Who answered first, from BN.2's `409 decision_already_answered` (`details.resolution`). */
export interface Winner {
  /** The person's name; `null` for a policy, or a person since removed. */
  readonly who: string | null;
  /** The policy that closed it, or `null` for a person's answer. */
  readonly policy: string | null;
  /** The action that answered. */
  readonly actionId: string;
  /** When, epoch milliseconds; `null` when the service could not say. */
  readonly resolvedAtMs: number | null;
}

/** What a press of an answering action came to. */
export type DecisionAnswer =
  /** Answered: the resolution and its receipt. */
  | { readonly outcome: "answered"; readonly result: InboxActionResult }
  /** Someone answered first. */
  | { readonly outcome: "raced"; readonly winner: Winner }
  /** Refused or failed; the item is still open. */
  | { readonly outcome: "failed"; readonly reason: string };

/** A stretch of the why paragraph, in prose or in mono. */
export interface WhySegment {
  readonly text: string;
  readonly mono: boolean;
}

/** How one action is drawn. */
export type ActionShape =
  /** A button that answers. */
  | "answer"
  /** A link drawn as a button — the card's context link (*Open PR verification →*). */
  | "link"
  /** A link drawn as quiet text — any link after the first (*Edit protected paths →*). */
  | "quiet-link";

/** What pressing an answering action does first. */
export type AnswerStep =
  /** Opens the inline note panel, which shows the consequence and confirms. */
  | "note"
  /** Opens a confirmation carrying the consequence. */
  | "confirm"
  /** Answers at once. */
  | "send";

/** The policy id BN.1 records when a source settled its own question (V097). */
const SOURCE_RESOLVED = "source_resolved";

/** A fact worth setting in mono: one unbroken token of at least three characters. */
const CODE_LIKE = /^\S{3,}$/;

/** A character that continues a word — what a mono span must not start or end inside. */
const WORD = /[\p{L}\p{N}_]/u;

/**
 * Whether a match sits on word boundaries, so `refactor` never lights up inside `refactoring`.
 *
 * @param text The paragraph.
 * @param start Where the match starts.
 * @param end Where it ends (exclusive).
 * @returns `true` when neither neighbour continues a word the match starts or ends with.
 */
function onBoundaries(text: string, start: number, end: number): boolean {
  const before = start > 0 && WORD.test(text[start - 1]!) && WORD.test(text[start]!);
  const after = end < text.length && WORD.test(text[end]!) && WORD.test(text[end - 1]!);

  return !before && !after;
}

/**
 * The why paragraph, cut into prose and mono spans.
 *
 * The service composes the sentence and sends the facts it was composed from; a fact that is one
 * unbroken token — a path (`boot/rollback_flag.c`), a label (`refactor`), a key (`#486`) — is a
 * value read character by character, so its mentions are set in mono, as the mockup sets them.
 * Counts and phrases stay prose.
 *
 * @param why The rendered paragraph.
 * @param facts The facts it was composed from.
 * @returns The paragraph in order; concatenating every `text` gives `why` back.
 */
export function whySegments(why: string, facts: Readonly<Record<string, unknown>>): WhySegment[] {
  const tokens = [
    ...new Set(
      Object.values(facts).filter((value): value is string => typeof value === "string" && CODE_LIKE.test(value)),
    ),
    // Longest first, so a path wins over a shorter fact it happens to contain.
  ].sort((a, b) => b.length - a.length);
  const segments: WhySegment[] = [];
  let prose = "";
  let at = 0;

  while (at < why.length) {
    const token = tokens.find((candidate) => why.startsWith(candidate, at) && onBoundaries(why, at, at + candidate.length));

    if (token === undefined) {
      prose += why[at];
      at += 1;
      continue;
    }

    if (prose !== "") segments.push({ text: prose, mono: false });

    segments.push({ text: token, mono: true });
    prose = "";
    at += token.length;
  }

  if (prose !== "") segments.push({ text: prose, mono: false });

  return segments;
}

/**
 * How long a card has been asking, now.
 *
 * Counted from when it was asked rather than added to the last figure, so a poll cannot move it
 * and a tab left in the background catches up; the service's own reading is the floor, so a
 * browser clock running behind never takes the age backwards.
 *
 * @param item The item — its `createdAt` and the `ageSeconds` the service read.
 * @param nowSeconds The clock, whole seconds since the epoch.
 * @returns Seconds since it was asked.
 */
export function liveAgeSeconds(item: Pick<InboxItem, "createdAt" | "ageSeconds">, nowSeconds: number): number {
  const askedAt = Math.floor(Date.parse(item.createdAt) / 1000);

  return Number.isFinite(askedAt) ? Math.max(item.ageSeconds, nowSeconds - askedAt) : item.ageSeconds;
}

/**
 * A destination the service sent, as somewhere this page will link.
 *
 * The service resolves every tag's and link's destination (`decisions/inbox.links.ts`) as a path
 * on this origin, and the card renders what it is sent. It still renders it as an `href`, so the
 * value is read through the application's one same-origin guard (`safeReturnTo`): anything that is
 * not a plain path here — another host, a scheme, a control character — is no destination at all,
 * and the tag is drawn unlinked or the action as unavailable.
 *
 * @param href What the service sent.
 * @returns The path, or `null` when there is nothing safe to link.
 */
export function sitePath(href: string | null | undefined): string | null {
  return safeReturnTo(href ?? undefined) ?? null;
}

/**
 * How each action of a row is drawn, in declared order.
 *
 * An answering action is a button. The first link is the card's context link and takes the
 * button treatment; any link after it is the quiet one — the mockup's *Edit protected paths →*.
 *
 * @param actions The declared row.
 * @returns One shape per action, in order.
 */
export function actionShapes(actions: readonly InboxAction[]): ActionShape[] {
  let links = 0;

  return actions.map((action) => {
    if (!action.navigates) return "answer";

    links += 1;

    return links === 1 ? "link" : "quiet-link";
  });
}

/**
 * Why an action cannot be used by this reader, or `undefined` when it can.
 *
 * The service decides (BN.4's `allowed` and `disabledReason`); this only puts it in words, so the
 * card can never disagree with what BN.2 will enforce.
 *
 * @param action The action.
 * @returns The sentence, or `undefined`.
 */
export function inertReason(action: InboxAction): string | undefined {
  if (!action.allowed) {
    return action.disabledReason === "capability_required"
      ? NEEDS_APPROVER
      : `Needs the ${action.requiredRole} role in this workspace.`;
  }

  return action.navigates && sitePath(action.href) === null ? LINK_UNAVAILABLE : undefined;
}

/**
 * What pressing an answering action does first.
 *
 * Every action declares a consequence sentence, so the sentence alone cannot decide who asks. An
 * action that takes a note already stops for the note — its panel shows the consequence and its
 * button is the confirmation — and a `danger` action confirms with the same sentence. Everything
 * else answers on the first press: a confirm on every button teaches people to click through.
 *
 * @param action An answering action.
 * @returns The step.
 */
export function answerStep(action: InboxAction): AnswerStep {
  if (action.takesNote) return "note";

  return action.style === "danger" ? "confirm" : "send";
}

/**
 * Whether a card can still be answered or snoozed.
 *
 * @param phase Where it stands.
 * @returns `false` once it is answered, raced or snoozed.
 */
export function isAsking(phase: CardPhase): boolean {
  return phase.kind !== "answered" && phase.kind !== "raced" && phase.kind !== "snoozed";
}

/**
 * Whether a press is on its way.
 *
 * @param phase Where the card stands.
 * @returns `true` while an answer or a snooze is in flight.
 */
export function inFlight(phase: CardPhase): boolean {
  return phase.kind === "answering" || phase.kind === "snoozing";
}

/**
 * A receipt as one line.
 *
 * @param receipt What the answer executed.
 * @returns `exception granted · resume sent to loop #1844`.
 */
export function receiptLine(receipt: InboxActionReceipt): string {
  return receipt.effects.join(" · ");
}

/**
 * Who answered first, from a `409`'s details.
 *
 * @param details The error's `details`.
 * @returns The winner, or `null` when the details name no resolution.
 */
export function winnerOf(details: unknown): Winner | null {
  if (typeof details !== "object" || details === null) return null;

  const resolution = (details as { resolution?: unknown }).resolution;

  if (typeof resolution !== "object" || resolution === null) return null;

  const { actor, policy, actionId, resolvedAt } = resolution as Record<string, unknown>;
  const name =
    typeof actor === "object" && actor !== null ? (actor as { name?: unknown }).name : undefined;
  const at = typeof resolvedAt === "string" ? Date.parse(resolvedAt) : Number.NaN;

  return {
    who: typeof name === "string" && name !== "" ? name : null,
    policy: typeof policy === "string" ? policy : null,
    actionId: typeof actionId === "string" ? actionId : "",
    // The service answers the epoch when it lost the row; that is "unknown", not "56 years ago".
    resolvedAtMs: Number.isFinite(at) && at > 0 ? at : null,
  };
}

/**
 * The race state's sentence — *Answered by Priya 10s ago — Approve & merge.*
 *
 * A designed state, not an error: the reader pressed, someone was faster, and the card says who,
 * when and with what, so nobody wonders whether their own press went through.
 *
 * @param winner Who answered first.
 * @param actions The card's actions, to name the winning one by its label.
 * @param nowMs The clock, epoch milliseconds.
 * @returns The sentence.
 */
export function raceLine(winner: Winner, actions: readonly InboxAction[], nowMs: number): string {
  const ago = winner.resolvedAtMs === null ? "" : ` ${ageOfSeconds((nowMs - winner.resolvedAtMs) / 1000)} ago`;

  if (winner.policy === SOURCE_RESOLVED) return `Settled at its source${ago} — nothing is left to answer.`;

  const who = winner.who ?? (winner.policy === null ? null : "policy");
  const label = actions.find((action) => action.id === winner.actionId)?.label;
  const lead = who === null ? `Already answered${ago}` : `Answered by ${who}${ago}`;

  return label === undefined ? `${lead}.` : `${lead} — ${label}.`;
}

/**
 * A snoozed card's line.
 *
 * @param untilMs When it wakes, epoch milliseconds.
 * @param clock How an instant is printed — `14:20`.
 * @returns `Snoozed until 14:20 — it returns to the queue then.`
 */
export function snoozedLine(untilMs: number, clock: (atMs: number) => string): string {
  return `Snoozed until ${clock(untilMs)} — it returns to the queue then.`;
}

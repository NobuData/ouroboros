/**
 * Decision cards (BZ.2, [#536](https://github.com/NobuData/ouroboros/issues/536)) — pure.
 *
 * **The inbox owns the words.** A card's headline and body are the kind's own question and why
 * (#457), rendered from the item's facts by the registry — the same sentences the Needs-you
 * inbox, the decision mail and the GitHub mirror print. Nothing here writes prose about a
 * decision: change a kind's declaration and the card changes, with no edit to this file.
 *
 * ```
 * open       ⏸ <question>                      resolved   ✓ <question>
 *            <why>                                         <why>
 *            <refs>                                        <refs>
 *            [answer…] [link…]                             (no buttons)
 *            paused 4m · escalates to the                  Maya Chen answered: allowed once · in Slack
 *            Needs-you inbox in 26m
 * ```
 *
 * **A card has a lifetime.** The resolved form is the same card with every button gone and the
 * outcome and its actor stated — what `chat.update` writes — followed in the channel by a system
 * line.
 */

import { NAVIGATE_PREFIX, navigationHref } from "../decisions/inbox.links";
import { outcomeWords } from "../decisions/inbox.compose";
import type {
  DecisionAction,
  DecisionRef,
  PublishedDecisionKind,
  RenderedDecision,
} from "../decisions/decision.types";
import type { DecisionChannel, DecisionSeverity } from "../db/schema";
import {
  STAT_SEPARATOR,
  shortDuration,
  type ChatCard,
  type ChatCardAction,
  type ChatSeverity,
  type ChatSystemLine,
} from "./chat.card";

/** The mark on a decision that is waiting, and on one that has been answered. */
export const WAITING_MARK = "⏸";
export const ANSWERED_MARK = "✓";

/** What a waiting card says once its escalation timer has fired (#538). */
export const ESCALATED_ANNOTATION = "⚠ escalated — now in the Needs-you inbox";

/** The one button a merge-class card has in chat, and the line that says why (decision X5). */
export const CONFIRM_IN_APP_LABEL = "Confirm in Ouroboros ↗";
export const CONFIRM_IN_APP_LINE =
  "A merge is confirmed in Ouroboros, signed in — it cannot be answered from chat.";

/**
 * A decision's escalation timer, as the card reads it (#538) — `decision_escalation_timers`'
 * three instants.
 */
export interface EscalationTimerState {
  /** When the item escalates if nobody has answered. */
  readonly dueAt: Date;
  readonly firedAt: Date | null;
  readonly cancelledAt: Date | null;
}

/** How each answering channel reads on a resolved card. */
const CHANNEL_WORDS: Readonly<Record<DecisionChannel, string>> = {
  web: "in Ouroboros",
  email: "by email",
  github: "on GitHub",
  slack: "in Slack",
  push: "by push",
  api: "through the API",
};

/** A card's severity for each severity a decision can have. */
const SEVERITIES: Readonly<Record<DecisionSeverity, ChatSeverity>> = {
  err: "err",
  warn: "warn",
  info: "info",
};

/** The part of a decision a card is composed from. */
export interface DecisionCardSubject {
  /** The decision item — what the app's own page for it is addressed by. */
  readonly itemId: string;
  /** The kind the item is pinned to — its actions, what answers it, and whether it is a merge. */
  readonly kind: Pick<PublishedDecisionKind, "actions" | "resolutionSemantics" | "mergeClass">;
  /** The kind's question and why, rendered from the item's facts as plain text. */
  readonly rendered: RenderedDecision;
  readonly severity: DecisionSeverity;
  readonly refs: readonly DecisionRef[];
  /** The item's `source_ref`, which some link actions resolve through. */
  readonly sourceRef: string;
  /** When the decision was asked. */
  readonly askedAt: Date;
}

/** How a decision ended. */
export interface DecisionCardResolution {
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly actionId: string;
  /** The person's name; null for a policy, or a person since removed. */
  readonly actorName: string | null;
  readonly channel: DecisionChannel;
}

/**
 * The fact lines every form of a decision card shares.
 *
 * @param subject - The decision.
 * @returns The kind's why, then what the decision is about.
 */
function factLines(subject: DecisionCardSubject): string[] {
  const refs = subject.refs.map((ref) => ref.label).join(STAT_SEPARATOR);

  return refs === "" ? [subject.rendered.why] : [subject.rendered.why, refs];
}

/**
 * Whether an action answers the decision — as opposed to opening a page.
 *
 * @param kind - The kind.
 * @param action - One of its actions.
 * @returns True for an action in the kind's `answered_by` that does not navigate.
 */
export function answers(
  kind: Pick<PublishedDecisionKind, "resolutionSemantics">,
  action: DecisionAction,
): boolean {
  return (
    kind.resolutionSemantics.answered_by.includes(action.id) &&
    !action.handler_binding.startsWith(NAVIGATE_PREFIX)
  );
}

/**
 * The footnote of a waiting card: how long it has waited and when it escalates.
 *
 * This is the countdown computation (#538): the line is read off the timer's own state at the
 * instant of rendering, so it cannot say anything the mechanism will not do. A decision about a
 * run holds that run up, so it reads *paused*; any other reads *waiting*.
 *
 * | timer | the line |
 * | --- | --- |
 * | pending, due later | `paused 4m · escalates to the Needs-you inbox in 26m` |
 * | pending, due now or overdue | `paused 31m · escalating to the Needs-you inbox` |
 * | fired | `paused 31m · ⚠ escalated — now in the Needs-you inbox` |
 * | cancelled, or none | `paused 4m` — nothing is counting down, so nothing is promised |
 *
 * @param subject - The decision.
 * @param now - The instant the card is rendered.
 * @param timer - The item's escalation timer, or undefined when it has none.
 * @returns The footnote.
 */
export function waitingFootnote(
  subject: Pick<DecisionCardSubject, "askedAt" | "refs">,
  now: Date,
  timer: EscalationTimerState | undefined,
): string {
  const waited = Math.max(0, (now.getTime() - subject.askedAt.getTime()) / 1000);
  const verb = subject.refs.some((ref) => ref.type === "run") ? "paused" : "waiting";
  const head = `${verb} ${shortDuration(waited)}`;

  if (timer === undefined || timer.cancelledAt !== null) {
    return head;
  }

  if (timer.firedAt !== null) {
    return `${head}${STAT_SEPARATOR}${ESCALATED_ANNOTATION}`;
  }

  const left = (timer.dueAt.getTime() - now.getTime()) / 1000;

  return left > 0
    ? `${head}${STAT_SEPARATOR}escalates to the Needs-you inbox in ${shortDuration(left)}`
    : `${head}${STAT_SEPARATOR}escalating to the Needs-you inbox`;
}

/**
 * A waiting decision, as a card with its buttons.
 *
 * @param subject - The decision.
 * @param input.uiUrl - The UI origin link buttons are built on.
 * @param input.values - The signed value for each answering action, by action id. An answering
 *   action with no value gets no button: an unsigned button is never drawn.
 * @param input.now - The instant the card is rendered, for the footnote.
 * @param input.timer - The item's escalation timer, which the footnote counts down from.
 * @returns The card. A merge-class decision's answers are one link into the app instead of
 *   buttons (X5), and the card says so.
 */
export function decisionCard(
  subject: DecisionCardSubject,
  input: {
    uiUrl: string;
    values: ReadonlyMap<string, string>;
    now: Date;
    timer?: EscalationTimerState;
  },
): ChatCard {
  const origin = input.uiUrl.replace(/\/+$/, "");
  const actions: ChatCardAction[] = [];
  const inApp = subject.kind.mergeClass;

  if (inApp) {
    actions.push({
      type: "link",
      id: "confirm_in_app",
      label: CONFIRM_IN_APP_LABEL,
      url: `${origin}/inbox?item=${encodeURIComponent(subject.itemId)}`,
    });
  }

  for (const action of subject.kind.actions) {
    if (answers(subject.kind, action)) {
      const value = input.values.get(action.id);

      // Chat never completes a merge: its answers are the one link above.
      if (value !== undefined && !inApp) {
        actions.push({
          type: "answer",
          id: action.id,
          label: action.label,
          style:
            action.style === "primary"
              ? "primary"
              : action.style === "danger"
                ? "danger"
                : "default",
          value,
        });
      }

      continue;
    }

    const href = navigationHref(action.handler_binding, {
      refs: subject.refs,
      sourceRef: subject.sourceRef,
    });

    if (href !== null) {
      actions.push({ type: "link", id: action.id, label: action.label, url: `${origin}${href}` });
    }
  }

  return {
    kind: "card",
    severity: SEVERITIES[subject.severity],
    mark: WAITING_MARK,
    headline: subject.rendered.question,
    lines: inApp ? [...factLines(subject), CONFIRM_IN_APP_LINE] : factLines(subject),
    stats: null,
    actions,
    footnote: waitingFootnote(subject, input.now, input.timer),
  };
}

/**
 * How a resolution reads on the card it closed.
 *
 * @param resolution - How it ended.
 * @returns `Maya Chen answered: allowed once · in Slack`, `Closed — settled elsewhere`.
 */
export function resolutionFootnote(resolution: DecisionCardResolution): string {
  const words = outcomeWords(resolution);

  if (resolution.resolver === "policy") {
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  }

  return `${resolution.actorName ?? "Someone"} answered: ${words}${STAT_SEPARATOR}${CHANNEL_WORDS[resolution.channel]}`;
}

/**
 * An answered decision: the same card with no buttons, saying how it ended and who ended it.
 *
 * @param subject - The decision.
 * @param resolution - How it ended.
 * @returns The card `chat.update` writes over the waiting one.
 */
export function resolvedDecisionCard(
  subject: DecisionCardSubject,
  resolution: DecisionCardResolution,
): ChatCard {
  return {
    kind: "card",
    severity: "info",
    mark: ANSWERED_MARK,
    headline: subject.rendered.question,
    lines: factLines(subject),
    stats: null,
    actions: [],
    footnote: resolutionFootnote(resolution),
  };
}

/**
 * The line posted under a card once it is answered.
 *
 * It names the action by the kind's own label, lower-cased as a sentence reads it, and what the
 * decision was about. It claims no effect — *resumed*, *merged* — that this service did not
 * observe.
 *
 * @param subject - The decision.
 * @param resolution - How it ended.
 * @returns `✓ Maya Chen answered: allow once — loop #1851`.
 */
export function decisionSystemLine(
  subject: Pick<DecisionCardSubject, "kind" | "refs">,
  resolution: DecisionCardResolution,
): ChatSystemLine {
  const about = (subject.refs.find((ref) => ref.type === "run") ?? subject.refs[0])?.label;
  const tail = about === undefined ? "" : ` — ${about}`;

  if (resolution.resolver === "policy") {
    return { kind: "line", text: `${ANSWERED_MARK} ${resolutionFootnote(resolution)}${tail}` };
  }

  const action = subject.kind.actions.find((candidate) => candidate.id === resolution.actionId);
  const said =
    action === undefined
      ? resolution.actionId.replace(/_/g, " ")
      : action.label.replace(/\s*[→↗]\s*$/, "").toLowerCase();

  return {
    kind: "line",
    text: `${ANSWERED_MARK} ${resolution.actorName ?? "Someone"} answered: ${said}${tail}`,
  };
}

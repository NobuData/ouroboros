"use client";

import { useCallback, useRef, useState } from "react";

import type { InboxAction, InboxItem } from "@/app/api/inbox";

import { ANSWER_FAILED, IDLE, ITEM_SNOOZE_FAILED, type CardPhase, answerStep } from "./card-view";
import { answerDecision, snoozeDecision } from "./inbox-actions";

/** What a card's controls can do. */
export interface DecisionControls {
  /** Where the card stands. */
  readonly phase: CardPhase;
  /**
   * An answering action was pressed: open its note panel, open its confirmation, or send it —
   * whichever {@link answerStep} says.
   */
  readonly press: (action: InboxAction) => void;
  /** Send an answer — the note panel's and the confirmation's button, and `press` itself. */
  readonly send: (action: InboxAction, note?: string) => void;
  /** Offer the snooze's durations. */
  readonly chooseSnooze: () => void;
  /** Snooze the item for a while. */
  readonly snoozeFor: (minutes: number) => void;
  /** Close a note panel, a confirmation or the snooze's durations without acting. */
  readonly cancel: () => void;
}

/** What {@link useDecision} takes beyond the item. */
export interface DecisionOptions {
  /**
   * Hears a press the moment it leaves — before the service answers — so the queue can hold the
   * card on screen: a read that lands mid-flight may already have dropped the item, and the
   * receipt must still have a card to be printed on.
   */
  readonly onPressed?: (itemId: string) => void;
  /**
   * Hears that the card settled here — answered, raced or snoozed — so the page can recount and
   * re-read.
   */
  readonly onSettled?: (itemId: string) => void;
  /** Mints a press's idempotency key — a test seam. Defaults to a random UUID. */
  readonly newKey?: () => string;
}

/**
 * One card's answer lifecycle (BO.2, [#467](https://github.com/NobuData/ouroboros/issues/467)).
 *
 * ```
 * idle ─ press ─▶ noting / confirming ─ send ─▶ answering ─▶ answered  (the receipt)
 *                                                         ├▶ raced     (someone was first)
 *                                                         └▶ failed    (still open, answerable)
 * idle ─ chooseSnooze ─▶ choosing-snooze ─ snoozeFor ─▶ snoozing ─▶ snoozed | failed
 * ```
 *
 * **One press at a time, one execution per press.** A second press while one is in flight is
 * dropped here, and each press carries a fresh idempotency key, so a delivery retried underneath
 * this hook answers with the first attempt rather than executing twice (BN.2, #462). A press that
 * failed gets a new key when it is pressed again — the old one would only replay the failure.
 *
 * **A failure leaves the card asking.** Whatever went wrong — a plane refused, the action's plane
 * is not built, the network dropped — the card returns to its buttons with the reason beside
 * them, which is the service's own rule: a failing handler leaves the item open.
 *
 * @param item The item.
 * @param options See {@link DecisionOptions}.
 * @returns The phase and the controls.
 */
export function useDecision(item: Pick<InboxItem, "id">, options: DecisionOptions = {}): DecisionControls {
  const { onPressed, onSettled, newKey = () => crypto.randomUUID() } = options;
  const [phase, setPhase] = useState<CardPhase>(IDLE);
  const busy = useRef(false);
  const itemId = item.id;

  const send = useCallback(
    (action: InboxAction, note?: string) => {
      if (busy.current) return;

      busy.current = true;
      setPhase({ kind: "answering", actionId: action.id });
      onPressed?.(itemId);

      void answerDecision(itemId, action.id, { idempotencyKey: newKey(), ...(note === undefined ? {} : { note }) })
        .then((answer) => {
          if (answer.outcome === "failed") {
            setPhase({ kind: "failed", reason: answer.reason });

            return;
          }

          setPhase(
            answer.outcome === "answered"
              ? { kind: "answered", actionId: action.id, receipt: answer.result.receipt }
              : { kind: "raced", winner: answer.winner },
          );
          onSettled?.(itemId);
        })
        // The action itself never arrived or never answered: the item is as open as it was.
        .catch(() => setPhase({ kind: "failed", reason: ANSWER_FAILED }))
        .finally(() => {
          busy.current = false;
        });
    },
    [itemId, newKey, onPressed, onSettled],
  );

  const press = useCallback(
    (action: InboxAction) => {
      if (busy.current) return;

      const step = answerStep(action);

      if (step === "send") send(action);
      else setPhase({ kind: step === "note" ? "noting" : "confirming", actionId: action.id });
    },
    [send],
  );

  const snoozeFor = useCallback(
    (minutes: number) => {
      if (busy.current) return;

      busy.current = true;
      setPhase({ kind: "snoozing" });
      onPressed?.(itemId);

      void snoozeDecision(itemId, minutes)
        .then((outcome) => {
          const until = outcome.ok && outcome.value.until !== null ? Date.parse(outcome.value.until) : Number.NaN;

          if (!outcome.ok) {
            setPhase({ kind: "failed", reason: outcome.reason });
          } else if (Number.isFinite(until)) {
            setPhase({ kind: "snoozed", untilMs: until });
            onSettled?.(itemId);
          } else {
            // An answer with no wake time snoozed nothing; say so rather than dim the card.
            setPhase({ kind: "failed", reason: ITEM_SNOOZE_FAILED });
          }
        })
        .catch(() => setPhase({ kind: "failed", reason: ITEM_SNOOZE_FAILED }))
        .finally(() => {
          busy.current = false;
        });
    },
    [itemId, onPressed, onSettled],
  );

  const chooseSnooze = useCallback(() => {
    if (!busy.current) setPhase({ kind: "choosing-snooze" });
  }, []);

  const cancel = useCallback(() => {
    if (!busy.current) setPhase(IDLE);
  }, []);

  return { phase, press, send, chooseSnooze, snoozeFor, cancel };
}

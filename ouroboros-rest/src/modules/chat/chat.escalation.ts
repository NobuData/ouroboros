/**
 * The escalation pass (BZ.4, [#538](https://github.com/NobuData/ouroboros/issues/538)) — what
 * happens when nobody answers.
 *
 * ```
 * pending timer, due ─▶ claim (skip locked) ─▶ decision_escalation_fire
 *                                               ├─ item.escalated_at        the queue lists it first
 *                                               ├─ card.escalated_at        each open card, annotated by an edit
 *                                               └─ DM the on-call person    the card, in its escalated form
 * ```
 *
 * One timer per transaction: the claim, the firing and the intents commit together or not at
 * all, so a crash between them leaves the timer pending and the next pass does it whole.
 *
 * **Missed timers fire once, not in a storm.** A timer that came due while nothing was running
 * is still a pending row, and firing ends it. A pass takes at most {@link ESCALATION_BATCH} of
 * them, oldest first; the rest wait for the next pass, a few seconds on.
 *
 * **Cancelled timers are never seen.** The database cancels a timer when its item is answered,
 * snoozed or withdrawn (`V135`), so the claim only ever finds questions still waiting.
 */

import { Injectable, Logger } from "@nestjs/common";

import { ChatEscalationRepository } from "./chat.escalation.repository";

/** The most timers one pass fires. */
export const ESCALATION_BATCH = 50;

/** What a pass did. */
export interface EscalationReport {
  /** Timers fired — items escalated. */
  readonly escalated: number;
  /** Posted cards that will be annotated. */
  readonly cardEdits: number;
  /** DMs intended for on-call people. */
  readonly directMessages: number;
}

@Injectable()
export class ChatEscalation {
  private readonly logger = new Logger(ChatEscalation.name);

  /** @param repository - The timers, and the intents a firing writes. */
  constructor(private readonly repository: ChatEscalationRepository) {}

  /**
   * Fire the timers that have come due.
   *
   * @param now - The instant of the pass.
   * @param limit - The most timers to fire.
   * @returns What was escalated and what was intended to say so.
   */
  async pass(now: Date, limit: number = ESCALATION_BATCH): Promise<EscalationReport> {
    const report = { escalated: 0, cardEdits: 0, directMessages: 0 };

    for (let taken = 0; taken < limit; taken += 1) {
      const fired = await this.repository.transaction(async (transaction) => {
        const timer = await this.repository.claimDue(transaction, now);

        if (timer === undefined) {
          return undefined;
        }

        if (!(await this.repository.fire(transaction, timer.id, now))) {
          // Cancelled or fired between the claim's snapshot and its lock: nothing to say.
          return { timer, intents: undefined };
        }

        return { timer, intents: await this.repository.enqueue(transaction, timer) };
      });

      if (fired === undefined) {
        break;
      }

      if (fired.intents === undefined) {
        continue;
      }

      report.escalated += 1;
      report.cardEdits += fired.intents.cardEdits;
      report.directMessages += fired.intents.directMessages;
      this.logger.log(
        `Decision ${fired.timer.decisionItemId} escalated unanswered: ` +
          `${String(fired.intents.cardEdits)} card(s) annotated, ` +
          `${String(fired.intents.directMessages)} on-call DM(s).`,
      );
    }

    return report;
  }
}

/**
 * The chat publisher (BZ.2, [#536](https://github.com/NobuData/ouroboros/issues/536)) — where
 * things that happen become things to say.
 *
 * ```
 * decision filed      ─▶ a decision card, wherever the workspace routes blocking questions
 * decision resolved   ─▶ chat.update of each posted card, then a system line beside it
 * weekly digest due   ─▶ the digest card, to its bound channel
 * run merged          ─▶ (the merge's own transaction calls `enqueueLoopFinished`)
 * ```
 *
 * It only writes intents (`chat.outbox.ts`); the dispatcher sends them. A listener here must not
 * block or throw (`decision.lifecycle.ts`), so each handler runs detached and logs its own
 * failure — and a missed enqueue costs one message, never the decision.
 *
 * **A refresh says nothing.** A decision re-filed with new facts keeps its card: the card is
 * re-composed from current facts whenever it is next written (its resolution), and re-posting
 * every refresh would be the noise the mockup's routing card turns off by default.
 */

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import {
  DecisionLifecycle,
  type DecisionLifecycleEvent,
  type DecisionLifecycleListener,
} from "../decisions/decision.lifecycle";
import { describeForLog } from "../errors/failure";
import { dueRouteSlot } from "../notification-routes/routes.schedule";
import { ChatEscalationRepository } from "./chat.escalation.repository";
import { CHAT_ROUTE_KINDS, enqueueChatIntent } from "./chat.outbox";
import { ChatRepository } from "./chat.repository";

/** How long after a card's edit its system line is due — so a channel reads them in order. */
export const SYSTEM_LINE_DELAY_MS = 1000;

@Injectable()
export class ChatPublisher implements DecisionLifecycleListener, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatPublisher.name);

  /** Unregisters the listener. */
  private unregister?: () => void;

  /**
   * @param database - Where intents are written.
   * @param repository - Where a decision's cards are, and the digest routes.
   * @param escalations - Starts a decision's escalation timer with its card.
   * @param registry - Which kinds are dormant.
   * @param lifecycle - Where filed and resolved are heard.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: ChatRepository,
    private readonly escalations: ChatEscalationRepository,
    private readonly registry: DecisionKindRegistry,
    private readonly lifecycle: DecisionLifecycle,
  ) {}

  /** Start hearing the lifecycle. */
  onModuleInit(): void {
    this.unregister = this.lifecycle.add(this);
  }

  /** Stop hearing it. */
  onModuleDestroy(): void {
    this.unregister?.();
  }

  /**
   * Hear one change, after the caller has moved on.
   *
   * @param event - What happened.
   */
  decisionChanged(event: DecisionLifecycleEvent): void {
    if (event.type === "filed") {
      void this.decisionFiled(event.organizationId, event.itemId, event.kindId);
    } else if (event.type === "resolved") {
      void this.decisionResolved(event.itemId, event.actionId);
    }
  }

  /**
   * Intend a decision card wherever the workspace routes blocking questions, and start the
   * escalation timer its footnote counts down from (#538) — in one transaction, so a card is
   * never intended without the timer behind it. A decision nobody is told about in chat starts
   * no timer: there is no channel for it to stop depending on. Never throws.
   *
   * @param organizationId - The workspace.
   * @param itemId - The decision.
   * @param kindId - Its kind.
   * @returns How many targets it was enqueued for.
   */
  async decisionFiled(organizationId: string, itemId: string, kindId: string): Promise<number> {
    if (this.registry.isDormant(kindId)) {
      return 0;
    }

    try {
      return await this.escalations.transaction(async (transaction) => {
        const written = await enqueueChatIntent(transaction, {
          organizationId,
          messageKind: "decision_card",
          cardKind: kindId,
          decisionItemId: itemId,
          subject: {},
          routeKinds: CHAT_ROUTE_KINDS.decision,
          dedupe: ["decision_card", itemId],
        });

        if (written > 0) {
          await this.escalations.start(transaction, itemId);
        }

        return written;
      });
    } catch (error) {
      this.logger.error(`Could not enqueue the card of decision ${itemId}.`, describeForLog(error));

      return 0;
    }
  }

  /**
   * Intend the edit of every card a decision has, and the line that follows. Never throws.
   *
   * @param itemId - The decision.
   * @param actionId - What it was answered with.
   * @param now - The instant, for the line's due time.
   * @returns How many rows were written.
   */
  async decisionResolved(
    itemId: string,
    actionId: string,
    now: Date = new Date(),
  ): Promise<number> {
    try {
      return await this.repository.enqueueResolution(
        itemId,
        actionId,
        await this.repository.cardPlacements(itemId),
        new Date(now.getTime() + SYSTEM_LINE_DELAY_MS),
      );
    } catch (error) {
      this.logger.error(
        `Could not enqueue the resolution of decision ${itemId}.`,
        describeForLog(error),
      );

      return 0;
    }
  }

  /**
   * Intend the weekly digest for every workspace whose slot has come. Safe to call as often as
   * the scheduler likes: a slot is intended once per target.
   *
   * @param now - The instant of the pass.
   * @returns How many rows were written.
   */
  async digestPass(now: Date): Promise<number> {
    let written = 0;

    for (const route of await this.repository.digestRoutes(CHAT_ROUTE_KINDS.digest)) {
      // A digest route keeps the weekly schedule whichever kind carries it.
      const slot = dueRouteSlot("weekly_insights", route.config, now, route.lastSlot);

      if (slot === undefined) {
        continue;
      }

      try {
        written += await enqueueChatIntent(this.database.db, {
          organizationId: route.organizationId,
          messageKind: "event_card",
          cardKind: "digest",
          subject: { slot: slot.toISOString() },
          routeKinds: [route.kind],
          dedupe: ["digest", slot.toISOString()],
        });
      } catch (error) {
        this.logger.error(
          `Could not enqueue the weekly digest of workspace ${route.organizationId}.`,
          describeForLog(error),
        );
      }
    }

    return written;
  }
}

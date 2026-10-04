/**
 * `DecisionLifecycle` — who hears that a decision item changed state.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), and the hook #536 (BZ.2) asked
 * for: when an item is filed, refreshed or resolved, a published chat card is updated to match
 * (mockup 19's `⏸ Build paused` becoming `✓ … answered`). Emitters keep supplying facts and kinds
 * keep rendering prose; a channel adds a listener, not a second vocabulary.
 *
 * Told **after** the change committed. A listener must not block and must not throw; one that does
 * is logged and the others still hear — the same contract as the gate engine's `GateListeners`.
 * BN.2 (answers), BN.3 (channel echo) and BN.4 (snooze) emit through the same registry with their
 * own event types.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { DecisionChannel } from "../db/schema";
import type { DecisionSourceSettlement } from "./decision.types";

/** What happened to an item. */
export type DecisionLifecycleEvent =
  | {
      readonly type: "filed" | "refreshed";
      readonly itemId: string;
      readonly organizationId: string;
      readonly kindId: string;
    }
  | {
      readonly type: "resolved";
      readonly itemId: string;
      readonly organizationId: string;
      readonly kindId: string;
      /** `policy` for an out-of-band closure. */
      readonly resolver: "human" | "policy";
      /** The policy that closed it — `source_resolved` — or null for a person. */
      readonly policy: string | null;
      /** The action that answered it — `source_resolved` for a closure. */
      readonly actionId: string;
      readonly channel: DecisionChannel;
      /** Why the source counts as settled, for a closure. */
      readonly settlement?: DecisionSourceSettlement;
    };

/** One listener. */
export interface DecisionLifecycleListener {
  /**
   * Hear one change. Must not block — schedule slow work.
   *
   * @param event - What happened.
   */
  decisionChanged(event: DecisionLifecycleEvent): void;
}

/** The registry — see this file's header. */
@Injectable()
export class DecisionLifecycle {
  private readonly logger = new Logger(DecisionLifecycle.name);

  private readonly listeners = new Set<DecisionLifecycleListener>();

  /**
   * Register a listener.
   *
   * @param listener - Who wants to hear.
   * @returns A function that unregisters it.
   */
  add(listener: DecisionLifecycleListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Tell every listener. A listener that throws is logged; the others still hear.
   *
   * @param event - The change.
   */
  emit(event: DecisionLifecycleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener.decisionChanged(event);
      } catch (error) {
        this.logger.error(
          `A decision lifecycle listener failed for item ${event.itemId}.`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}

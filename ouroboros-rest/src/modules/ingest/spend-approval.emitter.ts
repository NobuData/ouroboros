/**
 * The `spend_approval` emitter — **registered, and dormant**.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)); activates with AF.4
 * ([#237](https://github.com/NobuData/ouroboros/issues/237)). The kind is declared (V097) so its
 * shape — *"{subject} has spent $2.61 against a $2.50 per-run cap"* — is fixed now, and this
 * adapter composes it from a run's spend in integer cents. But per-run caps are not enforced yet
 * (`provider_connections.monthly_cap_cents` is warning-only and nothing pauses a run at
 * `spend_guard.per_run_cap_cents`), so a card would ask approval for a pause that never happened.
 * The registry therefore holds the kind dormant (`DORMANT_DECISION_KINDS` in
 * `decisions/decision-kind.registry.ts`): {@link SpendApprovalEmitter.capCrossed} answers `dormant`
 * and files nothing. AF.4 removes the kind from that set and calls this hook where the run pauses.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { clipFact, runCardFacts, type RunCardFacts } from "../decisions/decision.refs";
import type { DecisionEmission, DecisionEmitOutcome } from "../decisions/decision.types";

/** The kind. */
export const SPEND_APPROVAL_KIND = "spend_approval";

/** The plane's name in the idempotency key. */
export const SPEND_APPROVAL_PLANE = "spend";

/**
 * Integer cents as the card prints them.
 *
 * @param cents - A whole, non-negative number of cents — `261`.
 * @returns `$2.61`.
 */
export function dollars(cents: number): string {
  const whole = Math.max(0, Math.round(cents));

  return `$${String(Math.floor(whole / 100))}.${String(whole % 100).padStart(2, "0")}`;
}

/**
 * The emission for one run past its per-run cap.
 *
 * @param run - The run's subject and refs.
 * @param spentCents - What it has spent.
 * @param capCents - The cap it crossed.
 * @returns The emission.
 */
export function spendApprovalEmission(
  run: RunCardFacts,
  spentCents: number,
  capCents: number,
): DecisionEmission {
  return {
    organizationId: run.organizationId,
    kindId: SPEND_APPROVAL_KIND,
    payload: {
      subject: clipFact(run.subject, 120),
      spent: dollars(spentCents),
      cap: dollars(capCents),
    },
    refs: run.refs,
    key: { plane: SPEND_APPROVAL_PLANE, sourceRef: `run:${run.runId}:spend` },
  };
}

@Injectable()
export class SpendApprovalEmitter {
  /**
   * @param database - The pool, for the run.
   * @param registry - Where the card would be filed — and what holds the kind dormant.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: DecisionKindRegistry,
  ) {}

  /**
   * A run crossed its per-run cap. While the kind is dormant this files nothing.
   *
   * @param runId - The run.
   * @param spentCents - What it has spent, in integer cents.
   * @param capCents - The cap, in integer cents.
   * @returns `dormant` until AF.4; then what the emission did. Null when the run is unknown.
   */
  async capCrossed(
    runId: string,
    spentCents: number,
    capCents: number,
  ): Promise<DecisionEmitOutcome | null> {
    const run = await runCardFacts(this.database.db, runId);

    return run === undefined
      ? null
      : this.registry.emit(spendApprovalEmission(run, spentCents, capCents));
  }
}

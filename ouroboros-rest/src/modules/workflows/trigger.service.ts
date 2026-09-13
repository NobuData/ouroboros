/**
 * `TriggerService` — when a ticket is queued, which workflow claims it, and at which version?
 * (R.1, [#143](https://github.com/NobuData/ouroboros/issues/143)).
 *
 * The intake queue write (`backlog/queue.service.ts`, #112) calls this once per request, after
 * every refusal and before the insert, and stores what it answers on each queue item as the pin:
 * `workflow_tag`, `workflow_version` and `workflow_pin_reason` (V032). No execution happens here —
 * the pin is what T.6 will eventually run, and pinning at queue time is what makes that run
 * auditable.
 *
 * The rules — explicit wins, a predicate fills the default, specificity then slug breaks a tie,
 * the estimate's suggestion when nothing matched — are `trigger.evaluation.ts`', documented in its
 * header and asserted without a database. This file decides only what the database rows *are*:
 *
 *   * **A candidate is an active workflow with a published version and a trigger that parses.**
 *     Paused and archived workflows never match; a draft-only workflow has nothing a pin could
 *     name. A stored trigger that fails `TriggerSchema` is skipped with a warning rather than
 *     failing the queue write — published versions passed the publish gate, so one that does not
 *     parse is a broken document somebody should hear about, not a reason to refuse a person's
 *     selection with a `500`.
 *   * **Any slug's version is the version in force, whatever its status.** An explicit choice has
 *     already been held to the active vocabulary by the queue write, and an estimate's suggestion
 *     is copied as it was made — decision F8 keeps that history readable — so the lookup answers
 *     for every workflow row, and `null` for a slug that is none (a bootstrap workspace's four).
 *
 * **A pin is a snapshot.** It is computed once per request, outside the insert's transaction and
 * reused across its position-collision retries: a publish or pause landing between this read and
 * the insert pins what was in force when the person pressed the button, which is the question a
 * pin answers. Holding a lock on `workflows` for the length of the insert would make every queue
 * write wait on every publish to close a window that means nothing — published versions are
 * immutable, so `v14` stays exactly `v14` whatever is published next. T.6 must re-check status and
 * version when it claims an item.
 */

import { Injectable, Logger } from "@nestjs/common";

import { TriggerSchema } from "./dsl.schema";
import {
  resolveWorkflow,
  type TicketFacts,
  type TriggerCandidate,
  type WorkflowPin,
} from "./trigger.evaluation";
import { TriggerRepository, type WorkflowTriggerRow } from "./trigger.repository";

// Re-exported so a caller outside this module names the pin through the exported service's file,
// never by reaching into the evaluator.
export type { WorkflowPin } from "./trigger.evaluation";

/** One ticket being queued: its facts, and the workflow its estimate suggested. */
export interface QueuedTicket extends TicketFacts {
  /** The estimate's `suggested_workflow` — the answer when no trigger matches. */
  readonly suggestedWorkflow: string;
}

@Injectable()
export class TriggerService {
  /** Where a stored trigger that fails the DSL's schema is reported. */
  private readonly logger = new Logger(TriggerService.name);

  /**
   * @param repository - The one org-scoped read of the workspace's workflows.
   */
  constructor(private readonly repository: TriggerRepository) {}

  /**
   * Pin a workflow and version on each ticket of one queue write.
   *
   * @param organizationId - The workspace, from the tenant context. Only its own workflows are
   *   read, so a workflow never claims another workspace's ticket.
   * @param tickets - The tickets being queued, in the order they will be appended.
   * @param explicit - The workflow the request named, or `undefined` when it named none. The
   *   caller has already held it to the workspace's offered vocabulary.
   * @returns One pin per ticket, in the same order. Empty for an empty selection, without a read.
   */
  async pin(
    organizationId: string,
    tickets: readonly QueuedTicket[],
    explicit: string | undefined,
  ): Promise<WorkflowPin[]> {
    if (tickets.length === 0) return [];

    const rows = await this.repository.triggers(organizationId);
    const candidates = this.candidates(organizationId, rows);
    const versions = new Map(rows.map((row) => [row.slug, row.current_version]));
    const versionOf = (slug: string): number | null => versions.get(slug) ?? null;

    return tickets.map((ticket) =>
      resolveWorkflow({
        explicit,
        suggested: ticket.suggestedWorkflow,
        facts: ticket,
        candidates,
        versionOf,
      }),
    );
  }

  /**
   * The workflows that may claim a ticket: active, published, and carrying a trigger that parses.
   *
   * @param organizationId - The workspace, for the warning's sake.
   * @param rows - Every workflow of that workspace.
   * @returns The candidates, each with its version in force and its validated trigger.
   */
  private candidates(
    organizationId: string,
    rows: readonly WorkflowTriggerRow[],
  ): TriggerCandidate[] {
    const candidates: TriggerCandidate[] = [];

    for (const row of rows) {
      if (row.status !== "active" || row.current_version === null) continue;

      const parsed = TriggerSchema.safeParse(row.trigger);

      if (!parsed.success) {
        this.logger.warn(
          `Workflow ${row.slug} in workspace ${organizationId} has a published version ` +
            `(v${row.current_version}) whose trigger does not parse, so it cannot claim ` +
            "queued tickets until it is republished — see trigger.service.ts.",
        );
        continue;
      }

      candidates.push({ slug: row.slug, version: row.current_version, trigger: parsed.data });
    }

    return candidates;
  }
}

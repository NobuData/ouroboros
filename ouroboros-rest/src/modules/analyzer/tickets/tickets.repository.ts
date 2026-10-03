/**
 * The drafted-tickets card's reads (BW.4, [#519](https://github.com/NobuData/ouroboros/issues/519))
 * — the `ticket_draft` suggestions an analysis still stands behind: the ones nobody has drafted
 * yet, and which planning batches the rest were drafted into.
 *
 * *Still stands behind* is the suggestion cards' rule, word for word
 * (`suggestions/suggestions.repository.ts`'s {@link STILL_CURRENT}): a ticket suggestion leaves
 * this card only when a later analysis ran every analyzer its findings came from and did not
 * compose it again.
 *
 * **Read-only, the analyzer's own tables only, and every statement is scoped by the workspace.**
 * The batches themselves are planning's, read through its service (`tickets.service.ts`).
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import { STILL_CURRENT } from "../suggestions/suggestions.repository";

/** A ticket suggestion nobody has drafted yet. */
export interface UndraftedTicketRow {
  id: string;
  title: string;
  evidence_line: string;
  confidence: number;
  /** Every reference its cited findings carry, each once — what its draft's body will list. */
  evidence_refs: unknown;
}

@Injectable()
export class TicketsRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The repository's open ticket suggestions that are still current, most confident first.
   *
   * The references are gathered exactly as the draft action gathers them
   * (`actions/actions.repository.ts`), so what the card shows before drafting is what the draft's
   * body will carry.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The suggestions.
   */
  async undrafted(organizationId: string, repoRef: string): Promise<UndraftedTicketRow[]> {
    const { rows } = await sql<UndraftedTicketRow>`
      select s.id::text as id, s.title, s.evidence_line, s.confidence,
             coalesce((select jsonb_agg(distinct e)
                         from ouroboros.analysis_suggestion_findings cited
                         join ouroboros.analysis_findings finding on finding.id = cited.finding_id
                        cross join lateral jsonb_array_elements(finding.evidence_refs) e
                        where cited.suggestion_id = s.id), '[]'::jsonb) as evidence_refs
        from ouroboros.analysis_suggestions s
        join ouroboros.analysis_runs r on r.id = s.last_run_id
       where s.organization_id = ${organizationId} and s.repo_ref = ${repoRef}
         and s.kind = 'ticket_draft'
         and s.status = 'open'
         and ${STILL_CURRENT}
       order by s.confidence desc, s.title, s.id`.execute(this.database.db);

    return rows;
  }

  /**
   * The planning batches the repository's current ticket suggestions were drafted into.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns Each batch's id, once.
   */
  async batchIds(organizationId: string, repoRef: string): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      select distinct s.draft_batch_id::text as id
        from ouroboros.analysis_suggestions s
        join ouroboros.analysis_runs r on r.id = s.last_run_id
       where s.organization_id = ${organizationId} and s.repo_ref = ${repoRef}
         and s.kind = 'ticket_draft'
         and s.status = 'drafted'
         and ${STILL_CURRENT}`.execute(this.database.db);

    return rows.map((row) => row.id);
  }
}

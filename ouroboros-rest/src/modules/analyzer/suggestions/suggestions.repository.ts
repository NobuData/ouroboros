/**
 * The suggestion cards' reads (BW.3, [#518](https://github.com/NobuData/ouroboros/issues/518)) —
 * the build-process and workflow suggestions that are still current, in every status, and the
 * findings each cites.
 *
 * ### Which suggestions are current
 *
 * A suggestion is a standing statement about the corpus: an analysis composed it from findings,
 * and it stays true until an analysis **looks again and does not find it**. So a suggestion is on
 * the cards unless a later run that ended (`complete` or `budget_exceeded`) had **every analyzer
 * its findings came from complete** — and still did not record it again.
 *
 * ```
 * run 2 (all analyzers)     composes  A B C
 * run 3 (A's analyzer only) re-finds  A        → A is run 3's; B and C stay: nobody looked again
 * run 4 (all analyzers)     re-finds  A B      → C leaves the cards: its analyzer ran, and found nothing
 * ```
 *
 * That one rule is why a run in flight, a failed run, or one whose pattern analyzers were skipped
 * never blanks the cards — none of them looked — and why a suggestion an analysis no longer
 * supports does not stay on them forever. It holds for every status: a dismissed suggestion an
 * analysis finds again is still listed, still dismissed.
 *
 * **Read-only, and every statement is scoped by the workspace.** The suggestion tables are not in
 * `db/schema.ts`, so this is `sql`, as the composer's and the actions' are.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { ActionBinding } from "../composer/composer.types";

/** The kinds the two suggestion cards draw — ticket drafts are the drafted-tickets card's (BW.4). */
export const CARD_KINDS = ["build_process", "workflow"] as const;

/** A kind one of the two cards draws. */
export type CardKind = (typeof CARD_KINDS)[number];

/**
 * The currency rule (see the file header) as a predicate — for a statement that reads a
 * suggestion as `s`, joined to the analysis that last composed it as `r`. Shared with the
 * drafted-tickets card's read (BW.4, `tickets/tickets.repository.ts`), so both cards agree on what
 * an analysis still stands behind.
 *
 * `coverage` counts, for one suggestion and one later run, the findings the suggestion cites and
 * how many of them came from an analyzer that completed in that later run. The suggestion is
 * superseded only when every one did (and it cites any at all). Every analysis that composed a
 * suggestion cited the same analyzers — its identity is derived from them — so counting its
 * findings across those analyses asks the same question as counting its last one's.
 */
export const STILL_CURRENT = sql<boolean>`
  not exists (
        select 1
          from ouroboros.analysis_runs later
         cross join lateral (
               select count(*) as cited,
                      count(*) filter (
                        where coalesce(later.progress -> 'analyzers', '[]'::jsonb)
                              @> jsonb_build_array(jsonb_build_object(
                                   'id', f.analyzer, 'status', 'completed'))) as looked
                 from ouroboros.analysis_suggestion_findings l
                 join ouroboros.analysis_findings f on f.id = l.finding_id
                where l.suggestion_id = s.id) coverage
         where later.organization_id = s.organization_id
           and later.repo_ref = s.repo_ref
           and later.status in ('complete', 'budget_exceeded')
           and later.started_at > r.started_at
           and coverage.cited > 0
           and coverage.looked = coverage.cited)`;

/** The newest analysis that composed a suggestion. */
export interface ComposedRun {
  id: string;
  finished_at: Date | null;
}

/** One suggestion, as the cards read it. */
export interface SuggestionListRow {
  id: string;
  kind: CardKind;
  title: string;
  evidence_line: string;
  confidence: number;
  /** V087's `{formula, inputs, value}`; null on a row composed before it. */
  confidence_basis: unknown;
  /** V081's impact; null only on a ticket draft, which this read does not answer. */
  impact: unknown;
  needs_spike: boolean;
  action_binding: ActionBinding;
  status: "open" | "applied" | "dismissed" | "drafted";
  resolved_at: Date | null;
  /** Who resolved it, by display name; null while open, and once that person is removed. */
  resolved_by_name: string | null;
  resolution_reason: string | null;
  draft_batch_id: string | null;
  /** The workflow a `workflow` binding names, when the workspace still has it. */
  workflow_slug: string | null;
  /** That workflow's version in force; null when nothing was ever published. */
  workflow_version: number | null;
}

/** One finding a suggestion cites, from the analysis that last composed it. */
export interface SuggestionFindingRow {
  suggestion_id: string;
  id: string;
  analyzer: string;
  analyzer_version: number;
  finding_type: string;
  subject_key: string;
  data: unknown;
  evidence_refs: unknown;
  confidence: number;
  confidence_basis: unknown;
}

@Injectable()
export class SuggestionsRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The repository's newest analysis that **ended having composed a suggestion** of any kind —
   * `complete` or `budget_exceeded`. Before one, there is nothing for the cards to say.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The run, or undefined before any analysis has composed a suggestion.
   */
  async composedRun(organizationId: string, repoRef: string): Promise<ComposedRun | undefined> {
    const { rows } = await sql<ComposedRun>`
      select r.id::text as id, r.finished_at
        from ouroboros.analysis_runs r
       where r.organization_id = ${organizationId} and r.repo_ref = ${repoRef}
         and r.status in ('complete', 'budget_exceeded')
         and exists (select 1
                       from ouroboros.analysis_suggestions s
                      where s.organization_id = r.organization_id
                        and s.repo_ref = r.repo_ref
                        and s.last_run_id = r.id)
       order by r.started_at desc, r.id desc
       limit 1`.execute(this.database.db);

    return rows[0];
  }

  /**
   * The cards' suggestions: every build-process and workflow suggestion that is still current —
   * {@link STILL_CURRENT} — in every status, most confident first.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @returns The suggestions.
   */
  async suggestions(organizationId: string, repoRef: string): Promise<SuggestionListRow[]> {
    const { rows } = await sql<SuggestionListRow>`
      select s.id::text as id, s.kind, s.title, s.evidence_line, s.confidence, s.confidence_basis,
             s.impact, s.needs_spike, s.action_binding, s.status, s.resolved_at,
             u."name" as resolved_by_name, s.resolution_reason,
             s.draft_batch_id::text as draft_batch_id,
             w.slug as workflow_slug, w.current_version as workflow_version
        from ouroboros.analysis_suggestions s
        join ouroboros.analysis_runs r on r.id = s.last_run_id
        left join ouroboros."user" u on u."id" = s.resolved_by
        left join ouroboros.workflows w
          on w.organization_id = s.organization_id
         and s.action_binding ->> 'plane' = 'workflow'
         and w.slug = s.action_binding #>> '{change,workflow}'
       where s.organization_id = ${organizationId} and s.repo_ref = ${repoRef}
         and s.kind = any(${[...CARD_KINDS]}::text[])
         and ${STILL_CURRENT}
       order by s.confidence desc, s.title, s.id`.execute(this.database.db);

    return rows;
  }

  /**
   * The findings a set of suggestions cite — each suggestion's from the analysis that last
   * composed it, so the Details sheet shows the evidence the card's line was written from and not
   * an older run's copy of it.
   *
   * @param organizationId - The workspace.
   * @param suggestionIds - The suggestions.
   * @returns The findings, by suggestion and then by analyzer and subject. A suggestion whose
   *   findings retention has removed has none.
   */
  async findings(
    organizationId: string,
    suggestionIds: readonly string[],
  ): Promise<SuggestionFindingRow[]> {
    if (suggestionIds.length === 0) {
      return [];
    }

    const { rows } = await sql<SuggestionFindingRow>`
      select l.suggestion_id::text as suggestion_id, f.id::text as id, f.analyzer,
             f.analyzer_version, f.finding_type, f.subject_key, f.data, f.evidence_refs,
             f.confidence, f.confidence_basis
        from ouroboros.analysis_suggestion_findings l
        join ouroboros.analysis_suggestions s on s.id = l.suggestion_id
        join ouroboros.analysis_findings f on f.id = l.finding_id and f.run_id = s.last_run_id
       where l.organization_id = ${organizationId}
         and s.organization_id = ${organizationId}
         and l.suggestion_id = any(${[...suggestionIds]}::uuid[])
       order by l.suggestion_id, f.analyzer, f.subject_key, f.id`.execute(this.database.db);

    return rows;
  }
}

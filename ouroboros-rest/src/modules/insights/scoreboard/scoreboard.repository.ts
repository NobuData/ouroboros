/**
 * The model scoreboard's statement (BJ.3, [#439](https://github.com/NobuData/ouroboros/issues/439)):
 * one window's tallies per task kind × serving model × hop, from runs, resolutions, PRs and usage.
 *
 * ```
 * window_runs  runs with a loop PR merged, or usage recorded, inside the window
 *   └─ served  each (run, task kind)'s latest resolved snapshot → its serving hop
 *        ├─ merged  merged loop PRs per served row; untouched by I6's one predicate
 *        └─ usage   the run's usage recorded under that task kind: tokens, unpriced, priced cents
 *   ⇒ merged ⟗ usage
 * ```
 *
 * **The serving hop** is the last kept hop the executor tried (a tried hop carries `duration_ms`,
 * V024) — the executor moves to the next kept hop only when one fails — or, when no hop was timed,
 * the first kept hop. Its 1-based `index` in the chain, dropped hops included, is the row's `hop`.
 *
 * **Every statement is scoped to one workspace**: each table it reads filters on the workspace,
 * which `scoreboard.repository.spec.ts` asserts.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import { joinRepo, num, REPO_REF } from "../rollup/rollup.sql";
import { untouchedPr } from "../untouched.sql";
import type { ScoreboardTally } from "./scoreboard.types";

/** A window's bounds as instants: `[from, to)`. */
export interface InstantSpan {
  readonly from: Date;
  readonly to: Date;
}

/** One grouped row, as `pg` hands it back. */
interface TallyRow {
  task_kind: string;
  model_id: string;
  hop: number;
  merged: string;
  untouched: string;
  tokens: string;
  unpriced_tokens: string;
  cost_cents: string | null;
}

@Injectable()
export class ScoreboardRepository {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One window's tallies.
   *
   * @param organizationId - The workspace.
   * @param span - The window, `[from, to)`.
   * @param repo - One repository's `owner/name`, or undefined for the workspace.
   * @returns One tally per (task kind, model, hop) with a merge or usage in the window.
   */
  async tallies(
    organizationId: string,
    span: InstantSpan,
    repo?: string,
  ): Promise<ScoreboardTally[]> {
    const { from, to } = span;
    const repoScope =
      repo === undefined
        ? sql``
        : sql`join ouroboros.runs r on r.id = s.run_id ${joinRepo("r")}
               and ${REPO_REF} = ${repo}`;

    const { rows } = await sql<TallyRow>`
      with window_runs as (
        select pr.run_id
          from ouroboros.pull_requests pr
         where pr.organization_id = ${organizationId}
           and pr.run_id is not null and pr.state = 'merged'
           and pr.merged_at >= ${from} and pr.merged_at < ${to}
        union
        select tu.run_id
          from ouroboros.token_usage tu
         where tu.organization_id = ${organizationId}
           and tu.run_id is not null and tu.task_kind is not null
           and tu.occurred_at >= ${from} and tu.occurred_at < ${to}
      ),
      served as (
        select distinct on (s.run_id, s.task_kind) s.run_id, s.task_kind, hop.model_id, hop.hop
          from ouroboros.resolution_snapshots s
          join window_runs w on w.run_id = s.run_id
          ${repoScope}
          cross join lateral (
            select h ->> 'model_id' as model_id, (h ->> 'index')::int as hop
              from jsonb_array_elements(s.chain) h
             where h ->> 'decision' = 'kept'
             order by (h ->> 'duration_ms') is null,
                      case when (h ->> 'duration_ms') is null then (h ->> 'index')::int
                           else -(h ->> 'index')::int end
             limit 1
          ) hop
         where s.organization_id = ${organizationId} and s.outcome = 'resolved'
         order by s.run_id, s.task_kind, s.resolved_at desc, s.id desc
      ),
      merged as (
        select sv.task_kind, sv.model_id, sv.hop,
               count(*) as merged,
               count(*) filter (where ${untouchedPr("pr")}) as untouched
          from ouroboros.pull_requests pr
          join served sv on sv.run_id = pr.run_id
         where pr.organization_id = ${organizationId} and pr.state = 'merged'
           and pr.merged_at >= ${from} and pr.merged_at < ${to}
         group by 1, 2, 3
      ),
      usage as (
        select sv.task_kind, sv.model_id, sv.hop,
               sum(tu.tokens_in::bigint + tu.tokens_out) as tokens,
               coalesce(sum(tu.tokens_in::bigint + tu.tokens_out)
                          filter (where tu.cost_cents is null), 0) as unpriced_tokens,
               sum(tu.cost_cents) as cost_cents
          from ouroboros.token_usage tu
          join served sv on sv.run_id = tu.run_id and sv.task_kind = tu.task_kind
         where tu.organization_id = ${organizationId}
           and tu.occurred_at >= ${from} and tu.occurred_at < ${to}
         group by 1, 2, 3
      )
      select task_kind, model_id, hop,
             coalesce(merged, 0) as merged, coalesce(untouched, 0) as untouched,
             coalesce(tokens, 0) as tokens, coalesce(unpriced_tokens, 0) as unpriced_tokens,
             cost_cents
        from merged full join usage using (task_kind, model_id, hop)`.execute(this.database.db);

    return rows.map((row) => ({
      taskKind: row.task_kind,
      model: row.model_id,
      hop: Number(row.hop),
      merged: num(row.merged),
      untouched: num(row.untouched),
      tokens: num(row.tokens),
      unpricedTokens: num(row.unpriced_tokens),
      costCents: row.cost_cents === null ? null : Number(row.cost_cents),
    }));
  }
}

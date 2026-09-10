/**
 * The four statements behind `GET /api/v1/backlog`
 * (M.1, [#110](https://github.com/NobuData/ouroboros/issues/110)) — the rows, the counts, the
 * chip set, and, since M.3 ([#112](https://github.com/NobuData/ouroboros/issues/112)), the
 * queued issues the `queued` pill is drawn from.
 *
 * ## Every one of them is scoped to one workspace, in the statement
 *
 * `organization_id = $1` leads every read here, exactly as `runs.repository.ts` and
 * `dashboard.repository.ts` do it and for the ticket's own criterion: *"cross-org isolation
 * verified — another org's issues are unreachable regardless of parameters"*. Isolation that
 * held because a service remembered to compare afterwards would be one forgotten `if` away
 * from a leak; here it is a predicate the planner needs, and `listing.repository.spec.ts`
 * asserts it is present in every statement this class can compile.
 *
 * `?repo=` is a second predicate under that scope rather than an alternative to it, so a
 * repository id belonging to somebody else narrows to nothing instead of reaching anything.
 *
 * ## The filters are index-served, and each one has an index of its own
 *
 * V014 created three indexes and named this ticket in the comment above them, so the statements
 * below are written to enter through them:
 *
 * | The filter        | The predicate                          | The index                              |
 * |-------------------|----------------------------------------|----------------------------------------|
 * | workspace, repo, state | `organization_id`, `github_repo_id`, `state` | `github_issues_organization_repo_state_idx` |
 * | the chip set      | `labels @> '["bug","tech-debt"]'`      | `github_issues_labels_idx` (GIN)        |
 * | the search box    | `title ilike '%watchdog%'`             | `github_issues_title_trgm_idx` (GIN trigram) |
 *
 * **Label filtering is one containment test, not one per label.** `@>` against an array of
 * every selected name is the AND the ticket asks for, in a single indexable operator; a chain
 * of `labels @> '["bug"]' and labels @> '["tech-debt"]'` is the same answer with two index
 * probes and a planner that has to intersect them.
 *
 * ## The estimate is a lateral, because latest-wins is a per-row question
 *
 * Decision **K4** is that re-estimation writes a new row and the highest version wins, so a
 * plain join to `issue_estimates` would multiply a twice-estimated issue into two rows — the
 * seed's `#487` is exactly that fixture, and it exists to catch this. `left join lateral (…
 * order by version desc limit 1)` asks the question once per issue and reads it backwards off
 * `issue_estimates_issue_version_key`, which V026's header says is what makes latest-wins a
 * single indexed lookup rather than a `max()` and a second pass.
 *
 * `left` rather than `inner`, because an issue with no estimate is a row the table draws —
 * `unsized` and `estimating` are two of the four pills.
 *
 * ## What this file does not decide
 *
 * Defaults, mapping and the freshness stamp are `listing.service.ts`'s and
 * `listing.resources.ts`'s. This holds statements, which is what lets its spec assert the SQL
 * PostgreSQL would receive — where a missing `where` shows up — without a server.
 *
 * The fourth statement is the odd one and says so at its own definition: it reads `queue_items`
 * rather than `github_issues`, and it is a separate read rather than a join precisely so the
 * three plan-asserted statements above are the ones M.1 pinned.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Expression, type SqlBool } from "kysely";

import { DatabaseService } from "../db/db.service";
import {
  ISSUE_ESTIMATE_EFFORTS,
  SCHEMA_NAME,
  type EstimateEffort,
  type GithubIssueState,
  type SizingStatus,
} from "../db/schema";
import type { PageWindow } from "../tenancy/pagination";
import { asCount } from "../tenancy/queries";
import type { BacklogSort, BacklogStateFilter } from "./listing.dto";
import { searchTerms } from "./listing.search";

/** What the filter bar narrowed the backlog to. */
export interface BacklogFilter {
  /** `github_repos.id`, or `undefined` for the whole workspace. */
  readonly repoId?: string;
  /** Which states — already defaulted by the service, so there is no `undefined` case here. */
  readonly state: BacklogStateFilter;
  /** The chip set, ANDed. `undefined` when no chip is on. */
  readonly labels?: readonly string[];
  /** The search box, trimmed and non-empty, or `undefined`. */
  readonly search?: string;
}

/** One issue and the estimate in force, as the listing statement returns them. */
export interface BacklogListRow {
  /** `github_issues.id`. */
  readonly id: string;
  readonly number: number;
  readonly title: string;
  /** GitHub's label names. `pg` hands the `jsonb` column back already parsed. */
  readonly labels: string[];
  readonly state: GithubIssueState;
  readonly sizingStatus: SizingStatus;
  readonly githubRepoId: string;
  /** `owner/name`, assembled in the statement from `github_orgs.login` and `github_repos.name`. */
  readonly repository: string;
  /** The four estimate fields, all null together on an issue that has none. */
  readonly effort: EstimateEffort | null;
  readonly confidence: number | null;
  readonly suggestedWorkflow: string | null;
  readonly routedModel: string | null;
}

/** One issue the run queue holds, as the `queued` pill needs to recognise it. */
export interface QueuedIssueKey {
  /** `queue_items.github_repo_id`. */
  readonly githubRepoId: string;
  /** `queue_items.issue_number` — GitHub's, not a row id: the queue stores the number. */
  readonly number: number;
}

/** The page head's two figures, and how many rows the filter actually matched. */
export interface BacklogCounts {
  /** Rows matching the whole filter — the page's `total`. */
  readonly total: number;
  /** Open issues in scope, ignoring every row filter. See `listing.resources.ts`. */
  readonly openCount: number;
  /** How many of those are `sized`. */
  readonly sizedCount: number;
}

@Injectable()
export class BacklogListingRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One window of the workspace's backlog, in the requested order.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param filter - What the filter bar narrowed it to.
   * @param sort - Which of the four orderings.
   * @param window - Which rows of the match to return.
   * @returns The rows, each with the estimate in force or four nulls.
   */
  async list(
    organizationId: string,
    filter: BacklogFilter,
    sort: BacklogSort,
    window: PageWindow,
  ): Promise<BacklogListRow[]> {
    const unfiltered = this.scope(organizationId, filter.repoId)
      .innerJoin("github_repos", "github_repos.id", "github_issues.github_repo_id")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("issue_estimates")
            .select([
              "issue_estimates.effort as effort",
              "issue_estimates.confidence as confidence",
              "issue_estimates.suggested_workflow as suggestedWorkflow",
              "issue_estimates.routed_model as routedModel",
            ])
            .whereRef("issue_estimates.github_issue_id", "=", "github_issues.id")
            .orderBy("issue_estimates.version", "desc")
            .limit(1)
            .as("estimate"),
        (join) => join.onTrue(),
      )
      .select([
        "github_issues.id as id",
        "github_issues.number as number",
        "github_issues.title as title",
        "github_issues.labels as labels",
        "github_issues.state as state",
        "github_issues.sizing_status as sizingStatus",
        "github_issues.github_repo_id as githubRepoId",
        "estimate.effort as effort",
        "estimate.confidence as confidence",
        "estimate.suggestedWorkflow as suggestedWorkflow",
        "estimate.routedModel as routedModel",
        // `owner/name` in the statement rather than in TypeScript, for `estimation.repository.ts`'s
        // reason: the read stays one round trip and the assembly has nowhere else to live.
        sql<string>`${sql.ref("github_orgs.login")} || '/' || ${sql.ref("github_repos.name")}`.as(
          "repository",
        ),
      ])
      .orderBy(ORDERINGS[sort])
      // Two tie-breaks, and they answer different questions. `number` descending is the one a
      // person would choose — newest issue first, as GitHub lists a backlog. `id` is what makes
      // the order *total*: without it two rows equal on every key could swap between page 1 and
      // page 2, so a row would be shown twice and another not at all.
      .orderBy("github_issues.number", "desc")
      .orderBy("github_issues.id", "asc")
      .limit(window.limit)
      .offset(window.offset);

    // Applied one at a time rather than folded into a single `and`, so that a request naming no
    // filter at all compiles to the scope alone rather than to a `where true` the planner then
    // has to look past.
    return rowPredicates(filter)
      .reduce((query, predicate) => query.where(predicate), unfiltered)
      .execute();
  }

  /**
   * The page's `total`, and the page head's two figures — in one statement.
   *
   * **One pass, three aggregates**, which is the ticket's *"the page head and the freshness tag
   * read from the same query as the rows"* taken as far as a count can take it: the three
   * numbers describe the same instant, and no interleaved sync can leave a head disagreeing
   * with the total beside it. `count(*) filter (where …)` is what makes that possible;
   * `estimation.repository.ts` reaches for it for the same reason.
   *
   * **The two head figures ignore the row filters, deliberately.** The `where` is the scope —
   * workspace, and `?repo=` if one narrows it — and the state, chip set and search reach only
   * the `total`'s own `filter`. `listing.resources.ts` carries the argument: the head describes
   * the backlog and the table describes the filter.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param filter - What the filter bar narrowed it to.
   * @returns The three counts.
   */
  async counts(organizationId: string, filter: BacklogFilter): Promise<BacklogCounts> {
    const row = await this.scope(organizationId, filter.repoId)
      .select((eb) => {
        const predicates = rowPredicates(filter);
        const matching = eb.fn.countAll<string>();

        return [
          (predicates.length === 0 ? matching : matching.filterWhere(eb.and(predicates))).as(
            "total",
          ),
          eb.fn.countAll<string>().filterWhere("github_issues.state", "=", "open").as("openCount"),
          eb.fn
            .countAll<string>()
            .filterWhere(
              eb.and([
                eb("github_issues.state", "=", "open"),
                eb("github_issues.sizing_status", "=", "sized"),
              ]),
            )
            .as("sizedCount"),
        ];
      })
      .executeTakeFirstOrThrow();

    // `count()` arrives as a string: PostgreSQL counts in `bigint` and `pg` will not narrow
    // that silently. A backlog fits in a double many times over, which is `asCount`'s own note.
    return {
      total: asCount(row.total),
      openCount: asCount(row.openCount),
      sizedCount: asCount(row.sizedCount),
    };
  }

  /**
   * Every issue of this workspace the run queue holds — the `queued` pill's own read
   * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)).
   *
   * **A read of its own rather than a join onto the listing**, and there are two reasons.
   * A queue is *small* — tens of rows, bounded by what a workspace has committed the loop to —
   * so fetching all of its keys costs less than a correlated subquery evaluated per row, and it
   * runs concurrently with the other four reads instead of inside one of them. And the listing's
   * three statements were plan-asserted at volume by M.1
   * ([#110](https://github.com/NobuData/ouroboros/issues/110)); a subquery threaded into them
   * would change the plans that ticket's suite pins, to buy nothing a reader can see.
   *
   * **Matched on the repository as well as the number, deliberately.** `queue_items` is keyed
   * `(organization_id, issue_number)` and so holds one `#485` per workspace however many
   * repositories number one — V009's own over-reach, argued there. For *display* that key is
   * too wide: it would draw the pill on a second repository's `#485` that is not in the queue
   * and could not be. V009 says as much — *"`github_repo_id` disambiguates them for display"* —
   * so the pill uses the repository and the queue write's `409` uses the constraint's own key.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param repoId - The repository, or `undefined` for the whole workspace. The same narrowing
   *   the rows get, so a filtered listing does not read a queue it cannot draw.
   * @returns One key per queued issue. Empty for a workspace that has queued nothing.
   */
  async queuedIssues(organizationId: string, repoId?: string): Promise<QueuedIssueKey[]> {
    let query = this.database.db
      .selectFrom("queue_items")
      .select(["github_repo_id as githubRepoId", "issue_number as number"])
      .where("organization_id", "=", organizationId);

    if (repoId !== undefined) {
      query = query.where("github_repo_id", "=", repoId);
    }

    return query.execute();
  }

  /**
   * Every distinct label in scope, ascending — what the chip set is built from.
   *
   * Raw SQL rather than the builder, because the shape is a lateral over a set-returning
   * function: `jsonb_array_elements_text` turns one row's array into rows, and `distinct`
   * collapses them across the workspace. Kysely can express the join and cannot type the
   * function's output column, so writing it out is the honest version — and the schema is
   * qualified through `sql.id(SCHEMA_NAME)` exactly as `registry.repository.ts` does it, since
   * `WithSchemaPlugin` reaches the builder's tables and not a raw fragment's.
   *
   * **Scoped by the workspace and by `?repo=`, and by nothing else.** The chip set must not
   * shrink as chips are selected — see `listing.resources.ts` — so the labels, the state and
   * the search are deliberately absent from this statement.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param repoId - The repository, or `undefined` for the whole workspace.
   * @returns The names, ascending. Empty for a workspace whose issues carry no labels.
   */
  async labelFacets(organizationId: string, repoId?: string): Promise<string[]> {
    const { rows } = await sql<{ label: string }>`
      select distinct names.label
        from ${sql.id(SCHEMA_NAME)}.github_issues issues
             cross join lateral jsonb_array_elements_text(issues.labels) as names(label)
       where issues.organization_id = ${organizationId}
         and ${repoId === undefined ? sql`true` : sql`issues.github_repo_id = ${repoId}`}
       order by names.label asc
    `.execute(this.database.db);

    return rows.map((row) => row.label);
  }

  /**
   * The workspace, and the repository if one narrows it — the predicates every read shares.
   *
   * @param organizationId - The workspace.
   * @param repoId - The repository, or `undefined`.
   * @returns The select, ready for the rest of the statement.
   */
  private scope(organizationId: string, repoId?: string) {
    const query = this.database.db
      .selectFrom("github_issues")
      .where("github_issues.organization_id", "=", organizationId);

    return repoId === undefined ? query : query.where("github_issues.github_repo_id", "=", repoId);
  }
}

/**
 * The `order by` each sort compiles to, above the two tie-breaks {@link BacklogListingRepository.list}
 * appends.
 *
 * **`effort` is the chip order with unsized last**, and both halves are one clause:
 * `array_position` over `ISSUE_ESTIMATE_EFFORTS` maps `xs`–`xl` onto 1–5 — the list is declared
 * smallest-first in `schema.ts` precisely so an index into it is a rank — and an issue with no
 * estimate has no position, so `nulls last` is what *"unsized last"* means. Within one size the
 * most confident estimate leads, which is what makes the seeded fixture's order total: no two
 * of its nine issues share an `(effort, confidence)` pair.
 *
 * `nulls last` is written out on both descending keys. PostgreSQL's default for `desc` is
 * `nulls first`, so leaving it implicit would float every unestimated issue to the top of a
 * `confidence` sort — the opposite of the rule `effort` states.
 */
const ORDERINGS: Readonly<Record<BacklogSort, Expression<unknown>>> = {
  effort: sql`array_position(${[...ISSUE_ESTIMATE_EFFORTS]}::text[], ${sql.ref("estimate.effort")}) asc nulls last, ${sql.ref("estimate.confidence")} desc nulls last`,
  confidence: sql`${sql.ref("estimate.confidence")} desc nulls last`,
  updated: sql`${sql.ref("github_issues.gh_updated_at")} desc`,
  number: sql`${sql.ref("github_issues.number")} desc`,
};

/**
 * The state, the chip set and the search, as predicates.
 *
 * One function, called by both {@link BacklogListingRepository.list} and
 * {@link BacklogListingRepository.counts}, because *what the filter matches* has to mean the
 * same thing in the rows and in the `total` beside them — a page whose count came from a
 * slightly different `where` is a page number that is wrong at the end of the list.
 *
 * @param filter - What the filter bar narrowed the backlog to.
 * @returns The predicates, in index order — cheapest and most selective first. Empty when the
 *   request filtered on nothing but its scope, which `state=all` with no chips and no search is.
 */
function rowPredicates(filter: BacklogFilter): Expression<SqlBool>[] {
  const predicates: Expression<SqlBool>[] = [];

  // `all` is the absence of the predicate rather than `state in ('open', 'closed')`: the same
  // set, and the shorter question keeps the index prefix usable.
  if (filter.state !== "all") {
    predicates.push(sql<SqlBool>`${sql.ref("github_issues.state")} = ${filter.state}`);
  }

  if (filter.labels !== undefined && filter.labels.length > 0) {
    // One containment against the whole selection — the AND, as a single GIN probe. The array
    // is serialised here because `labels` is a `jsonb` column and the driver sends text.
    predicates.push(
      sql<SqlBool>`${sql.ref("github_issues.labels")} @> ${JSON.stringify([...filter.labels])}::jsonb`,
    );
  }

  if (filter.search !== undefined) {
    const { pattern, number } = searchTerms(filter.search);

    // The placeholder's three matches, as one disjunction: the title through the trigram index,
    // an exact label name through the GIN one, and the issue number when the text names one.
    //
    // **The label half is a name rather than a substring, and that is the indexable half of the
    // trade.** `labels ? 'watchdog'` is the operator `jsonb_ops` was chosen for — V014 says so —
    // while `jsonb_array_elements_text(labels) ilike '%watchdog%'` is a subquery per row that no
    // index can answer, and one unindexable disjunct makes the *whole* disjunction a scan. A
    // label name is a short token out of a set the chip set hands the client, so the substring
    // form buys very little and costs the plan.
    predicates.push(
      sql<SqlBool>`(${sql.ref("github_issues.title")} ilike ${pattern}
        or ${sql.ref("github_issues.labels")} ? ${filter.search}
        ${number === undefined ? sql`` : sql`or ${sql.ref("github_issues.number")} = ${number}`})`,
    );
  }

  return predicates;
}

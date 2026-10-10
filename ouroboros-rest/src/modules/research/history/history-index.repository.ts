/**
 * The issue & PR history index's reads, and imported document sets' rows (V119; CL.5,
 * [#618](https://github.com/NobuData/ouroboros/issues/618)).
 *
 * Every read goes through `history_index_entries` — canonical tickets, mirrored PRs and imported
 * documents in one shape — and **every read names the workspace first**: there is no method here
 * that takes an id or a locator without one, so no cross-workspace retrieval path exists.
 *
 * Nothing here knows a tracker. The view never reads `ticket_sources.kind`, and neither does this
 * file (decision V2): a ticket a Jira source fed and one GitHub fed are the same kind of row.
 *
 * Search, lookup and aggregation run under a statement timeout — the tool's declared latency
 * budget — so a slow index is a classified failure rather than a stalled investigation.
 */

import { Injectable } from "@nestjs/common";
import { sql, type RawBuilder, type Transaction } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { Database, DocumentImportFormat, HistoryIndexKind } from "../../db/schema";

/** The text-search configuration V119's `history_index_document()` uses. */
const CONFIG = sql`'english'::regconfig`;

/** How much of a body a search excerpt is cut from, in characters. */
const HEADLINE_CHARS = 20000;

/** The most rows one locator lookup answers — a locator is not a key (V119). */
export const MAX_LOCATOR_MATCHES = 10;

/** The most buckets an aggregate answers. */
export const MAX_BUCKETS = 50;

/** What `aggregate` may group by. */
export const AGGREGATE_GROUPS = ["label", "period", "kind", "repo", "set"] as const;

/** One of {@link AGGREGATE_GROUPS}. */
export type AggregateGroup = (typeof AGGREGATE_GROUPS)[number];

/** The periods a `period` aggregate buckets by. */
export const AGGREGATE_PERIODS = ["day", "week", "month"] as const;

/** One of {@link AGGREGATE_PERIODS}. */
export type AggregatePeriod = (typeof AGGREGATE_PERIODS)[number];

/** The kinds an aggregate counts — a set is a container, not an item. */
export const COUNTED_KINDS: readonly HistoryIndexKind[] = ["ticket", "pr", "document"];

/** The bucket key of an entry with no repository. */
export const NO_REPO = "(none)";

/** One row of the corpus. */
export interface IndexEntry {
  readonly kind: HistoryIndexKind;
  readonly entryId: string;
  /** Where it came from: the source's slug, or `<collection>/<name>`. */
  readonly setKey: string;
  readonly locator: string;
  /** What a person calls it — `#482`, `PROJ-142`, `acct-07`. */
  readonly ref: string;
  readonly title: string;
  readonly body: string | null;
  readonly state: string | null;
  readonly labels: readonly string[];
  readonly author: string | null;
  readonly repo: string | null;
  readonly url: string | null;
  readonly occurredAt: Date;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** A search hit: the entry, how well it matched, and the passage that did. */
export interface SearchHit extends IndexEntry {
  /** 0–1; higher is a better match. */
  readonly rank: number;
  /** Whether it matched every term of the query, not just some. */
  readonly complete: boolean;
  /** The matching passage. */
  readonly excerpt: string;
}

/** How the corpus is narrowed. Every field is optional; absent means unfiltered. */
export interface IndexFilters {
  readonly kinds?: readonly HistoryIndexKind[];
  /** Entries carrying any of these labels. */
  readonly labels?: readonly string[];
  /** Entries dated at or after this instant. */
  readonly since?: Date;
  /** Entries dated before this instant. */
  readonly until?: Date;
  readonly repo?: string;
  /** A source's slug, or an imported set's `<collection>/<name>`. */
  readonly set?: string;
}

/** One bucket of an aggregate. */
export interface AggregateBucket {
  readonly key: string;
  readonly count: number;
}

/** An aggregate, and the entries its largest buckets are cited by. */
export interface AggregateResult {
  /** Largest first — or, for `period`, oldest first. At most {@link MAX_BUCKETS}. */
  readonly buckets: readonly AggregateBucket[];
  /** How many entries were counted. An entry with two labels is in two buckets and counted once. */
  readonly total: number;
  /** The newest entries of the leading buckets, each with the bucket it is in. */
  readonly evidence: readonly (IndexEntry & { readonly bucket: string })[];
}

/** What an aggregate asks. */
export interface AggregateQuery {
  readonly groupBy: AggregateGroup;
  /** The bucket width of a `period` aggregate. */
  readonly period: AggregatePeriod;
  /** Count only entries mentioning every term of this; null counts all. */
  readonly q: string | null;
  readonly filters: IndexFilters;
  /** How many leading buckets are cited, and by how many entries each. */
  readonly citedBuckets: number;
  readonly citedPerBucket: number;
}

/** What the tools card's sub-line counts. */
export interface IndexSummary {
  readonly tickets: number;
  readonly pullRequests: number;
  readonly documents: number;
  /** The imported sets' titles, newest first. */
  readonly sets: readonly string[];
}

/** An imported set. */
export interface DocumentImportRow {
  readonly id: string;
  readonly collection: string;
  readonly name: string;
  readonly title: string;
  readonly description: string | null;
  readonly format: DocumentImportFormat;
  readonly contentHash: string;
  readonly importedBy: string | null;
  readonly createdAt: Date;
  readonly documents: number;
}

/** A document of an imported set. */
export interface DocumentImportItemRow {
  readonly id: string;
  readonly position: number;
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly occurredAt: Date | null;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** A set to write. */
export interface NewDocumentImport {
  readonly organizationId: string;
  readonly collection: string;
  readonly name: string;
  readonly title: string;
  readonly description: string | null;
  readonly format: DocumentImportFormat;
  readonly contentHash: string;
  readonly importedBy: string | null;
  readonly documents: readonly {
    readonly key: string;
    readonly title: string;
    readonly body: string;
    readonly labels: readonly string[];
    readonly occurredAt: Date | null;
    readonly meta: Readonly<Record<string, unknown>>;
  }[];
}

/** A row of the view, as selected. */
interface EntryRecord {
  kind: HistoryIndexKind;
  entry_id: string;
  set_key: string;
  locator: string;
  ref: string;
  title: string;
  body: string | null;
  state: string | null;
  labels: string[];
  author: string | null;
  repo: string | null;
  url: string | null;
  occurred_at: Date;
  meta: Record<string, unknown>;
}

/** The view's columns a read selects — everything but the workspace and the tsvector. */
const COLUMNS = sql`e.kind, e.entry_id, e.set_key, e.locator, e.ref, e.title, e.body, e.state,
  e.labels, e.author, e.repo, e.url, e.occurred_at, e.meta`;

@Injectable()
export class HistoryIndexRepository {
  /** @param database - The database. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Full-text search over the workspace's corpus, best match first.
   *
   * An entry matches when it mentions **any** term of the query; those mentioning **every** term
   * come first, then by rank (title above body), then newest.
   *
   * @param organizationId - The workspace.
   * @param q - What to look for, in plain words.
   * @param filters - Kind, label, date, repository and set.
   * @param limit - The most hits.
   * @param budgetMs - The statement timeout.
   * @returns The hits; empty when nothing matches, or the query is only stop words.
   */
  async search(
    organizationId: string,
    q: string,
    filters: IndexFilters,
    limit: number,
    budgetMs: number,
  ): Promise<SearchHit[]> {
    const every = sql`plainto_tsquery(${CONFIG}, ${q})`;
    const some = sql`replace(plainto_tsquery(${CONFIG}, ${q})::text, '&', '|')::tsquery`;

    const rows = await this.budgeted(budgetMs, (trx) =>
      sql<EntryRecord & { rank: number; complete: boolean; excerpt: string }>`
        select hit.*,
               ts_headline(${CONFIG}, left(coalesce(hit.body, hit.title), ${HEADLINE_CHARS}), ${some},
                 'MaxFragments=2, MaxWords=40, MinWords=10, StartSel="", StopSel="", FragmentDelimiter=" … "')
                 as excerpt
          from (
            select ${COLUMNS},
                   (e.document @@ ${every}) as complete,
                   ts_rank_cd(e.document, ${some}, 32) as rank
              from ouroboros.history_index_entries e
             where e.organization_id = ${organizationId}
               and e.document @@ ${some}
               ${narrowed(filters)}
             order by complete desc, rank desc, e.occurred_at desc, e.locator
             limit ${limit}
          ) hit
         order by hit.complete desc, hit.rank desc, hit.occurred_at desc, hit.locator
      `.execute(trx),
    );

    return rows.rows.map((row) => ({
      ...entryOf(row),
      rank: Number(row.rank),
      complete: row.complete,
      excerpt: row.excerpt,
    }));
  }

  /**
   * The entries a locator names in the workspace.
   *
   * @param organizationId - The workspace.
   * @param locator - `issue-index://…`.
   * @param budgetMs - The statement timeout.
   * @returns Usually one entry; none when the workspace has no such entry; several when two
   *   sources' names slug alike (V119) — at most {@link MAX_LOCATOR_MATCHES}.
   */
  async get(organizationId: string, locator: string, budgetMs: number): Promise<IndexEntry[]> {
    const rows = await this.budgeted(budgetMs, (trx) =>
      sql<EntryRecord>`
        select ${COLUMNS}
          from ouroboros.history_index_entries e
         where e.organization_id = ${organizationId}
           and e.locator = ${locator}
         order by e.kind, e.occurred_at desc, e.entry_id
         limit ${MAX_LOCATOR_MATCHES}
      `.execute(trx),
    );

    return rows.rows.map(entryOf);
  }

  /**
   * Count the workspace's entries by label, period, kind, repository or set.
   *
   * @param organizationId - The workspace.
   * @param query - What to group by, what to count, and how much to cite.
   * @param budgetMs - The statement timeout, per statement.
   * @returns The buckets, the number of entries counted, and the leading buckets' newest entries.
   */
  async aggregate(
    organizationId: string,
    query: AggregateQuery,
    budgetMs: number,
  ): Promise<AggregateResult> {
    const { groupBy, filters } = query;
    const kinds = (filters.kinds ?? COUNTED_KINDS).filter((kind) => COUNTED_KINDS.includes(kind));
    const mentioning =
      query.q === null ? sql`` : sql`and e.document @@ plainto_tsquery(${CONFIG}, ${query.q})`;
    const matching = sql`
      e.organization_id = ${organizationId}
      ${mentioning}
      ${narrowed({ ...filters, kinds })}`;

    // A label aggregate counts each label an entry carries — narrowed to the labels asked for,
    // so "these seven themes" answers seven buckets and not every label beside them.
    const labelled = groupBy === "label";
    const from = labelled
      ? sql`ouroboros.history_index_entries e
            cross join lateral jsonb_array_elements_text(e.labels) as tag (label)`
      : sql`ouroboros.history_index_entries e`;
    const only =
      labelled && filters.labels !== undefined && filters.labels.length > 0
        ? sql`and tag.label = any(${sql.val([...filters.labels])}::text[])`
        : sql``;
    // An entry with no label is in no bucket, so it is not in a label aggregate's total either.
    const bucketed =
      labelled && (filters.labels === undefined || filters.labels.length === 0)
        ? sql`and jsonb_array_length(e.labels) > 0`
        : sql``;
    const key = bucketKey(groupBy, query.period);
    const order = groupBy === "period" ? sql`bucket` : sql`count(*) desc, bucket`;

    return this.budgeted(budgetMs, async (trx) => {
      const buckets = await sql<{ bucket: string; count: string }>`
        select ${key} as bucket, count(*) as count
          from ${from}
         where ${matching} ${only}
         group by bucket
         order by ${order}
         limit ${MAX_BUCKETS}
      `.execute(trx);

      if (buckets.rows.length === 0) return { buckets: [], total: 0, evidence: [] };

      const total = await sql<{ count: string }>`
        select count(*) as count
          from ouroboros.history_index_entries e
         where ${matching} ${bucketed}
      `.execute(trx);

      const cited = buckets.rows.slice(0, query.citedBuckets).map((row) => row.bucket);
      const evidence = await sql<EntryRecord & { bucket: string }>`
        select *
          from (
            select ${COLUMNS}, ${key} as bucket,
                   row_number() over (partition by ${key}
                                          order by e.occurred_at desc, e.locator) as place
              from ${from}
             where ${matching} ${only}
          ) newest
         where newest.bucket = any(${sql.val(cited)}::text[])
           and newest.place <= ${query.citedPerBucket}
         order by array_position(${sql.val(cited)}::text[], newest.bucket), newest.place
      `.execute(trx);

      return {
        buckets: buckets.rows.map((row) => ({ key: row.bucket, count: Number(row.count) })),
        total: Number(total.rows[0]?.count ?? 0),
        evidence: evidence.rows.map((row) => ({ ...entryOf(row), bucket: row.bucket })),
      };
    });
  }

  /**
   * What the workspace's index holds — the tools card's sub-line.
   *
   * @param organizationId - The workspace.
   * @returns Tickets, PRs and imported documents counted, and the imported sets' titles.
   */
  async summary(organizationId: string): Promise<IndexSummary> {
    const [counts, sets] = await Promise.all([
      this.database.db
        .selectFrom("history_index_entries")
        .select((eb) => [
          eb.fn.countAll<string>().filterWhere("kind", "=", "ticket").as("tickets"),
          eb.fn.countAll<string>().filterWhere("kind", "=", "pr").as("pull_requests"),
          eb.fn.countAll<string>().filterWhere("kind", "=", "document").as("documents"),
        ])
        .where("organization_id", "=", organizationId)
        .executeTakeFirstOrThrow(),
      this.database.db
        .selectFrom("document_imports")
        .select("title")
        .where("organization_id", "=", organizationId)
        .orderBy("created_at", "desc")
        .orderBy("id")
        .execute(),
    ]);

    return {
      tickets: Number(counts.tickets),
      pullRequests: Number(counts.pull_requests),
      documents: Number(counts.documents),
      sets: sets.map((set) => set.title),
    };
  }

  /**
   * The workspace's imported sets, newest first.
   *
   * @param organizationId - The workspace.
   * @returns The sets, each with its document count.
   */
  async listImports(organizationId: string): Promise<DocumentImportRow[]> {
    const rows = await this.imports().where("d.organization_id", "=", organizationId).execute();

    return rows.map(importOf);
  }

  /**
   * One imported set of the workspace.
   *
   * @param organizationId - The workspace.
   * @param importId - The set.
   * @returns The set, or undefined when the workspace has none by that id.
   */
  async findImport(
    organizationId: string,
    importId: string,
  ): Promise<DocumentImportRow | undefined> {
    const row = await this.imports()
      .where("d.organization_id", "=", organizationId)
      .where("d.id", "=", importId)
      .executeTakeFirst();

    return row === undefined ? undefined : importOf(row);
  }

  /**
   * A set's documents, in file order.
   *
   * @param organizationId - The workspace.
   * @param importId - The set.
   * @returns Its documents.
   */
  async listItems(organizationId: string, importId: string): Promise<DocumentImportItemRow[]> {
    const rows = await this.database.db
      .selectFrom("document_import_items")
      .select(["id", "position", "item_key", "title", "body", "labels", "occurred_at", "meta"])
      .where("organization_id", "=", organizationId)
      .where("import_id", "=", importId)
      .orderBy("position")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      position: row.position,
      key: row.item_key,
      title: row.title,
      body: row.body,
      labels: row.labels,
      occurredAt: row.occurred_at,
      meta: row.meta,
    }));
  }

  /**
   * Write a set and its documents, together.
   *
   * @param set - The set.
   * @returns Its id.
   * @throws The unique violation `document_imports_locator_key` when the workspace already has a
   *   set at that collection and name.
   */
  async insertImport(set: NewDocumentImport): Promise<string> {
    return this.database.transaction(async (trx) => {
      const { id } = await trx
        .insertInto("document_imports")
        .values({
          organization_id: set.organizationId,
          collection: set.collection,
          name: set.name,
          title: set.title,
          description: set.description,
          format: set.format,
          content_hash: set.contentHash,
          imported_by: set.importedBy,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      // In batches: 2 000 documents of nine parameters each would pass the driver's bound.
      for (let start = 0; start < set.documents.length; start += 500) {
        await trx
          .insertInto("document_import_items")
          .values(
            set.documents.slice(start, start + 500).map((document, offset) => ({
              import_id: id,
              organization_id: set.organizationId,
              position: start + offset + 1,
              item_key: document.key,
              title: document.title,
              body: document.body,
              labels: JSON.stringify(document.labels),
              occurred_at: document.occurredAt,
              meta: JSON.stringify(document.meta),
            })),
          )
          .execute();
      }

      return id;
    });
  }

  /**
   * Remove a set and its documents.
   *
   * @param organizationId - The workspace.
   * @param importId - The set.
   * @returns Whether the workspace had it.
   */
  async deleteImport(organizationId: string, importId: string): Promise<boolean> {
    const result = await this.database.db
      .deleteFrom("document_imports")
      .where("organization_id", "=", organizationId)
      .where("id", "=", importId)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }

  private imports() {
    return this.database.db
      .selectFrom("document_imports as d")
      .select((eb) => [
        "d.id",
        "d.collection",
        "d.name",
        "d.title",
        "d.description",
        "d.format",
        "d.content_hash",
        "d.imported_by",
        "d.created_at",
        eb
          .selectFrom("document_import_items as i")
          .select((count) => count.fn.countAll<string>().as("n"))
          .whereRef("i.import_id", "=", "d.id")
          .as("documents"),
      ])
      .orderBy("d.created_at", "desc")
      .orderBy("d.id");
  }

  /**
   * Run reads under the latency budget.
   *
   * @param budgetMs - The statement timeout for each statement in `work`.
   * @param work - The reads.
   * @returns What they answered.
   * @throws PostgreSQL's `57014` (query canceled) when a statement outlives the budget.
   */
  private budgeted<T>(
    budgetMs: number,
    work: (trx: Transaction<Database>) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (trx) => {
      await sql`select set_config('statement_timeout', ${String(budgetMs)}, true)`.execute(trx);

      return work(trx);
    });
  }
}

/**
 * The filters, as `and …` clauses over `e`.
 *
 * @param filters - What to narrow by.
 * @returns The clauses; empty for no filter.
 */
function narrowed(filters: IndexFilters): RawBuilder<unknown> {
  const clauses: RawBuilder<unknown>[] = [];

  if (filters.kinds !== undefined) {
    clauses.push(sql`and e.kind = any(${sql.val([...filters.kinds])}::text[])`);
  }
  if (filters.labels !== undefined && filters.labels.length > 0) {
    clauses.push(sql`and jsonb_exists_any(e.labels, ${sql.val([...filters.labels])}::text[])`);
  }
  if (filters.since !== undefined) clauses.push(sql`and e.occurred_at >= ${filters.since}`);
  if (filters.until !== undefined) clauses.push(sql`and e.occurred_at < ${filters.until}`);
  if (filters.repo !== undefined) clauses.push(sql`and lower(e.repo) = lower(${filters.repo})`);
  if (filters.set !== undefined) clauses.push(sql`and e.set_key = ${filters.set}`);

  return sql.join(clauses, sql` `);
}

/**
 * The expression an aggregate groups by.
 *
 * @param groupBy - The grouping.
 * @param period - The bucket width, for `period`.
 * @returns SQL over `e` (and `tag`, for `label`) yielding the bucket's key as text.
 */
function bucketKey(groupBy: AggregateGroup, period: AggregatePeriod): RawBuilder<unknown> {
  switch (groupBy) {
    case "label":
      return sql`tag.label`;
    case "period":
      // UTC, so a bucket is the same bucket whoever asks. A week starts on its Monday.
      return sql`to_char(date_trunc(${sql.lit(period)}, e.occurred_at at time zone 'UTC'), 'YYYY-MM-DD')`;
    case "kind":
      return sql`e.kind`;
    case "repo":
      return sql`coalesce(e.repo, ${sql.lit(NO_REPO)})`;
    case "set":
      return sql`e.set_key`;
  }
}

function entryOf(row: EntryRecord): IndexEntry {
  return {
    kind: row.kind,
    entryId: row.entry_id,
    setKey: row.set_key,
    locator: row.locator,
    ref: row.ref,
    title: row.title,
    body: row.body,
    state: row.state,
    labels: row.labels,
    author: row.author,
    repo: row.repo,
    url: row.url,
    occurredAt: row.occurred_at,
    meta: row.meta,
  };
}

function importOf(row: {
  id: string;
  collection: string;
  name: string;
  title: string;
  description: string | null;
  format: DocumentImportFormat;
  content_hash: string;
  imported_by: string | null;
  created_at: Date;
  documents: string | null;
}): DocumentImportRow {
  return {
    id: row.id,
    collection: row.collection,
    name: row.name,
    title: row.title,
    description: row.description,
    format: row.format,
    contentHash: row.content_hash,
    importedBy: row.imported_by,
    createdAt: row.created_at,
    documents: Number(row.documents ?? 0),
  };
}

/**
 * An in-memory history index for the `tickets` tool's suites (CL.5,
 * [#618](https://github.com/NobuData/ouroboros/issues/618)) — the repository's four reads over an
 * array, with the same ordering rules, and no database.
 *
 * It matches words rather than stems (a term matches a word it begins), which is enough to prove
 * what the tool does with an answer. What PostgreSQL does with a query is
 * `history-index.integration-spec.ts`'s.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { HistoryIndexKind } from "../../db/schema";
import {
  COUNTED_KINDS,
  MAX_BUCKETS,
  MAX_LOCATOR_MATCHES,
  NO_REPO,
  type AggregateQuery,
  type AggregateResult,
  type IndexEntry,
  type IndexFilters,
  type IndexSummary,
  type SearchHit,
} from "./history-index.repository";

/** The workspace the fixture corpus belongs to, and one that holds nothing. */
export const INDEX_ORG = "org-history";
export const OTHER_ORG = "org-elsewhere";

/** An entry and the workspace it belongs to. */
export interface StoredEntry extends IndexEntry {
  readonly organizationId: string;
}

/**
 * An entry with defaults.
 *
 * @param fields - What differs — at least a locator and a title.
 * @returns The entry, in {@link INDEX_ORG} unless said otherwise.
 */
export function entry(
  fields: Partial<StoredEntry> & Pick<StoredEntry, "locator" | "title">,
): StoredEntry {
  const segments = fields.locator.replace("issue-index://", "").split("/");

  return {
    organizationId: INDEX_ORG,
    kind: "ticket",
    entryId: `e-${fields.locator}`,
    setKey: segments[0],
    ref: segments[segments.length - 1],
    body: null,
    state: "open",
    labels: [],
    author: null,
    repo: null,
    url: null,
    occurredAt: new Date("2026-08-01T00:00:00Z"),
    meta: {},
    ...fields,
  };
}

/**
 * Mockup 22's corpus in miniature: a GitHub-fed ticket, a second tracker's, a PR, and the churn
 * interviews — a set and two of its documents.
 *
 * @returns The entries.
 */
export function fixtureCorpus(): StoredEntry[] {
  return [
    entry({
      locator: "issue-index://github-acme-robotics/498",
      ref: "#498",
      title: "Docking abort in crosswind above 6 m/s",
      body: "The approach controller aborts docking when gusts exceed the fixed gain margin.",
      labels: ["bug", "docking"],
      author: "maya-chen",
      repo: "helios-firmware",
      url: "https://github.com/acme-robotics/helios-firmware/issues/498",
      occurredAt: new Date("2026-08-20T10:00:00Z"),
    }),
    entry({
      locator: "issue-index://support/SUP-2214",
      ref: "SUP-2214",
      title: "Docking aborts on coastal sites",
      body: "Customer reports the unit aborting docking in moderate wind and waiting at loiter.",
      state: "closed",
      labels: ["docking", "support"],
      author: "field-support",
      url: "https://support.example.com/tickets/SUP-2214",
      occurredAt: new Date("2026-09-02T08:00:00Z"),
    }),
    entry({
      locator: "issue-index://support/SUP-2301",
      ref: "SUP-2301",
      title: "Battery estimate wrong in the cold",
      body: "Remaining-flight estimate drops sharply on cold mornings.",
      state: "closed",
      labels: ["battery", "support"],
      occurredAt: new Date("2026-09-10T08:00:00Z"),
    }),
    entry({
      kind: "pr",
      locator: "issue-index://github-acme-robotics/pull/512",
      ref: "#512",
      title: "dock: retry the approach after an abort",
      state: "merged",
      repo: "helios-firmware",
      url: "https://github.com/acme-robotics/helios-firmware/pull/512",
      occurredAt: new Date("2026-09-05T12:00:00Z"),
    }),
    entry({
      kind: "document_set",
      locator: "issue-index://support/churn-2026-q2",
      setKey: "support/churn-2026-q2",
      title: "Support churn interviews Q2",
      body: 'Exit interviews with churned accounts. 9 of 14 cite docking reliability; several said the drone "gives up" after one abort.',
      state: null,
      occurredAt: new Date("2026-07-01T00:00:00Z"),
      meta: { format: "csv", documents: 14 },
    }),
    entry({
      kind: "document",
      locator: "issue-index://support/churn-2026-q2/acct-01",
      setKey: "support/churn-2026-q2",
      title: "Churn interview — Northwind Survey",
      body: "Docking reliability was the reason. The drone aborts the approach and gives up.",
      state: null,
      labels: ["docking"],
      occurredAt: new Date("2026-04-08T00:00:00Z"),
      meta: { account: "Northwind Survey" },
    }),
    entry({
      kind: "document",
      locator: "issue-index://support/churn-2026-q2/acct-03",
      setKey: "support/churn-2026-q2",
      title: "Churn interview — Cascade Timber",
      body: "Battery estimates were wrong on cold mornings.",
      state: null,
      labels: ["battery"],
      occurredAt: new Date("2026-04-21T00:00:00Z"),
      meta: { account: "Cascade Timber" },
    }),
  ];
}

const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The in-memory index. */
export class MemoryHistoryIndex {
  /** Every read made, in order — `[organizationId, operation]`. */
  readonly reads: [string, string][] = [];

  /** @param entries - The corpus, across workspaces. */
  constructor(readonly entries: StoredEntry[] = fixtureCorpus()) {}

  private scoped(organizationId: string, filters: IndexFilters): StoredEntry[] {
    return this.entries.filter(
      (item) =>
        item.organizationId === organizationId &&
        (filters.kinds === undefined || filters.kinds.includes(item.kind)) &&
        (filters.labels === undefined ||
          filters.labels.length === 0 ||
          filters.labels.some((label) => item.labels.includes(label))) &&
        (filters.since === undefined || item.occurredAt >= filters.since) &&
        (filters.until === undefined || item.occurredAt < filters.until) &&
        (filters.repo === undefined || item.repo?.toLowerCase() === filters.repo.toLowerCase()) &&
        (filters.set === undefined || item.setKey === filters.set),
    );
  }

  private static mentions(
    item: StoredEntry,
    q: string,
  ): { title: number; body: number; of: number } {
    const terms = words(q);
    const count = (text: string | null): number =>
      terms.filter((term) => words(text ?? "").some((word) => word.startsWith(term))).length;
    const any = terms.filter((term) =>
      words(`${item.title} ${item.body ?? ""}`).some((word) => word.startsWith(term)),
    ).length;

    return { title: count(item.title), body: any - count(item.title), of: terms.length };
  }

  search(
    organizationId: string,
    q: string,
    filters: IndexFilters,
    limit: number,
  ): Promise<SearchHit[]> {
    this.reads.push([organizationId, "search"]);

    const hits = this.scoped(organizationId, filters)
      .map((item) => ({ item, match: MemoryHistoryIndex.mentions(item, q) }))
      .filter(({ match }) => match.title + match.body > 0)
      .map(({ item, match }) => {
        const { organizationId: _organization, ...found } = item;
        const score = match.title + match.body * 0.4;

        return {
          ...found,
          rank: score / (score + 1),
          complete: match.title + match.body === match.of,
          excerpt: item.body ?? item.title,
        };
      })
      .sort(
        (a, b) =>
          Number(b.complete) - Number(a.complete) ||
          b.rank - a.rank ||
          b.occurredAt.getTime() - a.occurredAt.getTime() ||
          a.locator.localeCompare(b.locator),
      );

    return Promise.resolve(hits.slice(0, limit));
  }

  get(organizationId: string, locator: string): Promise<IndexEntry[]> {
    this.reads.push([organizationId, "get"]);

    return Promise.resolve(
      this.entries
        .filter((item) => item.organizationId === organizationId && item.locator === locator)
        .slice(0, MAX_LOCATOR_MATCHES)
        .map(({ organizationId: _organization, ...found }) => found),
    );
  }

  aggregate(organizationId: string, query: AggregateQuery): Promise<AggregateResult> {
    this.reads.push([organizationId, "aggregate"]);

    const kinds = (query.filters.kinds ?? COUNTED_KINDS).filter((kind: HistoryIndexKind) =>
      COUNTED_KINDS.includes(kind),
    );
    const named = query.filters.labels ?? [];
    const matched = this.scoped(organizationId, { ...query.filters, kinds }).filter((item) => {
      const match = query.q === null ? null : MemoryHistoryIndex.mentions(item, query.q);
      return match === null || match.title + match.body === match.of;
    });

    const keysOf = (item: StoredEntry): string[] => {
      switch (query.groupBy) {
        case "label":
          return item.labels.filter((label) => named.length === 0 || named.includes(label));
        case "period": {
          const day = new Date(item.occurredAt);
          if (query.period === "month") day.setUTCDate(1);
          if (query.period === "week")
            day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
          return [day.toISOString().slice(0, 10)];
        }
        case "kind":
          return [item.kind];
        case "repo":
          return [item.repo ?? NO_REPO];
        case "set":
          return [item.setKey];
      }
    };

    const members = new Map<string, StoredEntry[]>();
    for (const item of matched) {
      for (const key of keysOf(item)) members.set(key, [...(members.get(key) ?? []), item]);
    }

    const buckets = [...members.entries()]
      .map(([key, items]) => ({ key, count: items.length }))
      .sort((a, b) =>
        query.groupBy === "period"
          ? a.key.localeCompare(b.key)
          : b.count - a.count || a.key.localeCompare(b.key),
      )
      .slice(0, MAX_BUCKETS);

    const evidence = buckets.slice(0, query.citedBuckets).flatMap((bucket) =>
      [...(members.get(bucket.key) ?? [])]
        .sort(
          (a, b) =>
            b.occurredAt.getTime() - a.occurredAt.getTime() || a.locator.localeCompare(b.locator),
        )
        .slice(0, query.citedPerBucket)
        .map(({ organizationId: _organization, ...found }) => ({ ...found, bucket: bucket.key })),
    );

    return Promise.resolve({
      buckets,
      total: matched.filter((item) => keysOf(item).length > 0).length,
      evidence,
    });
  }

  summary(organizationId: string): Promise<IndexSummary> {
    this.reads.push([organizationId, "summary"]);

    const own = this.entries.filter((item) => item.organizationId === organizationId);
    const count = (kind: HistoryIndexKind): number =>
      own.filter((item) => item.kind === kind).length;

    return Promise.resolve({
      tickets: count("ticket"),
      pullRequests: count("pr"),
      documents: count("document"),
      sets: own.filter((item) => item.kind === "document_set").map((item) => item.title),
    });
  }
}

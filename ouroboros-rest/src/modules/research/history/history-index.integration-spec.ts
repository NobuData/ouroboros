import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import type { ErrorEnvelope } from "../../errors/error.envelope";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import {
  InMemoryTicketSourceProvider,
  InMemoryTracker,
  IN_MEMORY_PROJECT,
} from "../../ticket-sources/providers/in-memory.provider.fixture";
import { cycleWith } from "../../ticket-sources/ticket-sync.integration.fixture";
import {
  supportsQuery,
  type ToolCallContext,
  type ToolResult,
} from "../tools/research-tool.adapter";
import { resultViolations } from "../tools/research-tool.citations";
import { ResearchToolError } from "../tools/research-tool.errors";
import { renderSubLine } from "../tools/research-tool.health";
import { ResearchToolRegistry } from "../tools/research-tool.registry";
import {
  CHURN_CSV,
  CHURN_DOCKING,
  CHURN_DOCUMENTS,
  CHURN_LOCATOR,
  CHURN_SET,
} from "./document-import.fixture";
import { DOCUMENT_IMPORT_ERRORS } from "./document-imports.errors";
import type {
  DocumentImportDetailResource,
  DocumentImportListResource,
} from "./document-imports.resources";
import { HistoryIndexRepository } from "./history-index.repository";

/**
 * The issue & PR history index against a migrated database (CL.5,
 * [#618](https://github.com/NobuData/ouroboros/issues/618)).
 *
 * The unit suites run the tool over an index in memory; what only PostgreSQL can say is here, and
 * it is the issue's acceptance criteria:
 *
 *   * **Full-text search returns ranked `issue-index://` hits with excerpts** — stemming, title
 *     above body, every-term matches first.
 *   * **A ticket ingested through a second tracker's adapter is indistinguishable from a
 *     GitHub-sourced one** — the pluggability proof. The second tracker is Q.5's in-memory
 *     provider, through the real sync loop.
 *   * **A churn-interview import round-trips** over HTTP and is citable at mockup 22's locator.
 *   * **`aggregate` reproduces a theme count**, and **the sub-line matches the indexed corpus**.
 *   * **Cross-workspace retrieval returns nothing.**
 *   * **Search stays inside the tool's declared budget** over 3 412 tickets — mockup 22's count —
 *     and a statement that outlives the budget is cancelled.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const IMPORTS = "/api/v1/research/document-imports";

/** The seven themes RS-124 clusters support tickets into, and how many tickets each gets. */
const THEMES = ["docking", "battery", "telemetry", "ota", "recovery", "gusts", "pairing"] as const;

interface Hit {
  locator: string;
  kind: string;
  title: string;
  excerpt: string;
  rank: number;
  matchedEveryTerm: boolean;
  [field: string]: unknown;
}

describe("the issue & PR history index, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    // A day, so the application's own sync loop cannot fire a cycle in the middle of a test.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  /** The registered tool — proof the module wires the adapter to the real index. */
  function tool() {
    const adapter = api.nest.get(ResearchToolRegistry).get("tickets");
    if (!supportsQuery(adapter)) throw new Error("the tickets tool does not declare query");

    return {
      adapter,
      query: (organizationId: string, structured: Record<string, unknown>): Promise<ToolResult> => {
        const context: ToolCallContext = {
          organizationId,
          investigationId: "00000000-0000-4000-8000-000000000000",
          config: {},
          secret: null,
          tokenCeiling: null,
        };

        return adapter.query(context, structured);
      },
    };
  }

  /** A workspace and its owner. */
  async function space(): Promise<Workspace & { owner: Person }> {
    const owner = await api.signIn();

    return { ...(await api.workspace(owner)), owner };
  }

  /**
   * A ticket source row.
   *
   * @param organizationId - The workspace.
   * @param kind - Which tracker the row claims.
   * @param displayName - The name a person reads — the locator's first segment is its slug.
   * @param config - The provider's settings.
   * @param status - `paused` keeps the sync loop off a source no provider is registered for.
   * @returns The source's id.
   */
  async function source(
    organizationId: string,
    kind: string,
    displayName: string,
    config: unknown = {},
    status = "active",
  ): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config, status)
       values ($1, $2, $3, $4::jsonb, $5) returning id`,
      [organizationId, kind, displayName, JSON.stringify(config), status],
    );

    return rows[0].id;
  }

  /**
   * A canonical ticket, as GitHub's provider writes one.
   *
   * @param organizationId - The workspace.
   * @param sourceId - Its GitHub-kind source.
   * @param number - The issue number.
   * @param fields - Title, body, labels.
   */
  async function githubTicket(
    organizationId: string,
    sourceId: string,
    number: number,
    fields: { title: string; body?: string; labels?: string[]; repo?: string },
  ): Promise<void> {
    const repo = fields.repo ?? "helios-firmware";

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.tickets
         (organization_id, source_id, external_id, external_key, external_url, title, body, state,
          labels, author, source_created_at, source_updated_at, meta)
       values ($1, $2, $3, $4, $5, $6, $7, 'open', $8::jsonb, 'maya-chen',
               now() - interval '3 days', now() - interval '2 days', $9::jsonb)`,
      [
        organizationId,
        sourceId,
        String(number),
        `#${String(number)}`,
        `https://github.com/acme-robotics/${repo}/issues/${String(number)}`,
        fields.title,
        fields.body ?? null,
        JSON.stringify(fields.labels ?? []),
        JSON.stringify({ github: { owner: "acme-robotics", repo } }),
      ],
    );
  }

  /**
   * Support tickets in bulk, a theme each in rotation — the seed's shape, at any size.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @param count - How many.
   */
  async function supportTickets(
    organizationId: string,
    sourceId: string,
    count: number,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.tickets
         (organization_id, source_id, external_id, external_key, external_url, title, body, state,
          labels, author, source_created_at, source_updated_at)
       select $1, $2, 'SUP-' || n, 'SUP-' || n, 'https://support.example.com/tickets/SUP-' || n,
              'Report about ' || theme || ' from the field',
              'Customer reports a ' || theme || ' problem during an inspection mission; unit ' || n || '.',
              'closed', jsonb_build_array(theme, 'support'), 'field-support',
              now() - make_interval(days => 1 + (n % 60)), now() - make_interval(days => n % 60)
         from generate_series(1, $3::int) as n
         cross join lateral (select ($4::text[])[1 + (n % 7)] as theme) pick`,
      [organizationId, sourceId, count, [...THEMES]],
    );
  }

  const hitsOf = (result: ToolResult): Hit[] =>
    (result.payload as { hits: Hit[] } | null)?.hits ?? [];

  describe("search", () => {
    it("returns ranked hits as issue-index:// source records with excerpts", async () => {
      const { id } = await space();
      const github = await source(id, "github", "GitHub · acme-robotics", {}, "paused");

      await githubTicket(id, github, 498, {
        title: "Docking aborts in crosswind above 6 m/s",
        body: "The approach controller aborted the docking sequence twice during the gust test.",
        labels: ["bug", "docking"],
      });
      await githubTicket(id, github, 499, {
        title: "Altimeter spikes below −10 °C",
        body: "Unrelated, but the unit also aborted one mission.",
      });
      await githubTicket(id, github, 500, { title: "Console pairing drops after sleep" });

      const result = await tool().query(id, { op: "search", q: "docking abort" });
      const hits = hitsOf(result);

      expect(resultViolations(result, null)).toEqual([]);
      // Stemming finds `aborts` and `aborted`; the title match outranks the body-only one; the
      // ticket mentioning neither is not a hit.
      expect(hits.map((hit) => hit.locator)).toEqual([
        "issue-index://github-acme-robotics/498",
        "issue-index://github-acme-robotics/499",
      ]);
      expect(hits[0].matchedEveryTerm).toBe(true);
      expect(hits[1].matchedEveryTerm).toBe(false);
      expect(hits[0].rank).toBeGreaterThan(hits[1].rank);
      expect(hits[0].excerpt).toContain("docking");
      expect(result.sources[0]).toMatchObject({
        kind: "ticket",
        title: "#498 — Docking aborts in crosswind above 6 m/s",
        locator: "issue-index://github-acme-robotics/498",
        excerpt: expect.stringContaining("aborted the docking sequence") as string,
        meta: { entry: "ticket", repo: "helios-firmware", labels: ["bug", "docking"] },
      });

      // The ledger would accept each locator as a ticket source.
      const { rows } = await api.sql.query<{ ok: boolean }>(
        `select bool_and(${SCHEMA_NAME}.source_locator_valid('ticket', l)) as ok
           from unnest($1::text[]) as l`,
        [result.sources.map((cited) => cited.locator)],
      );
      expect(rows[0].ok).toBe(true);
    });

    it("searches tickets, pull requests and imported documents together, and filters them", async () => {
      const { id, slug, owner } = await space();
      const github = await source(id, "github", "GitHub · acme-robotics", {}, "paused");

      await githubTicket(id, github, 498, {
        title: "Docking aborts in crosswind",
        labels: ["docking"],
      });
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.pull_requests
           (organization_id, source_id, external_number, external_url, title, head_branch, base_branch)
         values ($1, $2, 512, 'https://github.com/acme-robotics/helios-firmware/pull/512',
                 'dock: retry the docking approach after an abort', 'loop/498-dock-retry', 'main')`,
        [id, github],
      );
      await api
        .as(owner)("post", IMPORTS)
        .set(TENANT_HEADER, slug)
        .send({ ...CHURN_SET, format: "csv", content: CHURN_CSV })
        .expect(201);

      const all = hitsOf(
        await tool().query(id, { op: "search", q: "docking abort churn", limit: 50 }),
      );

      // The set's description mentions every term, so it leads — the diagram's answer.
      expect(all[0]).toMatchObject({ locator: CHURN_LOCATOR, kind: "document_set" });
      expect(new Set(all.map((hit) => hit.kind))).toEqual(
        new Set(["document_set", "document", "ticket", "pr"]),
      );
      expect(all.map((hit) => hit.locator)).toEqual(
        expect.arrayContaining([
          "issue-index://github-acme-robotics/498",
          "issue-index://github-acme-robotics/pull/512",
          `${CHURN_LOCATOR}/acct-01`,
        ]),
      );

      const only = async (filters: Record<string, unknown>): Promise<string[]> =>
        hitsOf(await tool().query(id, { op: "search", q: "docking", limit: 50, ...filters })).map(
          (hit) => hit.locator,
        );

      expect(await only({ kinds: ["pr"] })).toEqual([
        "issue-index://github-acme-robotics/pull/512",
      ]);
      expect(await only({ repo: "helios-firmware", kinds: ["ticket", "pr"] })).toHaveLength(2);
      // Stemming: "a wired dock" mentions docking too — ten interviews, nine of them labelled.
      expect(await only({ set: "support/churn-2026-q2", kinds: ["document"] })).toHaveLength(10);
      expect(await only({ set: "support/churn-2026-q2", labels: ["docking"] })).toHaveLength(
        CHURN_DOCKING,
      );
      expect(await only({ labels: ["recovery"] })).toEqual(
        expect.arrayContaining([`${CHURN_LOCATOR}/acct-02`, `${CHURN_LOCATOR}/acct-10`]),
      );
      expect(await only({ since: "2026-06-01", until: "2026-07-01", kinds: ["document"] })).toEqual(
        expect.arrayContaining([`${CHURN_LOCATOR}/acct-10`, `${CHURN_LOCATOR}/acct-11`]),
      );
      expect(await only({ until: "2026-04-10", kinds: ["document"] })).toEqual([
        `${CHURN_LOCATOR}/acct-01`,
      ]);
    });

    it("gives a ticket from a second tracker's adapter the same result as a GitHub-sourced one", async () => {
      const { id } = await space();
      const github = await source(id, "github", "GitHub · acme-robotics", {}, "paused");
      await source(id, "custom", "Field Tracker", { project: IN_MEMORY_PROJECT });

      await githubTicket(id, github, 498, {
        title: "Watchdog resets during docking",
        body: "The watchdog fires while the dock handshake is retried.",
        labels: ["bug", "watchdog"],
      });

      // The second tracker: Q.5's in-memory provider, ingested by the real sync loop.
      const tracker = new InMemoryTracker({ token: null });
      tracker.file({
        summary: "Watchdog resets during docking",
        description: "The watchdog fires while the dock handshake is retried.",
        tags: ["bug", "watchdog"],
        reporter: "field-support",
      });
      const report = await cycleWith(api, [new InMemoryTicketSourceProvider(tracker)]);
      expect(report.sources.map((synced) => synced.imported)).toEqual([1]);

      const result = await tool().query(id, { op: "search", q: "watchdog docking" });
      const [first, second] = hitsOf(result);
      const locators = [first.locator, second.locator].sort();

      expect(locators).toEqual([
        "issue-index://field-tracker/10001",
        "issue-index://github-acme-robotics/498",
      ]);
      // Same content, same score, same shape — nothing distinguishes them but where they are.
      expect(second.rank).toBe(first.rank);
      expect(second.excerpt).toBe(first.excerpt);
      expect(Object.keys(second)).toEqual(Object.keys(first));
      for (const field of ["kind", "title", "labels", "matchedEveryTerm"] as const) {
        expect(second[field]).toEqual(first[field]);
      }
      expect(Object.keys(result.sources[1]).sort()).toEqual(Object.keys(result.sources[0]).sort());
      expect(result.sources.map((cited) => cited.kind)).toEqual(["ticket", "ticket"]);
      expect(resultViolations(result, null)).toEqual([]);
      // No answer names a tracker kind: the index cannot see one.
      expect(JSON.stringify(result)).not.toMatch(/"(kind|tracker|provider)":"(github|custom)"/);

      // And each is one bucket of the same aggregate, and one issue of the same sub-line.
      const byLabel = await tool().query(id, { op: "aggregate", groupBy: "label" });
      expect((byLabel.payload as { buckets: unknown }).buckets).toEqual([
        { key: "bug", count: 2 },
        { key: "watchdog", count: 2 },
      ]);
      expect((await tool().adapter.counts(id, {})).issues).toBe("2 issues");
    });
  });

  describe("an imported document set", () => {
    it("round-trips the churn interviews and is citable as mockup 22's [19]", async () => {
      const { id, slug, owner } = await space();
      const created = bodyOf<DocumentImportDetailResource>(
        await api
          .as(owner)("post", IMPORTS)
          .set(TENANT_HEADER, slug)
          .send({ ...CHURN_SET, format: "csv", content: CHURN_CSV })
          .expect(201),
      );

      expect(created).toMatchObject({
        locator: CHURN_LOCATOR,
        title: "Support churn interviews Q2",
        documents: CHURN_DOCUMENTS,
        importedBy: owner.id,
      });
      expect(created.items).toHaveLength(CHURN_DOCUMENTS);

      // Read back, it is what was sent.
      const read = bodyOf<DocumentImportDetailResource>(
        await api.as(owner)("get", `${IMPORTS}/${created.id}`).set(TENANT_HEADER, slug).expect(200),
      );
      expect(read).toEqual(created);
      expect(read.items[6]).toEqual({
        key: "acct-07",
        locator: `${CHURN_LOCATOR}/acct-07`,
        title: "Churn interview — Ridgeline Utilities",
        text: "Docking reliability on ridge sites. The approach is unstable in gusts and the drone gives up rather than re-plan.",
        labels: ["docking", "gusts"],
        occurredAt: "2026-05-15T00:00:00.000Z",
        meta: { account: "Ridgeline Utilities", seats: "40" },
      });
      expect(
        bodyOf<DocumentImportListResource>(
          await api.as(owner)("get", IMPORTS).set(TENANT_HEADER, slug).expect(200),
        ).items.map((set) => set.locator),
      ).toEqual([CHURN_LOCATOR]);

      // [19]  Support churn interviews Q2      issue-index://support/churn-2026-q2
      const cited = await tool().query(id, { op: "get", ref: CHURN_LOCATOR });

      expect(resultViolations(cited, null)).toEqual([]);
      expect(cited.sources).toHaveLength(1);
      expect(cited.sources[0]).toMatchObject({
        kind: "ticket",
        title: "Support churn interviews Q2",
        locator: CHURN_LOCATOR,
        excerpt: CHURN_SET.description,
      });
      expect(cited.payload).toMatchObject({
        entries: [{ kind: "document_set", meta: { format: "csv", documents: CHURN_DOCUMENTS } }],
      });

      // …and so is each interview, and the count behind "9 of 14 cite docking reliability".
      const one = await tool().query(id, { op: "get", ref: `${CHURN_LOCATOR}/acct-01` });
      expect(one.sources[0]).toMatchObject({
        title: "Churn interview — Northwind Survey",
        locator: `${CHURN_LOCATOR}/acct-01`,
      });
      const docking = await tool().query(id, {
        op: "aggregate",
        groupBy: "label",
        set: "support/churn-2026-q2",
        labels: ["docking"],
        windowDays: 3650,
      });
      expect(docking.payload).toMatchObject({
        buckets: [{ key: "docking", count: CHURN_DOCKING }],
      });

      // Counted in the sub-line.
      const line = tool().adapter;
      expect(renderSubLine(line.displayMeta().subLine, await line.counts(id, {}))).toBe(
        "0 issues · 0 pull requests · Support churn interviews Q2",
      );
    });

    it("lets only an owner import or remove, and every member read", async () => {
      const { id, slug, owner } = await space();
      const admin = await api.signIn();
      const viewer = await api.signIn();
      await api.join(id, admin, "admin");
      await api.join(id, viewer, "viewer");
      const body = { ...CHURN_SET, format: "csv", content: CHURN_CSV };

      for (const person of [admin, viewer]) {
        expect(
          bodyOf<ErrorEnvelope>(
            await api.as(person)("post", IMPORTS).set(TENANT_HEADER, slug).send(body).expect(403),
          ).code,
        ).toBe("forbidden");
      }

      const created = bodyOf<DocumentImportDetailResource>(
        await api.as(owner)("post", IMPORTS).set(TENANT_HEADER, slug).send(body).expect(201),
      );

      await api.as(viewer)("get", IMPORTS).set(TENANT_HEADER, slug).expect(200);
      await api.as(viewer)("get", `${IMPORTS}/${created.id}`).set(TENANT_HEADER, slug).expect(200);
      await api
        .as(admin)("delete", `${IMPORTS}/${created.id}`)
        .set(TENANT_HEADER, slug)
        .expect(403);
      await api
        .as(owner)("delete", `${IMPORTS}/${created.id}`)
        .set(TENANT_HEADER, slug)
        .expect(204);
      await api.as(owner)("get", `${IMPORTS}/${created.id}`).set(TENANT_HEADER, slug).expect(404);

      // Gone from the index too.
      expect((await tool().query(id, { op: "get", ref: CHURN_LOCATOR })).payload).toBeNull();
    });

    it("refuses a second set at the same locator, an unreadable file and a malformed request", async () => {
      const { slug, owner } = await space();
      const post = (body: Record<string, unknown>) =>
        api.as(owner)("post", IMPORTS).set(TENANT_HEADER, slug).send(body);
      const body = { ...CHURN_SET, format: "csv", content: CHURN_CSV };

      await post(body).expect(201);

      expect(bodyOf<ErrorEnvelope>(await post(body).expect(409))).toMatchObject({
        code: DOCUMENT_IMPORT_ERRORS.exists,
        details: { collection: "support", name: "churn-2026-q2" },
      });
      expect(
        bodyOf<ErrorEnvelope>(
          await post({ ...body, name: "broken", content: "title\nno text column\n" }).expect(422),
        ),
      ).toMatchObject({
        code: DOCUMENT_IMPORT_ERRORS.invalid,
        message:
          "The file cannot be imported: the header row needs a text column (text, body or content).",
      });
      expect(
        bodyOf<ErrorEnvelope>(
          await post({
            collection: "support",
            name: "untitled",
            format: "csv",
            content: "text\nx\n",
          }).expect(422),
        ).code,
      ).toBe(DOCUMENT_IMPORT_ERRORS.titleRequired);
      expect(
        bodyOf<ErrorEnvelope>(await post({ ...body, collection: "Support" }).expect(422)).code,
      ).toBe("validation_failed");
      // Nothing half-written.
      const { rows } = await api.sql.query<{ sets: string; items: string }>(
        `select (select count(*) from ${SCHEMA_NAME}.document_imports) as sets,
                (select count(*) from ${SCHEMA_NAME}.document_import_items) as items`,
      );
      expect(rows[0]).toEqual({ sets: "1", items: String(CHURN_DOCUMENTS) });
    });

    it("stores an import of the largest shape the route takes", async () => {
      const { id, slug, owner } = await space();
      const rows = Array.from(
        { length: 2000 },
        (_unused, n) => `doc-${String(n)},"Field note ${String(n)} about the dock, with a comma."`,
      );
      const created = bodyOf<DocumentImportDetailResource>(
        await api
          .as(owner)("post", IMPORTS)
          .set(TENANT_HEADER, slug)
          .send({
            collection: "field",
            name: "notes",
            title: "Field notes",
            format: "csv",
            content: `key,text\n${rows.join("\n")}\n`,
          })
          .expect(201),
      );

      expect(created.documents).toBe(2000);
      expect((await tool().adapter.counts(id, {})).imports).toBe("Field notes");
    });
  });

  describe("aggregate and the sub-line", () => {
    it("reproduces the seven-theme count over 312 support tickets, and counts what is indexed", async () => {
      const { id } = await space();
      const support = await source(id, "custom", "Support", {}, "paused");
      await supportTickets(id, support, 312);

      const themes = await tool().query(id, {
        op: "aggregate",
        groupBy: "label",
        set: "support",
        labels: [...THEMES],
      });

      expect(resultViolations(themes, null)).toEqual([]);
      // 312 = 44 × 7 + 4: four themes hold 45 tickets and three hold 44.
      expect(themes.payload).toMatchObject({
        total: 312,
        buckets: [
          { key: "battery", count: 45 },
          { key: "ota", count: 45 },
          { key: "recovery", count: 45 },
          { key: "telemetry", count: 45 },
          { key: "docking", count: 44 },
          { key: "gusts", count: 44 },
          { key: "pairing", count: 44 },
        ],
      });
      // Each theme is cited by tickets that carry it.
      expect(themes.sources.length).toBeGreaterThanOrEqual(THEMES.length);
      for (const cited of themes.sources) {
        expect(cited.locator).toMatch(/^issue-index:\/\/support\/SUP-\d+$/);
        const [bucket] = Object.keys(cited.meta.buckets as Record<string, number>);
        expect(cited.meta.labels).toContain(bucket);
      }

      // "How many tickets mention docking this month?" — a count, by week, of a full-text match.
      const mentions = await tool().query(id, {
        op: "aggregate",
        groupBy: "period",
        period: "week",
        q: "docking problem",
        windowDays: 30,
      });
      const weekly = mentions.payload as { total: number; buckets: { count: number }[] };
      expect(weekly.total).toBeGreaterThan(0);
      expect(weekly.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(weekly.total);

      // The sub-line is the corpus, counted.
      const adapter = tool().adapter;
      const { rows } = await api.sql.query<{ n: string }>(
        `select count(*) as n from ${SCHEMA_NAME}.tickets where organization_id = $1`,
        [id],
      );
      expect(rows[0].n).toBe("312");
      expect(renderSubLine(adapter.displayMeta().subLine, await adapter.counts(id, {}))).toBe(
        "312 issues · 0 pull requests · no imported sets",
      );
      expect(await adapter.healthCheck({}, null, id)).toEqual({
        state: "healthy",
        detail: "312 issues · 0 pull requests · no imported sets",
      });
    });
  });

  describe("isolation", () => {
    it("returns nothing from another workspace — by search, locator, aggregate, count or route", async () => {
      const mine = await space();
      const theirs = await space();
      const support = await source(theirs.id, "custom", "Support", {}, "paused");
      await supportTickets(theirs.id, support, 21);
      const set = bodyOf<DocumentImportDetailResource>(
        await api
          .as(theirs.owner)("post", IMPORTS)
          .set(TENANT_HEADER, theirs.slug)
          .send({ ...CHURN_SET, format: "csv", content: CHURN_CSV })
          .expect(201),
      );

      // They have a corpus…
      expect(
        hitsOf(await tool().query(theirs.id, { op: "search", q: "docking" })),
      ).not.toHaveLength(0);

      // …and none of it is reachable from here.
      for (const call of [
        { op: "search", q: "docking churn battery support", limit: 50 },
        { op: "get", ref: CHURN_LOCATOR },
        { op: "get", ref: "issue-index://support/SUP-1" },
        { op: "aggregate", groupBy: "label", windowDays: 3650 },
        { op: "aggregate", groupBy: "set", windowDays: 3650 },
      ]) {
        expect(await tool().query(mine.id, call)).toEqual({
          payload: null,
          sources: [],
          usage: { tokens: 0 },
        });
      }
      expect(await tool().adapter.counts(mine.id, {})).toEqual({
        issues: "0 issues",
        prs: "0 pull requests",
        imports: "no imported sets",
      });
      expect(
        bodyOf<DocumentImportListResource>(
          await api.as(mine.owner)("get", IMPORTS).set(TENANT_HEADER, mine.slug).expect(200),
        ).items,
      ).toEqual([]);
      await api
        .as(mine.owner)("get", `${IMPORTS}/${set.id}`)
        .set(TENANT_HEADER, mine.slug)
        .expect(404);
      await api
        .as(mine.owner)("delete", `${IMPORTS}/${set.id}`)
        .set(TENANT_HEADER, mine.slug)
        .expect(404);
      // A stranger to their workspace cannot name it either.
      await api.as(mine.owner)("get", IMPORTS).set(TENANT_HEADER, theirs.slug).expect(404);
      // Theirs is untouched.
      await api
        .as(theirs.owner)("get", `${IMPORTS}/${set.id}`)
        .set(TENANT_HEADER, theirs.slug)
        .expect(200);
    });
  });

  describe("the latency budget", () => {
    it("answers a search over 3,412 tickets inside the declared 500 ms, and cancels one that cannot", async () => {
      const { id } = await space();
      const support = await source(id, "custom", "Support", {}, "paused");
      await supportTickets(id, support, 3412);
      await api.sql.query(`analyze ${SCHEMA_NAME}.tickets`);

      const adapter = tool();
      expect((await adapter.adapter.counts(id, {})).issues).toBe("3,412 issues");

      // Warm the connection, then measure: the budget is the statement's, so the wall clock
      // around the whole call is the stricter test.
      await adapter.query(id, { op: "search", q: "docking" });
      for (const call of [
        { op: "search", q: "docking problem inspection", limit: 50 },
        { op: "search", q: "pairing", labels: ["pairing"], limit: 10 },
        { op: "aggregate", groupBy: "label", windowDays: 90 },
        { op: "get", ref: "issue-index://support/SUP-3412" },
      ]) {
        const started = process.hrtime.bigint();
        const result = await adapter.query(id, call);
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

        expect(result.payload).not.toBeNull();
        expect(elapsedMs).toBeLessThan(500);
      }

      // The budget is enforced, not merely met: the same search under a 1 ms budget is cancelled.
      const index = api.nest.get(HistoryIndexRepository);
      await expect(index.search(id, "docking problem inspection", {}, 50, 1)).rejects.toMatchObject(
        {
          code: "57014",
        },
      );
      // And the connection is not left with the short budget.
      expect(await index.search(id, "docking", {}, 5, 500)).toHaveLength(5);
    });

    it("reports a cancelled statement as an upstream failure naming the budget", async () => {
      const { id } = await space();
      const index = api.nest.get(HistoryIndexRepository);
      const cancelled = jest
        .spyOn(index, "search")
        .mockRejectedValueOnce(Object.assign(new Error("canceling statement"), { code: "57014" }));

      const failure: unknown = await tool()
        .query(id, { op: "search", q: "docking" })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ResearchToolError);
      expect(failure).toMatchObject({
        errorClass: "upstream",
        detail: "the history index did not answer within its 500 ms budget",
      });
      cancelled.mockRestore();
    });
  });
});

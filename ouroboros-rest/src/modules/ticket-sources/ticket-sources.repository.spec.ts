import { readFileSync } from "node:fs";
import { join } from "node:path";

import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import {
  FIXTURE_GITHUB_SOURCE,
  FIXTURE_NOW,
  FIXTURE_WORKSPACE,
  githubSource,
  githubTicket,
  jiraSource,
  jiraTicket,
} from "./ticket-source.fixture";
import type { CanonicalTicket } from "./ticket-source.provider";
import { TicketSourcesRepository } from "./ticket-sources.repository";

/**
 * The statements, asserted as SQL — for the reason `backlog-sync.repository.spec.ts` and
 * `provider-health.repository.spec.ts` both give: this layer holds statements rather than
 * rules, so mocking a method would prove nothing about the things that can actually be wrong
 * here ([#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * Four properties are load-bearing, and each is a property of a statement:
 *
 *   * **The credential is read by one statement and nothing else reads the table.** V030 built
 *     `ticket_sources_public` so a read path cannot select what it cannot see; what a suite can
 *     add is that the *exception* stays one method — asserted over this module's own source,
 *     because "no second reader" is a claim about a file rather than about a call.
 *   * **The whole sync is one transaction.** The rows, the cursor, the freshness stamp and the
 *     status move together or not at all, which is what makes *"freshness can never claim a
 *     sync that partly failed"* structural.
 *   * **An unchanged ticket produces no statement at all.** `tickets_touch_updated_at` is
 *     unconditional, so the only way to keep `updated_at` meaning *the tracker changed this* is
 *     to not issue the update — and that is also what makes a re-sync idempotent.
 *   * **A successful sync clears a previous failure.** The one moment a source's recovery is
 *     knowable is the moment a sync succeeds, and a loop that only ever *set* a status would
 *     leave a source red until somebody noticed.
 *
 * Both shapes throughout: a GitHub-flavoured ticket and a Jira-flavoured one with no
 * repository, because decision **P6** is half of what is under test.
 */

/** The repository's own source, for the exclusivity claim. */
const SOURCE = readFileSync(join(__dirname, "ticket-sources.repository.ts"), "utf8");

/** A stored row, in the database's own column names. */
function stored(ticket: CanonicalTicket, overrides: Record<string, unknown> = {}) {
  return {
    id: "5eed0031-0000-0000-0000-000000000001",
    external_id: ticket.externalId,
    external_key: ticket.externalKey,
    external_url: ticket.externalUrl,
    title: ticket.title,
    body: ticket.body,
    state: ticket.state,
    labels: [...ticket.labels],
    author: ticket.author,
    source_created_at: ticket.sourceCreatedAt,
    source_updated_at: ticket.sourceUpdatedAt,
    meta: ticket.meta,
    ...overrides,
  };
}

describe("TicketSourcesRepository", () => {
  let database: RecordingDatabase;
  let repository: TicketSourcesRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new TicketSourcesRepository(database.service);
  });

  describe("the cross-workspace read", () => {
    it("selects through the view, so no credential is in the rows at all", async () => {
      database.answers({ rows: [] });

      await repository.activeSources();

      const [sql] = database.sql();

      expect(sql).toContain('from "ouroboros"."ticket_sources_public"');
      expect(sql).not.toContain("credentials_encrypted");
    });

    it("takes only the active sources, which is the whole of the filter", async () => {
      // V030's three-state column doing its job: a `paused` source is somebody's choice and an
      // `error` one is a source the loop already has a reason for.
      database.answers({ rows: [] });

      await repository.activeSources();

      expect(database.statements[0]?.sql).toContain('"status" = $1');
      expect(database.statements[0]?.parameters).toStrictEqual(["active"]);
    });

    it("puts a source that has never been synced at the front", async () => {
      // A cycle that can only get through some of its work should spend it on the sources that
      // have waited longest, and a cold source has waited forever. `nulls first` is spelled
      // because PostgreSQL's `asc` default is the opposite.
      database.answers({ rows: [] });

      await repository.activeSources();

      expect(database.sql()[0]).toContain('order by "synced_at" asc nulls first, "id" asc');
    });

    it("maps a row onto the source the loop works with", async () => {
      database.answers({
        rows: [
          {
            id: FIXTURE_GITHUB_SOURCE,
            organization_id: FIXTURE_WORKSPACE,
            kind: "github",
            display_name: "GitHub · acme-robotics",
            config: { login: "acme-robotics" },
            sync_cursor: "2026-09-11T09:00:00Z",
            synced_at: FIXTURE_NOW,
          },
        ],
      });

      const [source] = await repository.activeSources();

      expect(source).toStrictEqual({
        sourceId: FIXTURE_GITHUB_SOURCE,
        organizationId: FIXTURE_WORKSPACE,
        kind: "github",
        displayName: "GitHub · acme-robotics",
        config: { login: "acme-robotics" },
        cursor: "2026-09-11T09:00:00Z",
        syncedAt: FIXTURE_NOW,
      });
    });
  });

  describe("the credential", () => {
    it("is the one statement that names the table for reading, and selects one column", async () => {
      database.answers({ rows: [{ credentials_encrypted: null }] });

      await repository.sealedCredential(FIXTURE_GITHUB_SOURCE);

      const [sql] = database.sql();

      expect(sql).toContain('from "ouroboros"."ticket_sources"');
      expect(sql).toContain('select "credentials_encrypted"');
      // Nothing else: a statement that also selected a display name would be a statement
      // somebody could grow into a general-purpose read of the table.
      expect(sql).not.toContain("display_name");
    });

    it("answers null for a source with no credential yet, which is a real state", async () => {
      database.answers({ rows: [{ credentials_encrypted: null }] });

      await expect(repository.sealedCredential(FIXTURE_GITHUB_SOURCE)).resolves.toBeNull();
    });

    it("answers null for a source that vanished between the read and the sync", async () => {
      // A cycle reads its sources and then syncs them; a source deleted in between is
      // legitimate. The sync then fails `auth`, and the next cycle does not list the row.
      database.answers({ rows: [] });

      await expect(repository.sealedCredential(FIXTURE_GITHUB_SOURCE)).resolves.toBeNull();
    });

    it("is read by no other statement in this module", () => {
      // The exclusivity claim, over the file. V030's view makes the *default* safe; this is
      // what keeps the exception from acquiring siblings — a second `selectFrom("ticket_sources")`
      // would compile, run, and put the sealed column in reach of a `select *` somebody adds
      // later.
      const reads = SOURCE.match(/selectFrom\("ticket_sources"\)/g) ?? [];

      expect(reads).toHaveLength(1);
    });
  });

  describe("one sync, one transaction", () => {
    it("wraps the reads, the writes and the stamp in a single transaction", async () => {
      // `begin` and `commit` consume no queued answer — see `database.fixture.ts` — so the
      // queue is the select, then the insert.
      database.answers({ rows: [] }, { rows: [{ id: "5eed0031-0000-0000-0000-000000000001" }] });

      await repository.applySync({
        source: githubSource(),
        tickets: [githubTicket()],
        cursor: "2026-09-11T09:00:00Z",
        syncedAt: FIXTURE_NOW,
      });

      const sql = database.sql();

      expect(sql[0]).toBe("begin");
      expect(sql.at(-1)).toBe("commit");
      expect(sql.join("\n")).toContain('update "ouroboros"."ticket_sources"');
    });

    it("issues no read at all when the page was empty", async () => {
      // Most syncs change nothing, and a `where external_id in ()` is a statement with no
      // meaning. The stamp still moves, because *"we looked and nothing had changed"* is what
      // the freshness tag claims.
      await repository.applySync({
        source: githubSource(),
        tickets: [],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      const sql = database.sql();

      expect(sql.some((statement) => statement.includes('from "ouroboros"."tickets"'))).toBe(false);
      expect(sql.join("\n")).toContain('update "ouroboros"."ticket_sources"');
    });
  });

  describe("what a sync writes", () => {
    it("inserts a ticket this mirror has never seen, as unsized", async () => {
      database.answers({ rows: [] }, { rows: [{ id: "t-1" }] });

      const written = await repository.applySync({
        source: githubSource(),
        tickets: [githubTicket()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.imported).toBe(1);
      expect(database.sql().join("\n")).toContain('insert into "ouroboros"."tickets"');
      // A freshly ingested ticket has no estimate, and this is the value the estimation
      // pipeline claims work by.
      expect(
        database.statements.some((statement) => statement.parameters.includes("unsized")),
      ).toBe(true);
    });

    it("stores a Jira ticket with no repository anywhere in it", async () => {
      // Decision P6, as a write: the canonical insert has no column a Jira ticket would have
      // to leave null and no `meta` key it would have to invent.
      database.answers({ rows: [] }, { rows: [{ id: "t-2" }] });

      await repository.applySync({
        source: jiraSource(),
        tickets: [jiraTicket()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      const insert = database.statements.find((statement) =>
        statement.sql.includes('insert into "ouroboros"."tickets"'),
      );

      expect(insert?.parameters).toContain("PROJ-142");
      expect(insert?.parameters).toContain("10042");
      expect(JSON.stringify(insert?.parameters)).not.toContain("repo_id");
    });

    it("writes nothing for a ticket identical to what is stored", async () => {
      // The acceptance criterion a re-sync depends on. Most trackers' cursors are inclusive,
      // so every incremental sync re-reads the ticket on the watermark.
      database.answers({ rows: [stored(githubTicket())] });

      const written = await repository.applySync({
        source: githubSource(),
        tickets: [githubTicket()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written).toMatchObject({ imported: 0, updated: 0, unchanged: 1 });
      expect(database.sql().join("\n")).not.toContain('update "ouroboros"."tickets"');
    });

    it("is not fooled by jsonb reordering meta's keys", async () => {
      // `jsonb` does not preserve key order, so a naive `JSON.stringify` comparison would call
      // every ticket changed on every sync — and `updated_at` would stop meaning anything.
      const ticket = githubTicket({ meta: { github: { repo_id: "r-1", owner: "acme" } } });

      database.answers({
        rows: [stored(ticket, { meta: { github: { owner: "acme", repo_id: "r-1" } } })],
      });

      const written = await repository.applySync({
        source: githubSource(),
        tickets: [ticket],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.unchanged).toBe(1);
    });

    it("rewrites a ticket whose title the tracker changed, and leaves sizing_status alone", async () => {
      database.answers({ rows: [stored(githubTicket(), { title: "an older title" })] });

      const written = await repository.applySync({
        source: githubSource(),
        tickets: [githubTicket()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.updated).toBe(1);

      const update = database.statements.find((statement) =>
        statement.sql.includes('update "ouroboros"."tickets"'),
      );

      // The one column this product owns. A sync that reset it would undo the pipeline's work
      // every time somebody edited a title.
      expect(update?.sql).not.toContain("sizing_status");
    });

    it("notices a reordered label list, because the tags render in that order", async () => {
      database.answers({ rows: [stored(githubTicket({ labels: ["i2c", "bug", "watchdog"] }))] });

      const written = await repository.applySync({
        source: githubSource(),
        tickets: [githubTicket()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.updated).toBe(1);
    });

    it("does not store a closed ticket it has never seen", async () => {
      // A backlog holds what was open at least once, and the alternative is that a first sync
      // of a ten-year-old project stores every ticket ever closed. Provider-neutral: the same
      // rule for all five kinds, applied here because deciding whether a closed ticket is
      // *new* needs the mirror's own state, which is what a provider does not have.
      database.answers({ rows: [] });

      const written = await repository.applySync({
        source: githubSource(),
        tickets: [githubTicket({ state: "closed" })],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written).toMatchObject({ imported: 0, skippedClosed: 1 });
      expect(database.sql().join("\n")).not.toContain('insert into "ouroboros"."tickets"');
    });

    it("does store a close it has been watching", async () => {
      database.answers({ rows: [stored(githubTicket())] });

      const written = await repository.applySync({
        source: githubSource(),
        tickets: [githubTicket({ state: "closed" })],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.updated).toBe(1);
      expect(written.skippedClosed).toBe(0);
    });
  });

  describe("the estimation handoff", () => {
    it("offers an imported ticket, with the key a person can search for", async () => {
      database.answers({ rows: [] }, { rows: [{ id: "t-1" }] });

      const written = await repository.applySync({
        source: jiraSource(),
        tickets: [jiraTicket()],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.estimable).toStrictEqual([
        {
          organizationId: FIXTURE_WORKSPACE,
          ticketId: "t-1",
          sourceId: jiraSource().sourceId,
          sourceKind: "jira",
          externalKey: "PROJ-142",
          reason: "imported",
        },
      ]);
    });

    it("offers a reopened ticket, because it is back with an estimate worth redoing", async () => {
      database.answers({ rows: [stored(githubTicket(), { state: "closed" })] });

      const written = await repository.applySync({
        source: githubSource(),
        tickets: [githubTicket({ state: "open" })],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.estimable.map((ticket) => ticket.reason)).toStrictEqual(["reopened"]);
    });

    it("offers nothing for a close, which is the opposite of new work", async () => {
      database.answers({ rows: [stored(githubTicket())] });

      const written = await repository.applySync({
        source: githubSource(),
        tickets: [githubTicket({ state: "closed" })],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      expect(written.estimable).toStrictEqual([]);
    });
  });

  describe("the stamp", () => {
    it("moves the freshness, the cursor and the status together", async () => {
      await repository.applySync({
        source: githubSource(),
        tickets: [],
        cursor: "opaque::7f3a",
        syncedAt: FIXTURE_NOW,
      });

      const stamp = database.statements.find((statement) =>
        statement.sql.includes('update "ouroboros"."ticket_sources"'),
      );

      expect(stamp?.sql).toContain('"synced_at"');
      expect(stamp?.sql).toContain('"sync_cursor"');
      expect(stamp?.sql).toContain('"status"');
      expect(stamp?.parameters).toContain("opaque::7f3a");
    });

    it("clears a previous failure, because recovery is only knowable when a sync succeeds", async () => {
      await repository.applySync({
        source: githubSource(),
        tickets: [],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      const stamp = database.statements.find((statement) =>
        statement.sql.includes('update "ouroboros"."ticket_sources"'),
      );

      expect(stamp?.parameters).toContain("active");
      expect(stamp?.parameters).toContain(null);
      expect(stamp?.sql).toContain('"status_reason"');
    });

    it("leaves the stored cursor alone when the provider returned none", async () => {
      // Null is *no watermark to record*, which is what
      // `ticket_sources_cursor_after_sync` reads as the legitimate state it is — synced, with
      // nothing to resume from. Clearing it would re-import the whole backlog next cycle.
      await repository.applySync({
        source: githubSource({ cursor: "kept" }),
        tickets: [],
        cursor: null,
        syncedAt: FIXTURE_NOW,
      });

      const stamp = database.statements.find((statement) =>
        statement.sql.includes('update "ouroboros"."ticket_sources"'),
      );

      expect(stamp?.sql).not.toContain('"sync_cursor"');
    });
  });

  describe("markFailure", () => {
    it("writes the status and the reason and nothing else", async () => {
      // In particular not `synced_at`, which would claim a poll that did not happen, and not
      // `sync_cursor`, which would either lose the watermark or re-store the one already there.
      await repository.markFailure(FIXTURE_GITHUB_SOURCE, "error", "rate limited until 14:20 UTC");

      const [statement] = database.statements;

      expect(statement?.sql).toContain('update "ouroboros"."ticket_sources"');
      expect(statement?.sql).not.toContain("synced_at");
      expect(statement?.sql).not.toContain("sync_cursor");
      expect(statement?.parameters).toStrictEqual([
        "error",
        "rate limited until 14:20 UTC",
        FIXTURE_GITHUB_SOURCE,
      ]);
    });

    it("runs outside a transaction, because there is no sync to be atomic with", async () => {
      await repository.markFailure(FIXTURE_GITHUB_SOURCE, "error", "credentials rejected");

      expect(database.sql()).not.toContain("begin");
    });
  });
});

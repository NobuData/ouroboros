import { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { VaultService } from "../vault/vault.service";
import { TicketSourceError } from "./ticket-source.errors";
import {
  FIXTURE_CREDENTIAL,
  githubTicket,
  jiraTicket,
  page,
  scriptedProvider,
  type ScriptedProvider,
} from "./ticket-source.fixture";
import type { TicketSourceProvider } from "./ticket-source.provider";
import { TICKET_SOURCE_PROVIDERS, TicketSourceRegistry } from "./ticket-source.registry";
import { TicketSourcesRepository } from "./ticket-sources.repository";
import { TicketSourcesService } from "./ticket-sources.service";

/**
 * The loop against a migrated database ([#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * The unit suites run this code over recorded statements, and that is exactly what makes this
 * one necessary. Six things can only be asserted here, and five of them are acceptance
 * criteria:
 *
 *   * **A canonical row survives V030's constraints** — for a GitHub-shaped ticket *and* for a
 *     Jira-shaped one with no repository, which is decision **P6**'s own criterion. A unit test
 *     cannot say whether the row a provider produced is a row the server accepts.
 *   * **A re-sync touches no rows.** The *touches no rows* half is a claim about `updated_at`,
 *     which only `tickets_touch_updated_at` can move — so only a database can prove it did not.
 *   * **A cursor round-trips.** Stored, read back, handed to `incrementalSync` unchanged — a
 *     trip through a `text` column and V030's two CHECKs that no unit test crosses.
 *   * **A failure lands in `status` and V031's `status_reason`**, through
 *     `ticket_sources_status_reason_present`, and a later success clears both.
 *   * **The credential is sealed by the real vault and opened by the loop** — so what a
 *     provider receives is what an administrator actually pasted, and
 *     `ticket_sources_credentials_sealed` is what the column would have refused otherwise.
 *   * **`ticket_sources_public` really is the read path**, and the one statement that names the
 *     table is the one that opens the secret.
 *
 * ---------------------------------------------------------------------------
 * **The registry is rebuilt with a scripted provider**, because this build registers none —
 * `ticket-sources.module.ts` binds an empty list until Q.3
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)). What is under test here is the
 * loop and the schema beneath it, not a tracker, so the provider is the double the unit suites
 * use and the assertions are about what reached PostgreSQL.
 *
 * The cycle is driven from the injector rather than by waiting for the scheduler; the loop's
 * own behaviour is `ticket-sources.scheduler.spec.ts`'s, under fake timers. The harness is
 * started with a day-long interval so the application's own loop cannot fire a competing cycle
 * mid-test.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** One canonical row, as an assertion reads it. */
interface StoredTicket {
  external_id: string;
  external_key: string;
  external_url: string;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  author: string | null;
  meta: Record<string, unknown>;
  sizing_status: string;
  synced_at: Date;
  updated_at: Date;
}

/** The source's own columns, after a cycle. */
interface StoredSource {
  status: string;
  status_reason: string | null;
  sync_cursor: string | null;
  synced_at: Date | null;
}

describe("the ticket source sync, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    // A day, so the application's own loop cannot fire a cycle in the middle of a test.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  /**
   * A workspace with one source of the given kind.
   *
   * Written directly rather than through an API, because the source-management routes are
   * Q.4's ([#141](https://github.com/NobuData/ouroboros/issues/141)) — this ticket ships the
   * loop, and the rows it reads have no other writer yet.
   *
   * @param kind - Which tracker.
   * @param sealed - A sealed credential to store, or nothing.
   * @returns The workspace and the source.
   */
  async function source(
    kind: "github" | "jira",
    sealed?: string,
  ): Promise<{ organizationId: string; sourceId: string }> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources
         (organization_id, kind, display_name, config, credentials_encrypted)
       values ($1, $2, $3, $4::jsonb, $5)
       returning id`,
      [
        workspace.id,
        kind,
        `${kind} · harness`,
        JSON.stringify({ project_keys: ["PROJ"] }),
        sealed ?? null,
      ],
    );

    return { organizationId: workspace.id, sourceId: rows[0].id };
  }

  /**
   * Run one cycle with these providers registered.
   *
   * The registry is constructed here rather than overridden in the module, because the
   * providers differ per test and a Nest override is per application.
   *
   * @param providers - What to register.
   * @returns The cycle's report.
   */
  async function cycleWith(providers: readonly TicketSourceProvider[]) {
    const service = new TicketSourcesService(
      api.nest.get(TicketSourcesRepository),
      new TicketSourceRegistry(providers),
      api.nest.get(VaultService),
      { accept: () => Promise.resolve() },
    );

    return service.cycle();
  }

  /** Every ticket stored for one source. */
  async function ticketsOf(sourceId: string): Promise<StoredTicket[]> {
    const { rows } = await api.sql.query<StoredTicket>(
      `select external_id, external_key, external_url, title, body, state, labels, author,
              meta, sizing_status, synced_at, updated_at
         from ${SCHEMA_NAME}.tickets where source_id = $1 order by external_id`,
      [sourceId],
    );

    return rows;
  }

  /** The source's own columns, read through the view a read path uses. */
  async function sourceRow(sourceId: string): Promise<StoredSource> {
    const { rows } = await api.sql.query<StoredSource>(
      `select status, status_reason, sync_cursor, synced_at
         from ${SCHEMA_NAME}.ticket_sources_public where id = $1`,
      [sourceId],
    );

    return rows[0];
  }

  describe("a first sync", () => {
    it("stores a GitHub-shaped ticket the server accepts", async () => {
      const { sourceId } = await source("github");
      const provider = scriptedProvider({ pages: [page([githubTicket()])] });

      const report = await cycleWith([provider]);

      expect(report.sources[0]?.imported).toBe(1);

      const [stored] = await ticketsOf(sourceId);

      expect(stored.external_id).toBe("485");
      expect(stored.external_key).toBe("#485");
      expect(stored.labels).toStrictEqual(["bug", "i2c", "watchdog"]);
      expect(stored.meta).toStrictEqual({
        github: { repo_id: "dfff0000-0000-0000-0000-00000000000a" },
      });
      // V014's vocabulary and default, verbatim, so the estimation pipeline needs no change.
      expect(stored.sizing_status).toBe("unsized");
    });

    it("stores a Jira-shaped ticket with no repository, which is decision P6's criterion", async () => {
      // The row V014's shape could not have held: a text identity that is not the display key,
      // no repository anywhere, a null body and an account id where a login would have been.
      const { sourceId } = await source("jira");
      const provider = scriptedProvider({ kind: "jira", pages: [page([jiraTicket()])] });

      await cycleWith([provider]);

      const [stored] = await ticketsOf(sourceId);

      expect(stored.external_id).toBe("10042");
      expect(stored.external_key).toBe("PROJ-142");
      expect(stored.body).toBeNull();
      expect(stored.labels).toStrictEqual([]);
      // V014's `author_login` pattern would have refused this; V030 deliberately carries no
      // login grammar.
      expect(stored.author).toBe("5b10a2844c20165700ede21g");
      expect(JSON.stringify(stored.meta)).not.toContain("repo");
    });

    it("takes a source with no cursor through fullSync and stores what came back", async () => {
      const { sourceId } = await source("github");
      const provider = scriptedProvider({
        pages: [page([githubTicket()], { nextCursor: "2026-09-11T09:00:00Z" })],
      });

      await cycleWith([provider]);

      expect(provider.members).toStrictEqual(["fullSync"]);
      expect((await sourceRow(sourceId)).sync_cursor).toBe("2026-09-11T09:00:00Z");
      expect((await sourceRow(sourceId)).synced_at).not.toBeNull();
    });

    it("does not store a closed ticket it has never seen", async () => {
      const { sourceId } = await source("github");

      const report = await cycleWith([
        scriptedProvider({ pages: [page([githubTicket({ state: "closed" })])] }),
      ]);

      expect(report.sources[0]?.skippedClosed).toBe(1);
      expect(await ticketsOf(sourceId)).toStrictEqual([]);
      // And the source is still stamped: *"we looked and nothing had changed"* is what the
      // freshness tag claims.
      expect((await sourceRow(sourceId)).synced_at).not.toBeNull();
    });
  });

  describe("a second sync", () => {
    /**
     * Sync once, then again with whatever the second page says.
     *
     * @param first - The first page.
     * @param second - The second.
     * @returns The source, the provider and both reports.
     */
    async function twice(
      first: ReturnType<typeof page>,
      second: ReturnType<typeof page>,
      kind: "github" | "jira" = "github",
    ): Promise<{ sourceId: string; provider: ScriptedProvider }> {
      const { sourceId } = await source(kind);
      const provider = scriptedProvider({ kind, pages: [first, second] });

      await cycleWith([provider]);
      await cycleWith([provider]);

      return { sourceId, provider };
    }

    it("hands the stored cursor back to incrementalSync, unchanged", async () => {
      // The round trip a unit test cannot make: through V030's `text` column, its two CHECKs,
      // and back out. The value is deliberately not a timestamp.
      const cursor = "opaque::page-token::7f3a";
      const { provider } = await twice(page([], { nextCursor: cursor }), page());

      expect(provider.members).toStrictEqual(["fullSync", "incrementalSync"]);
      expect(provider.cursors).toStrictEqual([undefined, cursor]);
    });

    it("touches no row when nothing upstream changed", async () => {
      // The idempotence criterion, and the one assertion in this file that only a database can
      // settle: `tickets_touch_updated_at` is unconditional, so a row whose `updated_at` did
      // not move is a row on which no statement ran. `synced_at` is checked beside it because
      // the loop sets that column too — if the update had been issued, *both* would have moved,
      // and comparing one alone could not tell a skipped write from a rewritten one.
      const { sourceId } = await source("github");
      const provider = scriptedProvider({ pages: [page([githubTicket()])] });

      await cycleWith([provider]);

      const [first] = await ticketsOf(sourceId);

      await cycleWith([provider]);

      const [second] = await ticketsOf(sourceId);

      expect(second.updated_at).toStrictEqual(first.updated_at);
      expect(second.synced_at).toStrictEqual(first.synced_at);
    });

    it("rewrites a ticket whose title the tracker changed", async () => {
      const { sourceId } = await source("github");

      await cycleWith([scriptedProvider({ pages: [page([githubTicket()])] })]);

      const [first] = await ticketsOf(sourceId);

      await cycleWith([
        scriptedProvider({ pages: [page([githubTicket({ title: "Watchdog resets, revised" })])] }),
      ]);

      const [second] = await ticketsOf(sourceId);

      expect(second.title).toBe("Watchdog resets, revised");
      // The other half of the case above: a row the tracker really changed *does* move, which
      // is what makes the unchanged case an assertion rather than a tautology.
      expect(second.updated_at.getTime()).toBeGreaterThan(first.updated_at.getTime());
    });

    it("flips state when a ticket closes upstream", async () => {
      const { sourceId } = await twice(
        page([githubTicket()]),
        page([githubTicket({ state: "closed" })]),
      );

      expect((await ticketsOf(sourceId))[0].state).toBe("closed");
    });
  });

  describe("two sources", () => {
    it("let the same external key mean two different tickets", async () => {
      // V030's acceptance criterion, exercised by the writer rather than by a fixture: identity
      // is `(source_id, external_id)`, and `PROJ-142` in two Jira sites is two tickets.
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name)
         values ($1, 'jira', 'Jira · one'), ($1, 'jira', 'Jira · two')
         returning id`,
        [workspace.id],
      );

      // One provider for the kind, two sources through it — which is exactly the shape two
      // Jira sites in one workspace takes.
      const provider = scriptedProvider({ kind: "jira", pages: [page([jiraTicket()])] });

      await cycleWith([provider]);

      for (const row of rows) {
        expect((await ticketsOf(row.id))[0]?.external_key).toBe("PROJ-142");
      }

      const { rows: all } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count from ${SCHEMA_NAME}.tickets`,
      );

      expect(all[0].count).toBe("2");
    });
  });

  describe("a failure", () => {
    it("writes an honest reason onto the source, through V031's CHECK", async () => {
      const { sourceId } = await source("github");
      const failure = new TicketSourceError(
        "rate_limit",
        "429",
        new Date("2026-09-12T14:20:00.000Z"),
      );

      await cycleWith([scriptedProvider({ fails: failure })]);

      expect(await sourceRow(sourceId)).toMatchObject({
        status: "error",
        status_reason: "rate limited until 14:20 UTC",
        // Never stamped: a poll that did not happen must not claim freshness.
        synced_at: null,
      });
    });

    it("is cleared by the next sync that succeeds", async () => {
      // The one moment a source's recovery is knowable is the moment a sync succeeds, so the
      // stamp and the status move in the same transaction.
      const { sourceId } = await source("github");

      await cycleWith([scriptedProvider({ fails: new TicketSourceError("auth", "401") })]);

      expect((await sourceRow(sourceId)).status).toBe("error");

      // The failed source is now `error`, and the loop's filter is `active` — so it has to be
      // put back before it can recover, which is Q.4's pause/resume affordance in miniature.
      await api.sql.query(
        `update ${SCHEMA_NAME}.ticket_sources set status = 'active' where id = $1`,
        [sourceId],
      );

      await cycleWith([scriptedProvider({ pages: [page([githubTicket()])] })]);

      expect(await sourceRow(sourceId)).toMatchObject({ status: "active", status_reason: null });
    });

    it("does not poll a source somebody paused", async () => {
      const { sourceId } = await source("github");

      await api.sql.query(
        `update ${SCHEMA_NAME}.ticket_sources set status = 'paused' where id = $1`,
        [sourceId],
      );

      const provider = scriptedProvider({ pages: [page([githubTicket()])] });
      const report = await cycleWith([provider]);

      expect(report.sources).toStrictEqual([]);
      expect(provider.calls).toStrictEqual([]);
    });
  });

  describe("the credential", () => {
    it("is sealed by the real vault and reaches the provider opened", async () => {
      // What an administrator pasted, through `VaultService.encryptText` and
      // `ticket_sources_credentials_sealed`, out again inside one provider call. The record id
      // is the source id, which is what the AAD binds — so this also proves the loop seals and
      // opens against the same pair.
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name)
         values ($1, 'github', 'GitHub · sealed') returning id`,
        [workspace.id],
      );
      const sourceId = rows[0].id;
      const sealed = await api.nest
        .get(VaultService)
        .encryptText(workspace.id, sourceId, FIXTURE_CREDENTIAL);

      await api.sql.query(
        `update ${SCHEMA_NAME}.ticket_sources set credentials_encrypted = $2 where id = $1`,
        [sourceId, sealed],
      );

      const provider = scriptedProvider();

      await cycleWith([provider]);

      expect(provider.calls[0]?.credentials).toBe(FIXTURE_CREDENTIAL);
    });

    it("is absent from the view every read path selects", async () => {
      // V030's mechanism, asserted where it can be: the column is not in the view at all, so a
      // `select *` through it cannot reach one.
      await source("github");

      const { rows } = await api.sql.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = $1 and table_name = 'ticket_sources_public'`,
        [SCHEMA_NAME],
      );

      expect(rows.map((row) => row.column_name)).not.toContain("credentials_encrypted");
      expect(rows.map((row) => row.column_name)).toContain("status_reason");
    });

    it("is null on a source nobody has credentialed, and the sync still runs", async () => {
      // A tracker serving public projects needs none, and a source exists before anybody has
      // finished configuring it.
      const { sourceId } = await source("github");
      const provider = scriptedProvider({ pages: [page([githubTicket()])] });

      await cycleWith([provider]);

      expect(provider.calls[0]?.credentials).toBeNull();
      expect(await ticketsOf(sourceId)).toHaveLength(1);
    });
  });

  describe("the module as it ships", () => {
    it("registers no provider, so a cycle over a real source polls nothing", async () => {
      // The honest state of this build, end to end: V030 accepts the row, the loop finds it,
      // and nothing can reach the tracker — so it is skipped and the row is left alone.
      const { sourceId } = await source("github");
      const report = await api.nest.get(TicketSourcesService).cycle();

      expect(api.nest.get(TICKET_SOURCE_PROVIDERS)).toStrictEqual([]);
      expect(report.sources[0]?.skipped).toBe("unsupported_kind");
      expect(await sourceRow(sourceId)).toMatchObject({ status: "active", synced_at: null });
    });
  });
});

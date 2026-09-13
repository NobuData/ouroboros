import { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import {
  IN_MEMORY_EPOCH,
  IN_MEMORY_PROJECT,
  InMemoryTicketSourceProvider,
  InMemoryTracker,
  inMemoryCursor,
  readInMemoryCursor,
} from "./providers/in-memory.provider.fixture";
import { FIXTURE_CREDENTIAL } from "./ticket-source.fixture";
import { TicketSourceRegistry } from "./ticket-source.registry";
import { TicketSourcesService } from "./ticket-sources.service";
import { cycleWith, insertSource, sourceRow, ticketsOf } from "./ticket-sync.integration.fixture";

/**
 * The loop against a migrated database ([#139](https://github.com/NobuData/ouroboros/issues/139)),
 * on the in-memory provider ([#142](https://github.com/NobuData/ouroboros/issues/142)).
 *
 * The unit suites run this code over recorded statements, and that is exactly what makes this one
 * necessary. Six things can only be asserted here, and five of them are acceptance criteria:
 *
 *   * **A canonical row survives V030's constraints** — for a ticket whose key is its display form
 *     *and* for one of another kind with no body, no labels and an account id for an author, which
 *     is decision **P6**'s own criterion. A unit test cannot say whether a row is one the server
 *     accepts.
 *   * **A re-sync touches no rows.** The *touches no rows* half is a claim about `updated_at`, which
 *     only `tickets_touch_updated_at` can move — so only a database can prove it did not.
 *   * **A cursor round-trips.** Stored, read back, handed to `incrementalSync` unchanged — a trip
 *     through a `text` column and V030's two CHECKs that no unit test crosses.
 *   * **A failure lands in `status` and V031's `status_reason`**, through
 *     `ticket_sources_status_reason_present`, and a later success clears both.
 *   * **The credential is sealed by the real vault and opened by the loop** — so what a provider
 *     receives is what an administrator actually pasted.
 *   * **`ticket_sources_public` really is the read path**, and the one statement that names the
 *     table is the one that opens the secret.
 *
 * ---------------------------------------------------------------------------
 * **Every case runs on `InMemoryTicketSourceProvider`, and nothing here imports Octokit.** That is
 * Q.5's third acceptance criterion — *the core intake harness runs entirely on the fake* — and it
 * is a better harness for the loop than the double it replaces, because the fake has behaviour: a
 * tracker that refuses a token it does not recognise, serves a record that closed before anybody saw
 * it, and resumes after the cursor it wrote. So the credential case proves the opened value by the
 * tracker *accepting* it, and the cursor case by what the tracker's access log was asked.
 * `.dependency-cruiser.cjs`'s `ticket-source-core-tests-run-on-the-fake` makes an Octokit, GitHub
 * fixture or GitHub provider import here a lint failure.
 *
 * **GitHub end to end is `providers/github.provider.integration-spec.ts`** — Q.3's criterion that the
 * intake MVP holds through the SPI, moved beside the provider it is about.
 *
 * The cycle is driven from the injector rather than by waiting for the scheduler; the loop's own
 * timing is `ticket-sources.scheduler.spec.ts`'s, under fake timers. The harness is started with a
 * day-long interval so the application's own loop cannot fire a competing cycle mid-test.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

describe("the ticket source sync, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    // A day, so the application's own loop cannot fire a cycle in the middle of a test.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  /** The settings every source here is configured with — the in-memory kind's grammar. */
  const CONFIG = { project: IN_MEMORY_PROJECT };

  /**
   * A workspace with one source mirroring the in-memory tracker's project.
   *
   * @param kind - Which kind the row claims. `custom` is the in-memory provider's own.
   * @param options - A credential to seal, or a cursor from an earlier sync.
   * @returns The workspace and the source.
   */
  function source(
    kind: "custom" | "jira" = "custom",
    options: { credential?: string; cursor?: string } = {},
  ) {
    return insertSource(api, { kind, config: CONFIG, ...options });
  }

  /**
   * A tracker serving its project to anybody — so a source with no credential still syncs, and the
   * credential cases can be about the credential alone.
   *
   * @returns The tracker.
   */
  function publicTracker(): InMemoryTracker {
    return new InMemoryTracker({ token: null });
  }

  describe("a first sync", () => {
    it("stores a canonical ticket the server accepts", async () => {
      const { sourceId } = await source();
      const tracker = publicTracker();

      tracker.file({
        summary: "Watchdog timer resets during I2C bus recovery",
        description: "The watchdog fires while the bus is being recovered.",
        tags: ["bug", "i2c", "watchdog"],
        reporter: "field-support",
      });

      const report = await cycleWith(api, [new InMemoryTicketSourceProvider(tracker)]);

      expect(report.sources[0]?.imported).toBe(1);

      const [stored] = await ticketsOf(api, sourceId);

      expect(stored).toMatchObject({
        external_id: "10001",
        external_key: "PROJ-1",
        external_url: "https://tracker.example.invalid/browse/PROJ-1",
        labels: ["bug", "i2c", "watchdog"],
        author: "field-support",
        meta: { custom: { project: "PROJ", status: "todo" } },
        // V014's vocabulary and default, verbatim, so the estimation pipeline needs no change.
        sizing_status: "unsized",
      });
    });

    it("stores a ticket whose key is not its identity, with no body, no labels and no repository — decision P6's criterion", async () => {
      // The row V014's shape could not have held: a text identity that is not the display key, no
      // repository anywhere, a null body and an account id where a login would have been.
      const { sourceId } = await source("jira");
      const tracker = publicTracker();

      tracker.file({
        summary: "Calibration drifts after firmware rollback",
        reporter: "5b10a2844c20165700ede21g",
      });

      await cycleWith(api, [new InMemoryTicketSourceProvider(tracker, { kind: "jira" })]);

      const [stored] = await ticketsOf(api, sourceId);

      expect(stored.external_id).toBe("10001");
      expect(stored.external_key).toBe("PROJ-1");
      expect(stored.body).toBeNull();
      expect(stored.labels).toStrictEqual([]);
      // V014's `author_login` pattern would have refused this; V030 deliberately carries no login
      // grammar.
      expect(stored.author).toBe("5b10a2844c20165700ede21g");
      expect(JSON.stringify(stored.meta)).not.toContain("repo");
    });

    it("takes a source with no cursor through fullSync and stores the cursor it answered", async () => {
      const { sourceId } = await source();
      const tracker = publicTracker();
      const record = tracker.file({ summary: "Watchdog timer resets during I2C bus recovery" });

      await cycleWith(api, [new InMemoryTicketSourceProvider(tracker)]);

      // A cold import is a listing of open records from the beginning — the tracker's log is where
      // the loop's full-or-incremental decision shows.
      expect(tracker.requests).toStrictEqual([
        { operation: "list", project: "PROJ", openOnly: true, after: null },
      ]);
      expect(await sourceRow(api, sourceId)).toMatchObject({ sync_cursor: inMemoryCursor(record) });
      expect((await sourceRow(api, sourceId)).synced_at).not.toBeNull();
    });

    it("does not store a closed ticket it has never seen", async () => {
      const tracker = publicTracker();
      const seen = tracker.file({ summary: "Mirrored by an earlier sync" });
      const closed = tracker.file({
        summary: "Opened and closed between two polls",
        status: "done",
      });
      // A source that has synced before, up to `seen` — so the next sync is incremental and asks
      // for every record, closed ones included.
      const { sourceId } = await source("custom", { cursor: inMemoryCursor(seen) });

      const report = await cycleWith(api, [new InMemoryTicketSourceProvider(tracker)]);

      expect(report.sources[0]?.skippedClosed).toBe(1);
      expect(await ticketsOf(api, sourceId)).toStrictEqual([]);
      // And the source still moved on: *"we looked, and there was nothing to store"* is what the
      // watermark records.
      expect((await sourceRow(api, sourceId)).sync_cursor).toBe(inMemoryCursor(closed));
    });
  });

  describe("a second sync", () => {
    it("hands the stored cursor back to incrementalSync, unchanged", async () => {
      // The round trip a unit test cannot make: through V030's `text` column, its two CHECKs, and
      // back out. The value is deliberately not something the loop could read as a date.
      const { sourceId } = await source();
      const tracker = publicTracker();
      const record = tracker.file({ summary: "Watchdog timer resets during I2C bus recovery" });
      const provider = new InMemoryTicketSourceProvider(tracker);

      await cycleWith(api, [provider]);
      await cycleWith(api, [provider]);

      const cursor = (await sourceRow(api, sourceId)).sync_cursor;

      expect(cursor).toBe(inMemoryCursor(record));
      expect(Number.isNaN(new Date(String(cursor)).getTime())).toBe(true);
      expect(tracker.requests.map((request) => request.after)).toStrictEqual([
        null,
        readInMemoryCursor(inMemoryCursor(record)),
      ]);
    });

    it("touches no row when a sync reads an unchanged ticket again", async () => {
      // The idempotence criterion, and the one assertion in this file only a database can settle:
      // `tickets_touch_updated_at` is unconditional, so a row whose `updated_at` did not move is a
      // row on which no statement ran. `synced_at` is checked beside it because the loop sets that
      // column too — if the update had been issued, *both* would have moved.
      const { sourceId } = await source();
      const tracker = publicTracker();

      tracker.file({ summary: "Watchdog timer resets during I2C bus recovery" });

      const provider = new InMemoryTicketSourceProvider(tracker);

      await cycleWith(api, [provider]);

      const [first] = await ticketsOf(api, sourceId);

      // The watermark put back behind the record, so the next sync reads it again — which is what
      // an inclusive cursor does on every poll, and the case the loop's comparison exists for.
      await api.sql.query(
        `update ${SCHEMA_NAME}.ticket_sources set sync_cursor = $2 where id = $1`,
        [sourceId, inMemoryCursor({ updated: IN_MEMORY_EPOCH.toISOString(), id: "0" })],
      );

      const report = await cycleWith(api, [provider]);
      const [second] = await ticketsOf(api, sourceId);

      expect(report.sources[0]).toMatchObject({ imported: 0, updated: 0, unchanged: 1 });
      expect(second.updated_at).toStrictEqual(first.updated_at);
      expect(second.synced_at).toStrictEqual(first.synced_at);
    });

    it("rewrites a ticket whose title the tracker changed", async () => {
      const { sourceId } = await source();
      const tracker = publicTracker();
      const record = tracker.file({ summary: "Watchdog timer resets during I2C bus recovery" });
      const provider = new InMemoryTicketSourceProvider(tracker);

      await cycleWith(api, [provider]);

      const [first] = await ticketsOf(api, sourceId);

      tracker.edit(record.id, { summary: "Watchdog resets, revised" });
      await cycleWith(api, [provider]);

      const [second] = await ticketsOf(api, sourceId);

      expect(second.title).toBe("Watchdog resets, revised");
      // The other half of the case above: a row the tracker really changed *does* move, which is
      // what makes the unchanged case an assertion rather than a tautology.
      expect(second.updated_at.getTime()).toBeGreaterThan(first.updated_at.getTime());
    });

    it("flips state when a ticket closes upstream", async () => {
      const { sourceId } = await source();
      const tracker = publicTracker();
      const record = tracker.file({ summary: "Watchdog timer resets during I2C bus recovery" });
      const provider = new InMemoryTicketSourceProvider(tracker);

      await cycleWith(api, [provider]);
      tracker.transition(record.id, "done");
      await cycleWith(api, [provider]);

      expect((await ticketsOf(api, sourceId))[0].state).toBe("closed");
    });
  });

  describe("two sources", () => {
    it("let the same external key mean two different tickets", async () => {
      // V030's acceptance criterion, exercised by the writer rather than by a fixture: identity is
      // `(source_id, external_id)`, and `PROJ-1` in two sites is two tickets.
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
         values ($1, 'jira', 'Jira · one', $2::jsonb), ($1, 'jira', 'Jira · two', $2::jsonb)
         returning id`,
        [workspace.id, JSON.stringify(CONFIG)],
      );
      const tracker = publicTracker();

      tracker.file({ summary: "Calibration drifts after firmware rollback" });

      // One provider for the kind, two sources through it — which is exactly the shape two Jira
      // sites in one workspace takes.
      await cycleWith(api, [new InMemoryTicketSourceProvider(tracker, { kind: "jira" })]);

      for (const row of rows) {
        expect((await ticketsOf(api, row.id))[0]?.external_key).toBe("PROJ-1");
      }

      const { rows: all } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count from ${SCHEMA_NAME}.tickets`,
      );

      expect(all[0].count).toBe("2");
    });
  });

  describe("a failure", () => {
    it("writes an honest reason onto the source, through V031's CHECK", async () => {
      const { sourceId } = await source();
      const tracker = publicTracker();

      tracker.refuse("rate_limit", new Date("2026-09-12T14:20:00.000Z"));
      await cycleWith(api, [new InMemoryTicketSourceProvider(tracker)]);

      expect(await sourceRow(api, sourceId)).toMatchObject({
        status: "error",
        status_reason: "rate limited until 14:20 UTC",
        // Never stamped: a poll that did not happen must not claim freshness.
        synced_at: null,
      });
    });

    it("is cleared by the next sync that succeeds", async () => {
      // The one moment a source's recovery is knowable is the moment a sync succeeds, so the stamp
      // and the status move in the same transaction.
      const { sourceId } = await source();
      const tracker = publicTracker();
      const provider = new InMemoryTicketSourceProvider(tracker);

      tracker.file({ summary: "Watchdog timer resets during I2C bus recovery" });
      tracker.refuse("auth");
      await cycleWith(api, [provider]);

      expect(await sourceRow(api, sourceId)).toMatchObject({
        status: "error",
        status_reason: "credentials rejected (401)",
      });

      // The failed source is now `error`, and the loop's filter is `active` — so it has to be put
      // back before it can recover, which is Q.4's pause and resume affordance in miniature.
      await api.sql.query(
        `update ${SCHEMA_NAME}.ticket_sources set status = 'active' where id = $1`,
        [sourceId],
      );
      tracker.recover();
      await cycleWith(api, [provider]);

      expect(await sourceRow(api, sourceId)).toMatchObject({
        status: "active",
        status_reason: null,
      });
      expect(await ticketsOf(api, sourceId)).toHaveLength(1);
    });

    it("does not poll a source somebody paused", async () => {
      const { sourceId } = await source();

      await api.sql.query(
        `update ${SCHEMA_NAME}.ticket_sources set status = 'paused' where id = $1`,
        [sourceId],
      );

      const tracker = publicTracker();
      const report = await cycleWith(api, [new InMemoryTicketSourceProvider(tracker)]);

      expect(report.sources).toStrictEqual([]);
      expect(tracker.requests).toStrictEqual([]);
    });
  });

  describe("the credential", () => {
    it("is sealed by the real vault and reaches the provider opened", async () => {
      // What an administrator pasted, through `VaultService.encryptText` and
      // `ticket_sources_credentials_sealed`, out again inside one provider call. The tracker only
      // answers the token it was set up with, so a sync that stores a ticket is a sync that was
      // handed exactly that token.
      const tracker = new InMemoryTracker({ token: FIXTURE_CREDENTIAL });

      tracker.file({ summary: "Watchdog timer resets during I2C bus recovery" });

      const { sourceId } = await source("custom", { credential: FIXTURE_CREDENTIAL });

      await cycleWith(api, [new InMemoryTicketSourceProvider(tracker)]);

      expect(await sourceRow(api, sourceId)).toMatchObject({
        status: "active",
        status_reason: null,
      });
      expect(await ticketsOf(api, sourceId)).toHaveLength(1);
    });

    it("that the tracker does not recognise is refused as auth", async () => {
      // The other half of the case above: a sealed value that opens to something else fails, so the
      // success there is about the value rather than about there being one.
      const tracker = new InMemoryTracker({ token: FIXTURE_CREDENTIAL });
      const { sourceId } = await source("custom", {
        credential: "imt_a_different_credential_entirely_0000",
      });

      await cycleWith(api, [new InMemoryTicketSourceProvider(tracker)]);

      expect(await sourceRow(api, sourceId)).toMatchObject({
        status: "error",
        status_reason: "credentials rejected (401)",
      });
    });

    it("is absent from the view every read path selects", async () => {
      // V030's mechanism, asserted where it can be: the column is not in the view at all, so a
      // `select *` through it cannot reach one.
      await source();

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
      const { sourceId } = await source();
      const tracker = publicTracker();

      tracker.file({ summary: "Watchdog timer resets during I2C bus recovery" });
      await cycleWith(api, [new InMemoryTicketSourceProvider(tracker)]);

      expect(await ticketsOf(api, sourceId)).toHaveLength(1);
    });
  });

  describe("the module as it ships", () => {
    it("registers the GitHub provider, and skips a kind it has none for", async () => {
      // The honest state of this build, end to end: `github` resolves, `jira` does not, and the row
      // of a kind nothing can reach is skipped and left alone rather than marked failed. The
      // in-memory provider is a fixture and is registered by suites, never by the module.
      const { sourceId } = await source("jira");
      const report = await api.nest.get(TicketSourcesService).cycle();

      expect(api.nest.get(TicketSourceRegistry).kinds()).toStrictEqual(["github"]);
      expect(report.sources[0]?.skipped).toBe("unsupported_kind");
      expect(await sourceRow(api, sourceId)).toMatchObject({ status: "active", synced_at: null });
    });
  });
});

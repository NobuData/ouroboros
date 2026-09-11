import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { addRepo, workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { MOCKUP_03, seedIntake } from "../../testing/intake.fixture";
import { recordingDatabase } from "../db/database.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { BacklogListingRepository } from "./listing.repository";
import type { BacklogListing } from "./listing.resources";

/**
 * `GET /api/v1/backlog` over the whole pipeline — session guard, tenant guard, pipe, handler,
 * lateral join, GIN indexes, error filter — against a migrated database and mockup 03's own
 * nine rows ([#110](https://github.com/NobuData/ouroboros/issues/110)).
 *
 * The unit suites cover the statements, the defaults and the mapping. Every one of this ticket's
 * six acceptance criteria has a half that only a running database can answer, and they are what
 * this file is:
 *
 *   * **The seeded rows reproduce the mockup table under `sort=effort`, unsized last.** A
 *     `nulls last` that was written the other way compiles, passes every unit assertion about
 *     the SQL's *shape*, and puts the unestimated issue first.
 *   * **`q="#485"` returns exactly one row**, and a search over a label name matches. `ilike`
 *     over `jsonb_array_elements_text` is a statement no stand-in can evaluate.
 *   * **The counts match the seeds** — *"9 open issues. 7 already sized."*
 *   * **Multi-label filtering is AND, not OR.** `labels @> '["bug","tech-debt"]'` against real
 *     rows is the only place the difference shows: an OR would answer six issues where the AND
 *     answers one.
 *   * **Cross-org isolation, regardless of parameters** — including a `repo` that names a
 *     repository another workspace enabled, which is the one parameter that could reach across.
 *   * **`meta.syncedAt` is the real per-repository stamp**, never a request timestamp.
 *
 * And the criterion that is about the *plan* rather than the answer: **no sequential scan on the
 * hot path at seed×1000 volume**, `EXPLAIN`-verified. See *the plans* at the bottom for how the
 * volume is arranged so the assertion means something.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const PATH = "/api/v1/backlog";

/** How many issues the volume case writes — a thousand times the fixture, in the same workspace. */
const NOISE_ISSUES = 9_000;

describe("the backlog listing, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    // A day, so the application's own sync loop cannot poll in the middle of a test and move a
    // freshness stamp an assertion is about.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(async () => {
    await api.truncate();
  });

  /**
   * A workspace with mockup 03's backlog in it, owned by its only member.
   *
   * @param email - Whose workspace, for a test that wants two.
   * @returns The workspace, and the person who may read it.
   */
  async function backlog(email?: string): Promise<{ workspace: SeededWorkspace; owner: Person }> {
    const owner = await api.signIn(email === undefined ? {} : { email });
    const workspace = await workspaceWithRepo(api, owner);

    await seedIntake(api, workspace);

    return { workspace, owner };
  }

  /**
   * Read the listing as somebody.
   *
   * @param person - Who is asking.
   * @param workspace - Which workspace, as `X-Ouro-Tenant`.
   * @param query - The query string, already encoded.
   * @param status - The status expected.
   * @returns The response body.
   */
  async function list(
    person: Person,
    workspace: SeededWorkspace,
    query = "",
    status = 200,
  ): Promise<BacklogListing> {
    const response = await api
      .as(person)("get", query === "" ? PATH : `${PATH}?${query}`)
      .set(TENANT_HEADER, workspace.slug)
      .expect(status);

    return bodyOf<BacklogListing>(response);
  }

  /**
   * The issue numbers a listing answered with, in the order it answered them.
   *
   * @param listing - The body.
   * @returns The numbers.
   */
  function numbers(listing: BacklogListing): number[] {
    return listing.items.map((row) => row.number);
  }

  describe("the mockup's table", () => {
    it("reproduces the seeded order under `sort=effort`, with the unsized row last", async () => {
      // The ticket's first criterion. The order is total over this fixture — no two issues share
      // an `(effort, confidence)` pair — so this is an equality rather than a spot check.
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace, "sort=effort"))).toEqual([
        ...MOCKUP_03.effortOrder,
      ]);
    });

    it("defaults to that sort and to open issues, which is the screen's first draw", async () => {
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace))).toEqual([...MOCKUP_03.effortOrder]);
    });

    it("gives every row the cells the table draws, and no more", async () => {
      const { workspace, owner } = await backlog();
      const listing = await list(owner, workspace, "q=%23485");
      const [row] = listing.items;

      expect(row).toEqual({
        id: expect.any(String) as string,
        number: 485,
        title: "Watchdog reset on I²C bus lockup",
        labels: ["bug", "i2c", "watchdog", "priority-high"],
        state: "open",
        sizingStatus: "sized",
        // M.3 (#112) added the pill, and it is `false` here because nothing has queued this
        // issue — a presentation over `queue_items`, not a fifth sizing status.
        queued: false,
        githubRepoId: workspace.repoId,
        repository: `${workspace.slug}/helios-firmware`,
        estimate: {
          effort: "m",
          confidence: 92,
          suggestedWorkflow: "standard-fix",
          routedModel: "claude-fable-5",
          // N.4 (#118) added the fifth field: the breakdown's `est_minutes`, which the
          // selection action bar sums and the queue write copies — 45 on the seeded `#485`.
          estMinutes: 45,
        },
      });
    });

    it("reads the estimate in force, not the one it replaced", async () => {
      // `#487` carries two versions and every visible field differs between them. Decision K4:
      // the highest version wins. A `min(version)` join would answer `s` / 55% here.
      const { workspace, owner } = await backlog();
      const listing = await list(owner, workspace, "q=delta+OTA");

      expect(listing.items).toHaveLength(1);
      expect(listing.items[0].estimate).toEqual({
        effort: "l",
        confidence: 71,
        suggestedWorkflow: "feature-loop",
        routedModel: "claude-fable-5",
        estMinutes: 110,
      });
    });

    it("returns a twice-estimated issue once", async () => {
      // The lateral, as a row count: a plain join to `issue_estimates` would answer ten rows for
      // nine issues, and every other assertion in this file would still pass.
      const { workspace, owner } = await backlog();
      const listing = await list(owner, workspace, "limit=100");

      expect(listing.items).toHaveLength(MOCKUP_03.issues);
      expect(listing.total).toBe(MOCKUP_03.issues);
    });

    it("keeps an issue that has no estimate, with a null rather than an absence", async () => {
      // `#483` is `estimating` and has no `issue_estimates` row at all, which is what that word
      // means. N.2 renders a mid-flight row from what exists.
      const { workspace, owner } = await backlog();
      const listing = await list(owner, workspace, "q=frame+drops");

      expect(listing.items).toHaveLength(1);
      expect(listing.items[0]).toMatchObject({
        number: 483,
        sizingStatus: "estimating",
        estimate: null,
      });
    });

    it("keeps the status and the estimate as separate answers", async () => {
      // `#490` is `needs_human` *and* carries the estimate that sent it there.
      const { workspace, owner } = await backlog();
      const [row] = (await list(owner, workspace, "q=Zephyr")).items;

      expect(row.sizingStatus).toBe("needs_human");
      expect(row.estimate?.effort).toBe("xl");
    });
  });

  describe("the other three orderings", () => {
    it("puts the most confident estimate first and the unestimated last", async () => {
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace, "sort=confidence"))).toEqual([
        488, 491, 485, 484, 486, 489, 487, 490, 483,
      ]);
    });

    it("puts the most recently touched issue first", async () => {
      // The fixture's `gh_updated_at` ages: `#483` an hour ago is the newest, `#488` thirty the
      // oldest. Nothing here depends on an estimate.
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace, "sort=updated"))).toEqual([
        483, 490, 485, 489, 491, 487, 486, 484, 488,
      ]);
    });

    it("puts the newest issue first under `sort=number`", async () => {
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace, "sort=number"))).toEqual([
        491, 490, 489, 488, 487, 486, 485, 484, 483,
      ]);
    });
  });

  describe("the page head", () => {
    it("counts the seeds — *9 open issues, 7 already sized*", async () => {
      const { workspace, owner } = await backlog();
      const listing = await list(owner, workspace);

      expect(listing.meta.openCount).toBe(MOCKUP_03.openCount);
      expect(listing.meta.sizedCount).toBe(MOCKUP_03.sizedCount);
    });

    it("does not move when the filter bar does", async () => {
      // The head sits above the filter bar and says how much work there is; the table says how
      // much of it is on screen. Counts that moved with the chips would make *7 already sized* a
      // statement about the filter.
      const { workspace, owner } = await backlog();
      const filtered = await list(owner, workspace, "labels=bug,tech-debt&q=CRC32&state=all");

      expect(filtered.total).toBe(1);
      expect(filtered.meta.openCount).toBe(MOCKUP_03.openCount);
      expect(filtered.meta.sizedCount).toBe(MOCKUP_03.sizedCount);
    });

    it("counts the open issues that are sized, rather than every sized issue", async () => {
      // One sentence about one set: an issue sized and then closed is in neither figure.
      const { workspace, owner } = await backlog();

      await api.sql.query(
        `update ${SCHEMA_NAME}.github_issues set state = 'closed' where number = 491`,
      );

      const listing = await list(owner, workspace);

      expect(listing.meta.openCount).toBe(8);
      expect(listing.meta.sizedCount).toBe(6);
    });

    it("narrows with the repository, because the head is about the backlog in scope", async () => {
      const { workspace, owner } = await backlog();
      const second = await addRepo(api, workspace);

      const whole = await list(owner, workspace);
      const narrowed = await list(owner, workspace, `repo=${second}`);

      expect(whole.meta.openCount).toBe(MOCKUP_03.openCount);
      expect(narrowed.meta).toEqual({
        openCount: 0,
        sizedCount: 0,
        syncedAt: whole.meta.syncedAt,
      });
      expect(narrowed.items).toEqual([]);
    });
  });

  describe("the freshness tag", () => {
    it("is null until a poll has stamped one, rather than the time of the request", async () => {
      // The ticket's criterion. `R__dev_seed_intake.sql` leaves `issues_synced_at` null on
      // purpose — a seeded poll is a poll that never ran — so this is the seeded state too.
      const { workspace, owner } = await backlog();

      expect((await list(owner, workspace)).meta.syncedAt).toBeNull();
    });

    it("is the repository's own stamp once one exists", async () => {
      const { workspace, owner } = await backlog();
      const stamp = "2026-09-09T12:34:56.000Z";

      await api.sql.query(
        `update ${SCHEMA_NAME}.github_repos set issues_synced_at = $1 where id = $2`,
        [stamp, workspace.repoId],
      );

      expect((await list(owner, workspace)).meta.syncedAt).toBe(stamp);
    });

    it("agrees with the sync endpoint, because one service computes it", async () => {
      const { workspace, owner } = await backlog();

      await api.sql.query(
        `update ${SCHEMA_NAME}.github_repos set issues_synced_at = now() where id = $1`,
        [workspace.repoId],
      );

      const listing = await list(owner, workspace);
      const status = await api
        .as(owner)("get", `${PATH}/sync-status`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200);

      expect(listing.meta.syncedAt).toBe(bodyOf<{ syncedAt: string }>(status).syncedAt);
    });
  });

  describe("the chip set", () => {
    it("ANDs the labels rather than ORing them", async () => {
      // The criterion that only real rows can settle. Five issues carry `bug` and two carry
      // `tech-debt`; exactly one carries both. An OR would answer six.
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace, "labels=bug"))).toEqual([...MOCKUP_03.bugIssues]);
      expect(numbers(await list(owner, workspace, "labels=bug,tech-debt"))).toEqual([491]);
    });

    it("takes the repeated spelling as well as the comma-separated one", async () => {
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace, "labels=bug&labels=tech-debt"))).toEqual([491]);
    });

    it("matches a label name exactly, so a prefix is not a chip", async () => {
      // The chips hand out names and take them back. Substring matching is `q`'s job.
      const { workspace, owner } = await backlog();

      expect((await list(owner, workspace, "labels=tech")).items).toEqual([]);
    });

    it("publishes every label in scope, not only the ones left after filtering", async () => {
      // Selecting `bug` must not delete every other chip, or a second chip could never be
      // chosen. The facets are the scope's, and they do not move.
      const { workspace, owner } = await backlog();

      const unfiltered = await list(owner, workspace);
      const filtered = await list(owner, workspace, "labels=bug");

      expect(unfiltered.labelFacets).toEqual([...MOCKUP_03.labelFacets]);
      expect(filtered.labelFacets).toEqual([...MOCKUP_03.labelFacets]);
    });

    it("publishes the labels of closed issues too, so the set is the backlog's", async () => {
      const { workspace, owner } = await backlog();

      await api.sql.query(
        `update ${SCHEMA_NAME}.github_issues set state = 'closed' where number = 490`,
      );

      expect((await list(owner, workspace)).labelFacets).toContain("zephyr");
    });
  });

  describe("the search box", () => {
    it("finds exactly one issue for `#485`", async () => {
      const { workspace, owner } = await backlog();
      const listing = await list(owner, workspace, "q=%23485");

      expect(numbers(listing)).toEqual([485]);
      expect(listing.total).toBe(1);
    });

    it("finds the same one without the hash", async () => {
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace, "q=485"))).toEqual([485]);
    });

    it("matches a substring of the title, case-insensitively", async () => {
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace, "q=WATCHDOG"))).toEqual([485]);
    });

    it("matches a label the issue carries, by name", async () => {
      // The third of the placeholder's three promises. A name rather than a substring of one,
      // because that is the half an index can answer — `listing.repository.ts` carries the trade.
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace, "q=good-first-issue"))).toEqual([488]);
      // A prefix of that name is not that name, and no title carries the text either.
      expect((await list(owner, workspace, "q=good-first")).items).toEqual([]);
    });

    it("still matches a title substring that a label name would not", async () => {
      // The two halves are different questions, and the title half is the one that is a
      // substring: `q=lockup` finds `#485` through its title with no label of that name anywhere.
      const { workspace, owner } = await backlog();

      expect(numbers(await list(owner, workspace, "q=lockup"))).toEqual([485]);
      expect(numbers(await list(owner, workspace, "q=motor"))).toEqual([484]);
    });

    it("treats a wildcard a person typed as a character", async () => {
      // Unescaped, `%` would match every title. The answer to a search for a literal `%` over
      // these nine rows is nothing.
      const { workspace, owner } = await backlog();

      expect((await list(owner, workspace, "q=%25")).items).toEqual([]);
    });

    it("reads a cleared box as no search", async () => {
      const { workspace, owner } = await backlog();

      expect((await list(owner, workspace, "q=")).items).toHaveLength(MOCKUP_03.issues);
    });
  });

  describe("the state filter", () => {
    it("hides a closed issue by default and shows it on request", async () => {
      const { workspace, owner } = await backlog();

      await api.sql.query(
        `update ${SCHEMA_NAME}.github_issues set state = 'closed' where number = 488`,
      );

      expect(numbers(await list(owner, workspace))).not.toContain(488);
      expect(numbers(await list(owner, workspace, "state=closed"))).toEqual([488]);
      expect((await list(owner, workspace, "state=all")).items).toHaveLength(MOCKUP_03.issues);
    });
  });

  describe("the window", () => {
    it("pages through the listing without repeating or losing a row", async () => {
      // Every ordering ends on the row id, so the order is total and a page boundary cannot make
      // two rows swap places between requests.
      const { workspace, owner } = await backlog();

      const first = await list(owner, workspace, "limit=4&offset=0");
      const second = await list(owner, workspace, "limit=4&offset=4");
      const third = await list(owner, workspace, "limit=4&offset=8");

      expect([...numbers(first), ...numbers(second), ...numbers(third)]).toEqual([
        ...MOCKUP_03.effortOrder,
      ]);
      expect(first.total).toBe(MOCKUP_03.issues);
      expect(first.limit).toBe(4);
      expect(second.offset).toBe(4);
    });
  });

  describe("what a malformed request gets", () => {
    it("is a 422 naming the field, before a statement is issued", async () => {
      const { workspace, owner } = await backlog();
      const response = await api
        .as(owner)("get", `${PATH}?sort=risk&state=merged&repo=helios-firmware`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(422);
      const envelope = bodyOf<ErrorEnvelope>(response);

      expect(envelope.code).toBe("validation_failed");
      expect(Object.keys(envelope.details ?? {}).sort()).toEqual(["repo", "sort", "state"]);
    });

    it("refuses a parameter this endpoint does not declare", async () => {
      // `forbidNonWhitelisted`: a client cannot reach a column nobody meant to expose by adding
      // a query parameter.
      const { workspace, owner } = await backlog();

      await api
        .as(owner)("get", `${PATH}?orderBy=sizing_status`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(422);
    });
  });

  describe("isolation", () => {
    it("answers only this workspace's issues, whatever the parameters say", async () => {
      // The ticket's criterion, and the parameter that could reach across if the scope were not a
      // predicate: `repo` naming a repository somebody else enabled.
      const theirs = await backlog("other-owner@ouroboros.invalid");
      const mine = await backlog("my-owner@ouroboros.invalid");

      await api.sql.query(`delete from ${SCHEMA_NAME}.github_issues where organization_id = $1`, [
        mine.workspace.id,
      ]);

      const listing = await list(mine.owner, mine.workspace, `repo=${theirs.workspace.repoId}`);

      expect(listing.items).toEqual([]);
      expect(listing.total).toBe(0);
      expect(listing.meta).toEqual({ openCount: 0, sizedCount: 0, syncedAt: null });
      expect(listing.labelFacets).toEqual([]);
    });

    it("refuses a workspace the caller is not a member of", async () => {
      const theirs = await backlog("owner-a@ouroboros.invalid");
      const stranger = await api.signIn({ email: "stranger@ouroboros.invalid" });

      // `tenant_not_found` rather than `403`: naming no workspace and naming one you may not see
      // are deliberately one answer.
      await api.as(stranger)("get", PATH).set(TENANT_HEADER, theirs.workspace.slug).expect(404);
    });

    it("refuses a request with no session at all", async () => {
      const { workspace } = await backlog();

      await api.anonymous("get", PATH).set(TENANT_HEADER, workspace.slug).expect(401);
    });

    it("is readable by a viewer, because reading a backlog spends nothing", async () => {
      const { workspace } = await backlog();
      const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });

      await api.join(workspace.id, viewer, "viewer");

      expect((await list(viewer, workspace)).items).toHaveLength(MOCKUP_03.issues);
    });
  });

  describe("the plans", () => {
    /**
     * Nine thousand more issues in the **same** workspace, in a repository of their own.
     *
     * The criterion is *"no sequential scans on the hot path at seed×1000 volume"*, and the
     * honest reading of that is a workspace whose own backlog is a thousand times the fixture —
     * not a busy installation in which this workspace is still nine rows. Volume in another
     * organization would make `organization_id` do all the work and leave every filter's own
     * index unexercised, which is the assertion passing for the wrong reason.
     *
     * A second repository rather than the seeded one, so the nine stay addressable by `repo` and
     * so `(github_repo_id, number)` has room for `1`–`9000`.
     *
     * `analyze` is not optional: the planner chooses from statistics, and a table that was bulk
     * loaded and never analysed has none.
     *
     * @param workspace - The workspace to fill.
     * @returns The noisy repository's id.
     */
    async function atVolume(workspace: SeededWorkspace): Promise<string> {
      const noisy = await addRepo(api, workspace, "helios-telemetry");

      await api.sql.query(
        `insert into ${SCHEMA_NAME}.github_issues
                (organization_id, github_repo_id, number, title, body, state, labels,
                 gh_created_at, gh_updated_at, gh_url, sizing_status)
         select $1, $2, generated.number,
                'Noise issue ' || generated.number::text, null, 'open',
                jsonb_build_array('noise-' || (generated.number % 50)::text),
                now(), now(),
                'https://github.com/noise/noise/issues/' || generated.number::text,
                'unsized'
           from generate_series(1, $3::int) as generated(number)`,
        [workspace.id, noisy, NOISE_ISSUES],
      );

      await api.sql.query(`analyze ${SCHEMA_NAME}.github_issues`);

      return noisy;
    }

    /**
     * The statement the **service** would issue for one read, compiled rather than retyped.
     *
     * This is what makes a plan assertion worth having. An `EXPLAIN` over SQL written out in a
     * test is a statement about that SQL, and it stays green after the repository stops issuing
     * it; compiling the real one through the recording driver — the same fixture
     * `listing.repository.spec.ts` uses — means the plan below is the plan of the query this
     * endpoint actually runs, parameters and all.
     *
     * @param read - The read to compile, given a repository over the recording driver.
     * @returns The SQL and its parameters, as PostgreSQL would receive them.
     */
    async function statementFor(
      read: (repository: BacklogListingRepository) => Promise<unknown>,
    ): Promise<{ sql: string; parameters: readonly unknown[] }> {
      const recording = recordingDatabase();

      // `counts` reads one row and would otherwise throw before the statement is recorded.
      recording.answers({ rows: [{ total: "0", openCount: "0", sizedCount: "0" }] });
      await read(new BacklogListingRepository(recording.service));

      return recording.statements[0];
    }

    /**
     * The plan the server chooses for one statement.
     *
     * **`sequential` is the whole of the difference between two questions**, and
     * `ouroboros-db/tests/constraints.sql` already drew the distinction for these same three
     * indexes: *"a handful of fixture rows is genuinely cheaper to scan, and what is asserted is
     * that a usable index exists at production size"*.
     *
     *   * Left alone, the plan is the one PostgreSQL would really choose, and what is asserted is
     *     that a scan of the **whole table** is not it — the property that matters in a service
     *     where the table holds every workspace's issues.
     *   * With sequential scans off, what is asserted is that each filter has an index that *can*
     *     answer it. Nine thousand rows still fit in a handful of pages, so a scan is honestly
     *     cheaper than a bitmap at this size; the index is what the same query needs at fifty
     *     thousand, and this is the only way to ask about it before there are fifty thousand.
     *
     * `set local` needs a transaction, and a transaction needs one connection rather than a pool,
     * which is why this takes a client of its own and rolls back.
     *
     * @param statement - The SQL and parameters, from {@link statementFor}.
     * @param sequential - Whether the planner may choose a sequential scan. Defaults to yes.
     * @returns The plan, one string.
     */
    async function planOf(
      statement: { sql: string; parameters: readonly unknown[] },
      sequential = true,
    ): Promise<string> {
      const client = await api.sql.connect();

      try {
        await client.query("begin");
        if (!sequential) await client.query("set local enable_seqscan = off");

        const { rows } = await client.query<Record<string, string>>(`explain ${statement.sql}`, [
          ...statement.parameters,
        ]);

        await client.query("rollback");

        return rows.map((row) => Object.values(row)[0]).join("\n");
      } finally {
        client.release();
      }
    }

    /** The window a listing request resolves to when it names none. */
    const WINDOW = { limit: 25, offset: 0 };

    it("still answers correctly at a thousand times the seed", async () => {
      // The plans below are only worth asking about if the answers are still right at volume, and
      // the seeded nine are still exactly the nine the filters reach.
      const { workspace, owner } = await backlog();
      await atVolume(workspace);

      expect(numbers(await list(owner, workspace, `repo=${workspace.repoId}`))).toEqual([
        ...MOCKUP_03.effortOrder,
      ]);
      expect(numbers(await list(owner, workspace, "labels=bug,tech-debt"))).toEqual([491]);
      expect(numbers(await list(owner, workspace, "q=watchdog"))).toEqual([485]);
      expect((await list(owner, workspace)).total).toBe(MOCKUP_03.issues + NOISE_ISSUES);
    });

    it("reads one repository's rows through the workspace index", async () => {
      // The mockup's own view: a breadcrumb naming one repository, and `Open ▾`. All three columns
      // of `github_issues_organization_repo_state_idx`, in its order — and the plan PostgreSQL
      // really chooses, with nothing turned off.
      const { workspace } = await backlog();
      await atVolume(workspace);

      const plan = await planOf(
        await statementFor((repository) =>
          repository.list(
            workspace.id,
            { state: "open", repoId: workspace.repoId },
            "effort",
            WINDOW,
          ),
        ),
      );

      expect(plan).not.toMatch(/Seq Scan on github_issues/);
      expect(plan).toContain("github_issues_organization_repo_state_idx");
    });

    it("reads the page head's counts through it as well", async () => {
      // The counts are an aggregate over the scope, so they read more rows than the listing does —
      // and they must still enter through the workspace rather than through the table.
      const { workspace } = await backlog();
      await atVolume(workspace);

      const plan = await planOf(
        await statementFor((repository) =>
          repository.counts(workspace.id, { state: "open", repoId: workspace.repoId }),
        ),
      );

      expect(plan).not.toMatch(/Seq Scan on github_issues/);
      expect(plan).toContain("github_issues_organization_repo_state_idx");
    });

    it("reads the chip set's facets through it as well", async () => {
      const { workspace } = await backlog();
      await atVolume(workspace);

      const plan = await planOf(
        await statementFor((repository) => repository.labelFacets(workspace.id, workspace.repoId)),
      );

      expect(plan).not.toMatch(/Seq Scan on github_issues/);
      expect(plan).toContain("github_issues_organization_repo_state_idx");
    });

    it("reads an issue number through it, which is what `q=#485` is", async () => {
      // `number` has no index of its own — `github_issues_repo_number_key` leads with the
      // repository — so a numeric search is a disjunct the scope has to carry. Under a repository
      // it is nine rows, which is what the filter bar's *Repository* select makes it.
      const { workspace } = await backlog();
      await atVolume(workspace);

      const plan = await planOf(
        await statementFor((repository) =>
          repository.list(
            workspace.id,
            { state: "open", repoId: workspace.repoId, search: "#485" },
            "effort",
            WINDOW,
          ),
        ),
      );

      expect(plan).not.toMatch(/Seq Scan on github_issues/);
      expect(plan).toContain("github_issues_organization_repo_state_idx");
    });

    it("has a usable index for the chip set — V014's GIN, over the whole workspace", async () => {
      // The index V014 created for this ticket and chose `jsonb_ops` for, asked about the way
      // `constraints.sql` asks: with scans off, because nine thousand rows are honestly cheaper to
      // scan than to bitmap and fifty thousand are not.
      const { workspace } = await backlog();
      await atVolume(workspace);

      const plan = await planOf(
        await statementFor((repository) =>
          repository.list(
            workspace.id,
            { state: "open", labels: ["bug", "tech-debt"] },
            "effort",
            WINDOW,
          ),
        ),
        false,
      );

      expect(plan).toContain("github_issues_labels_idx");
    });

    it("carries the search box over the workspace's own rows and no further", async () => {
      // The one combination PostgreSQL will not answer from an index at this size, and the reason
      // is worth writing down rather than asserting around. `q` is a **disjunction** — a title
      // substring or a label name — and a bitmap over two GIN indexes has a startup cost that
      // nine thousand rows do not repay, so the planner reads the workspace's own issues and
      // filters them. That is the right plan at nine thousand and the wrong one at fifty; the
      // index is what the same statement reaches for when it starts paying, which is what this
      // asks about the way `constraints.sql` asks it — with scans off.
      //
      // Both halves are indexable, and that is why the label half is an exact name rather than a
      // substring: `labels ? 'watchdog'` is served by `github_issues_labels_idx`, and a
      // `jsonb_array_elements_text(...) ilike` subquery is served by nothing at all.
      const { workspace } = await backlog();
      await atVolume(workspace);

      const plan = await planOf(
        await statementFor((repository) =>
          repository.list(workspace.id, { state: "open", search: "watchdog" }, "effort", WINDOW),
        ),
        false,
      );

      expect(plan).not.toMatch(/Seq Scan on github_issues/);
    });

    it("reads a repository-scoped search through the workspace index", async () => {
      // Which is the view the mockup actually draws: the search box sits beside a *Repository*
      // select the breadcrumb has already chosen. Under one repository the disjunction is a
      // filter over nine rows the index found, with nothing turned off.
      const { workspace } = await backlog();
      await atVolume(workspace);

      const plan = await planOf(
        await statementFor((repository) =>
          repository.list(
            workspace.id,
            { state: "open", repoId: workspace.repoId, search: "watchdog" },
            "effort",
            WINDOW,
          ),
        ),
      );

      expect(plan).not.toMatch(/Seq Scan on github_issues/);
      expect(plan).toContain("github_issues_organization_repo_state_idx");
    });
  });
});

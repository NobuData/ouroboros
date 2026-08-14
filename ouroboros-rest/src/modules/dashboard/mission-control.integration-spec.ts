import {
  addRepo,
  MOCKUP_02,
  seedMockup,
  workspaceWithRepo,
  type SeededWorkspace,
} from "../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { OrganizationRole } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { QueuePage } from "../queue/queue.service";
import type { AutoMergeResource } from "../settings/resources";
import type { Page } from "../tenancy/pagination";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { DashboardResource, RunSummary } from "./resources";

/**
 * Epic G's five surfaces, together, over one population
 * ([#76](https://github.com/NobuData/ouroboros/issues/76)).
 *
 * Each of #70, #71, #73 and #74 ships with a suite that holds *it* to its own ticket. This is
 * the one that holds them to **each other**, and it exists because the four bugs the ticket
 * names are the four that no single-endpoint suite can see:
 *
 *   * **Window math.** A boundary is only wrong on one side of itself, so a suite whose
 *     fixture sits comfortably inside the window never meets it. Every case here is a pair of
 *     rows an hour either side of a boundary, read through the HTTP layer rather than through
 *     `windows.ts` — which `windows.spec.ts` already proves in isolation, and which proves
 *     nothing about whether the endpoint passes those instants to the statements that use them.
 *   * **Org scoping.** The existing isolation tests are *asymmetric*: one workspace holds rows
 *     and the other holds few or none, so a query that lost its scope returns visibly too much.
 *     This one seeds **two identical populations** — which is the arrangement that also catches
 *     the scope that was not lost but *swapped*, where every count is right and every row
 *     belongs to somebody else. That is what the ticket's spot-check deletes a predicate to
 *     prove; the pull request records the result.
 *   * **Role gates.** Stated as a matrix rather than as four prose tests, so a role added to
 *     `OrganizationRole` is a compile error here rather than a row nobody wrote a case for.
 *   * **Cache behaviour.** The aggregate's tag fingerprints four tables, and a suite that
 *     mutates one of them proves the mechanism works for that one. Each is exercised, because
 *     `token_usage` is fingerprinted on a *different column* from the other three and is the
 *     one a refactor would quietly get wrong.
 *
 * Nothing here re-asserts what a single-endpoint suite already asserts alone. Where the same
 * figure appears, it is because two endpoints have to agree about it and this is the only place
 * both are asked in one breath.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The five surfaces mockup 02 is painted from. */
const DASHBOARD = "/api/v1/dashboard";
const RUNS = "/api/v1/runs";
const QUEUE = "/api/v1/queue";
const SETTING = "/api/v1/settings/auto-merge";

/** A day, in seconds — every window boundary below is stated as a multiple of it. */
const DAY = 24 * 60 * 60;

/** How far either side of a boundary the edge cases sit. Comfortably past any clock skew. */
const NUDGE = 3600;

/** What a run the window cases insert may vary in — everything else is a stable filler. */
interface RunSeed {
  readonly issue: number;
  readonly status: "coding" | "building" | "review" | "merged" | "needs_human" | "failed";
  /** Seconds ago it started. */
  readonly startedAgo: number;
  /** Seconds ago it finished. Omitted for a run still in flight, which must have no instant. */
  readonly finishedAgo?: number;
}

describe("mission control, end to end", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Read a URL as somebody, in a named workspace. */
  function read(person: Person, workspace: SeededWorkspace, url: string) {
    return api.as(person)("get", url).set(TENANT_HEADER, workspace.slug);
  }

  /** The whole aggregate, as somebody sees it. */
  async function dashboardOf(
    person: Person,
    workspace: SeededWorkspace,
  ): Promise<DashboardResource> {
    return bodyOf<DashboardResource>(await read(person, workspace, DASHBOARD).expect(200));
  }

  /**
   * One run, written the way the ingestion bridge (#91) will write them.
   *
   * The nullable columns move together with `finishedAgo`, which is what V008's constraints
   * require: `runs_terminal_finished_at` makes a terminal status and a `finished_at` the same
   * fact, `runs_merged_has_pr` refuses a merge with no pull request, and `runs_checks_paired`
   * refuses one half of a check count. A fixture that got any of them wrong would be refused
   * by the database rather than by an assertion here.
   *
   * @param workspace - Whose.
   * @param seed - What this row is about.
   * @returns The run's id, for the cases that address one.
   */
  async function insertRun(workspace: SeededWorkspace, seed: RunSeed): Promise<string> {
    const closed = seed.finishedAgo !== undefined;
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                   workflow_tag, model, status, stage_label, stage_index,
                                   stage_total, started_at, finished_at, pr_number,
                                   checks_passed, checks_total)
       values ($1, $2, $3::int, 'Issue ' || $3::int, 'standard-fix', 'claude-fable-5', $4,
               'Stage', 1, 6, now() - make_interval(secs => $5),
               case when $6::float8 is null then null
                    else now() - make_interval(secs => $6::float8) end,
               case when $7::boolean then 100 + $3::int else null end,
               case when $6::float8 is null then null else 6 end,
               case when $6::float8 is null then null else 6 end)
       returning id`,
      [
        workspace.id,
        workspace.repoId,
        seed.issue,
        seed.status,
        seed.startedAgo,
        seed.finishedAgo ?? null,
        // Only a merge is *required* to name a pull request, and only a closed run may. A
        // `failed` run that never opened one is the row the merge rate's denominator is about.
        closed && seed.status === "merged",
      ],
    );

    return rows[0].id;
  }

  /**
   * One token-usage event, at a stated instant.
   *
   * @param workspace - Whose.
   * @param secondsAgo - How long before now it occurred. The day boundary cases put one event
   *   either side of midnight, so this is the only column they vary.
   * @param tokens - How many input tokens it records. Output is zero, so the day's total is
   *   this number and the assertion is about the boundary rather than about the arithmetic.
   */
  async function insertUsage(
    workspace: SeededWorkspace,
    secondsAgo: number,
    tokens: number,
  ): Promise<void> {
    await api.sql.query(
      `insert into ouroboros.token_usage (organization_id, provider, model, tokens_in,
                                          tokens_out, cost_cents, occurred_at)
       values ($1, 'anthropic', 'claude-fable-5', $2::int, 0, 100.0000,
               now() - make_interval(secs => $3::float8))`,
      [workspace.id, tokens, secondsAgo],
    );
  }

  /**
   * How far into the current UTC day the database thinks it is.
   *
   * Asked of the database rather than of this process, because the day boundary the endpoint
   * measures from is `date_trunc('day', now() at time zone 'utc')` and a case that placed a row
   * relative to the *runner's* clock would be a case about clock skew rather than about the
   * boundary.
   *
   * @returns Seconds since midnight UTC — so `now() - make_interval(secs => elapsed + 60)` is
   *   a minute the wrong side of it, whatever hour the suite runs at.
   */
  async function secondsSinceMidnight(): Promise<number> {
    const { rows } = await api.sql.query<{ elapsed: number }>(
      `select extract(epoch from (
                now() - (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
              ))::float8 as elapsed`,
    );

    return rows[0].elapsed;
  }

  describe("one population, read through every surface", () => {
    let owner: Person;
    let workspace: SeededWorkspace;
    let dashboard: DashboardResource;

    beforeEach(async () => {
      owner = await api.signIn();
      workspace = await workspaceWithRepo(api, owner);
      await seedMockup(api, workspace, owner.id);
      dashboard = await dashboardOf(owner, workspace);
    });

    it("reports the seeded arithmetic on every stat, the pulse and the delta", () => {
      // The ticket's first bullet in one assertion: the whole aggregate at once, so a payload
      // that got one number right by breaking another has nowhere to hide. `toEqual` on the
      // object rather than seven `toBe`s, because an extra key or a missing one is also a way
      // for this contract to be wrong.
      expect(dashboard.stats).toEqual(MOCKUP_02.stats);
      expect(dashboard.pulse).toEqual(MOCKUP_02.pulse);
      expect(dashboard.activeRuns.map((run) => run.issueNumber)).toEqual([
        ...MOCKUP_02.activeIssues,
      ]);
      expect(dashboard.recentRuns.slice(0, 4).map((run) => run.issueNumber)).toEqual([
        ...MOCKUP_02.recentIssues,
      ]);
      expect(dashboard.queueHead.map((item) => item.issueNumber)).toEqual([
        ...MOCKUP_02.queueHeadIssues,
      ]);
    });

    it("agrees with the drill-in endpoints about the same rows, in one breath", async () => {
      // Four modules, four independently-stated orderings, one population. Each of #71 and #73
      // already asserts its own half of this against its own fixture; what only this can say is
      // that all four agree *at once* — which is the property a client painting the page from
      // the aggregate and then following a link depends on.
      const [actives, terminals, queue, setting] = await Promise.all([
        read(owner, workspace, `${RUNS}?status=active`).expect(200),
        read(owner, workspace, `${RUNS}?status=terminal`).expect(200),
        read(owner, workspace, QUEUE).expect(200),
        read(owner, workspace, SETTING).expect(200),
      ]);

      const active = bodyOf<Page<RunSummary>>(actives);
      const terminal = bodyOf<Page<RunSummary>>(terminals);
      const queued = bodyOf<QueuePage>(queue);

      expect(active.total).toBe(MOCKUP_02.runs.active);
      expect(terminal.total).toBe(MOCKUP_02.runs.terminal);
      expect(active.items).toEqual(dashboard.activeRuns);
      expect(terminal.items.slice(0, dashboard.recentRuns.length)).toEqual(dashboard.recentRuns);

      expect(queued.total).toBe(dashboard.stats.queued.count);
      expect(queued.totalEstMinutes).toBe(dashboard.stats.queued.estMinutes);
      expect(queued.items.slice(0, dashboard.queueHead.length)).toEqual(dashboard.queueHead);

      expect(bodyOf<AutoMergeResource>(setting).enabled).toBe(dashboard.pulse.autoMerge);
    });

    it("carries every seeded row somewhere a listing can reach it", async () => {
      // The cards are heads of listings, and a head is only a head of something. The aggregate
      // draws eleven of the fifty-three runs and five of the twelve queue items; the listings
      // are how the other forty-nine rows are reachable at all, and a page asked for the whole
      // population has to return the whole population.
      const terminal = bodyOf<Page<RunSummary>>(
        await read(
          owner,
          workspace,
          `${RUNS}?status=terminal&limit=${MOCKUP_02.runs.terminal}`,
        ).expect(200),
      );
      const queue = bodyOf<QueuePage>(
        await read(owner, workspace, `${QUEUE}?limit=${MOCKUP_02.queueItems}`).expect(200),
      );

      expect(terminal.items).toHaveLength(MOCKUP_02.runs.terminal);
      expect(terminal.total + MOCKUP_02.runs.active).toBe(MOCKUP_02.runs.total);
      expect(queue.items).toHaveLength(MOCKUP_02.queueItems);
    });
  });

  describe("an organization with nothing in it", () => {
    // #70's own suite asserts the aggregate's zero state field by field. What is here is the
    // rest of the page: the empty state (#86) is rendered from *five* answers, and a listing
    // that answered `404` or a settings read that answered `null` would break the same screen
    // the aggregate's zeros were written to protect.

    let founder: Person;
    let workspace: SeededWorkspace;

    beforeEach(async () => {
      founder = await api.signIn();
      workspace = await workspaceWithRepo(api, founder);
    });

    it("answers every listing with an empty page and zero totals", async () => {
      for (const url of [`${RUNS}?status=active`, `${RUNS}?status=terminal`, QUEUE]) {
        const page = bodyOf<Page<unknown>>(await read(founder, workspace, url).expect(200));

        expect(page.items).toEqual([]);
        expect(page.total).toBe(0);
      }

      // The queue carries one total the others do not, and a sum over no rows is `0` rather
      // than the `null` PostgreSQL would otherwise hand back.
      const queue = bodyOf<QueuePage>(await read(founder, workspace, QUEUE).expect(200));
      expect(queue.totalEstMinutes).toBe(0);
    });

    it("answers the switch as never chosen rather than as absent", async () => {
      const setting = bodyOf<AutoMergeResource>(
        await read(founder, workspace, SETTING).expect(200),
      );

      expect(setting).toEqual({ enabled: false, updatedAt: null, updatedBy: null });
    });

    it("holds a stable tag across polls, so an empty page is cheap to watch", async () => {
      // A workspace with no rows still fingerprints four tables, and four counts of zero have
      // to hash to the same tag twice running — otherwise the emptiest dashboard in the
      // installation is the one that never answers `304`.
      const first = await read(founder, workspace, DASHBOARD).expect(200);

      const second = await read(founder, workspace, DASHBOARD)
        .set("If-None-Match", first.headers.etag)
        .expect(304);

      expect(second.headers.etag).toBe(first.headers.etag);
    });
  });

  describe("two organizations in one database", () => {
    let mine: Person;
    let theirs: Person;
    let ours: SeededWorkspace;
    let neighbour: SeededWorkspace;

    beforeEach(async () => {
      // Two owners, two workspaces, and the *same* population in each. Identical rather than
      // asymmetric on purpose — see this file's header.
      mine = await api.signIn();
      theirs = await api.signIn();
      ours = await workspaceWithRepo(api, mine);
      neighbour = await workspaceWithRepo(api, theirs);
      await seedMockup(api, ours, mine.id);
      await seedMockup(api, neighbour, theirs.id);
    });

    /**
     * Every run id a workspace owns, read through the suite's own connection.
     *
     * The independent oracle the row-level assertions are made against: the API is what is
     * under test, so what its answers are compared with cannot come from the API.
     *
     * @param workspace - Whose runs.
     * @returns Their ids.
     */
    async function ownRunIds(workspace: SeededWorkspace): Promise<Set<string>> {
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ouroboros.runs where organization_id = $1`,
        [workspace.id],
      );

      return new Set(rows.map((row) => row.id));
    }

    it("counts one workspace's rows on the aggregate and never both", async () => {
      const dashboard = await dashboardOf(mine, ours);

      // Every count on the page, against a database holding exactly twice what it should
      // report. A query that lost its scope doubles each of these.
      expect(dashboard.stats).toEqual(MOCKUP_02.stats);
      expect(dashboard.pulse).toEqual(MOCKUP_02.pulse);
      expect(dashboard.activeRuns).toHaveLength(MOCKUP_02.runs.active);
      expect(dashboard.queueHead).toHaveLength(MOCKUP_02.queueHeadIssues.length);
    });

    it("draws only rows the reading workspace owns, on every surface that carries one", async () => {
      // The half a count cannot catch. Two identical populations mean an unscoped query and a
      // *mis*-scoped one produce different failures, and only this assertion sees the second:
      // every id the API returned has to be in this workspace's own set.
      const owned = await ownRunIds(ours);
      const dashboard = await dashboardOf(mine, ours);
      const listing = bodyOf<Page<RunSummary>>(
        await read(mine, ours, `${RUNS}?status=terminal&limit=${MOCKUP_02.runs.terminal}`).expect(
          200,
        ),
      );

      for (const run of [...dashboard.activeRuns, ...dashboard.recentRuns, ...listing.items]) {
        expect(owned.has(run.id)).toBe(true);
      }

      const queue = bodyOf<QueuePage>(
        await read(mine, ours, `${QUEUE}?limit=${MOCKUP_02.queueItems}`).expect(200),
      );
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ouroboros.queue_items where organization_id = $1`,
        [ours.id],
      );
      const ownedItems = new Set(rows.map((row) => row.id));

      for (const item of [...dashboard.queueHead, ...queue.items]) {
        expect(ownedItems.has(item.id)).toBe(true);
      }
    });

    it("gives each listing this workspace's totals, not the installation's", async () => {
      const [active, terminal, queue] = await Promise.all([
        read(mine, ours, `${RUNS}?status=active`).expect(200),
        read(mine, ours, `${RUNS}?status=terminal`).expect(200),
        read(mine, ours, QUEUE).expect(200),
      ]);

      expect(bodyOf<Page<RunSummary>>(active).total).toBe(MOCKUP_02.runs.active);
      expect(bodyOf<Page<RunSummary>>(terminal).total).toBe(MOCKUP_02.runs.terminal);
      expect(bodyOf<QueuePage>(queue).total).toBe(MOCKUP_02.queueItems);
      expect(bodyOf<QueuePage>(queue).totalEstMinutes).toBe(MOCKUP_02.stats.queued.estMinutes);
    });

    it("answers a neighbour's run exactly as one that never existed", async () => {
      const [foreign] = [...(await ownRunIds(neighbour))];
      const invented = "00000000-0000-4000-8000-000000000000";

      const cross = bodyOf<ErrorEnvelope>(await read(mine, ours, `${RUNS}/${foreign}`).expect(404));
      const absent = bodyOf<ErrorEnvelope>(
        await read(mine, ours, `${RUNS}/${invented}`).expect(404),
      );

      // Both absences read identically apart from the id each was asked about, so nothing in
      // the answer distinguishes *not yours* from *not real*.
      expect(cross.code).toBe(absent.code);
      expect(cross.message).toBe(absent.message);
      expect(cross.details).toEqual({ runId: foreign });
      expect(absent.details).toEqual({ runId: invented });
    });

    it("narrows to nothing for a neighbour's repository rather than confirming it exists", async () => {
      // The `?repo=` filter is a predicate under the org scope, not a lookup. Asserted on both
      // listings, because they take the parameter through different modules.
      const runs = bodyOf<Page<RunSummary>>(
        await read(mine, ours, `${RUNS}?status=active&repo=${neighbour.repoId}`).expect(200),
      );
      const queue = bodyOf<QueuePage>(
        await read(mine, ours, `${QUEUE}?repo=${neighbour.repoId}`).expect(200),
      );

      expect(runs.total).toBe(0);
      expect(queue.total).toBe(0);
      expect(queue.totalEstMinutes).toBe(0);
      // …and a repository that *is* this workspace's still narrows to its rows, so the
      // predicate above refused for the right reason.
      const own = bodyOf<Page<RunSummary>>(
        await read(mine, ours, `${RUNS}?status=active&repo=${ours.repoId}`).expect(200),
      );
      expect(own.total).toBe(MOCKUP_02.runs.active);
    });

    it("keeps the two switches apart, and the two tags", async () => {
      await api
        .as(mine)("patch", SETTING)
        .set(TENANT_HEADER, ours.slug)
        .send({ enabled: false })
        .expect(200);

      const neighbourSetting = bodyOf<AutoMergeResource>(
        await read(theirs, neighbour, SETTING).expect(200),
      );
      expect(neighbourSetting.enabled).toBe(true);

      // Identical populations, different tags — which is what makes `Cache-Control: private,
      // no-cache` safe with no `Vary` on the tenant header.
      const one = await read(mine, ours, DASHBOARD).expect(200);
      const two = await read(theirs, neighbour, DASHBOARD).expect(200);

      expect(one.headers.etag).not.toBe(two.headers.etag);
      await read(theirs, neighbour, DASHBOARD).set("If-None-Match", one.headers.etag).expect(200);
    });

    it("refuses a workspace the caller is not a member of, with no hint that it is real", async () => {
      // Named through the tenant header rather than through a path, which is the only way this
      // API takes a workspace at all. A `403` here would confirm the slug names something.
      const response = await api
        .as(mine)("get", DASHBOARD)
        .set(TENANT_HEADER, neighbour.slug)
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("tenant_not_found");
    });
  });

  describe("the auto-merge role matrix", () => {
    /**
     * Every role, and what it may do with the page's one switch.
     *
     * Typed as `OrganizationRole`, so a fifth role added to the union is a compile error in
     * this table rather than a case nobody noticed was missing. Reading is every member's —
     * the numbers are not administrative — and writing is `ADMINISTRATORS`', which
     * `roles.guard.ts` states once and this reads rather than restates.
     */
    const MATRIX: readonly { role: OrganizationRole; write: number }[] = [
      { role: "owner", write: 200 },
      { role: "admin", write: 200 },
      { role: "member", write: 403 },
      { role: "viewer", write: 403 },
    ];

    it.each(MATRIX)("lets a $role read the switch and the page behind it", async ({ role }) => {
      const founder = await api.signIn();
      const workspace = await workspaceWithRepo(api, founder);
      await seedMockup(api, workspace, founder.id);

      const person = role === "owner" ? founder : await api.signIn();
      if (role !== "owner") {
        await api.join(workspace.id, person, role);
      }

      const setting = bodyOf<AutoMergeResource>(await read(person, workspace, SETTING).expect(200));
      const dashboard = await dashboardOf(person, workspace);

      // The same answer for every role: reading is not gated, and the two surfaces agree.
      expect(setting.enabled).toBe(true);
      expect(dashboard.pulse.autoMerge).toBe(true);
      expect(dashboard.stats).toEqual(MOCKUP_02.stats);
    });

    it.each(MATRIX)("answers a $role's flip with $write", async ({ role, write }) => {
      const founder = await api.signIn();
      const workspace = await workspaceWithRepo(api, founder);
      await seedMockup(api, workspace, founder.id);

      const person = role === "owner" ? founder : await api.signIn();
      if (role !== "owner") {
        await api.join(workspace.id, person, role);
      }

      const response = await api
        .as(person)("patch", SETTING)
        .set(TENANT_HEADER, workspace.slug)
        .send({ enabled: false })
        .expect(write);

      if (write === 200) {
        // Persisted, attributed, and visible on the next poll of the aggregate — which is the
        // whole round trip the pulse card's switch makes.
        expect(bodyOf<AutoMergeResource>(response)).toEqual(
          expect.objectContaining({ enabled: false, updatedBy: person.id }),
        );
        expect((await dashboardOf(person, workspace)).pulse.autoMerge).toBe(false);
      } else {
        // Refused with the API's one word for a refusal, and nothing written: the switch is
        // still where the seed left it, on both surfaces.
        expect(bodyOf<ErrorEnvelope>(response)).toEqual(
          expect.objectContaining({
            code: "forbidden",
            details: { role, required: [...ADMINISTRATORS] },
          }),
        );
        const unchanged = bodyOf<AutoMergeResource>(
          await read(person, workspace, SETTING).expect(200),
        );
        expect(unchanged.enabled).toBe(true);
        expect((await dashboardOf(person, workspace)).pulse.autoMerge).toBe(true);
      }
    });

    it("refuses a caller with no membership at all before it refuses their role", async () => {
      // The tenant guard runs first, so somebody who is nothing in this workspace is told the
      // workspace does not exist rather than that their role is insufficient — which is the
      // ordering `application.ts` establishes and the only one that leaks nothing.
      const founder = await api.signIn();
      const workspace = await workspaceWithRepo(api, founder);
      const stranger = await api.signIn();

      await api
        .as(stranger)("patch", SETTING)
        .set(TENANT_HEADER, workspace.slug)
        .send({ enabled: true })
        .expect(404);
    });
  });

  describe("the ETag cycle, once per fingerprinted table", () => {
    /**
     * The four sources the aggregate's version is derived from, and a write to each.
     *
     * One case per table because they are not one mechanism: three are fingerprinted on
     * `count || max(updated_at)` and `token_usage` — which is append-only and has no
     * `updated_at` — is fingerprinted on `created_at`. A single case over `runs` would pass
     * against a version query that had lost the other three.
     */
    const SOURCES: readonly {
      table: string;
      change: (workspace: SeededWorkspace, person: Person) => Promise<unknown>;
    }[] = [
      {
        table: "runs",
        change: (workspace) =>
          insertRun(workspace, { issue: 900, status: "coding", startedAgo: 120 }),
      },
      {
        table: "queue_items",
        change: (workspace) =>
          api.sql.query(
            `insert into ouroboros.queue_items (organization_id, github_repo_id, issue_number,
                                                issue_title, effort, workflow_tag, position)
             values ($1, $2, 999, 'One more thing', 'xs', 'docs-loop', 13)`,
            [workspace.id, workspace.repoId],
          ),
      },
      {
        table: "token_usage",
        change: (workspace) => insertUsage(workspace, 60, 1000),
      },
      {
        table: "workspace_settings",
        // Through the endpoint rather than through the suite's connection: this is the page's
        // one write, and what #74 has to guarantee is that *the API's* write moves the tag.
        change: (workspace, person) =>
          api
            .as(person)("patch", SETTING)
            .set(TENANT_HEADER, workspace.slug)
            .send({ enabled: false })
            .expect(200),
      },
    ];

    it.each(SOURCES)(
      "goes 200 → 304 → write to $table → 200 with a new tag",
      async ({ change }) => {
        const owner = await api.signIn();
        const workspace = await workspaceWithRepo(api, owner);
        await seedMockup(api, workspace, owner.id);

        // 200: the full payload, and the tag that names it.
        const first = await read(owner, workspace, DASHBOARD).expect(200);
        const held = first.headers.etag;
        expect(held).toMatch(/^"[0-9a-f]{32}"$/);

        // 304: nothing has moved, so the poll costs a version probe and returns no body.
        const unchanged = await read(owner, workspace, DASHBOARD)
          .set("If-None-Match", held)
          .expect(304);
        expect(unchanged.text).toBeFalsy();
        expect(unchanged.headers.etag).toBe(held);

        await change(workspace, owner);

        // 200 again: the held tag no longer names the current state, and the new one is different.
        const changed = await read(owner, workspace, DASHBOARD)
          .set("If-None-Match", held)
          .expect(200);
        expect(changed.headers.etag).not.toBe(held);

        // …and the new tag is itself current, which is what makes the cycle a cycle rather than
        // a payload that can never be revalidated again.
        await read(owner, workspace, DASHBOARD)
          .set("If-None-Match", changed.headers.etag)
          .expect(304);
      },
    );

    it("keeps the cache policy and the poll hint on both answers", async () => {
      // #75's contract, asserted where it matters most: a backed-off server answers mostly
      // `304`s, so the cheap answer is the one that has to carry the cadence.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner);

      const full = await read(owner, workspace, DASHBOARD).expect(200);
      const cheap = await read(owner, workspace, DASHBOARD)
        .set("If-None-Match", full.headers.etag)
        .expect(304);

      for (const response of [full, cheap]) {
        expect(response.headers["cache-control"]).toBe("private, no-cache");
        expect(response.headers["x-ouro-poll-after"]).toBe(
          String(api.configuration.dashboardPollSeconds),
        );
      }
    });

    it("is not moved by a write to a workspace next door", async () => {
      // The tag is derived from org-scoped subqueries. If one lost its scope, a neighbour's
      // insert would invalidate this workspace's cached page on every poll — which is a
      // correctness bug that looks exactly like a performance one.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner);
      const other = await api.signIn();
      const elsewhere = await workspaceWithRepo(api, other);

      const held = (await read(owner, workspace, DASHBOARD).expect(200)).headers.etag;

      await insertRun(elsewhere, { issue: 901, status: "coding", startedAgo: 60 });
      await insertUsage(elsewhere, 60, 5000);

      await read(owner, workspace, DASHBOARD).set("If-None-Match", held).expect(304);
    });
  });

  describe("the metric windows, through the HTTP layer", () => {
    let owner: Person;
    let workspace: SeededWorkspace;

    beforeEach(async () => {
      owner = await api.signIn();
      workspace = await workspaceWithRepo(api, owner);
    });

    it("splits this week from last at seven days, an hour either side", async () => {
      // The boundary itself. Both runs merged, both inside the rate window, and the only
      // difference between them is which side of `now − 7d` they stopped on.
      await insertRun(workspace, {
        issue: 1,
        status: "merged",
        startedAgo: 7 * DAY,
        finishedAgo: 7 * DAY - NUDGE,
      });
      await insertRun(workspace, {
        issue: 2,
        status: "merged",
        startedAgo: 8 * DAY,
        finishedAgo: 7 * DAY + NUDGE,
      });

      const dashboard = await dashboardOf(owner, workspace);

      expect(dashboard.stats.merged7d).toEqual({ count: 1, deltaVsPrior: 0 });
      // Both are in the fourteen-day rate window, and both merged.
      expect(dashboard.pulse.mergeRate).toBe(1);
    });

    it("stops comparing at fourteen days, and counts what falls past it nowhere", async () => {
      // The far edge of the prior-week bucket, which is half-open: `>= 14d ago and < 7d ago`.
      // A run an hour older than that is in no count on the page — and the merge rate does not
      // quietly stretch to reach it.
      await insertRun(workspace, {
        issue: 1,
        status: "merged",
        startedAgo: 15 * DAY,
        finishedAgo: 14 * DAY + NUDGE,
      });

      const dashboard = await dashboardOf(owner, workspace);

      expect(dashboard.stats.merged7d).toEqual({ count: 0, deltaVsPrior: 0 });
      expect(dashboard.pulse.mergeRate).toBe(0);
      expect(dashboard.pulse.avgCycleSeconds).toBe(0);
      // It is still a run, and the completions listing still carries it: aged out of the
      // windows is not deleted.
      expect(dashboard.recentRuns).toHaveLength(1);
    });

    it("counts every terminal status in the merge rate's denominator", async () => {
      // The rate is *autonomy*, not success: a run that failed and one that stopped for a human
      // are both runs the loop did not merge on its own, so both are in the denominator. A
      // denominator of merges alone would read 100% on the worst week a workspace ever had.
      await insertRun(workspace, {
        issue: 1,
        status: "merged",
        startedAgo: 3 * DAY,
        finishedAgo: 3 * DAY - 600,
      });
      await insertRun(workspace, {
        issue: 2,
        status: "failed",
        startedAgo: 5 * DAY,
        finishedAgo: 5 * DAY - 600,
      });
      await insertRun(workspace, {
        issue: 3,
        status: "needs_human",
        startedAgo: 10 * DAY,
        finishedAgo: 10 * DAY - 600,
      });

      const dashboard = await dashboardOf(owner, workspace);

      expect(dashboard.pulse.mergeRate).toBeCloseTo(1 / 3, 10);
      // The intervention count keeps the *seven*-day window while the rate keeps fourteen, so
      // the ten-day-old row is in the denominator above and not in this one.
      expect(dashboard.pulse.interventions7d).toBe(0);
      // One merge this week against none last: the delta is the count itself, which is what a
      // workspace's first week looks like.
      expect(dashboard.stats.merged7d).toEqual({ count: 1, deltaVsPrior: 1 });
    });

    it("averages the cycle over runs that closed this week and no others", async () => {
      // A long run that closed ten days ago is in the merge rate's window and not in the mean's.
      // If the mean took the rate's boundary, this would read 3300 instead of 600.
      await insertRun(workspace, {
        issue: 1,
        status: "merged",
        startedAgo: DAY + 600,
        finishedAgo: DAY,
      });
      await insertRun(workspace, {
        issue: 2,
        status: "merged",
        startedAgo: 10 * DAY + 6000,
        finishedAgo: 10 * DAY,
      });

      const dashboard = await dashboardOf(owner, workspace);

      expect(dashboard.pulse.avgCycleSeconds).toBeCloseTo(600, 0);
      expect(dashboard.pulse.mergeRate).toBe(1);
    });

    it("counts an intervention this week and not one an hour past the boundary", async () => {
      await insertRun(workspace, {
        issue: 1,
        status: "needs_human",
        startedAgo: 7 * DAY,
        finishedAgo: 7 * DAY - NUDGE,
      });
      await insertRun(workspace, {
        issue: 2,
        status: "needs_human",
        startedAgo: 8 * DAY,
        finishedAgo: 7 * DAY + NUDGE,
      });

      const dashboard = await dashboardOf(owner, workspace);

      expect(dashboard.pulse.interventions7d).toBe(1);
      // Neither is a merge, so the rate over two closed runs is zero rather than undefined.
      expect(dashboard.pulse.mergeRate).toBe(0);
    });

    it("measures 'since this morning' from midnight UTC, not from twenty-four hours ago", async () => {
      // The one boundary on the page with a calendar. A run merged a minute before midnight is
      // in the seven-day count and *not* in the subline — which is what makes the subline a
      // statement about today rather than about the last day.
      const elapsed = await secondsSinceMidnight();

      await insertRun(workspace, { issue: 1, status: "merged", startedAgo: 600, finishedAgo: 0 });
      await insertRun(workspace, {
        issue: 2,
        status: "merged",
        startedAgo: elapsed + 1200,
        finishedAgo: elapsed + 60,
      });

      const dashboard = await dashboardOf(owner, workspace);

      expect(dashboard.activity.mergedSinceMorning).toBe(1);
      expect(dashboard.stats.merged7d.count).toBe(2);
    });

    it("takes the day's token spend from the same midnight", async () => {
      // `token_usage_daily` fixes the day to UTC (V010) and the subline above follows it, so
      // both numbers on the page are about one morning. An event a minute the wrong side of it
      // belongs to yesterday's ledger.
      const elapsed = await secondsSinceMidnight();

      await insertUsage(workspace, 0, 4000);
      await insertUsage(workspace, elapsed + 60, 900_000);

      const dashboard = await dashboardOf(owner, workspace);

      expect(dashboard.stats.tokensToday.tokens).toBe(4000);
      expect(dashboard.stats.tokensToday.providers).toBe(1);
    });

    it("holds every window to one instant, so two polls of one moment agree", async () => {
      // `windows.ts`'s reason to exist, observed from outside: every statement in a request is
      // answered about one `now`. A run that closed a second inside the boundary must be on the
      // same side of it for the count, the delta, the rate and the mean — all four of which are
      // separate aggregates over separate predicates.
      await insertRun(workspace, {
        issue: 1,
        status: "merged",
        startedAgo: 7 * DAY,
        finishedAgo: 7 * DAY - NUDGE,
      });

      const first = await dashboardOf(owner, workspace);
      const second = await dashboardOf(owner, workspace);

      expect(first.stats.merged7d).toEqual(second.stats.merged7d);
      expect(first.pulse.avgCycleSeconds).toBe(second.pulse.avgCycleSeconds);
      // The mean is over the same single run the count is over — one row cannot be inside one
      // aggregate's window and outside another's.
      expect(first.stats.merged7d.count).toBe(1);
      expect(first.pulse.avgCycleSeconds).toBeCloseTo(NUDGE, 0);
    });

    it("keeps a second repository's rows in the windows and out of a filtered listing", async () => {
      // The repo filter narrows a *listing*; it does not narrow the aggregate, which speaks for
      // the workspace. A card reading 2 beside a filtered listing reading 1 is correct, and
      // this is what says so.
      const atlas = await addRepo(api, workspace);

      await insertRun(workspace, { issue: 1, status: "coding", startedAgo: 300 });
      await api.sql.query(
        `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                     workflow_tag, model, status, stage_label, stage_index,
                                     stage_total, started_at)
         values ($1, $2, 2, 'Issue 2', 'standard-fix', 'claude-fable-5', 'coding', 'Stage', 1, 6,
                 now() - interval '100 seconds')`,
        [workspace.id, atlas],
      );

      const dashboard = await dashboardOf(owner, workspace);
      const filtered = bodyOf<Page<RunSummary>>(
        await read(owner, workspace, `${RUNS}?status=active&repo=${atlas}`).expect(200),
      );

      expect(dashboard.stats.loopsLive.total).toBe(2);
      expect(filtered.total).toBe(1);
      expect(filtered.items[0].issueNumber).toBe(2);
    });
  });
});

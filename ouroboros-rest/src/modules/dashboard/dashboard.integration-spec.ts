import {
  seedMockup,
  workspaceWithRepo,
  type SeededWorkspace as Workspace,
} from "../../testing/dashboard.fixture";
import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { DashboardResource } from "./resources";

/**
 * `GET /api/v1/dashboard`, over a socket and against a migrated database.
 *
 * The unit suites hold each layer to its own rules; what only this one can certify is the
 * claim the ticket is actually about — **that mockup 02's numbers come out of rows**. The
 * seed (#68) is deliberately not applied to this database (`flyway.toml` leaves the dev-seed
 * placeholder false, and the harness truncates between tests anyway), so
 * `testing/dashboard.fixture.ts` builds the same population the seed does: fifty-three runs
 * where the cards draw seven, twelve queue items summing to 580 minutes, twelve usage events
 * summing to 4.2M tokens and $18.60, and one settings row.
 *
 * It is built rather than copied. What matters about the seed is its *arithmetic* — the
 * cycle-time spread that makes the mean exactly 14m 20s, the counts either side of the
 * seven-day boundary, the one queue item nobody sized — and the fixture reproduces that
 * arithmetic with the same construction and filler titles. Where a number here disagrees with
 * the mockup, one of the two is wrong, and that is the point.
 *
 * **Every figure below is a literal, and stays one.** The fixture publishes the same numbers
 * as `MOCKUP_02` for the suites whose subject is somewhere else
 * ([#76](https://github.com/NobuData/ouroboros/issues/76)); this suite is the one whose
 * subject *is* the arithmetic, so it restates them independently and is the oracle that keeps
 * that constant honest.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test. */
const DASHBOARD = "/api/v1/dashboard";

/** What the mockup's *Avg. cycle time* reads, in seconds — `14m 20s`. */
const MOCKUP_AVG_CYCLE_SECONDS = 860;

describe("the dashboard endpoint", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Read the dashboard as somebody, in a named workspace. */
  function read(person: Parameters<typeof api.as>[0], workspace: Workspace) {
    return api.as(person)("get", DASHBOARD).set(TENANT_HEADER, workspace.slug);
  }

  describe("who may ask", () => {
    it("refuses a stranger", async () => {
      // The global session guard, doing its one job: a workspace's operational numbers are
      // not something a request without a session is answered with.
      await api.anonymous("get", DASHBOARD).expect(401);
    });

    it("asks a session acting in no workspace to choose one", async () => {
      // The first operation in this API that can answer `organization_required`: it is
      // workspace-scoped and has no path to say which, so a session with no active
      // organization has nothing to fall back on. A `404` here would leave somebody whose
      // workspace was deleted with no idea what to do.
      const nomad = await api.signIn();

      const response = await api.as(nomad)("get", DASHBOARD).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });

    it("answers a workspace the caller is not a member of with 404, never 403", async () => {
      // The *no existence leaks* rule: a `403` would confirm that an identifier names
      // something real, which is what somebody enumerating identifiers wants to know.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner);
      await seedMockup(api, workspace, owner.id);

      const stranger = await api.signIn();
      const theirs = await workspaceWithRepo(api, stranger);

      const response = await api
        .as(stranger)("get", DASHBOARD)
        .set(TENANT_HEADER, workspace.slug)
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("tenant_not_found");
      // …and their own workspace still answers, so the refusal was about membership rather
      // than about the route.
      await read(stranger, theirs).expect(200);
    });

    it("lets every member read it, whatever their role", async () => {
      // Reading the numbers is not an administrative act. The one write on this page is the
      // auto-merge switch, and that is #74's endpoint and #74's role gate.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner);
      await seedMockup(api, workspace, owner.id);

      const viewer = await api.signIn();
      await api.join(workspace.id, viewer, "viewer");

      await read(viewer, workspace).expect(200);
    });
  });

  describe("against the mockup's own rows", () => {
    let owner: Awaited<ReturnType<typeof api.signIn>>;
    let workspace: Workspace;
    let dashboard: DashboardResource;

    beforeEach(async () => {
      owner = await api.signIn();
      workspace = await workspaceWithRepo(api, owner);
      await seedMockup(api, workspace, owner.id);

      dashboard = bodyOf<DashboardResource>(await read(owner, workspace).expect(200));
    });

    it("reproduces the stat row, number for number", () => {
      expect(dashboard.stats.loopsLive).toEqual({
        total: 3,
        byStatus: { coding: 1, building: 1, review: 1 },
      });
      expect(dashboard.stats.queued).toEqual({ count: 12, estMinutes: 580 });
      expect(dashboard.stats.merged7d).toEqual({ count: 27, deltaVsPrior: 8 });
      expect(dashboard.stats.tokensToday).toEqual({
        tokens: 4_200_000,
        costCents: 1860,
        providers: 4,
        unpricedEvents: 3,
      });
    });

    it("reproduces the pulse card, including the window the merge rate is measured over", () => {
      // `92%` is exact over the fourteen days these rows span — 46 merged of 50 closed — and
      // is *not* exact over seven: 27 of 29 is 93.1%. That choice is this endpoint's, it is
      // published in the OpenAPI description, and this is what holds the code to it.
      expect(dashboard.pulse).toEqual({
        mergeRate: 0.92,
        avgCycleSeconds: MOCKUP_AVG_CYCLE_SECONDS,
        interventions7d: 2,
        autoMerge: true,
      });
    });

    it("draws the active card in the mockup's order, with the mockup's rows", () => {
      expect(dashboard.activeRuns.map((run) => run.issueNumber)).toEqual([482, 479, 476]);
      expect(dashboard.activeRuns.map((run) => run.status)).toEqual([
        "coding",
        "building",
        "review",
      ]);
      expect(dashboard.activeRuns[1]).toEqual(
        expect.objectContaining({
          issueTitle: "Add OTA rollback on failed checksum",
          workflowTag: "feature-loop",
          model: "claude-sonnet-5",
          stageLabel: "Build farm",
          stageIndex: 5,
          stageTotal: 7,
          finishedAt: null,
          prNumber: null,
        }),
      );
    });

    it("draws the completions card newest first, with the mockup's four at the head", () => {
      // Eight are carried and four are drawn, so the assertion is about the head: those four,
      // in that order, are the rows the card renders.
      expect(dashboard.recentRuns).toHaveLength(8);
      expect(dashboard.recentRuns.slice(0, 4).map((run) => run.issueNumber)).toEqual([
        474, 471, 468, 465,
      ]);
      expect(dashboard.recentRuns[0]).toEqual(
        expect.objectContaining({
          prNumber: 512,
          model: "claude-fable-5",
          checksPassed: 14,
          checksTotal: 14,
          status: "merged",
        }),
      );
      // The row that is `needs_human` rather than `merged` because one check did not pass.
      expect(dashboard.recentRuns[3]).toEqual(
        expect.objectContaining({ status: "needs_human", checksPassed: 13, checksTotal: 14 }),
      );
    });

    it("carries the instants a card computes its durations from", () => {
      // *Cycle* is `finishedAt − startedAt`, computed by the client. `#474` reads `11m`.
      const [closed] = dashboard.recentRuns;
      const cycleSeconds =
        (Date.parse(closed.finishedAt ?? "") - Date.parse(closed.startedAt)) / 1000;

      expect(cycleSeconds).toBe(660);
    });

    it("draws the queue head the card draws, in queue order", () => {
      expect(dashboard.queueHead.map((item) => item.issueNumber)).toEqual([
        485, 486, 488, 490, 491,
      ]);
      expect(dashboard.queueHead.map((item) => item.effort)).toEqual(["m", "l", "xs", "xl", "s"]);
      expect(dashboard.queueHead[0]).toEqual(
        expect.objectContaining({
          issueTitle: "Watchdog reset on I²C bus lockup",
          workflowTag: "standard-fix",
          position: 1,
          estMinutes: 45,
        }),
      );
    });

    it("composes the page head's subline from the same figures the cards use", async () => {
      expect(dashboard.activity.inFlight).toBe(dashboard.stats.loopsLive.total);
      expect(dashboard.activity.queued).toBe(dashboard.stats.queued.count);

      // "Merged since this morning" is the one number measured from a calendar boundary, so
      // what it should be depends on the hour this suite runs at. Asked of the database
      // directly rather than hard-coded — an independent oracle for the same question.
      const { rows } = await api.sql.query<{ merged: number }>(
        `select count(*)::int as merged
           from ouroboros.runs
          where organization_id = $1
            and status = 'merged'
            and finished_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
        [workspace.id],
      );

      expect(dashboard.activity.mergedSinceMorning).toBe(rows[0].merged);
      expect(dashboard.activity.mergedSinceMorning).toBeLessThanOrEqual(
        dashboard.stats.merged7d.count,
      );
    });

    it("carries the queue item nobody sized, as a null rather than as a zero", async () => {
      // Not on the card's five, so it is asked of the count-and-sum pair instead: twelve
      // items, eleven estimates, 580 minutes.
      const { rows } = await api.sql.query<{ unsized: number }>(
        `select count(*)::int as unsized from ouroboros.queue_items
          where organization_id = $1 and est_minutes is null`,
        [workspace.id],
      );

      expect(rows[0].unsized).toBe(1);
      expect(dashboard.stats.queued).toEqual({ count: 12, estMinutes: 580 });
    });
  });

  describe("an organization with nothing in it", () => {
    it("answers zeros and empty arrays, and no nulls a card could divide by", async () => {
      // The zero-state fixture #86 renders against, and the acceptance criterion in full: a
      // fresh workspace has no runs, no queue, no spend and no settings row.
      const founder = await api.signIn();
      const workspace = await workspaceWithRepo(api, founder);

      const response = await read(founder, workspace).expect(200);

      expect(bodyOf<DashboardResource>(response)).toEqual({
        stats: {
          loopsLive: { total: 0, byStatus: { coding: 0, building: 0, review: 0 } },
          queued: { count: 0, estMinutes: 0 },
          merged7d: { count: 0, deltaVsPrior: 0 },
          tokensToday: { tokens: 0, costCents: 0, providers: 0, unpricedEvents: 0 },
        },
        pulse: { mergeRate: 0, avgCycleSeconds: 0, interventions7d: 0, autoMerge: false },
        activeRuns: [],
        recentRuns: [],
        queueHead: [],
        activity: { inFlight: 0, queued: 0, mergedSinceMorning: 0 },
      });
    });

    it("reads the auto-merge switch as off from the database, not from a default here", async () => {
      // V011's lazy creation: absence means every setting is at its default, and the
      // effective view is what resolves that. A workspace that has *answered* no must read
      // the same, and the difference is what #74 and #86 need to be able to tell.
      const founder = await api.signIn();
      const workspace = await workspaceWithRepo(api, founder);

      const before = bodyOf<DashboardResource>(await read(founder, workspace).expect(200));
      expect(before.pulse.autoMerge).toBe(false);

      await api.sql.query(
        `insert into ouroboros.workspace_settings (organization_id, auto_merge_on_checks)
         values ($1, false)`,
        [workspace.id],
      );

      const after = bodyOf<DashboardResource>(await read(founder, workspace).expect(200));
      expect(after.pulse.autoMerge).toBe(false);
    });

    it("survives a run with no history around it — the window of exactly one", async () => {
      // The single-run window: a rate of 1, a mean equal to that run's own cycle, and no
      // division by a count of zero anywhere.
      const founder = await api.signIn();
      const workspace = await workspaceWithRepo(api, founder);

      await api.sql.query(
        `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                     workflow_tag, model, status, stage_label, stage_index,
                                     stage_total, started_at, finished_at, pr_number,
                                     checks_passed, checks_total)
         values ($1, $2, 1, 'The only run there has ever been', 'standard-fix', 'claude-fable-5',
                 'merged', 'Merged', 6, 6, now() - interval '620 seconds', now(), 1, 3, 3)`,
        [workspace.id, workspace.repoId],
      );

      const only = bodyOf<DashboardResource>(await read(founder, workspace).expect(200));

      expect(only.pulse.mergeRate).toBe(1);
      expect(only.pulse.avgCycleSeconds).toBeCloseTo(620, 0);
      expect(only.stats.merged7d).toEqual({ count: 1, deltaVsPrior: 1 });
    });

    it("counts a run that closed just outside the window in neither week's total", async () => {
      // The boundary, from the other side: a run that finished fifteen days ago is older than
      // both windows, so it is in no count at all — and the merge rate does not quietly
      // stretch to reach it.
      const founder = await api.signIn();
      const workspace = await workspaceWithRepo(api, founder);

      await api.sql.query(
        `insert into ouroboros.runs (organization_id, github_repo_id, issue_number, issue_title,
                                     workflow_tag, model, status, stage_label, stage_index,
                                     stage_total, started_at, finished_at, pr_number,
                                     checks_passed, checks_total)
         values ($1, $2, 1, 'Ancient history', 'standard-fix', 'claude-fable-5', 'merged',
                 'Merged', 6, 6, now() - interval '15 days', now() - interval '15 days' + interval '10 minutes',
                 1, 3, 3)`,
        [workspace.id, workspace.repoId],
      );

      const dashboard = bodyOf<DashboardResource>(await read(founder, workspace).expect(200));

      expect(dashboard.stats.merged7d).toEqual({ count: 0, deltaVsPrior: 0 });
      expect(dashboard.pulse.mergeRate).toBe(0);
      expect(dashboard.pulse.avgCycleSeconds).toBe(0);
      // It is still a run, and the completions card still draws it.
      expect(dashboard.recentRuns).toHaveLength(1);
    });
  });

  describe("polling it", () => {
    let owner: Awaited<ReturnType<typeof api.signIn>>;
    let workspace: Workspace;

    beforeEach(async () => {
      owner = await api.signIn();
      workspace = await workspaceWithRepo(api, owner);
      await seedMockup(api, workspace, owner.id);
    });

    it("answers with a strong tag and tells a browser to revalidate", async () => {
      const response = await read(owner, workspace).expect(200);

      expect(response.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
      expect(response.headers["cache-control"]).toBe("private, no-cache");
    });

    it("says when to poll again, at the interval the contract documents", async () => {
      // The #75 contract over a real socket: the hint is on the answer, it is whole
      // seconds, and an unconfigured deployment says 15 — the number the #87 hook and
      // `docs/ARCHITECTURE.md` § 5.4 agreed on.
      const response = await read(owner, workspace).expect(200);

      expect(response.headers["x-ouro-poll-after"]).toBe("15");
    });

    it("answers 304 with no body when the caller already holds the tag", async () => {
      const first = await read(owner, workspace).expect(200);

      const second = await read(owner, workspace)
        .set("If-None-Match", first.headers.etag)
        .expect(304);

      expect(second.body).toEqual({});
      expect(second.text).toBeFalsy();
      // The tag travels on the `304`: it is how a client learns what it holds is current.
      expect(second.headers.etag).toBe(first.headers.etag);
      // And so do the caching policy and the poll hint: a backed-off server answers
      // mostly `304`s, so the cheap answer is the one that must carry the cadence.
      expect(second.headers["cache-control"]).toBe("private, no-cache");
      expect(second.headers["x-ouro-poll-after"]).toBe("15");
    });

    it("honours a tag a proxy weakened on the way past", async () => {
      // RFC 9110 § 8.8.3.2: `If-None-Match` compares weakly. Refusing this would turn a
      // proxy's correct behaviour into a full payload on every poll.
      const first = await read(owner, workspace).expect(200);

      await read(owner, workspace).set("If-None-Match", `W/${first.headers.etag}`).expect(304);
    });

    it("issues a new tag and a full payload once a row has changed", async () => {
      const first = await read(owner, workspace).expect(200);

      await api.sql.query(
        `update ouroboros.runs set stage_index = 5, stage_label = 'Self-review'
          where organization_id = $1 and issue_number = 482`,
        [workspace.id],
      );

      const second = await read(owner, workspace)
        .set("If-None-Match", first.headers.etag)
        .expect(200);

      expect(second.headers.etag).not.toBe(first.headers.etag);
      expect(bodyOf<DashboardResource>(second).activeRuns[0].stageLabel).toBe("Self-review");
    });

    it("issues a new tag when a row is added and when one is removed", async () => {
      const before = (await read(owner, workspace).expect(200)).headers.etag;

      await api.sql.query(
        `insert into ouroboros.queue_items (organization_id, github_repo_id, issue_number,
                                            issue_title, effort, workflow_tag, position)
         values ($1, $2, 999, 'One more thing', 'xs', 'docs-loop', 13)`,
        [workspace.id, workspace.repoId],
      );
      const added = (await read(owner, workspace).expect(200)).headers.etag;
      expect(added).not.toBe(before);

      await api.sql.query(`delete from ouroboros.queue_items where issue_number = 999`);
      const removed = (await read(owner, workspace).expect(200)).headers.etag;
      expect(removed).not.toBe(added);
    });

    it("gives two workspaces different tags, even holding the same rows", async () => {
      // A stored payload for one workspace can never be revalidated into an answer for
      // another — which is what makes `Cache-Control: private, no-cache` safe without a
      // `Vary` on the tenant header.
      const second = await workspaceWithRepo(api, owner);
      await seedMockup(api, second, owner.id);

      const one = await read(owner, workspace).expect(200);
      const two = await read(owner, second).expect(200);

      expect(one.headers.etag).not.toBe(two.headers.etag);
      // …and a tag from one workspace does not silence the other.
      await read(owner, second).set("If-None-Match", one.headers.etag).expect(200);
    });
  });

  describe("isolation", () => {
    it("counts one workspace's rows and never the installation's", async () => {
      // Every predicate in the repository is scoped by parameter; this is that property from
      // the outside, with two full fixtures in one database.
      const owner = await api.signIn();
      const mine = await workspaceWithRepo(api, owner);
      await seedMockup(api, mine, owner.id);

      const neighbour = await workspaceWithRepo(api, owner);
      await seedMockup(api, neighbour, owner.id);

      const dashboard = bodyOf<DashboardResource>(await read(owner, mine).expect(200));

      // Both workspaces hold the same fifty-three runs. Unscoped queries would double every
      // count on this page.
      expect(dashboard.stats.loopsLive.total).toBe(3);
      expect(dashboard.stats.merged7d.count).toBe(27);
      expect(dashboard.stats.queued.count).toBe(12);
      expect(dashboard.stats.tokensToday.tokens).toBe(4_200_000);
      expect(dashboard.activeRuns).toHaveLength(3);
    });
  });

  describe("what it costs", () => {
    it("answers a poll of the seeded workspace well inside the page's budget", async () => {
      // The ticket asks for p95 under 100ms on seed volume. A hard 100ms assertion against a
      // container on a shared CI runner would fail for reasons that have nothing to do with
      // this code, so what is asserted is a ceiling loose enough never to be the runner's
      // fault and tight enough to catch what actually goes wrong here: a query that stopped
      // being scoped, an accidental read per row, an index that stopped being used. The
      // measured figure is in the pull request.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner);
      await seedMockup(api, workspace, owner.id);

      const samples: number[] = [];
      for (let poll = 0; poll < 20; poll += 1) {
        const started = process.hrtime.bigint();
        await read(owner, workspace).expect(200);
        samples.push(Number(process.hrtime.bigint() - started) / 1_000_000);
      }

      const p95 = samples.toSorted((a, b) => a - b)[Math.floor(samples.length * 0.95) - 1];
      expect(p95).toBeLessThan(500);
    });

    it("costs less to be told nothing has changed than to be told everything", async () => {
      // The whole argument for a version source, observed end to end rather than counted in a
      // unit test: a `304` reads four aggregate subqueries and returns no rows.
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner);
      await seedMockup(api, workspace, owner.id);

      const first = await read(owner, workspace).expect(200);
      const tag = first.headers.etag;

      const notModified = await read(owner, workspace).set("If-None-Match", tag).expect(304);

      expect(notModified.headers["content-length"]).toBeUndefined();
      expect(Number(first.headers["content-length"])).toBeGreaterThan(0);
    });
  });
});

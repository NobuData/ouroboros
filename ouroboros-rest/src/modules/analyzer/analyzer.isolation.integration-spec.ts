import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { routeTable } from "../auth/route.table.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { SOURCE_CONFIG } from "../ticket-sources/providers/github.provider.fixture";
import {
  analyze,
  annotate,
  BENCH_REPO,
  changePointFinding,
  recordApplication,
  rollUp,
  seedSeededIdsWorkspace,
  suggestionId,
} from "./analyzer.integration.fixture";
import { POOL_A_ID } from "./composer/composer.seed.fixture";
import type { DurationChartResource } from "./duration/duration.resources";
import type { MeasurementsResource } from "./measurement/measurement.resources";
import type { SuggestionsResource } from "./suggestions/suggestions.resources";
import type { TicketsResource } from "./tickets/tickets.resources";

/**
 * Organization isolation on every Build Analyzer route (BV.6,
 * [#515](https://github.com/NobuData/ouroboros/issues/515)) — runs, findings, suggestions,
 * batches, measurements, the duration chart, the suggestion cards (BW.3, #518) and the
 * drafted-tickets card (BW.4, #519).
 *
 * Their workspace holds one of everything: a complete run with findings, composed suggestions, an applied
 * one with its measurement, an analyzer-drafted batch a ticket suggestion was drafted into (and
 * another still open), and a complete run whose change-point sits on a rolled-up duration series. Mine is an administrator's workspace
 * with none of it — and every route, aimed at their objects, answers as if they do not exist.
 * Their repository has the same `owner/name` I would name, so a route scoped by repository rather
 * than workspace would leak.
 *
 * `HAS A CLAIM FOR EVERY ANALYZER ROUTE` compares the claims with the router's own list, so an
 * analyzer route added without one fails here, naming itself.
 */

const ANALYZER = "/api/v1/analyzer";

/** What one route's isolation claim is. */
interface IsolationCase {
  readonly about: string;
  readonly check: () => Promise<void>;
}

describe("organization isolation, on every analyzer route", () => {
  let api: ApiHarness;
  let me: Person;
  let mine: Workspace;
  let them: Person;
  let theirs: Workspace;
  let theirRun: string;
  let theirSuggestion: string;
  let theirTicket: string;
  let theirBatch: string;
  let theirSource: string;

  beforeAll(async () => {
    api = await ApiHarness.start();
    them = await api.signIn();
    theirs = await api.workspace(them);
    await seedSeededIdsWorkspace(api, theirs);
    // Complete, so their suggestion cards have rows for the read's claim to be about.
    theirRun = await analyze(api, theirs, [], { ending: "complete" });
    theirSuggestion = await suggestionId(api, theirs, "Move forge-02");
    theirTicket = await suggestionId(api, theirs, "Refactor tests/");
    await recordApplication(
      api,
      theirs,
      them,
      await suggestionId(api, theirs, "Split the test gate"),
      {
        at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        metric: "build_duration",
        baseline: 380,
        delta: -110,
        analyzer: "cache_window",
      },
    );
    const source = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub', $2::jsonb) returning id`,
      [theirs.id, JSON.stringify(SOURCE_CONFIG)],
    );
    theirSource = source.rows[0].id;
    const batch = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.draft_batches
         (organization_id, source_prompt, planner, target_source_id)
       values ($1, 'Build Analyzer: drafted', 'analyzer-v1', $2) returning id`,
      [theirs.id, theirSource],
    );
    theirBatch = batch.rows[0].id;
    // One of their ticket suggestions is drafted into it, so their drafted-tickets card holds a
    // batch as well as the suggestion still open.
    await api.sql.query(
      `update ${SCHEMA_NAME}.analysis_suggestions
          set status = 'drafted', draft_batch_id = $2, resolved_at = now()
        where id = $1`,
      [await suggestionId(api, theirs, "Bump ccache"), theirBatch],
    );
    await rollUp(api, theirs, "build_duration", "2026-06-22", [212_000], "zephyr build");
    await annotate(api, theirs, [
      changePointFinding("2026-06-22", -130, [
        {
          label: "pool-a image zephyr-sdk:0.17",
          score: 0.6,
          ref: { kind: "runner_pool", id: POOL_A_ID },
          event_kind: "infra_event",
          days_from_breakpoint: 0,
        },
      ]),
    ]);

    me = await api.signIn();
    mine = await api.workspace(me);
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  /** A request as me, in my workspace. */
  function as(method: "get" | "post" | "put", path: string) {
    return api.as(me)(method, path).set(TENANT_HEADER, mine.slug);
  }

  /** A refusal's code, having asserted its status. */
  async function refused(
    method: "get" | "post" | "put",
    path: string,
    body: object = {},
    status = 404,
  ) {
    const request = as(method, path);
    const response = await (method === "get" ? request : request.send(body)).expect(status);
    return bodyOf<{ code: string }>(response).code;
  }

  /** Their suggestion's status — a refused mutation changed nothing. */
  async function status(id: string): Promise<string> {
    const { rows } = await api.sql.query<{ status: string }>(
      `select status from ${SCHEMA_NAME}.analysis_suggestions where id = $1`,
      [id],
    );
    return rows[0].status;
  }

  /** Every schedule row of the bench repository, across workspaces — a refused save adds none. */
  async function schedules(): Promise<unknown[]> {
    const { rows } = await api.sql.query<Record<string, unknown>>(
      `select organization_id, enabled, every_n_builds, max_builds from ${SCHEMA_NAME}.analysis_schedules
        where repo_ref = $1 order by organization_id`,
      [BENCH_REPO],
    );
    return rows;
  }

  const CASES: Readonly<Record<string, IsolationCase>> = {
    [`POST ${ANALYZER}/runs`]: {
      about: "cannot start a run of another workspace's repository",
      check: async () => {
        expect(await refused("post", `${ANALYZER}/runs`, { repo: BENCH_REPO })).toBe(
          "analysis_repository_not_found",
        );
      },
    },
    [`GET ${ANALYZER}/runs/latest`]: {
      about: "sees no run of the same repository name in another workspace",
      check: async () => {
        const body = bodyOf<{ run: unknown }>(
          await as("get", `${ANALYZER}/runs/latest?repo=${BENCH_REPO}`).expect(200),
        );
        expect(body.run).toBeNull();
      },
    },
    [`GET ${ANALYZER}/runs/:id`]: {
      about: "cannot read another workspace's run",
      check: async () => {
        expect(await refused("get", `${ANALYZER}/runs/${theirRun}`)).toBe("analysis_run_not_found");
      },
    },
    [`GET ${ANALYZER}/suggestions`]: {
      about:
        "lists none of another workspace's suggestions, findings or calibration for the same repository",
      check: async () => {
        const body = bodyOf<SuggestionsResource>(
          await as("get", `${ANALYZER}/suggestions?repo=${BENCH_REPO}`).expect(200),
        );
        expect(body).toEqual({
          repo: BENCH_REPO,
          runId: null,
          analyzedAt: null,
          suggestions: [],
          calibration: [],
        });
      },
    },
    [`GET ${ANALYZER}/tickets`]: {
      about:
        "lists none of another workspace's ticket suggestions or drafted batches for the same repository",
      check: async () => {
        const body = bodyOf<TicketsResource>(
          await as("get", `${ANALYZER}/tickets?repo=${BENCH_REPO}`).expect(200),
        );
        expect(body).toEqual({ repo: BENCH_REPO, undrafted: [], batches: [] });
      },
    },
    [`GET ${ANALYZER}/suggestions/:id/preview`]: {
      about: "cannot preview another workspace's suggestion or read its findings",
      check: async () => {
        expect(await refused("get", `${ANALYZER}/suggestions/${theirSuggestion}/preview`)).toBe(
          "analysis_suggestion_not_found",
        );
      },
    },
    [`POST ${ANALYZER}/suggestions/:id/apply`]: {
      about: "cannot apply another workspace's suggestion, changing nothing",
      check: async () => {
        expect(await refused("post", `${ANALYZER}/suggestions/${theirSuggestion}/apply`)).toBe(
          "analysis_suggestion_not_found",
        );
        expect(await status(theirSuggestion)).toBe("open");
      },
    },
    [`POST ${ANALYZER}/suggestions/:id/dismiss`]: {
      about: "cannot dismiss another workspace's suggestion, changing nothing",
      check: async () => {
        expect(await refused("post", `${ANALYZER}/suggestions/${theirSuggestion}/dismiss`)).toBe(
          "analysis_suggestion_not_found",
        );
        expect(await status(theirSuggestion)).toBe("open");
      },
    },
    [`POST ${ANALYZER}/suggestions/draft`]: {
      about: "cannot draft another workspace's ticket suggestion, changing nothing",
      check: async () => {
        expect(
          await refused("post", `${ANALYZER}/suggestions/draft`, {
            suggestionIds: [theirTicket],
            targetSourceId: theirSource,
          }),
        ).toBe("analysis_suggestion_not_found");
        expect(await status(theirTicket)).toBe("open");
      },
    },
    [`POST ${ANALYZER}/batches/:id/push`]: {
      about: "cannot push another workspace's analyzer batch",
      check: async () => {
        expect(await refused("post", `${ANALYZER}/batches/${theirBatch}/push`)).toBe(
          "analysis_batch_not_found",
        );
      },
    },
    [`GET ${ANALYZER}/schedule`]: {
      about: "cannot read another workspace's schedule or its build counter",
      check: async () => {
        expect(await refused("get", `${ANALYZER}/schedule?repo=${BENCH_REPO}`)).toBe(
          "analysis_repository_not_found",
        );
      },
    },
    [`PUT ${ANALYZER}/schedule`]: {
      about: "cannot save a schedule for another workspace's repository, changing nothing",
      check: async () => {
        const before = await schedules();
        expect(
          await refused("put", `${ANALYZER}/schedule`, {
            repo: BENCH_REPO,
            enabled: false,
            weeklyEnabled: false,
            weeklyDay: null,
            weeklyTime: null,
            everyNBuilds: null,
            maxBuilds: 1,
            maxLogLines: 1,
            computeCeilingSeconds: 1,
          }),
        ).toBe("analysis_repository_not_found");
        expect(await schedules()).toEqual(before);
      },
    },
    [`GET ${ANALYZER}/measurements`]: {
      about:
        "reads none of another workspace's measurements or calibration for the same repository",
      check: async () => {
        const body = bodyOf<MeasurementsResource>(
          await as("get", `${ANALYZER}/measurements?repo=${BENCH_REPO}`).expect(200),
        );
        expect(body.measurements).toEqual([]);
        expect(body.calibration).toEqual([]);
      },
    },
    [`GET ${ANALYZER}/duration`]: {
      about:
        "draws none of another workspace's duration series or change-points for the same repository",
      check: async () => {
        const body = bodyOf<DurationChartResource>(
          await as("get", `${ANALYZER}/duration?repo=${BENCH_REPO}`).expect(200),
        );
        expect(body).toEqual({
          repo: BENCH_REPO,
          runId: null,
          analyzedAt: null,
          durationLabel: null,
          window: null,
          series: [],
          changePoints: [],
        });
      },
    },
  };

  it("HAS A CLAIM FOR EVERY ANALYZER ROUTE THE APPLICATION REGISTERS", () => {
    const routes = routeTable(api.nest)
      .filter((route) => route.path.startsWith(`${ANALYZER}/`))
      .map((route) => route.signature)
      .sort();

    expect(routes).toEqual(Object.keys(CASES).sort());
  });

  it("has their side populated, so every claim below is about something that exists", async () => {
    const { rows } = await api.sql.query<{ n: string }>(
      `select count(*)::text as n from ${SCHEMA_NAME}.suggestion_measurements
        where organization_id = $1`,
      [theirs.id],
    );
    expect(rows[0].n).toBe("1");

    const chart = await api.sql.query<{ points: string; series: string }>(
      `select (select count(*) from ${SCHEMA_NAME}.analysis_findings f
                 join ${SCHEMA_NAME}.analysis_runs r on r.id = f.run_id
                where f.organization_id = $1 and f.finding_type = 'change_point'
                  and r.status = 'complete')::text as points,
              (select count(*) from ${SCHEMA_NAME}.metric_daily d
                where d.organization_id = $1 and d.metric_id = 'build_duration')::text as series`,
      [theirs.id],
    );
    expect(chart.rows[0]).toEqual({ points: "1", series: "1" });

    // Their cards list something: suggestions last composed by a run that ended complete.
    const cards = await api.sql.query<{ n: string }>(
      `select count(*)::text as n from ${SCHEMA_NAME}.analysis_suggestions s
         join ${SCHEMA_NAME}.analysis_runs r on r.id = s.last_run_id
        where s.organization_id = $1 and r.status = 'complete'
          and s.kind in ('build_process', 'workflow')`,
      [theirs.id],
    );
    expect(cards.rows[0].n).toBe("6");

    // …and their drafted-tickets card: a suggestion still open, and the batch another went into.
    const tickets = bodyOf<TicketsResource>(
      await api
        .as(them)("get", `${ANALYZER}/tickets?repo=${BENCH_REPO}`)
        .set(TENANT_HEADER, theirs.slug)
        .expect(200),
    );
    expect(tickets.undrafted.map((entry) => entry.id)).toContain(theirTicket);
    expect(tickets.batches.map((entry) => entry.batch.id)).toEqual([theirBatch]);
  });

  describe("each route holds the line", () => {
    it.each(
      Object.entries(CASES).map(
        ([signature, value]) => [signature, value.about, value.check] as const,
      ),
    )("%s — %s", async (_signature, _about, check) => {
      await check();
    });
  });
});

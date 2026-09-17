import { Logger } from "@nestjs/common";

import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { EstimationOrchestrator } from "../estimation/estimation.orchestrator";
import { seedRoutingBench, type RoutingBench } from "../routing/workspace.fixture";
import { nextNightlySlot } from "../scheduling/cadence";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { BacklogHealthResource } from "./planning.resources";
import { ReestimationJob } from "./reestimation.job";

/**
 * Backlog health and the nightly re-estimation, end to end, against a migrated database (AL.5,
 * [#281](https://github.com/NobuData/ouroboros/issues/281)).
 *
 * The backlog is the development seed's (`R__dev_seed_ticket_planning.sql`) — the same fifty-two
 * tickets, states, sizing and update ages, and the same six edges — inserted into a workspace the
 * harness made, so `38/42 · 4 · 6` is reproduced from rows rather than asserted by a mock. Sizing
 * runs through the application's own `EstimationOrchestrator` and the contract-faithful engine stub.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const HEALTH = "/api/v1/planning/health";

/** The nightly bound this suite runs under — small, so a four-ticket backlog can exceed it. */
const BATCH = 3;

/**
 * The seed's canonical tickets: number, state, sizing status, days since the tracker updated it.
 * Copied from `R__dev_seed_ticket_planning.sql`, whose header explains which row catches which
 * nearly-right count.
 */
const SEEDED_TICKETS: readonly (readonly [
  number,
  "open" | "closed",
  "sized" | "unsized",
  number,
])[] = [
  [540, "closed", "sized", 150],
  [541, "closed", "sized", 147],
  [542, "closed", "sized", 144],
  [543, "closed", "sized", 141],
  [544, "closed", "sized", 138],
  [545, "closed", "sized", 135],
  [546, "closed", "sized", 20],
  [547, "closed", "sized", 9],
  [548, "open", "sized", 10],
  [549, "open", "sized", 11],
  [550, "open", "sized", 1],
  [551, "open", "sized", 2],
  [552, "closed", "sized", 60],
  [553, "closed", "sized", 35],
  [554, "open", "sized", 5],
  [555, "open", "sized", 6],
  [556, "open", "sized", 7],
  [557, "open", "sized", 8],
  [558, "open", "sized", 9],
  [559, "open", "sized", 10],
  [560, "open", "sized", 11],
  [561, "open", "sized", 45],
  [562, "open", "sized", 2],
  [563, "open", "sized", 38],
  [564, "open", "sized", 4],
  [565, "open", "sized", 5],
  [566, "open", "sized", 6],
  [567, "open", "sized", 7],
  [568, "open", "sized", 8],
  [569, "open", "sized", 9],
  [570, "open", "sized", 10],
  [571, "open", "sized", 11],
  [572, "open", "sized", 1],
  [573, "open", "sized", 2],
  [574, "open", "sized", 3],
  [575, "open", "sized", 52],
  [576, "open", "sized", 5],
  [577, "open", "sized", 6],
  [578, "open", "sized", 7],
  [579, "open", "sized", 8],
  [580, "open", "sized", 9],
  [581, "open", "sized", 10],
  [582, "open", "sized", 40],
  [583, "open", "sized", 33],
  [584, "open", "sized", 47],
  [585, "open", "sized", 28],
  [586, "open", "sized", 4],
  [587, "open", "sized", 5],
  [588, "open", "unsized", 6],
  [589, "open", "unsized", 5],
  [590, "open", "unsized", 4],
  [591, "open", "unsized", 3],
];

/** The seed's six edges — blocker, blocked, origin. Two are `synced`. */
const SEEDED_EDGES: readonly (readonly [number, number, "planned" | "synced"])[] = [
  [548, 549, "planned"],
  [549, 551, "planned"],
  [550, 551, "planned"],
  [545, 550, "planned"],
  [554, 556, "synced"],
  [562, 565, "synced"],
];

describe("backlog health and nightly re-estimation, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;

  beforeAll(async () => {
    engine = await startEngineStub();
    api = await ApiHarness.start({
      OURO_ENGINE_URL: engine.url,
      OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
      OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS: "86400",
      OURO_REESTIMATION_BATCH: String(BATCH),
    });
  });

  afterAll(async () => {
    await api.close();
    await engine.stop();
  });

  beforeEach(() => {
    engine.reset();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    const unfaithful = [...engine.violations];

    await api.truncate();

    expect(unfaithful).toEqual([]);
  });

  /** A routed workspace with a GitHub source. */
  interface World {
    readonly bench: RoutingBench;
    readonly owner: Person;
    readonly sourceId: string;
    /** Ticket ids by number. */
    readonly tickets: Map<number, string>;
  }

  /**
   * A routed workspace with a GitHub source and the given tickets.
   *
   * @param tickets - Number, state, sizing status, days since updated.
   * @param edges - Blocker number, blocked number, origin.
   * @returns The world.
   */
  async function world(
    tickets: readonly (readonly [number, string, string, number])[] = SEEDED_TICKETS,
    edges: readonly (readonly [number, number, string])[] = SEEDED_EDGES,
  ): Promise<World> {
    const owner = await api.signIn();
    const bench = await seedRoutingBench(api, owner);
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub · acme-robotics', '{"login": "acme-robotics"}'::jsonb)
       returning id`,
      [bench.id],
    );
    const sourceId = rows[0].id;
    const ids = new Map<number, string>();

    for (const [number, state, sizing, updatedDaysAgo] of tickets) {
      const inserted = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.tickets
           (organization_id, source_id, external_id, external_key, external_url, title, state,
            labels, source_created_at, source_updated_at, sizing_status, meta)
         values ($1, $2, $3::text, '#' || $3::text,
                 'https://github.com/acme-robotics/helios-firmware/issues/' || $3::text,
                 'Seeded ticket #' || $3::text, $4, '["telemetry"]'::jsonb,
                 now() - interval '200 days' + make_interval(secs => $3::int),
                 now() - make_interval(days => $6::int), $5,
                 '{"github": {"owner": "acme-robotics", "repo": "helios-firmware"}}'::jsonb)
         returning id`,
        [bench.id, sourceId, number, state, sizing, updatedDaysAgo],
      );

      ids.set(number, inserted.rows[0].id);
    }

    for (const [blocker, blocked, origin] of edges) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.ticket_dependencies
           (organization_id, blocker_ticket_id, blocked_ticket_id, origin)
         values ($1, $2, $3, $4)`,
        [bench.id, ids.get(blocker), ids.get(blocked), origin],
      );
    }

    return { bench, owner, sourceId, tickets: ids };
  }

  /**
   * The card, as a workspace's owner reads it.
   *
   * @param seeded - The world.
   * @returns The card.
   */
  async function health(seeded: World): Promise<BacklogHealthResource> {
    const response = await api
      .as(seeded.owner)("get", HEALTH)
      .set(TENANT_HEADER, seeded.bench.slug)
      .expect(200);

    return bodyOf<BacklogHealthResource>(response);
  }

  /**
   * Run a night of re-estimation and wait for every estimate it queued.
   *
   * @param night - The instant whose next slot is run.
   */
  async function runNight(night: Date): Promise<void> {
    await api.nest.get(ReestimationJob).run(nextNightlySlot(night, 2));
    await api.nest.get(EstimationOrchestrator).settled();
  }

  it("reproduces the mockup's 38/42 · 4 · 6 from the seeded rows", async () => {
    const seeded = await world();

    const card = await health(seeded);

    expect(card).toEqual({
      open: 42,
      sized: { count: 38, total: 42, filter: { state: "open", sizing: "unsized" } },
      blocked: { count: 4, filter: { state: "open", blocked: true } },
      stale: { count: 6, thresholdDays: 30, filter: { state: "open", staleDays: 30 } },
      reestimation: {
        schedule: { hourUtc: 2, jitterMinutes: 30, batchLimit: BATCH },
        lastRun: null,
      },
    });
  });

  it("counts blocked over planned and synced edges alike", async () => {
    const planned = SEEDED_EDGES.filter(([, , origin]) => origin === "planned");

    expect((await health(await world(SEEDED_TICKETS, planned))).blocked.count).toBe(2);

    await api.truncate();

    expect((await health(await world())).blocked.count).toBe(4);
  });

  it("recomputes after a synced ticket-state change — no cached counter goes stale", async () => {
    const seeded = await world();

    expect(await health(seeded)).toMatchObject({ open: 42, blocked: { count: 4 } });

    // The sync closes #548, which blocks #549: one fewer open ticket, one fewer sized, and #549's
    // only blocker is resolved.
    await api.sql.query(
      `update ${SCHEMA_NAME}.tickets set state = 'closed', source_updated_at = now() where id = $1`,
      [seeded.tickets.get(548)],
    );
    // And the tracker touches #561, which was stale.
    await api.sql.query(
      `update ${SCHEMA_NAME}.tickets set source_updated_at = now() where id = $1`,
      [seeded.tickets.get(561)],
    );

    expect(await health(seeded)).toMatchObject({
      open: 41,
      sized: { count: 37, total: 41 },
      blocked: { count: 3 },
      stale: { count: 5 },
    });
  });

  it("answers genuine zeros for an empty workspace", async () => {
    const seeded = await world([], []);

    expect(await health(seeded)).toMatchObject({
      open: 0,
      sized: { count: 0, total: 0 },
      blocked: { count: 0 },
      stale: { count: 0 },
    });
  });

  it("sizes the unsized backlog through the orchestrator within its bound, and records the run", async () => {
    const seeded = await world();
    const unsized = [588, 589, 590, 591].map((number) => seeded.tickets.get(number));

    await runNight(new Date("2026-09-17T01:00:00.000Z"));

    // The bound: four unsized tickets, three engine calls, three estimates under ticket_id.
    expect(engine.requests).toHaveLength(BATCH);
    const { rows: sized } = await api.sql.query<{ ticket_id: string; version: number }>(
      `select ticket_id, version from ${SCHEMA_NAME}.issue_estimates where ticket_id = any($1)`,
      [unsized],
    );
    expect(sized).toHaveLength(BATCH);
    expect(sized.every((row) => row.version === 1)).toBe(true);

    const card = await health(seeded);
    expect(card.sized).toMatchObject({ count: 38 + BATCH, total: 42 });
    expect(card.reestimation.lastRun).toMatchObject({
      status: "succeeded",
      found: BATCH,
      queued: BATCH,
      inFlight: 0,
    });
    expect(card.reestimation.lastRun?.finishedAt).not.toBeNull();

    // A second replica starting the same night stands down: nothing more is dispatched.
    await runNight(new Date("2026-09-17T01:30:00.000Z"));
    expect(engine.requests).toHaveLength(BATCH);

    // The next night picks up what the bound left behind — and only that.
    await runNight(new Date("2026-09-18T01:00:00.000Z"));
    expect(engine.requests).toHaveLength(4);
    expect(await health(seeded)).toMatchObject({
      sized: { count: 42, total: 42 },
      reestimation: { lastRun: { found: 1, queued: 1 } },
    });
  });

  it("sends each ticket to the engine as a contract-valid issue in its own repository", async () => {
    await world([[588, "open", "unsized", 6]], []);

    await runNight(new Date("2026-09-17T01:00:00.000Z"));

    expect(engine.requests).toHaveLength(1);
    expect(engine.requests[0]).toMatchObject({
      issue: {
        number: 588,
        title: "Seeded ticket #588",
        labels: ["telemetry"],
        repo: "acme-robotics/helios-firmware",
      },
    });
  });

  it("holds every count to the workspace asking, and shares a night's batch between workspaces", async () => {
    const acme = await world();
    const other = await world(
      [
        [701, "open", "unsized", 1],
        [702, "open", "unsized", 1],
      ],
      [],
    );

    // Each workspace reads only its own backlog.
    expect(await health(other)).toMatchObject({
      open: 2,
      sized: { count: 0, total: 2 },
      blocked: { count: 0 },
      stale: { count: 0 },
    });
    expect((await health(acme)).open).toBe(42);

    // One night, a bound of three, two workspaces with unsized work: both get some.
    await runNight(new Date("2026-09-17T01:00:00.000Z"));

    const acmeRun = (await health(acme)).reestimation.lastRun;
    const otherRun = (await health(other)).reestimation.lastRun;

    expect(acmeRun).toMatchObject({ found: 2, queued: 2 });
    expect(otherRun).toMatchObject({ found: 1, queued: 1 });
    // The run itself is one run, read by both.
    expect(acmeRun?.startedAt).toBe(otherRun?.startedAt);

    // A workspace with no tickets reads the run with zero counts of its own.
    const empty = await world([], []);
    expect((await health(empty)).reestimation.lastRun).toMatchObject({
      found: 0,
      queued: 0,
      inFlight: 0,
    });
  });
});

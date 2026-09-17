import { Logger } from "@nestjs/common";

import {
  estimateAnswer,
  planAnswer,
  startEngineStub,
  type EngineStub,
} from "../../testing/engine.stub.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { planGoldenCase } from "../engine/engine.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { EstimationOrchestrator } from "../estimation/estimation.orchestrator";
import { OCTOKIT_FACTORY } from "../github/github.client.factory";
import { seedRoutingBench, type RoutingBench } from "../routing/workspace.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import {
  SOURCE_CONFIG,
  SOURCE_LOGIN,
  SOURCE_REPO,
  SOURCE_TOKEN,
  recordingFactory,
} from "../ticket-sources/providers/github.provider.fixture";
import {
  writeRecording,
  type WriteRecording,
} from "../ticket-sources/providers/github.write-recordings.fixture";
import { VaultService } from "../vault/vault.service";
import { PLANNING_ERRORS } from "./planning.errors";
import type {
  BatchResource,
  EpicResource,
  GeneratedBatchResource,
  MilestonesResource,
  PushResultResource,
  PushStatusResource,
  RoadmapResource,
} from "./planning.resources";
import { PUSH_ERRORS } from "./push.errors";

/**
 * The planning API, end to end, against a migrated database (AL.4,
 * [#280](https://github.com/NobuData/ouroboros/issues/280)).
 *
 * The acceptance criterion *"the full flow passes in the harness: generate → size → select → push →
 * queue-small"* is the first case, over HTTP, with nothing standing in but the engine (the
 * contract-faithful stub, answering AL.1's golden OTA batch) and GitHub (a recorded one behind the
 * real provider). Sizing runs through the application's own `EstimationOrchestrator`; the push
 * through AL.3's `PushService`; the queue-small hook through M.3's `BacklogQueueService` — all as the
 * process wires them.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const BATCHES = "/api/v1/planning/batches";
const EPICS = "/api/v1/planning/epics";
const ROADMAP = "/api/v1/planning/roadmap";

/** A model no price catalog covers — so an unpriced batch is unpriced by construction. */
const UNPRICED_MODEL = "harness-unpriced-model";

describe("the planning API, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;
  let github: WriteRecording;

  beforeAll(async () => {
    engine = await startEngineStub();
    github = writeRecording();
    api = await ApiHarness.start(
      {
        OURO_ENGINE_URL: engine.url,
        OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
        OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS: "86400",
      },
      [{ provide: OCTOKIT_FACTORY, useValue: recordingFactory(github.octokit).factory }],
    );
  });

  afterAll(async () => {
    await api.close();
    await engine.stop();
  });

  beforeEach(() => {
    engine.reset();
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    const unfaithful = [...engine.violations];

    await api.truncate();

    expect(unfaithful).toEqual([]);
  });

  /** A workspace with routing, a GitHub source, an owner and a member. */
  interface World {
    readonly bench: RoutingBench;
    readonly owner: Person;
    readonly member: Person;
    readonly sourceId: string;
  }

  /**
   * Seed a workspace the planning page can work in.
   *
   * @returns The world.
   */
  async function world(): Promise<World> {
    const owner = await api.signIn();
    const bench = await seedRoutingBench(api, owner);
    const member = await api.signIn();

    await api.join(bench.id, member, "member");

    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub · acme-robotics', $2::jsonb) returning id`,
      [bench.id, JSON.stringify(SOURCE_CONFIG)],
    );
    const sourceId = rows[0].id;
    const sealed = await api.nest.get(VaultService).encryptText(bench.id, sourceId, SOURCE_TOKEN);

    await api.sql.query(
      `update ${SCHEMA_NAME}.ticket_sources set credentials_encrypted = $2 where id = $1`,
      [sourceId, sealed],
    );

    return { bench, owner, member, sourceId };
  }

  /**
   * A request as somebody, in the world's workspace.
   *
   * @param seeded - The world.
   * @param person - Who.
   * @param method - The verb.
   * @param path - The path.
   * @returns The Supertest request.
   */
  function call(
    seeded: World,
    person: Person,
    method: "get" | "post" | "put" | "patch" | "delete",
    path: string,
  ) {
    return api.as(person)(method, path).set(TENANT_HEADER, seeded.bench.slug);
  }

  /**
   * Generate the golden OTA batch and wait for sizing to land.
   *
   * @param seeded - The world.
   * @param body - What else the generator card sends.
   * @returns The batch as generated.
   */
  async function generated(
    seeded: World,
    body: Record<string, unknown> = {},
  ): Promise<GeneratedBatchResource> {
    const golden = planGoldenCase().request as { narrative: string; outline: string };
    const response = await call(seeded, seeded.member, "post", BATCHES)
      .send({
        prompt: golden.narrative,
        outline: golden.outline,
        targetSourceId: seeded.sourceId,
        milestone: "Helios 2.1",
        ...body,
      })
      .expect(201);

    await api.nest.get(EstimationOrchestrator).settled();

    return bodyOf<GeneratedBatchResource>(response);
  }

  it("runs the full flow: generate → size → select → push → queue-small", async () => {
    const seeded = await world();

    // Odd drafts XS, even drafts M — so queue-small has something to take and something to leave.
    // Keyed on the draft's own number (its key's position) rather than the attempt, because the
    // orchestrator sizes concurrently and arrival order is not draft order.
    engine.respond((attempt) => {
      const issue = engine.requests[attempt - 1].issue as { number: number };

      return estimateAnswer({
        effort: issue.number % 2 === 1 ? "xs" : "m",
        routed_model: UNPRICED_MODEL,
      });
    });

    // The backlog sync's mirror of the five issues the push will create, blockers first, sized
    // — M.3 queues mirrored, sized issues only.
    const filedBefore = github.issues.length;

    await mirror(
      seeded,
      [1, 2, 3, 4, 5].map((offset) => filedBefore + offset),
      "sized",
    );

    // generate
    const batch = await generated(seeded, { queueSmall: true });

    expect(engine.plans).toHaveLength(1);
    expect(batch.planner).toBe("outline-v0");
    expect(batch.drafts.map((draft) => draft.localKey)).toEqual([
      "OTA-1",
      "OTA-2",
      "OTA-3",
      "OTA-4",
      "OTA-5",
      "OTA-6",
    ]);

    // size — through the one orchestrator, six engine calls, and the batch says so
    const sized = bodyOf<BatchResource>(
      await call(seeded, seeded.member, "get", `${BATCHES}/${batch.id}`).expect(200),
    );

    expect(engine.requests).toHaveLength(6);
    expect(sized.status).toBe("sized");
    expect(sized.summary).toMatchObject({
      allSized: true,
      sizedCount: 6,
      estimators: ["heuristic-v0"],
    });
    // Loop time is the real sum of est_minutes; `$` is absent because nothing prices the model.
    expect(sized.summary.estMinutes).toBe(6 * 23);
    expect(sized.summary).not.toHaveProperty("spend");

    // …and appears once a rate exists — never as $0 before it.
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.model_prices
         (organization_id, match_provider_kind, match_model, billing_mode,
          input_cents_per_1m, output_cents_per_1m, source)
       values ($1, '*', $2, 'token', 300, 1500, 'override')`,
      [seeded.bench.id, UNPRICED_MODEL],
    );

    const priced = bodyOf<BatchResource>(
      await call(seeded, seeded.member, "get", `${BATCHES}/${batch.id}`).expect(200),
    );

    expect(priced.summary.spend).toEqual({ cents: 324, display: "$3.24", partial: false });

    // select — a member may; OTA-6 (the docs ticket) is left out
    const selected = bodyOf<BatchResource>(
      await call(seeded, seeded.member, "patch", `${BATCHES}/${batch.id}/drafts/OTA-6`)
        .send({ selected: false })
        .expect(200),
    );

    expect(selected.summary.selectedCount).toBe(5);

    // push — a member may not
    const refused = await call(seeded, seeded.member, "post", `${BATCHES}/${batch.id}/push`).expect(
      403,
    );

    expect(bodyOf<ErrorEnvelope>(refused).code).toBe("forbidden");
    expect(github.issues).toHaveLength(filedBefore);

    // an admin may
    const pushed = bodyOf<PushResultResource>(
      await call(seeded, seeded.owner, "post", `${BATCHES}/${batch.id}/push`).expect(200),
    );

    expect(pushed.report).toMatchObject({ outcome: "pushed", pushedThisRun: 5 });
    expect(github.issues).toHaveLength(filedBefore + 5);

    // queue-small — the XS drafts (OTA-1, OTA-3, OTA-5) through M.3
    expect(pushed.queueSmall).toEqual({ queued: ["OTA-1", "OTA-3", "OTA-5"], skipped: [] });

    const { rows: queued } = await api.sql.query<{ issue_number: number }>(
      `select issue_number from ${SCHEMA_NAME}.queue_items
        where organization_id = $1 order by position`,
      [seeded.bench.id],
    );

    expect(queued.map((row) => row.issue_number).sort()).toEqual(
      pushed.report.drafts
        .filter((draft) => ["OTA-1", "OTA-3", "OTA-5"].includes(draft.localKey))
        .map((draft) => Number(draft.ticket?.externalId))
        .sort(),
    );

    // push status
    const status = bodyOf<PushStatusResource>(
      await call(seeded, seeded.member, "get", `${BATCHES}/${batch.id}/push-status`).expect(200),
    );

    expect(status.status).toBe("pushed");
    expect(status.drafts.filter((draft) => draft.pushState === "pushed")).toHaveLength(5);

    // milestones — passed through from the tracker the push just wrote to
    const milestones = bodyOf<MilestonesResource>(
      await call(
        seeded,
        seeded.member,
        "get",
        `/api/v1/planning/sources/${seeded.sourceId}/milestones`,
      ).expect(200),
    );

    expect(milestones).toMatchObject({ supported: true, milestones: [{ name: "Helios 2.1" }] });
  });

  it("reports small pushed tickets the sync has not mirrored yet rather than queueing them", async () => {
    const seeded = await world();

    engine.respond(() => estimateAnswer({ effort: "s" }));

    const batch = await generated(seeded, { queueSmall: true });
    const pushed = bodyOf<PushResultResource>(
      await call(seeded, seeded.owner, "post", `${BATCHES}/${batch.id}/push`).expect(200),
    );

    expect(pushed.queueSmall?.queued).toEqual([]);
    expect(pushed.queueSmall?.skipped.every((entry) => entry.reason === "not_yet_mirrored")).toBe(
      true,
    );
    expect(pushed.queueSmall?.skipped).toHaveLength(6);
  });

  it("refuses a cycle-introducing edit with a 422 naming the cycle", async () => {
    const seeded = await world();
    const batch = await generated(seeded);

    const refused = await call(
      seeded,
      seeded.member,
      "patch",
      `${BATCHES}/${batch.id}/drafts/OTA-3`,
    )
      .send({ dependencies: ["OTA-5"] })
      .expect(422);

    expect(bodyOf<ErrorEnvelope>(refused)).toEqual({
      code: PUSH_ERRORS.cycle,
      message:
        "This batch's dependencies form a cycle (OTA-3 → OTA-5 → OTA-3), so no ticket of it can go first.",
      details: { batchId: batch.id, cycle: ["OTA-3", "OTA-5", "OTA-3"] },
    });

    const unchanged = bodyOf<BatchResource>(
      await call(seeded, seeded.member, "get", `${BATCHES}/${batch.id}`).expect(200),
    );

    expect(unchanged.drafts[2].dependencies).toEqual(["OTA-1", "OTA-2"]);
  });

  it("regenerates with selections preserved by local key, and marks an edit as edited", async () => {
    const seeded = await world();
    const batch = await generated(seeded);

    await call(seeded, seeded.member, "patch", `${BATCHES}/${batch.id}/drafts/OTA-4`)
      .send({ selected: false })
      .expect(200);

    const edited = bodyOf<BatchResource>(
      await call(seeded, seeded.member, "patch", `${BATCHES}/${batch.id}/drafts/OTA-2`)
        .send({ title: "SHA-256 verification before the swap" })
        .expect(200),
    );

    expect(edited.drafts[1]).toMatchObject({ provenance: "edited" });

    const regenerated = bodyOf<GeneratedBatchResource>(
      await call(seeded, seeded.member, "post", `${BATCHES}/${batch.id}/regenerate`).expect(200),
    );

    expect(engine.plans).toHaveLength(2);
    expect(regenerated.drafts.find((draft) => draft.localKey === "OTA-4")?.selected).toBe(false);
    expect(regenerated.drafts.find((draft) => draft.localKey === "OTA-2")).toMatchObject({
      selected: true,
      provenance: "planned",
    });
    expect(regenerated.drafts[2].dependencies).toEqual(["OTA-1", "OTA-2"]);
  });

  it("leaves pushed drafts untouched when a partially pushed batch is regenerated", async () => {
    const seeded = await world();
    const batch = await generated(seeded);

    // Push only OTA-1 and OTA-2, then put the batch back in review — the state a push leaves when
    // somebody re-plans the remainder.
    for (const key of ["OTA-3", "OTA-4", "OTA-5", "OTA-6"]) {
      await call(seeded, seeded.member, "patch", `${BATCHES}/${batch.id}/drafts/${key}`)
        .send({ selected: false })
        .expect(200);
    }

    const pushed = bodyOf<PushResultResource>(
      await call(seeded, seeded.owner, "post", `${BATCHES}/${batch.id}/push`).expect(200),
    );

    expect(pushed.report.pushedThisRun).toBe(2);
    // Every selected draft was pushed, so the batch reads `pushed`; put it back to the state a push
    // that stopped short leaves — `pushing`, with nothing in flight — which is what re-planning the
    // remainder starts from.
    await api.sql.query(
      `update ${SCHEMA_NAME}.draft_batches set status = 'pushing' where id = $1`,
      [batch.id],
    );

    engine.respondToPlan(() =>
      planAnswer({
        drafts: planGoldenCase().response.drafts.map((draft) => ({
          ...draft,
          title: `${draft.title} (re-planned)`,
        })),
      }),
    );

    const regenerated = bodyOf<GeneratedBatchResource>(
      await call(seeded, seeded.member, "post", `${BATCHES}/${batch.id}/regenerate`).expect(200),
    );
    const byKey = new Map(regenerated.drafts.map((draft) => [draft.localKey, draft]));

    expect(byKey.get("OTA-1")).toMatchObject({ pushState: "pushed", id: batch.drafts[0].id });
    expect(byKey.get("OTA-1")?.title).not.toContain("re-planned");
    expect(byKey.get("OTA-3")).toMatchObject({ pushState: "pending", selected: false });
    expect(byKey.get("OTA-3")?.title).toContain("re-planned");
    // OTA-3 still waits on OTA-1 and OTA-2, now through the tickets they became.
    expect(byKey.get("OTA-3")?.dependencies).toEqual(["OTA-1", "OTA-2"]);
    expect(regenerated.drafts).toHaveLength(6);
  });

  it("round-trips epic CRUD — ranges, tint, status and order — with computed chips", async () => {
    const seeded = await world();

    const refused = await call(seeded, seeded.member, "post", EPICS)
      .send({ name: "Nope" })
      .expect(403);

    expect(bodyOf<ErrorEnvelope>(refused).code).toBe("forbidden");

    const ota = bodyOf<EpicResource>(
      await call(seeded, seeded.owner, "post", EPICS)
        .send({
          name: "OTA hardening",
          tint: "accent",
          startMonth: "2026-07",
          endMonth: "2026-09",
          roadmapName: "Helios 2.1",
          roadmapWindow: "Q3–Q4 2026",
        })
        .expect(201),
    );
    const zephyr = bodyOf<EpicResource>(
      await call(seeded, seeded.owner, "post", EPICS)
        .send({ name: "Zephyr 4.2 migration", status: "unscoped" })
        .expect(201),
    );

    expect(ota).toMatchObject({ startMonth: "2026-07", endMonth: "2026-09", sortOrder: 1 });
    expect(zephyr).toMatchObject({ startMonth: null, sortOrder: 2, tint: "neutral" });

    await call(seeded, seeded.owner, "patch", `${EPICS}/${ota.id}`)
      .send({ endMonth: null })
      .expect(422);

    const moved = bodyOf<EpicResource>(
      await call(seeded, seeded.owner, "patch", `${EPICS}/${ota.id}`)
        .send({ status: "proposed", endMonth: "2026-10" })
        .expect(200),
    );

    expect(moved).toMatchObject({ status: "proposed", startMonth: "2026-07", endMonth: "2026-10" });

    const reordered = bodyOf<EpicResource[]>(
      await call(seeded, seeded.owner, "put", `${EPICS}/order`)
        .send({ epicIds: [zephyr.id, ota.id] })
        .expect(200),
    );

    expect(reordered.map((lane) => lane.name)).toEqual(["Zephyr 4.2 migration", "OTA hardening"]);

    const tickets = await insertTickets(seeded, ["open", "closed", "closed"]);
    const linked = bodyOf<EpicResource>(
      await call(seeded, seeded.owner, "post", `${EPICS}/${ota.id}/tickets`)
        .send({ ticketIds: tickets })
        .expect(200),
    );

    expect(linked.chips).toEqual({ issues: 3, done: 2 });

    // Computed, not stored: closing the open ticket underneath moves the chip.
    await api.sql.query(`update ${SCHEMA_NAME}.tickets set state = 'closed' where id = $1`, [
      tickets[0],
    ]);

    const roadmap = bodyOf<RoadmapResource>(
      await call(seeded, seeded.member, "get", ROADMAP).expect(200),
    );

    expect(roadmap).toMatchObject({ name: "Helios 2.1", window: "Q3–Q4 2026" });
    expect(roadmap.lanes.find((lane) => lane.id === ota.id)?.chips).toEqual({ issues: 3, done: 3 });

    const unlinked = bodyOf<EpicResource>(
      await call(seeded, seeded.owner, "delete", `${EPICS}/${ota.id}/tickets`)
        .send({ ticketIds: [tickets[0]] })
        .expect(200),
    );

    expect(unlinked.chips).toEqual({ issues: 2, done: 2 });

    await call(seeded, seeded.owner, "delete", `${EPICS}/${zephyr.id}`).expect(204);
    await call(seeded, seeded.member, "get", `${EPICS}/${zephyr.id}`).expect(404);
  });

  it("holds every route to the workspace asking", async () => {
    const seeded = await world();
    const batch = await generated(seeded);
    const epic = bodyOf<EpicResource>(
      await call(seeded, seeded.owner, "post", EPICS).send({ name: "Ours" }).expect(201),
    );
    const filedBefore = github.issues.length;
    const stranger = await api.signIn();
    const theirs = await api.workspace(stranger);
    const as = (method: "get" | "post" | "put" | "patch" | "delete", path: string) =>
      api.as(stranger)(method, path).set(TENANT_HEADER, theirs.slug);

    const refusals = [
      await as("get", `${BATCHES}/${batch.id}`),
      await as("post", `${BATCHES}/${batch.id}/regenerate`),
      await as("patch", `${BATCHES}/${batch.id}/drafts/OTA-1`).send({ selected: false }),
      await as("post", `${BATCHES}/${batch.id}/push`),
      await as("post", `${BATCHES}/${batch.id}/push/resume`),
      await as("get", `${BATCHES}/${batch.id}/push-status`),
      await as("get", `${EPICS}/${epic.id}`),
      await as("patch", `${EPICS}/${epic.id}`).send({ name: "Stolen" }),
      await as("delete", `${EPICS}/${epic.id}`),
      await as("post", `${EPICS}/${epic.id}/tickets`).send({ ticketIds: [epic.id] }),
      await as("get", `/api/v1/planning/sources/${seeded.sourceId}/milestones`),
      await as("post", BATCHES).send({ prompt: "Steal", targetSourceId: seeded.sourceId }),
    ];

    expect(refusals.map((response) => response.status)).toEqual(
      Array<number>(refusals.length).fill(404),
    );
    expect(bodyOf<ErrorEnvelope>(refusals[10]).code).toBe(PLANNING_ERRORS.sourceNotFound);

    const lanes = bodyOf<EpicResource[]>(await as("get", EPICS).expect(200));

    expect(lanes).toEqual([]);
    expect(github.issues).toHaveLength(filedBefore);
  });

  /**
   * Mirror GitHub issues the way the backlog sync would, with an estimate in force.
   *
   * @param seeded - The world.
   * @param numbers - The issue numbers.
   * @param sizingStatus - Their sizing status.
   */
  async function mirror(
    seeded: World,
    numbers: readonly number[],
    sizingStatus: string,
  ): Promise<void> {
    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, $2, true) returning id`,
      [seeded.bench.id, SOURCE_LOGIN],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled) values ($1, $2, true) returning id`,
      [orgs[0].id, SOURCE_REPO],
    );

    for (const number of numbers) {
      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.github_issues
                (organization_id, github_repo_id, number, title, body, state, labels,
                 gh_created_at, gh_updated_at, gh_url, sizing_status)
         values ($1, $2, $3::int, 'Pushed ticket', null, 'open', '[]'::jsonb, now(), now(),
                 'https://github.com/acme-robotics/helios-firmware/issues/' || $3::int::text, $4)
         returning id`,
        [seeded.bench.id, repos[0].id, number, sizingStatus],
      );

      await api.sql.query(
        `insert into ${SCHEMA_NAME}.issue_estimates
                (github_issue_id, version, effort, confidence, suggested_workflow, routed_model,
                 breakdown, risk, risk_note, trace)
         values ($1, 1, 'xs', 90, 'feature-loop', 'claude-fable-5',
                 '{"files":[],"est_tokens":1000,"cycle_min":5,"cycle_max":10,"est_minutes":20}'::jsonb,
                 'low', 'Small.',
                 '{"estimator":"heuristic-v0","sized_at":"2026-09-16T15:00:00.000Z","tokens_used":0,"signals":[]}'::jsonb)`,
        [rows[0].id],
      );
    }
  }

  /**
   * Canonical tickets in the world's source.
   *
   * @param seeded - The world.
   * @param states - One state per ticket.
   * @returns Their ids.
   */
  async function insertTickets(seeded: World, states: readonly string[]): Promise<string[]> {
    const ids: string[] = [];

    for (const [index, state] of states.entries()) {
      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.tickets
           (organization_id, source_id, external_id, external_key, external_url, title, state,
            source_created_at, source_updated_at)
         values ($1, $2, $3, '#' || $3, 'https://github.com/acme-robotics/helios-firmware/issues/' || $3,
                 'Linked ticket', $4, now(), now())
         returning id`,
        [seeded.bench.id, seeded.sourceId, String(900 + index), state],
      );

      ids.push(rows[0].id);
    }

    return ids;
  }
});

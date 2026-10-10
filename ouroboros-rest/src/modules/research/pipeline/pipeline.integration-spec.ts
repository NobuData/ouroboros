/* eslint-disable @typescript-eslint/require-await -- fakes answer at once; async keeps the real signatures */

import request from "supertest";

import { ApiHarness } from "../../../testing/harness.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { EngineClient } from "../../engine/engine.client";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import type { EngineSkillRunRequest } from "../../engine/engine.skills";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import { BatchesService } from "../../planning/batches.service";
import {
  callAs,
  planningWorkspace,
  type PlanningWorkspace,
} from "../../planning/planning.integration.fixture";
import type { BatchResource } from "../../planning/planning.resources";
import { PushRepository } from "../../planning/push.repository";
import { PushService } from "../../planning/push.service";
import { ResolutionService } from "../../routing/resolution.service";
import { GithubTicketSourceProvider } from "../../ticket-sources/providers/github.provider";
import { recordingFactory } from "../../ticket-sources/providers/github.provider.fixture";
import {
  writeRecording,
  type WriteRecording,
} from "../../ticket-sources/providers/github.write-recordings.fixture";
import { TicketSourceRegistry } from "../../ticket-sources/ticket-source.registry";
import { TicketSourcesService } from "../../ticket-sources/ticket-sources.service";
import {
  FakeRepo,
  issuesRun,
  roadmapRun,
  rs124Roadmap,
  rs124RoadmapWithGustInMvp,
} from "./pipeline.fixture";
import { ProviderRepoGateway } from "./pipeline.repo";
import type {
  DraftEpicResource,
  DriftResource,
  IssuesResource,
  RoadmapResource,
  SuggestionResource,
} from "./pipeline.resources";
import { CREATE_ROADMAP_BODY } from "./pipeline.skills";
import { RoadmapScheduler } from "./roadmap.scheduler";

/**
 * The gaps hand-off and the roadmap pipeline on PostgreSQL (CM.5, #624): the routes, the real
 * services and V113/V125's rules, with four things stood in — the engine's skill run, the
 * `research` route, the repository host and the tracker a push writes to.
 */

const START = {
  loopVersion: "loop-v1",
  alias: "researcher-long-ctx",
  resolutionRef: "r1",
  task: "investigate:fixture",
};
const ITEM_KEYS = [
  "dock-mpc",
  "dock-retry",
  "dock-gust",
  "fleet-battery",
  "fleet-gaps",
  "fleet-playbook",
];

describe("the gaps hand-off and the roadmap pipeline, on the database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({
      OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
      OURO_RESEARCH_ROADMAP_TICK_MS: "0",
    });
  });

  afterAll(() => api.close());
  afterEach(async () => {
    jest.restoreAllMocks();
    await api.truncate();
  });

  /** One of the loop's writes, made the way the engine makes it. */
  function loopWrite(investigation: string, route: string, body: object) {
    return request(api.baseUrl)
      .post(`/internal/research/investigations/${investigation}/${route}`)
      .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
      .send(body);
  }

  /** An investigation of a kind, with `sources` records archived and its brief delivered. */
  async function investigated(
    workspace: PlanningWorkspace,
    kind: string,
    deliverables: (ledger: string[]) => object,
  ): Promise<{ id: string; ledger: string[] }> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.investigations (organization_id, kind_id, question, depth, tools_enabled)
       select $1, k.id, 'What should Helios ship next quarter?', 'quick', '["web"]'
         from ${SCHEMA_NAME}.investigation_kinds k
        where k.organization_id = $1 and k.slug = $2
       returning id`,
      [workspace.bench.id, kind],
    );
    const id = rows[0].id;
    const ledger: string[] = [];

    for (let n = 1; n <= 4; n += 1) {
      const archived = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.source_records
           (investigation_id, tool_slug, kind, title, locator, retrieved_at, content_hash, excerpt)
         values ($1, 'web', 'web', $2, $3, '2026-10-07T12:00:00Z'::timestamptz + make_interval(mins => $4),
                 'sha256:' || repeat($5, 64), $6)
         returning id`,
        [
          id,
          `Source ${String(n)}`,
          `https://example.com/${String(n)}`,
          n,
          n.toString(16),
          `What source ${String(n)} said.`,
        ],
      );

      ledger.push(archived.rows[0].id);
    }

    await loopWrite(id, "start", START).expect(200);
    await loopWrite(id, "brief", {
      attempt: 1,
      durationMs: 61_000,
      usage: [],
      body: { paragraphs: [{ spans: [{ text: "Docking aborts in gusts.", claim: "c1" }] }] },
      claims: [
        {
          ref: "c1",
          type: "finding",
          text: "Docking aborts in gusts.",
          sources: [ledger[0]],
          demoted: false,
        },
      ],
      deliverables: deliverables(ledger),
    }).expect(200);

    return { id, ledger };
  }

  /** A gap analysis whose matrix proposes the Docking parity epic and two stubs. */
  function gapAnalysis(workspace: PlanningWorkspace) {
    return investigated(workspace, "gap_analysis", (ledger) => ({
      matrix: {
        title: "Docking vs. the field",
        us: "Helios",
        rivals: ["Skylink"],
        rows: [
          {
            capability: "Docking in gusts",
            gap: "high",
            cells: [
              { subject: "Helios", status: "partial", sources: [ledger[0]] },
              { subject: "Skylink", status: "shipping", sources: [ledger[2]] },
            ],
          },
          {
            capability: "Abort and retry",
            gap: "med",
            cells: [
              { subject: "Helios", status: "none", sources: [ledger[1]] },
              { subject: "Skylink", status: "partial", sources: [ledger[3]] },
            ],
          },
        ],
        epic: "Docking parity",
        tickets: [
          {
            key: "DOCK-1",
            title: "wind-feedforward MPC",
            effort: "m",
            capability: "Docking in gusts",
            sources: [ledger[2], ledger[0]],
          },
          { key: "DOCK-2", title: "re-planned retry", effort: "s", capability: "Abort and retry" },
        ],
      },
    }));
  }

  /** The pipeline's stand-ins over the running application. */
  async function pipeline() {
    const workspace = await planningWorkspace(api);
    const investigation = await investigated(workspace, "roadmap_improvements", () => ({
      roadmap_doc: { title: "Q4", themes: [], milestones: [] },
    }));
    const repo = new FakeRepo();
    const github: WriteRecording = writeRecording();
    const provider = new GithubTicketSourceProvider(
      recordingFactory(github.octokit).factory,
      new GithubRateLimiter(),
    );
    const pusher = new PushService(
      api.nest.get(PushRepository),
      new TicketSourceRegistry([provider]),
      api.nest.get(TicketSourcesService),
    );
    const runs: EngineSkillRunRequest[] = [];
    const answers = [
      roadmapRun(rs124Roadmap()),
      roadmapRun(rs124RoadmapWithGustInMvp()),
      issuesRun(ITEM_KEYS),
    ];

    jest.spyOn(api.nest.get(EngineClient), "runSkill").mockImplementation(async (run) => {
      runs.push(run);

      const data = answers.shift();

      if (data === undefined) throw new Error("no scripted skill answer");

      return { ok: true, data };
    });
    jest.spyOn(api.nest.get(ResolutionService), "resolve").mockResolvedValue({
      outcome: "resolved",
      resolutionVersion: "r1",
      chain: [{ alias: "researcher-long-ctx", decision: "kept" }],
    } as never);
    jest
      .spyOn(api.nest.get(ProviderRepoGateway), "open")
      .mockImplementation((source, work) => repo.open(source, work));
    jest
      .spyOn(api.nest.get(BatchesService), "push")
      .mockImplementation(async (organizationId, batchId) => ({
        report: await pusher.push(organizationId, batchId),
        queueSmall: null,
      }));

    const base = `/api/v1/research/investigations/${investigation.id}`;
    const { owner, admin, member, viewer } = workspace.people;
    const as = (person: typeof owner, method: "get" | "post" | "put", path: string) =>
      callAs(api, workspace.bench.slug, person, method, path);

    return {
      workspace,
      investigation,
      repo,
      github,
      runs,
      answers,
      base,
      owner,
      admin,
      member,
      viewer,
      as,
    };
  }

  async function one<T>(query: string, values: unknown[]): Promise<T> {
    const { rows } = await api.sql.query<T & object>(query, values);

    return rows[0];
  }

  it("drafts an epic and one ticket per gap, with provenance, and files nothing", async () => {
    const workspace = await planningWorkspace(api);
    const { id, ledger } = await gapAnalysis(workspace);
    const path = `/api/v1/research/investigations/${id}/draft-epic`;
    const { member, viewer } = workspace.people;

    await callAs(api, workspace.bench.slug, viewer, "post", path).send({}).expect(403);

    const drafted = (
      await callAs(api, workspace.bench.slug, member, "post", path).send({}).expect(200)
    ).body as DraftEpicResource;

    expect(drafted).toMatchObject({ created: true, epic: { name: "Docking parity" } });
    expect(drafted.href).toBe(`/planning?batch=${drafted.batch.id}`);
    expect(
      drafted.batch.drafts.map((draft) => [
        draft.localKey,
        draft.capability,
        draft.severity,
        draft.effort,
        draft.sources,
      ]),
    ).toEqual([
      ["DOCK-1", "Docking in gusts", "high", "m", 2],
      ["DOCK-2", "Abort and retry", "med", "s", 0],
    ]);

    // Stored: a proposed epic, a batch under it, and V125's provenance on each draft.
    expect(
      await one(
        `select e.status, e.name, b.planner, b.status as batch_status, b.created_by
           from ${SCHEMA_NAME}.draft_batches b join ${SCHEMA_NAME}.planning_epics e on e.id = b.epic_id
          where b.id = $1`,
        [drafted.batch.id],
      ),
    ).toEqual({
      status: "proposed",
      name: "Docking parity",
      planner: "research-gaps-v1",
      batch_status: "drafting",
      created_by: member.id,
    });
    expect(
      await one(
        `select research_provenance, body from ${SCHEMA_NAME}.ticket_drafts where batch_id = $1 and local_key = 'DOCK-1'`,
        [drafted.batch.id],
      ),
    ).toEqual({
      research_provenance: {
        investigation_id: id,
        origin: "gap",
        capability: "Docking in gusts",
        severity: "high",
        item_key: null,
        effort: "m",
        sources: [ledger[2], ledger[0]],
      },
      body: expect.stringContaining(
        "Closes the **Docking in gusts** gap (HIGH) found by RS-",
      ) as string,
    });

    // Planning renders it: the batch route answers the same drafts, provenance included.
    const batch = (
      await callAs(
        api,
        workspace.bench.slug,
        member,
        "get",
        `/api/v1/planning/batches/${drafted.batch.id}`,
      ).expect(200)
    ).body as BatchResource;

    expect(batch.epicId).toBe(drafted.epic.id);
    expect(batch.drafts[0]?.research).toMatchObject({
      origin: "gap",
      capability: "Docking in gusts",
      sources: [ledger[2], ledger[0]],
    });
    expect(batch.drafts[0]?.body).toContain("**Sources**");

    // Nothing is filed.
    expect(
      await one(
        `select count(*)::int as n from ${SCHEMA_NAME}.tickets where organization_id = $1`,
        [workspace.bench.id],
      ),
    ).toEqual({ n: 0 });

    // Asking again answers the same batch.
    const again = (
      await callAs(api, workspace.bench.slug, member, "post", path).send({}).expect(200)
    ).body as DraftEpicResource;

    expect(again).toMatchObject({
      created: false,
      batch: { id: drafted.batch.id },
      epic: drafted.epic,
    });
    expect(
      await one(
        `select count(*)::int as n from ${SCHEMA_NAME}.draft_batches where organization_id = $1`,
        [workspace.bench.id],
      ),
    ).toEqual({ n: 1 });
  });

  it("refuses to draft from a brief that proposes nothing, and hides another workspace's investigation", async () => {
    const world = await pipeline();
    const elsewhere = await planningWorkspace(api);
    const path = `${world.base}/draft-epic`;

    expect((await world.as(world.member, "post", path).send({}).expect(422)).body).toMatchObject({
      code: "gaps_nothing_proposed",
    });
    expect(
      (
        await callAs(api, elsewhere.bench.slug, elsewhere.people.owner, "post", path)
          .send({})
          .expect(404)
      ).body,
    ).toMatchObject({ code: "investigation_not_found" });
    expect(
      (
        await callAs(
          api,
          elsewhere.bench.slug,
          elsewhere.people.owner,
          "get",
          `${world.base}/roadmap`,
        ).expect(404)
      ).body,
    ).toMatchObject({ code: "investigation_not_found" });
  });

  it("runs brief → v1 → PR → apply → v2 → six issues under two milestones → writeback v3 ≡ tracker", async () => {
    const world = await pipeline();
    const { base, admin, member, as } = world;

    // Before anything: no roadmap, and only an admin may generate one.
    await as(member, "get", `${base}/roadmap`).expect(404);
    await as(member, "post", `${base}/roadmap`).send({}).expect(403);

    // 1 · create-roadmap → v1 → a pull request.
    const v1 = (await as(admin, "post", `${base}/roadmap`).send({}).expect(201))
      .body as RoadmapResource;

    expect(v1.doc).toMatchObject({
      version: 1,
      generatedBy: "create-roadmap@v1",
      targetSourceId: world.workspace.sourceId,
    });
    expect(v1.projection).toMatchObject({
      state: "pr_open",
      prRef: "#88",
      path: "docs/ROADMAP.md",
    });
    expect(world.runs[0]?.skill).toEqual({
      slug: "create-roadmap",
      version: 1,
      body: CREATE_ROADMAP_BODY,
    });
    expect(world.runs[0]?.alias).toBe("researcher-long-ctx");
    expect(String(world.runs[0]?.input.brief)).toContain("Docking aborts in gusts.");
    expect(world.runs[0]?.input.outline).toEqual({ title: "Q4", themes: [], milestones: [] });

    // The skill was shipped to the workspace's registry: generated, published by nobody.
    expect(
      await one(
        `select s.origin, s.scope, s.current_version, v.published_by, v.change_note
           from ${SCHEMA_NAME}.skills s join ${SCHEMA_NAME}.skill_versions v on v.skill_id = s.id and v.version = 1
          where s.organization_id = $1 and s.slug = 'create-roadmap'`,
        [world.workspace.bench.id],
      ),
    ).toEqual({
      origin: "generated",
      scope: "org",
      current_version: 1,
      published_by: null,
      change_note: "Shipped procedure",
    });

    await as(admin, "post", `${base}/roadmap`).send({}).expect(409);

    // 2 · a person's suggestion, applied by a re-run → v2.
    const suggestion = (
      await as(member, "post", `${base}/roadmap/suggestions`)
        .send({
          text: "Pull the gust estimator into the M1 MVP set.",
          hint: { item: "dock-gust", change: "mvp", to: true },
        })
        .expect(201)
    ).body as SuggestionResource;

    expect(suggestion).toMatchObject({ authorKind: "user", status: "open" });
    await as(member, "post", `${base}/roadmap/suggestions/${suggestion.id}/apply`).expect(403);

    const v2 = (
      await as(admin, "post", `${base}/roadmap/suggestions/${suggestion.id}/apply`).expect(200)
    ).body as RoadmapResource;

    expect(v2.doc).toMatchObject({
      version: 2,
      generatedBy: `create-roadmap@v1 · suggestion ${suggestion.id}`,
    });
    expect(v2.milestones[0]?.items[2]).toMatchObject({ key: "dock-gust", mvp: true });
    expect(v2.suggestions.items[0]).toMatchObject({ status: "applied", appliedVersion: 2 });
    expect(world.runs[1]?.input.suggestions).toEqual([
      {
        from: "a person",
        text: "Pull the gust estimator into the M1 MVP set.",
        hint: { item: "dock-gust", change: "mvp", to: true },
      },
    ]);
    expect((world.runs[1]?.input.previous as { milestones: unknown[] }).milestones).toHaveLength(2);
    // v1 is as it was written: a re-run, not a patch.
    expect(
      await one(
        `select (structure #>> '{milestones,0,items,2,mvp}') as mvp, generated_by
           from ${SCHEMA_NAME}.roadmap_doc_versions where doc_id = $1 and version = 1`,
        [v1.doc.id],
      ),
    ).toEqual({ mvp: "false", generated_by: "create-roadmap@v1" });
    await as(admin, "post", `${base}/roadmap/suggestions/${suggestion.id}/apply`).expect(409);

    // 3 · create-issues: drafted and handed to the one sizer; nothing pushed while it works.
    const sizing = (await as(admin, "post", `${base}/roadmap/issues`).send({}).expect(200))
      .body as IssuesResource;

    expect(sizing).toMatchObject({ stage: "sizing", unsized: 6, wroteVersion: false });
    expect(world.github.issues).toHaveLength(0);
    expect(
      await one(`select planner, source_prompt from ${SCHEMA_NAME}.draft_batches where id = $1`, [
        sizing.batchId,
      ]),
    ).toEqual({
      planner: "create-roadmap-v1",
      source_prompt: expect.stringMatching(
        /^RS-\d+ brief → ROADMAP\.md → create-issues: 2 milestones, 6 issues\.$/,
      ) as string,
    });

    // The estimator answers (its engine is not here, so its rows are written as it writes them).
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.issue_estimates
         (draft_id, version, effort, confidence, suggested_workflow, routed_model, breakdown, risk, risk_note, trace)
       select d.id, 1, 'm', 70, 'feature-loop', 'claude-fable-5',
              '{"files": [], "est_tokens": 1200000, "cycle_min": 1620, "cycle_max": 2700, "est_minutes": 2160}'::jsonb,
              'medium', 'Sized for the suite.',
              '{"estimator": "heuristic-v0", "sized_at": "2026-10-08T00:00:00Z", "tokens_used": 0, "signals": []}'::jsonb
         from ${SCHEMA_NAME}.ticket_drafts d where d.batch_id = $1`,
      [sizing.batchId],
    );

    const filed = (await as(admin, "post", `${base}/roadmap/issues`).send({}).expect(200))
      .body as IssuesResource;

    expect(filed).toMatchObject({ stage: "filed", wroteVersion: true, unsized: 0, undrafted: [] });
    expect(filed.roadmap.doc).toMatchObject({
      version: 3,
      generatedBy: "create-issues@v1 · writeback",
    });
    expect(filed.roadmap.issues).toMatchObject({
      filed: 6,
      total: 6,
      label: "6 issues · 2 milestones",
    });

    // Six issues, under two milestones with their due dates, MVP as a label.
    expect(world.github.issues).toHaveLength(6);
    expect(world.github.milestones).toEqual([
      { number: 1, title: "Docking parity", dueOn: "2026-10-15T08:00:00Z" },
      { number: 2, title: "Fleet reliability", dueOn: "2026-11-20T08:00:00Z" },
    ]);
    expect(world.github.issues.map((issue) => [issue.milestone, [...issue.labels]])).toEqual([
      [1, ["mvp"]],
      [1, ["mvp"]],
      [1, ["mvp"]],
      [2, []],
      [2, []],
      [2, []],
    ]);

    // Estimator fields on every filed issue — the sizer's, read through.
    for (const item of filed.roadmap.milestones.flatMap((milestone) => milestone.items)) {
      expect(item.ticket?.key).toMatch(/^#\d+$/);
      expect(item.estimate).toEqual({
        effort: "m",
        complexity: "medium",
        estMinutes: 2160,
        loopDays: 1.5,
      });
    }
    expect(filed.roadmap.milestones.map((milestone) => milestone.dueLabel)).toEqual([
      "due Oct 15",
      "due Nov 20",
    ]);
    expect(
      await one(`select status from ${SCHEMA_NAME}.investigations where id = $1`, [
        world.investigation.id,
      ]),
    ).toEqual({ status: "issues_filed" });
    expect(
      await one(
        `select count(*)::int as n from ${SCHEMA_NAME}.tickets where organization_id = $1 and labels ? 'mvp'`,
        [world.workspace.bench.id],
      ),
    ).toEqual({ n: 3 });

    // The pull request now proposes v3; merged, the version is committed.
    expect(world.repo.prs).toHaveLength(1);
    expect(world.repo.prs[0]?.title).toMatch(/\(v3\)$/);
    world.repo.merge(88);

    // 4 · v3 ≡ tracker.
    const clean = (await as(member, "post", `${base}/roadmap/drift-check`).expect(200))
      .body as DriftResource;

    expect(clean).toMatchObject({ identical: true, differences: [], raised: null });
    expect(clean.roadmap.projection.state).toBe("committed");
    expect(world.repo.branches.get("main")?.get("docs/ROADMAP.md")?.content).toBe(
      filed.roadmap.markdown,
    );

    // 5 · idempotent: filing again files nothing and writes nothing.
    const again = (await as(admin, "post", `${base}/roadmap/issues`).send({}).expect(200))
      .body as IssuesResource;

    expect(again).toMatchObject({ stage: "filed", wroteVersion: false });
    expect(world.github.issues).toHaveLength(6);
    expect(
      await one(
        `select count(*)::int as n from ${SCHEMA_NAME}.roadmap_doc_versions where doc_id = $1`,
        [v1.doc.id],
      ),
    ).toEqual({ n: 3 });
    expect(
      await one(
        `select count(*)::int as n from ${SCHEMA_NAME}.draft_batches where organization_id = $1`,
        [world.workspace.bench.id],
      ),
    ).toEqual({ n: 1 });

    // 6 · drift injected on the tracker side: one suggestion, nothing rewritten.
    await api.sql.query(
      `update ${SCHEMA_NAME}.tickets set state = 'closed' where organization_id = $1 and external_key = '#3'`,
      [world.workspace.bench.id],
    );

    const before = await one<{ structure: unknown; markdown: string }>(
      `select structure, markdown from ${SCHEMA_NAME}.roadmap_doc_versions where doc_id = $1 and version = 3`,
      [v1.doc.id],
    );
    const drifted = (await as(member, "post", `${base}/roadmap/drift-check`).expect(200))
      .body as DriftResource;
    const repeated = (await as(member, "post", `${base}/roadmap/drift-check`).expect(200))
      .body as DriftResource;

    expect(drifted.identical).toBe(false);
    expect(drifted.differences).toEqual([
      { field: "state", itemKey: "dock-gust", ticketKey: "#3", document: "open", tracker: "done" },
    ]);
    expect(drifted.raised).toMatchObject({
      authorKind: "ai",
      authorName: "drift-detector",
      status: "open",
    });
    expect(drifted.roadmap.projection.state).toBe("drift_detected");
    expect(repeated.raised).toBeNull();
    expect(
      await one(
        `select count(*)::int as n from ${SCHEMA_NAME}.doc_suggestions where doc_id = $1 and author_agent = 'drift-detector'`,
        [v1.doc.id],
      ),
    ).toEqual({ n: 1 });
    expect(
      await one(
        `select structure, markdown from ${SCHEMA_NAME}.roadmap_doc_versions where doc_id = $1 and version = 3`,
        [v1.doc.id],
      ),
    ).toEqual(before);
    expect(
      await one(`select current_version from ${SCHEMA_NAME}.roadmap_docs where id = $1`, [
        v1.doc.id,
      ]),
    ).toEqual({ current_version: 3 });
    expect(world.repo.branches.get("main")?.get("docs/ROADMAP.md")?.content).toBe(
      filed.roadmap.markdown,
    );
  });

  it("keeps the document when the repository cannot be reached, and projects it on the next check", async () => {
    const world = await pipeline();
    const { base, admin, as } = world;

    world.repo.supported = false;

    const pending = (
      await as(admin, "post", `${base}/roadmap`).send({ path: "ROADMAP.md" }).expect(201)
    ).body as RoadmapResource;

    expect(pending.projection).toMatchObject({ state: "pending", path: "ROADMAP.md" });
    expect(pending.projection.problem).toContain("has no repository");

    world.repo.supported = true;

    const checked = (await as(admin, "post", `${base}/roadmap/drift-check`).expect(200))
      .body as DriftResource;

    expect(checked.roadmap.projection).toMatchObject({
      state: "pr_open",
      prRef: "#88",
      problem: null,
    });
    expect(
      world.repo.branches.get("ouroboros/roadmap-" + pending.doc.id.slice(0, 8))?.has("ROADMAP.md"),
    ).toBe(true);
  });

  it("commits directly only after the opt-in, which is audited — and audits a dismissal", async () => {
    const world = await pipeline();
    const { base, admin, member, viewer, as } = world;
    const settings = "/api/v1/research/roadmap-settings";

    expect((await as(viewer, "get", settings).expect(200)).body).toEqual({ directCommit: false });
    await as(member, "put", settings).send({ directCommit: true }).expect(403);
    await as(admin, "put", settings).send({}).expect(422);
    expect(
      (await as(admin, "put", settings).send({ directCommit: true }).expect(200)).body,
    ).toEqual({ directCommit: true });
    await as(admin, "put", settings).send({ directCommit: true }).expect(200);

    const v1 = (await as(admin, "post", `${base}/roadmap`).send({}).expect(201))
      .body as RoadmapResource;

    expect(v1.projection.state).toBe("committed");
    expect(v1.projection.committedSha).toMatch(/^[0-9a-f]{40}$/);
    expect(world.repo.prs).toEqual([]);
    expect(world.repo.branches.get("main")?.get("docs/ROADMAP.md")?.content).toBe(v1.markdown);

    const suggestion = (
      await as(member, "post", `${base}/roadmap/suggestions`)
        .send({ text: "Drop the playbook docs." })
        .expect(201)
    ).body as SuggestionResource;

    await as(member, "post", `${base}/roadmap/suggestions/${suggestion.id}/dismiss`).expect(403);

    const card = (
      await as(admin, "post", `${base}/roadmap/suggestions/${suggestion.id}/dismiss`).expect(200)
    ).body as RoadmapResource;

    expect(card.suggestions.items[0]).toMatchObject({ status: "dismissed", appliedVersion: null });
    expect(card.doc.version).toBe(1);
    await as(admin, "post", `${base}/roadmap/suggestions/${suggestion.id}/dismiss`).expect(409);
    await as(
      admin,
      "post",
      `${base}/roadmap/suggestions/5eed0097-0000-4000-8000-0000000000ff/dismiss`,
    ).expect(404);

    const { rows } = await api.sql.query<{
      action: string;
      subject_type: string;
      detail: Record<string, unknown>;
    }>(
      `select action, subject_type, detail from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action like 'roadmap.%' order by occurred_at`,
      [world.workspace.bench.id],
    );

    expect(rows).toEqual([
      {
        action: "roadmap.policy_updated",
        subject_type: "roadmap_pipeline_settings",
        detail: { previousDirectCommit: false, directCommit: true },
      },
      {
        action: "roadmap.suggestion_dismissed",
        subject_type: "roadmap_doc",
        detail: {
          suggestionId: suggestion.id,
          authorKind: "user",
          authorAgent: null,
          text: "Drop the playbook docs.",
          version: 1,
        },
      },
    ]);
  });

  it("runs a workspace's own published version of the skill, and refuses an unpublished copy", async () => {
    const world = await pipeline();
    const { base, admin, as } = world;
    const org = world.workspace.bench.id;

    // The workspace authored its own create-roadmap and never published it.
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.skills (organization_id, slug, name, description, scope, origin)
       values ($1, 'create-roadmap', 'create-roadmap', 'Ours', 'org', 'authored') returning id`,
      [org],
    );

    expect((await as(admin, "post", `${base}/roadmap`).send({}).expect(409)).body).toMatchObject({
      code: "roadmap_skill_unpublished",
    });
    expect(world.runs).toEqual([]);

    // Published, it is what runs.
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.skill_versions (skill_id, version, body, frontmatter, published_at)
       values ($1, 1, '# Our own procedure', '{"name": "create-roadmap", "description": "Ours"}', now())`,
      [rows[0].id],
    );
    await api.sql.query(`update ${SCHEMA_NAME}.skills set current_version = 1 where id = $1`, [
      rows[0].id,
    ]);

    const v1 = (await as(admin, "post", `${base}/roadmap`).send({}).expect(201))
      .body as RoadmapResource;

    expect(world.runs[0]?.skill).toEqual({
      slug: "create-roadmap",
      version: 1,
      body: "# Our own procedure",
    });
    expect(v1.doc.generatedBy).toBe("create-roadmap@v1");
    expect(
      await one(
        `select count(*)::int as n from ${SCHEMA_NAME}.skills where organization_id = $1 and slug = 'create-roadmap'`,
        [org],
      ),
    ).toEqual({ n: 1 });
  });

  it("stores nothing when the engine refuses the run", async () => {
    const world = await pipeline();

    jest.spyOn(api.nest.get(EngineClient), "runSkill").mockResolvedValue({
      ok: false,
      refusal: {
        code: "skill_model_failed",
        message: "The invocation gateway is not available.",
        reason: "gateway_unavailable",
      },
    });

    expect(
      (await world.as(world.admin, "post", `${world.base}/roadmap`).send({}).expect(502)).body,
    ).toMatchObject({
      code: "roadmap_skill_failed",
      details: { slug: "create-roadmap", reason: "gateway_unavailable" },
    });
    expect(
      await one(
        `select count(*)::int as n from ${SCHEMA_NAME}.roadmap_docs where organization_id = $1`,
        [world.workspace.bench.id],
      ),
    ).toEqual({ n: 0 });
  });

  it("checks every watched document on the scheduler's pass, and is wired off by a zero tick", async () => {
    const world = await pipeline();

    await world.as(world.admin, "post", `${world.base}/roadmap`).send({}).expect(201);

    const scheduler = api.nest.get(RoadmapScheduler);

    expect(await scheduler.tick()).toEqual({ checked: 1, drifted: 0, raised: 0 });
  });
});

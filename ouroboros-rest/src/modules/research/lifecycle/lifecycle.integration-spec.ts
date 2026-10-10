/**
 * An investigation's lifecycle on the real schema (V106, V108, V120, V123) — #625.
 *
 * What is proven here and nowhere else is the SQL and the wiring: the start writes a queued
 * investigation with its number and estimate and hands it to the engine; a refused start
 * leaves nothing queued; the list's counts and filters; the detail's ledger summary; the
 * progress stream reading what the loop's own writes left; cancel keeping the ledger; the
 * starter-role setting; and that another workspace sees none of it. The engine is the
 * stand-in, as in `investigation-loop.integration-spec.ts`: its client is stubbed to accept,
 * and the loop's writes are made over HTTP with the internal key.
 */

import request from "supertest";

import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { EngineClient } from "../../engine/engine.client";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import type {
  CancelledInvestigationResource,
  InvestigationDetailResource,
  InvestigationListResource,
  StartedInvestigationResource,
} from "./lifecycle.resources";
import { quarterOf } from "./quarter";

const BASE = "/api/v1/research/investigations";
const SETTINGS = "/api/v1/research/settings";

const COMPOSER = {
  question: "Why do rivals dock in wind and we do not?",
  kind: "gap_analysis",
  depth: "quick",
  tools: ["web", "code"],
};

const LOOP_START = {
  loopVersion: "loop-v1",
  alias: "researcher-long-ctx",
  resolutionRef: "r1",
  task: "investigate:fixture",
};

/** One parsed frame of an event stream. */
interface Frame {
  readonly event: string;
  readonly data: {
    kind: string;
    status?: string;
    sources?: number;
    spendCents?: number | null;
    iteration?: number | null;
    cancelRequested?: boolean;
  };
}

/** A workspace that can run research, and the people in it. */
interface Bench {
  readonly owner: Person;
  readonly workspace: Workspace;
}

describe("the investigation lifecycle, on the database", () => {
  let api: ApiHarness;
  let investigate: jest.SpiedFunction<EngineClient["investigate"]>;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  beforeEach(() => {
    investigate = jest.spyOn(api.nest.get(EngineClient), "investigate").mockResolvedValue({
      investigation: "fixture",
      task: "investigate:fixture",
      state: "accepted",
      loopVersion: "loop-v1",
    });
  });

  afterAll(() => api.close());
  afterEach(async () => {
    jest.restoreAllMocks();
    await api.truncate();
  });

  /** A workspace, optionally with the `research` task kind routed to one alias. */
  async function bench(options: { routed?: boolean } = {}): Promise<Bench> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    if (options.routed === false) return { owner, workspace };

    const client = await api.sql.connect();
    try {
      // The route and its chain go in together — V016's chain trigger is deferred.
      await client.query("begin");
      const connection = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.provider_connections
           (organization_id, kind, display_name, status, last_checked_at, health)
         values ($1, 'anthropic', 'Anthropic Claude', 'active', now(),
                 '{"check": "reachability", "latency_ms": 40}')
         returning id`,
        [workspace.id],
      );
      const alias = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.model_aliases
           (organization_id, alias, provider_connection_id, model_id, enabled)
         values ($1, 'researcher-long-ctx', $2, 'claude-sonnet-4-6', true) returning id`,
        [workspace.id, connection.rows[0].id],
      );
      const kind = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
         values ($1, 'research', 'Everything research needs', 10) returning id`,
        [workspace.id],
      );
      const route = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.routes (organization_id, task_kind_id, tag)
         values ($1, $2, 'research-primary') returning id`,
        [workspace.id, kind.rows[0].id],
      );
      await client.query(
        `insert into ${SCHEMA_NAME}.route_hops (organization_id, route_id, position, model_alias_id)
         values ($1, $2, 1, $3)`,
        [workspace.id, route.rows[0].id, alias.rows[0].id],
      );
      await client.query("commit");
    } catch (failure) {
      await client.query("rollback");
      throw failure;
    } finally {
      client.release();
    }

    return { owner, workspace };
  }

  /** Somebody else, holding a role in the bench's workspace. */
  async function colleague(space: Bench, role: "admin" | "member" | "viewer"): Promise<Person> {
    const person = await api.signIn();
    await api.join(space.workspace.id, person, role);
    return person;
  }

  /** A request as a person, in a workspace. */
  function call(
    person: Person,
    workspace: Workspace,
    method: "get" | "post" | "patch",
    path: string,
  ): request.Test {
    return api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  /** Start the composer's investigation, expecting `201`. */
  async function start(
    space: Bench,
    person: Person = space.owner,
    body: object = COMPOSER,
  ): Promise<StartedInvestigationResource> {
    return (await call(person, space.workspace, "post", BASE).send(body).expect(201))
      .body as StartedInvestigationResource;
  }

  /** The list, expecting `200`. */
  async function list(
    person: Person,
    workspace: Workspace,
    query: Record<string, string> = {},
  ): Promise<InvestigationListResource> {
    return (await call(person, workspace, "get", BASE).query(query).expect(200))
      .body as InvestigationListResource;
  }

  /** The detail, expecting `200`. */
  async function detail(
    person: Person,
    workspace: Workspace,
    id: string,
  ): Promise<InvestigationDetailResource> {
    return (await call(person, workspace, "get", `${BASE}/${id}`).expect(200))
      .body as InvestigationDetailResource;
  }

  /** The refusal code and details of a response. */
  function refusal(response: request.Response): { code: string; details: Record<string, unknown> } {
    return response.body as { code: string; details: Record<string, unknown> };
  }

  /** One of the loop's writes, made the way the engine makes it. */
  function loop(method: "post" | "put", investigation: string, route: string, body: object) {
    return request(api.baseUrl)
      [method](`/internal/research/investigations/${investigation}/${route}`)
      .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
      .send(body);
  }

  /** Archive one source into an investigation's ledger. */
  async function archive(investigationId: string, n: number, tool = "web"): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.source_records
         (investigation_id, tool_slug, kind, title, locator, retrieved_at, content_hash, excerpt)
       values ($1, $2, 'web', $3, $4, now(), 'sha256:' || repeat($5, 64), $6)
       returning id`,
      [
        investigationId,
        tool,
        `Source ${n.toString()}`,
        `https://example.com/${n.toString()}`,
        (n % 16).toString(16),
        `What source ${n.toString()} said.`,
      ],
    );
    return rows[0].id;
  }

  /** A checkpoint, as the loop saves one. */
  function checkpoint(seq: number, iteration: number, costCents: number | null) {
    return {
      attempt: 1,
      seq,
      checkpoint: { version: "loop-v1", phase: "iterate", iteration },
      durationMs: seq * 30_000,
      usage: [
        {
          seq,
          stage: "digest",
          alias: "researcher-long-ctx",
          hop: 0,
          connection: "conn-anthropic",
          model: "claude-sonnet-4-6",
          inputTokens: 20_000,
          outputTokens: 1_500,
          costCents,
        },
      ],
    };
  }

  /** A brief citing one source. */
  function brief(source: string) {
    return {
      attempt: 1,
      durationMs: 120_000,
      usage: [],
      body: { paragraphs: [{ spans: [{ text: "The gap is control.", claim: "c1" }] }] },
      claims: [
        {
          ref: "c1",
          type: "finding",
          text: "The gap is control.",
          sources: [source],
          demoted: false,
        },
      ],
      deliverables: {},
    };
  }

  /** Open a progress stream; resolves with its frames when the server closes it. */
  function watch(person: Person, workspace: Workspace, id: string): Promise<Frame[]> {
    return call(person, workspace, "get", `${BASE}/${id}/progress`)
      .buffer(true)
      .parse((response, done) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (text += chunk));
        response.on("end", () => {
          done(null, text);
        });
      })
      .expect(200)
      .expect("content-type", /text\/event-stream/)
      .then((response) =>
        (response.body as string)
          .split("\n\n")
          .filter((frame) => frame.startsWith("event: "))
          .map((frame) => {
            const [event, data] = frame.split("\n");
            return {
              event: event.replace("event: ", ""),
              data: JSON.parse(data.replace("data: ", "")) as Frame["data"],
            };
          }),
      );
  }

  /** Wait for the stream's next poll to have happened. */
  const nextPoll = () => new Promise((resolve) => setTimeout(resolve, 1300));

  /** Insert an investigation directly, in a status and at a time. */
  async function seed(
    workspace: Workspace,
    kind: string,
    status: string,
    createdAt: Date,
    owner: Person,
  ): Promise<string> {
    const finished = status === "brief_ready" || status === "issues_filed";
    const client = await api.sql.connect();
    try {
      // A finished investigation and its brief go in together — V108's rule is deferred.
      await client.query("begin");
      const { rows } = await client.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.investigations
           (organization_id, kind_id, question, depth, tools_enabled, status, actuals, provenance,
            created_by, created_at)
         select $1, k.id, $2 || ' question', 'quick', '["web"]', $3,
                case when $4 then '{"sources_used": 0, "spend_cents": 0, "duration_ms": 1}'::jsonb end,
                case when $5 then '{"researcher": "loop-v1", "alias": "a", "resolution_ref": null}'::jsonb end,
                $6, $7
           from ${SCHEMA_NAME}.investigation_kinds k
          where k.organization_id = $1 and k.slug = $2
         returning id`,
        [
          workspace.id,
          kind,
          status,
          finished,
          finished || status === "running",
          owner.id,
          createdAt,
        ],
      );
      if (finished) {
        await client.query(
          `insert into ${SCHEMA_NAME}.briefs (investigation_id, version, body)
           values ($1, 1, '{"paragraphs": [{"spans": [{"text": "Nothing to report."}]}]}')`,
          [rows[0].id],
        );
      }
      await client.query("commit");
      return rows[0].id;
    } catch (failure) {
      await client.query("rollback");
      throw failure;
    } finally {
      client.release();
    }
  }

  it("starts an investigation: numbered, queued, estimated, and handed to the engine", async () => {
    const space = await bench();

    const started = await start(space);

    expect(started.investigation).toMatchObject({
      displayId: "RS-001",
      kind: { slug: "gap_analysis", name: "Gap analysis", tint: "gap" },
      question: COMPOSER.question,
      depth: "quick",
      tools: ["web", "code"],
      origin: "user",
      status: "queued",
      pill: { state: "queued", label: "queued" },
      sources: 0,
      link: null,
      startedBy: { id: space.owner.id },
      progress: { status: "queued", iteration: null, iterations: 1, sources: 0, spendCents: 0 },
      mayCancel: true,
    });
    expect(started.estimate.researcher?.alias).toBe("researcher-long-ctx");
    expect(started.investigation.estimate?.sources).toEqual(started.estimate.sources);
    expect(investigate).toHaveBeenCalledTimes(1);
    expect(investigate.mock.calls[0][0]).toMatchObject({
      investigation: started.investigation.id,
      question: COMPOSER.question,
      alias: "researcher-long-ctx",
    });

    const { rows } = await api.sql.query<{ status: string; estimate: unknown; created_by: string }>(
      `select status, estimate, created_by from ${SCHEMA_NAME}.investigations where id = $1`,
      [started.investigation.id],
    );
    expect(rows[0]).toMatchObject({ status: "queued", created_by: space.owner.id });
    expect(rows[0].estimate).not.toBeNull();
  });

  it("uses the kind's default tools when none are chosen, and numbers the next one", async () => {
    const space = await bench();

    await start(space);
    const second = await start(space, space.owner, {
      question: "Why does the altimeter spike in the cold?",
      kind: "bug_root_cause",
      depth: "standard",
    });

    expect(second.investigation).toMatchObject({
      displayId: "RS-002",
      tools: ["code", "tickets", "telemetry"],
      progress: { iterations: 2 },
    });
  });

  it("creates nothing when routing resolves no researcher", async () => {
    const space = await bench({ routed: false });

    const refused = await call(space.owner, space.workspace, "post", BASE)
      .send(COMPOSER)
      .expect(409);

    expect(refusal(refused).code).toBe("investigation_researcher_unavailable");
    expect(investigate).not.toHaveBeenCalled();
    expect((await list(space.owner, space.workspace)).total).toBe(0);
  });

  it("cancels the new investigation when the engine cannot take it, and answers 502", async () => {
    const space = await bench();
    // The real client, pointed at an engine that is not there.
    investigate.mockRestore();

    const refused = await call(space.owner, space.workspace, "post", BASE)
      .send(COMPOSER)
      .expect(502);

    expect(refusal(refused).code).toBe("engine_unavailable");
    const listed = await list(space.owner, space.workspace);
    expect(listed.items.map((row) => [row.displayId, row.status])).toEqual([
      ["RS-001", "cancelled"],
    ]);
    expect(listed.counts.active).toBe(0);
  });

  it("refuses an unknown kind, an unknown tool and a malformed body, creating nothing", async () => {
    const space = await bench();
    const post = (body: object) => call(space.owner, space.workspace, "post", BASE).send(body);

    expect(refusal(await post({ ...COMPOSER, kind: "nope" }).expect(404)).code).toBe(
      "investigation_kind_not_found",
    );
    expect(refusal(await post({ ...COMPOSER, tools: ["nope"] }).expect(422)).code).toBe(
      "research_tool_unknown",
    );
    expect(refusal(await post({ ...COMPOSER, question: "  " }).expect(422)).code).toBe(
      "validation_failed",
    );
    expect(refusal(await post({ ...COMPOSER, status: "brief_ready" }).expect(422)).code).toBe(
      "validation_failed",
    );
    expect((await list(space.owner, space.workspace)).total).toBe(0);
  });

  it("lets members start by default, never a viewer, and follows the workspace's setting", async () => {
    const space = await bench();
    const [admin, member, viewer] = [
      await colleague(space, "admin"),
      await colleague(space, "member"),
      await colleague(space, "viewer"),
    ];
    const tryStart = (person: Person) => call(person, space.workspace, "post", BASE).send(COMPOSER);
    const settings = (person: Person) => call(person, space.workspace, "get", SETTINGS);

    expect((await settings(viewer).expect(200)).body).toEqual({ startRole: "member" });
    await tryStart(member).expect(201);
    const refused = refusal(await tryStart(viewer).expect(403));
    expect(refused).toMatchObject({
      code: "forbidden",
      details: { required: ["owner", "admin", "member"] },
    });

    // Only an owner or admin changes the setting.
    await call(member, space.workspace, "patch", SETTINGS).send({ startRole: "admin" }).expect(403);
    await call(admin, space.workspace, "patch", SETTINGS).send({ startRole: "viewer" }).expect(422);
    expect(
      (
        await call(admin, space.workspace, "patch", SETTINGS)
          .send({ startRole: "admin" })
          .expect(200)
      ).body,
    ).toEqual({ startRole: "admin" });
    expect((await settings(member).expect(200)).body).toEqual({ startRole: "admin" });

    expect(refusal(await tryStart(member).expect(403)).details).toMatchObject({
      required: ["owner", "admin"],
    });
    await tryStart(admin).expect(201);
    await tryStart(space.owner).expect(201);

    // An empty patch changes nothing; the setting is the workspace's own.
    expect(
      (await call(admin, space.workspace, "patch", SETTINGS).send({}).expect(200)).body,
    ).toEqual({ startRole: "admin" });
    const other = await bench();
    expect((await call(other.owner, other.workspace, "get", SETTINGS).expect(200)).body).toEqual({
      startRole: "member",
    });
    expect((await list(space.owner, space.workspace)).total).toBe(3);
  });

  it("streams start → progress → brief_ready with the source count rising, to every subscriber", async () => {
    const space = await bench();
    const viewer = await colleague(space, "viewer");
    const { id } = (await start(space)).investigation;

    const first = watch(space.owner, space.workspace, id);
    await nextPoll();
    await loop("post", id, "start", LOOP_START).expect(200);
    const source = await archive(id, 1);
    await archive(id, 2, "code");
    await loop("put", id, "checkpoint", checkpoint(1, 0, 140)).expect(200);
    await nextPoll();

    // A second subscriber joins mid-run and starts from the current reading.
    const second = watch(viewer, space.workspace, id);
    await archive(id, 3);
    await loop("put", id, "checkpoint", checkpoint(2, 0, 250)).expect(200);
    await nextPoll();
    await loop("post", id, "brief", brief(source)).expect(200);

    const [whole, late] = await Promise.all([first, second]);

    expect(whole[0]).toMatchObject({ event: "progress", data: { status: "queued", sources: 0 } });
    expect(whole.at(-1)).toMatchObject({
      event: "done",
      data: { kind: "done", status: "brief_ready", sources: 3, spendCents: 390 },
    });
    const counts = whole.map((frame) => frame.data.sources);
    expect(counts).toEqual([...counts].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(new Set(counts).size).toBeGreaterThanOrEqual(3);
    expect(
      whole.some((frame) => frame.data.status === "running" && frame.data.iteration === 1),
    ).toBe(true);

    expect(late[0]).toMatchObject({ event: "progress", data: { status: "running" } });
    expect(late.at(-1)).toEqual(whole.at(-1));

    const opened = await detail(space.owner, space.workspace, id);
    expect(opened).toMatchObject({
      status: "brief_ready",
      pill: { label: "✓ brief ready" },
      sources: 3,
      ledger: {
        total: 3,
        byTool: [
          { tool: "web", count: 2 },
          { tool: "code", count: 1 },
        ],
      },
      actuals: { sourcesUsed: 3, spendCents: 390 },
      provenance: { researcher: "loop-v1", alias: "researcher-long-ctx", resolutionRef: "r1" },
      link: { kind: "brief", label: "brief ↑", version: 1 },
      deliverables: [{ kind: "brief" }],
      mayCancel: false,
    });
  }, 30_000);

  it("cancels mid-run: the worker stops, the ledger is kept, and the stream closes cleanly", async () => {
    const space = await bench();
    const { id } = (await start(space)).investigation;
    await loop("post", id, "start", LOOP_START).expect(200);
    for (let n = 1; n <= 31; n += 1) await archive(id, n);
    await loop("put", id, "checkpoint", checkpoint(1, 0, 390)).expect(200);

    const stream = watch(space.owner, space.workspace, id);
    await nextPoll();
    const cancelled = (
      await call(space.owner, space.workspace, "post", `${BASE}/${id}/cancel`).expect(200)
    ).body as CancelledInvestigationResource;

    expect(cancelled).toMatchObject({
      state: "cancelling",
      investigation: {
        status: "running",
        pill: { state: "cancelling", live: true },
        sources: 31,
        progress: { cancelRequested: true },
      },
    });
    // Asking again while it is stopping is not an error.
    await call(space.owner, space.workspace, "post", `${BASE}/${id}/cancel`).expect(200);

    // The worker learns of it from its next checkpoint, and ends the run as cancelled.
    const told = await loop("put", id, "checkpoint", checkpoint(2, 0, 10)).expect(200);
    expect(told.body).toEqual({ cancelRequested: true });
    await nextPoll();
    await loop("post", id, "finish", {
      attempt: 1,
      outcome: "cancelled",
      durationMs: 90_000,
      usage: [],
      seq: 3,
      checkpoint: { version: "loop-v1", phase: "iterate", iteration: 0 },
    }).expect(200);

    const frames = await stream;
    expect(frames.some((frame) => frame.data.cancelRequested === true)).toBe(true);
    expect(frames.at(-1)).toMatchObject({
      event: "done",
      data: { status: "cancelled", sources: 31, spendCents: 400, cancelRequested: false },
    });

    const opened = await detail(space.owner, space.workspace, id);
    expect(opened).toMatchObject({
      status: "cancelled",
      pill: { label: "cancelled", live: false },
      sources: 31,
      ledger: { total: 31, byTool: [{ tool: "web", count: 31 }] },
      actuals: { sourcesUsed: 31, spendCents: 400 },
      failure: null,
      mayCancel: false,
    });
    const again = await call(space.owner, space.workspace, "post", `${BASE}/${id}/cancel`).expect(
      409,
    );
    expect(refusal(again).code).toBe("investigation_not_cancellable");
  }, 30_000);

  it("cancels a queued investigation at once, for its starter or an admin and nobody else", async () => {
    const space = await bench();
    const [admin, member, other] = [
      await colleague(space, "admin"),
      await colleague(space, "member"),
      await colleague(space, "member"),
    ];
    const mine = (await start(space, member)).investigation;
    const theirs = (await start(space, member)).investigation;
    const cancel = (person: Person, id: string) =>
      call(person, space.workspace, "post", `${BASE}/${id}/cancel`);

    expect((await detail(member, space.workspace, mine.id)).mayCancel).toBe(true);
    expect((await detail(other, space.workspace, mine.id)).mayCancel).toBe(false);
    expect((await detail(admin, space.workspace, mine.id)).mayCancel).toBe(true);

    const refused = refusal(await cancel(other, mine.id).expect(403));
    expect(refused).toMatchObject({
      code: "investigation_cancel_forbidden",
      details: { investigation: "RS-001" },
    });
    expect((await detail(other, space.workspace, mine.id)).status).toBe("queued");

    expect((await cancel(member, mine.id).expect(200)).body).toMatchObject({
      state: "cancelled",
      investigation: { status: "cancelled", pill: { label: "cancelled" } },
    });
    expect((await cancel(admin, theirs.id).expect(200)).body).toMatchObject({ state: "cancelled" });
  });

  it("lists with computed counts, a real quarter window, and filters that compose", async () => {
    const space = await bench();
    const now = new Date();
    const quarter = quarterOf(now);
    const inside = new Date(Math.max(quarter.from.getTime(), now.getTime() - 60_000));
    const before = new Date(quarter.from.getTime() - 86_400_000);
    const rows: [string, string, Date][] = [
      ["gap_analysis", "brief_ready", inside],
      ["gap_analysis", "cancelled", inside],
      ["gap_analysis", "brief_ready", before],
      ["bug_root_cause", "queued", inside],
      ["bug_root_cause", "failed", before],
      ["roadmap_improvements", "issues_filed", inside],
      ["regression_forensics", "running", inside],
    ];
    for (const [kind, status, at] of rows)
      await seed(space.workspace, kind, status, at, space.owner);
    const ids = async (query: Record<string, string>) =>
      (await list(space.owner, space.workspace, query)).items.map((row) => row.displayId);

    const all = await list(space.owner, space.workspace);
    expect(all.items.map((row) => row.displayId)).toEqual([
      "RS-007",
      "RS-006",
      "RS-005",
      "RS-004",
      "RS-003",
      "RS-002",
      "RS-001",
    ]);
    expect(all).toMatchObject({
      total: 7,
      limit: 25,
      offset: 0,
      // Five did not fail or get cancelled; five started inside this quarter.
      counts: { active: 5, thisQuarter: 5 },
      quarter: { key: quarter.key, from: quarter.from.toISOString(), to: quarter.to.toISOString() },
    });

    expect(await ids({ status: "active" })).toEqual([
      "RS-007",
      "RS-006",
      "RS-004",
      "RS-003",
      "RS-001",
    ]);
    expect(await ids({ kind: "gap_analysis" })).toEqual(["RS-003", "RS-002", "RS-001"]);
    expect(await ids({ kind: "gap_analysis", status: "brief_ready" })).toEqual([
      "RS-003",
      "RS-001",
    ]);
    expect(await ids({ kind: "gap_analysis", status: "brief_ready", quarter: "current" })).toEqual([
      "RS-001",
    ]);
    expect(
      await ids({ kind: "gap_analysis", status: "brief_ready", quarter: quarter.key }),
    ).toEqual(["RS-001"]);
    expect(await ids({ quarter: quarterOf(before).key })).toEqual(["RS-005", "RS-003"]);
    expect(await ids({ status: "failed", quarter: "current" })).toEqual([]);
    expect(await ids({ limit: "2", offset: "1" })).toEqual(["RS-006", "RS-005"]);

    // The counts do not move with the filters.
    const narrowed = await list(space.owner, space.workspace, { kind: "gap_analysis" });
    expect(narrowed.total).toBe(3);
    expect(narrowed.counts).toEqual({ active: 5, thisQuarter: 5 });

    const bad = await call(space.owner, space.workspace, "get", BASE)
      .query({ quarter: "2026-Q5" })
      .expect(422);
    expect(refusal(bad).code).toBe("validation_failed");
  });

  it("shows another workspace nothing: not the list, the detail, the stream or the cancel", async () => {
    const space = await bench();
    const elsewhere = await bench();
    const { id } = (await start(space)).investigation;
    const intruder = (method: "get" | "post", path: string) =>
      call(elsewhere.owner, elsewhere.workspace, method, path);

    expect(await list(elsewhere.owner, elsewhere.workspace)).toMatchObject({
      items: [],
      total: 0,
      counts: { active: 0, thisQuarter: 0 },
    });
    for (const [method, path] of [
      ["get", `${BASE}/${id}`],
      ["get", `${BASE}/${id}/progress`],
      ["post", `${BASE}/${id}/cancel`],
    ] as const) {
      const refused = await intruder(method, path).expect(404);
      expect(refusal(refused).code).toBe("investigation_not_found");
    }
    // Naming the workspace they are not a member of is no way in either.
    await call(elsewhere.owner, space.workspace, "get", BASE).expect(404);
    expect((await detail(space.owner, space.workspace, id)).status).toBe("queued");

    // The other workspace numbers its own from one.
    expect((await start(elsewhere)).investigation.displayId).toBe("RS-001");
  });

  it("refuses an id that is not a uuid", async () => {
    const space = await bench();

    await call(space.owner, space.workspace, "get", `${BASE}/RS-001`).expect(422);
    await call(space.owner, space.workspace, "post", `${BASE}/RS-001/cancel`).expect(422);
  });
});

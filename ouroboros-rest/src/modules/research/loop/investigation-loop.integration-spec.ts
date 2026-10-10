/**
 * The investigation loop's control-plane half on the real schema (V106, V108, V120) — #620.
 *
 * The engine is the stand-in: these cases make its four writes over HTTP with the internal key,
 * and read back what the database holds. What is proven here and nowhere else is the SQL — the
 * row lock that serialises a worker and its replacement, the usage rows' idempotency, actuals
 * computed from the ledger and `investigation_spend_cents()`, and V108's deferred citation rule
 * agreeing with the service's own.
 */

import request from "supertest";

import { ApiHarness } from "../../../testing/harness.fixture";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { RESEARCH_ERRORS } from "../research.errors";
import { RESEARCH_TOOL_ERRORS } from "../tools/research-tool.errors";
import { InvestigationDispatchService } from "./investigation-dispatch.service";
import { INVESTIGATION_LOOP_ERRORS } from "./investigation-loop.errors";
import { InvestigationLoopRepository } from "./investigation-loop.repository";

const START = {
  loopVersion: "loop-v1",
  alias: "researcher-long-ctx",
  resolutionRef: "r1",
  task: "investigate:fixture",
};

function usage(seq: number, costCents: number | null) {
  return {
    seq,
    stage: "digest",
    alias: "researcher-long-ctx",
    hop: 0,
    connection: "conn-anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 20_000,
    outputTokens: 1_500,
    costCents,
  };
}

describe("the investigation loop, on the database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** One of the loop's writes, made the way the engine makes it. */
  function write(method: "post" | "put", investigation: string, route: string, body: object) {
    return request(api.baseUrl)
      [method](`/internal/research/investigations/${investigation}/${route}`)
      .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
      .send(body);
  }

  /** A queued gap analysis in a fresh workspace. */
  async function investigation(): Promise<{ id: string; workspace: string }> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.investigations (organization_id, kind_id, question, depth, tools_enabled)
       select $1, k.id, 'Why do rivals dock in wind and we do not?', 'quick', '["web"]'
         from ouroboros.investigation_kinds k
        where k.organization_id = $1 and k.slug = 'gap_analysis'
       returning id`,
      [workspace.id],
    );
    return { id: rows[0].id, workspace: workspace.id };
  }

  /** Archive a source, as the tool surface would. */
  async function archive(investigationId: string, n: number): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.source_records
         (investigation_id, tool_slug, kind, title, locator, retrieved_at, content_hash, excerpt)
       values ($1, 'web', 'web', $2, $3, now(), 'sha256:' || repeat($4, 64), 'An excerpt.')
       returning id`,
      [
        investigationId,
        `Source ${n.toString()}`,
        `https://example.com/${n.toString()}`,
        n.toString(),
      ],
    );
    return rows[0].id;
  }

  async function one<T>(sql: string, values: unknown[]): Promise<T> {
    const { rows } = await api.sql.query(sql, values);
    return rows[0] as T;
  }

  function brief(sources: string[], overrides: object = {}) {
    return {
      attempt: 1,
      durationMs: 61_000,
      usage: [usage(3, 48)],
      body: {
        paragraphs: [
          { spans: [{ text: "The gap is control, not sensors.", claim: "c1" }] },
          { spans: [{ text: "Does AeroMesh use a beacon?", claim: "q1" }] },
        ],
      },
      claims: [
        { ref: "c1", type: "finding", text: "The gap is control.", sources, demoted: false },
        { ref: "q1", type: "open_question", text: "A beacon?", sources: [], demoted: true },
      ],
      deliverables: {
        matrix: { rows: [{ capability: "Gust docking", cells: [{ status: "partial", sources }] }] },
      },
      ...overrides,
    };
  }

  it("runs an investigation from queued to a cited brief, with computed actuals", async () => {
    const { id } = await investigation();

    const started = await write("post", id, "start", START).expect(200);
    expect(started.body).toMatchObject({
      attempt: 1,
      checkpoint: null,
      checkpointSeq: 0,
      cancelRequested: false,
      sources: [],
    });
    expect(
      await one(
        `select status, provenance, engine_task_ref from ouroboros.investigations where id = $1`,
        [id],
      ),
    ).toEqual({
      status: "running",
      provenance: { researcher: "loop-v1", alias: "researcher-long-ctx", resolution_ref: "r1" },
      engine_task_ref: "investigate:fixture",
    });

    const [first, second] = [await archive(id, 1), await archive(id, 2)];
    const saved = await write("put", id, "checkpoint", {
      attempt: 1,
      seq: 1,
      checkpoint: { version: "loop-v1", phase: "iterate" },
      durationMs: 30_000,
      usage: [usage(1, 8.25), usage(2, null)],
    }).expect(200);
    expect(saved.body).toEqual({ cancelRequested: false });

    const delivered = await write("post", id, "brief", brief([first, second])).expect(200);

    // 8.25 + 48 = 56.25¢ over three calls, one of them unpriced → 57¢; two sources archived.
    expect(delivered.body).toMatchObject({
      status: "brief_ready",
      actuals: { sourcesUsed: 2, spendCents: 57, durationMs: 61_000 },
      brief: { version: 1 },
    });
    expect(
      await one(`select status, actuals from ouroboros.investigations where id = $1`, [id]),
    ).toEqual({
      status: "brief_ready",
      actuals: { sources_used: 2, spend_cents: 57, duration_ms: 61_000 },
    });
    expect(
      await one(`select ouroboros.investigation_spend_cents($1::uuid) as spend`, [id]),
    ).toEqual({ spend: 57 });

    const { rows: claims } = await api.sql.query(
      `select c.span_ref, c.claim_type, c.demoted,
              (select count(*)::int from ouroboros.brief_claim_sources l where l.claim_id = c.id) as sources
         from ouroboros.brief_claims c where c.investigation_id = $1 order by c.span_ref`,
      [id],
    );
    expect(claims).toEqual([
      { span_ref: "c1", claim_type: "finding", demoted: false, sources: 2 },
      { span_ref: "q1", claim_type: "open_question", demoted: true, sources: 0 },
    ]);
    expect(
      await one(
        `select deliverable, payload -> 'rows' -> 0 ->> 'capability' as capability
           from ouroboros.investigation_deliverable_inputs where investigation_id = $1`,
        [id],
      ),
    ).toEqual({ deliverable: "matrix", capability: "Gust docking" });
  });

  it("resumes as a new attempt with the checkpoint and ledger, and refuses the replaced worker", async () => {
    const { id } = await investigation();
    await write("post", id, "start", START).expect(200);
    const source = await archive(id, 1);
    const checkpoint = {
      attempt: 1,
      seq: 2,
      checkpoint: { version: "loop-v1", phase: "iterate", iteration: 1 },
      durationMs: 4_200,
      usage: [usage(1, 10)],
    };
    await write("put", id, "checkpoint", checkpoint).expect(200);

    const resumed = await write("post", id, "start", START).expect(200);

    expect(resumed.body).toMatchObject({
      attempt: 2,
      checkpoint: { version: "loop-v1", phase: "iterate", iteration: 1 },
      checkpointSeq: 2,
      durationMs: 4_200,
    });
    expect((resumed.body as { sources: { id: string; citeNo: number }[] }).sources).toEqual([
      expect.objectContaining({
        id: source,
        citeNo: 1,
        tool: "web",
        locator: "https://example.com/1",
      }),
    ]);

    // The worker that was presumed dead writes again: refused, and nothing it sent is kept.
    const stale = await write("put", id, "checkpoint", {
      ...checkpoint,
      seq: 3,
      usage: [usage(2, 500)],
    }).expect(409);
    expect((stale.body as { code: string }).code).toBe(INVESTIGATION_LOOP_ERRORS.checkpointStale);
    await write("post", id, "finish", {
      attempt: 1,
      outcome: "failed",
      reason: "engine_error",
      detail: "The old worker gave up.",
      durationMs: 5_000,
      usage: [],
      seq: 4,
      checkpoint: {},
    }).expect(409);

    // The new attempt re-sends a usage row the old one recorded, and one it had not.
    await write("put", id, "checkpoint", {
      attempt: 2,
      seq: 3,
      checkpoint: { version: "loop-v1", phase: "synthesize" },
      durationMs: 100,
      usage: [usage(1, 999), usage(2, 5)],
    }).expect(200);
    await write("put", id, "checkpoint", {
      attempt: 2,
      seq: 3,
      checkpoint: {},
      durationMs: 0,
      usage: [],
    }).expect(409);

    const { rows } = await api.sql.query(
      `select seq, cost_cents::float8 as cost from ouroboros.investigation_usage
        where investigation_id = $1 order by seq`,
      [id],
    );
    expect(rows).toEqual([
      { seq: 1, cost: 10 },
      { seq: 2, cost: 5 },
    ]);
    expect(await one(`select status from ouroboros.investigations where id = $1`, [id])).toEqual({
      status: "running",
    });
    // Working time never goes back, whatever a resumed worker reports.
    expect(
      await one(
        `select duration_ms::int as duration from ouroboros.investigation_loops where investigation_id = $1`,
        [id],
      ),
    ).toEqual({ duration: 4_200 });
  });

  it("holds a brief to the ledger of its own investigation, and writes nothing when it refuses", async () => {
    const { id } = await investigation();
    const other = await investigation();
    await write("post", id, "start", START).expect(200);
    const own = await archive(id, 1);
    const foreign = await archive(other.id, 1);

    const cited = await write("post", id, "brief", brief([own, foreign])).expect(422);
    expect((cited.body as { code: string }).code).toBe(INVESTIGATION_LOOP_ERRORS.sourceUnknown);

    const uncited = await write("post", id, "brief", brief([])).expect(422);
    expect((uncited.body as { code: string }).code).toBe(INVESTIGATION_LOOP_ERRORS.claimUncited);

    const smuggled = await write(
      "post",
      id,
      "brief",
      brief([own], { deliverables: { matrix: { rows: [{ sources: [foreign] }] } } }),
    ).expect(422);
    expect((smuggled.body as { code: string }).code).toBe(INVESTIGATION_LOOP_ERRORS.sourceUnknown);

    expect(
      await one(
        `select (select count(*)::int from ouroboros.briefs where investigation_id = $1) as briefs,
                (select count(*)::int from ouroboros.investigation_usage where investigation_id = $1) as usage,
                (select status from ouroboros.investigations where id = $1) as status`,
        [id],
      ),
    ).toEqual({ briefs: 0, usage: 0, status: "running" });
  });

  it("fails with a reason and keeps the ledger, the checkpoint and the usage", async () => {
    const { id } = await investigation();
    await write("post", id, "start", START).expect(200);
    await archive(id, 1);

    const failed = await write("post", id, "finish", {
      attempt: 1,
      outcome: "failed",
      reason: "budget_breach",
      detail: "The investigation reached its spend ceiling of 30¢.",
      durationMs: 12_000,
      usage: [usage(1, 30)],
      seq: 5,
      checkpoint: { version: "loop-v1", phase: "iterate", operations_used: 1 },
    }).expect(200);

    expect(failed.body).toMatchObject({
      status: "failed",
      actuals: { sourcesUsed: 1, spendCents: 30, durationMs: 12_000 },
      brief: null,
    });
    expect(
      await one(
        `select l.failure_reason, l.failure_detail, l.checkpoint ->> 'phase' as phase, l.checkpoint_seq,
                (select count(*)::int from ouroboros.source_records s where s.investigation_id = l.investigation_id) as sources
           from ouroboros.investigation_loops l where l.investigation_id = $1`,
        [id],
      ),
    ).toEqual({
      failure_reason: "budget_breach",
      failure_detail: "The investigation reached its spend ceiling of 30¢.",
      phase: "iterate",
      checkpoint_seq: 5,
      sources: 1,
    });

    // It is over: no tool call, checkpoint or restart reaches it again.
    const late = await write("put", id, "checkpoint", {
      attempt: 1,
      seq: 6,
      checkpoint: {},
      durationMs: 0,
      usage: [],
    }).expect(409);
    expect((late.body as { code: string }).code).toBe(RESEARCH_TOOL_ERRORS.investigationNotRunning);
    const restart = await write("post", id, "start", START).expect(409);
    expect((restart.body as { code: string }).code).toBe(INVESTIGATION_LOOP_ERRORS.notRunnable);
  });

  it("answers a cancel request with the next checkpoint, and lands the partial intact", async () => {
    const { id, workspace } = await investigation();
    await write("post", id, "start", START).expect(200);
    await archive(id, 1);
    const dispatch = api.nest.get(InvestigationDispatchService);

    expect(await dispatch.requestCancel(workspace, id, null)).toEqual({
      investigation: expect.stringMatching(/^RS-\d{3}$/) as string,
      state: "cancelling",
    });
    await expect(dispatch.requestCancel("org-elsewhere", id, null)).rejects.toMatchObject({
      code: RESEARCH_ERRORS.investigationNotFound,
    });

    const saved = await write("put", id, "checkpoint", {
      attempt: 1,
      seq: 1,
      checkpoint: { version: "loop-v1", phase: "iterate" },
      durationMs: 900,
      usage: [],
    }).expect(200);
    expect(saved.body).toEqual({ cancelRequested: true });

    const cancelled = await write("post", id, "finish", {
      attempt: 1,
      outcome: "cancelled",
      durationMs: 1_000,
      usage: [],
      seq: 2,
      checkpoint: { version: "loop-v1", phase: "iterate" },
    }).expect(200);

    expect(cancelled.body).toMatchObject({
      status: "cancelled",
      actuals: { sourcesUsed: 1, spendCents: 0, durationMs: 1_000 },
    });
    expect(
      await one(
        `select failure_reason, cancel_requested_at is not null as requested
           from ouroboros.investigation_loops where investigation_id = $1`,
        [id],
      ),
    ).toEqual({ failure_reason: null, requested: true });
    await expect(dispatch.requestCancel(workspace, id, null)).rejects.toMatchObject({
      code: INVESTIGATION_LOOP_ERRORS.notCancellable,
    });
  });

  it("cancels a queued investigation outright", async () => {
    const { id, workspace } = await investigation();

    expect(
      (await api.nest.get(InvestigationDispatchService).requestCancel(workspace, id, null)).state,
    ).toBe("cancelled");
    expect(await one(`select status from ouroboros.investigations where id = $1`, [id])).toEqual({
      status: "cancelled",
    });
  });

  it("finds a stalled investigation, and abandons one only at the attempt that owns it", async () => {
    const { id } = await investigation();
    const quiet = await investigation();
    await write("post", id, "start", START).expect(200);
    const repository = api.nest.get(InvestigationLoopRepository);
    const later = new Date(Date.now() + 3_600_000);

    expect(await repository.stalled(new Date(Date.now() - 3_600_000), 20)).toEqual([]);
    expect(await repository.stalled(later, 20)).toEqual([
      {
        id,
        displayId: expect.stringMatching(/^RS-/) as string,
        attempt: 1,
        cancelRequested: false,
      },
    ]);
    expect(quiet.id).not.toBe(id);

    expect(await repository.abandon(id, 2, "Restarted too many times.")).toBe(false);
    expect(await repository.abandon(id, 1, "Restarted too many times.")).toBe(true);
    expect(
      await one(
        `select i.status, l.failure_reason, i.actuals ->> 'sources_used' as sources
           from ouroboros.investigations i
           join ouroboros.investigation_loops l on l.investigation_id = i.id where i.id = $1`,
        [id],
      ),
    ).toEqual({ status: "failed", failure_reason: "engine_error", sources: "0" });
    expect(await repository.stalled(later, 20)).toEqual([]);
  });

  it("is behind the internal key, and answers 404 for an investigation that does not exist", async () => {
    const { id } = await investigation();

    await request(api.baseUrl)
      .post(`/internal/research/investigations/${id}/start`)
      .send(START)
      .expect(401);
    await request(api.baseUrl)
      .post(`/internal/research/investigations/${id}/start`)
      .set(INTERNAL_KEY_HEADER, "not-the-key")
      .send(START)
      .expect(401);
    expect(await one(`select status from ouroboros.investigations where id = $1`, [id])).toEqual({
      status: "queued",
    });

    const missing = await write(
      "post",
      "5eed0091-0000-4000-8000-000000000999",
      "start",
      START,
    ).expect(404);
    expect((missing.body as { code: string }).code).toBe(RESEARCH_ERRORS.investigationNotFound);
    await write("post", "RS-127", "start", START).expect(400);
    await write("post", id, "start", { ...START, organizationId: "org-elsewhere" }).expect(422);
  });
});

/* eslint-disable @typescript-eslint/require-await -- fakes answer at once; async keeps the real signatures */

/**
 * The research tool SPI and the investigation loop's lifecycle, certified on the database (CM.7,
 * [#626](https://github.com/NobuData/ouroboros/issues/626)).
 *
 * The loop spans the engine, the adapters, the invocation route, the ledger and the lifecycle,
 * and a unit test of each part stays green while their composition rots. So this suite drives
 * the **real** route, invoker, repository and loop service against the seeded workspace, with
 * the engine played by Supertest: the in-memory fake adapter and one adapter per kind — `web`
 * and `code` over their recorded fixtures (the live ones need a network and an engine), and
 * `competitor`, `tickets` and `telemetry` the real adapters over the seed's own rows.
 *
 * What it certifies: every adapter's answer is archived and numbered by the one ledger; an
 * answer with no source record is refused as designed and archives nothing; a resumed attempt
 * archiving the same record again adds no row; each failure in the taxonomy, and a cancel, keep
 * what the attempt gathered — the ledger, the checkpoint and the usage.
 */

import request from "supertest";

import { ApiHarness } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME, type InvestigationFailureReason } from "../../db/schema";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import type { ErrorEnvelope } from "../../errors/error.envelope";
import { MetricsService } from "../../insights/metrics/metrics.service";
import { CompetitorsRepository } from "../competitors/competitors.repository";
import { HistoryIndexRepository } from "../history/history-index.repository";
import { TelemetryRepository } from "../telemetry/telemetry.repository";
import { CodeResearchTool } from "../tools/adapters/code/code.tool";
import { HELIOS, recordedReader } from "../tools/adapters/code/code.recordings.fixture";
import { CompetitorResearchTool } from "../tools/adapters/competitor/competitor.tool";
import { FAKE_CORPUS, FakeResearchTool } from "../tools/adapters/fake.tool.fixture";
import { TelemetryResearchTool } from "../tools/adapters/telemetry/telemetry.tool";
import { TicketsResearchTool } from "../tools/adapters/tickets/tickets.tool";
import { PageFetcher } from "../tools/adapters/web/web.fetcher";
import {
  ManualClock,
  RecordedProviders,
  RecordedSite,
} from "../tools/adapters/web/web.recordings.fixture";
import { WebResearchTool } from "../tools/adapters/web/web.tool";
import { RESEARCH_TOOL_ERRORS } from "../tools/research-tool.errors";
import type { ToolInvocationResult } from "../tools/research-tool.invoker";
import { RESEARCH_TOOL_ADAPTERS } from "../tools/research-tool.registry";
import type {
  ResearchToolAdapter,
  ToolCallContext,
  ToolResult,
} from "../tools/research-tool.adapter";
import {
  lazily,
  loopWrite,
  queuedInvestigation,
  seedResearch,
  type SeededResearch,
} from "./certification.fixture";

/** The engine's start, as the loop records it. */
const START = {
  loopVersion: "loop-v1",
  alias: "researcher-long-ctx",
  resolutionRef: "r1",
  task: "investigate:certification",
};

/** The slug the fake is registered under — a reference-table row this suite adds and removes. */
const FAKE_SLUG = "fake";

/** The recorded web fixtures' limits. */
const LIMITS = { timeoutMs: 15_000, maxBytes: 5_242_880, maxRedirects: 5, hostIntervalMs: 1000 };

/** Every failure the taxonomy names. */
const REASONS: readonly InvestigationFailureReason[] = [
  "tool_exhaustion",
  "budget_breach",
  "synthesis_failure",
  "engine_error",
];

/** The fake, with one more knob: answer a query with a payload and no source record. */
class SourcelessFake extends FakeResearchTool {
  sourceless = false;

  override async query(
    context: ToolCallContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const result = await super.query(context, input);

    return this.sourceless ? { ...result, sources: [] } : result;
  }
}

/** One model call's usage, as the gateway reports it. */
function usage(seq: number, costCents: number) {
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

describe("the research tool SPI and the loop lifecycle, certified on the database", () => {
  let api: ApiHarness;
  let seeded: SeededResearch;
  const fake = new SourcelessFake({ slug: FAKE_SLUG });

  beforeAll(async () => {
    const clock = new ManualClock();
    const providers = new RecordedProviders(clock);
    const web = new WebResearchTool({
      fetcher: new PageFetcher(new RecordedSite(undefined, clock), LIMITS, clock),
      http: providers.http,
      defaultSearxngUrl: "http://searxng.test:8080",
      timeoutMs: 15_000,
      now: () => new Date(clock.now()),
    });
    const code = new CodeResearchTool({
      reader: recordedReader(),
      bisects: {
        start: () => Promise.reject(new Error("not recorded")),
        get: async () => undefined,
        cancel: async () => undefined,
      },
      workspace: {
        enabled: async () => [HELIOS],
        stack: async () => ({ stack: "c", language: "C" }),
      },
      engineUp: async () => true,
    });
    const adapters: ResearchToolAdapter[] = [
      fake,
      web,
      code,
      new CompetitorResearchTool(lazily(() => api.nest.get(CompetitorsRepository))),
      new TicketsResearchTool(lazily(() => api.nest.get(HistoryIndexRepository))),
      new TelemetryResearchTool(
        lazily(() => api.nest.get(TelemetryRepository)),
        lazily(() => api.nest.get(MetricsService)),
      ),
    ];

    api = await ApiHarness.start({}, [{ provide: RESEARCH_TOOL_ADAPTERS, useValue: adapters }]);
    // The reference table survives every truncate, so the row is added here and removed below.
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.research_tools (slug, display_name) values ($1, 'In-memory corpus')
       on conflict do nothing`,
      [FAKE_SLUG],
    );
    seeded = await seedResearch(api);
  });

  afterAll(async () => {
    await api.truncate();
    await api.sql.query(`delete from ${SCHEMA_NAME}.research_tools where slug = $1`, [FAKE_SLUG]);
    await api.close();
  });

  afterEach(() => {
    fake.sourceless = false;
  });

  /** A running investigation in the seeded workspace, every tool enabled. */
  async function running(tools: readonly string[]): Promise<string> {
    const id = await queuedInvestigation(api, seeded.workspace.id, "gap_analysis", tools);

    await loopWrite(api, id, "start", START).expect(200);

    return id;
  }

  /** One tool operation, as the engine calls it. */
  function invoke(investigation: string, slug: string, op: string, input: object) {
    return request(api.baseUrl)
      .post(`/internal/research/tools/${slug}/${op}`)
      .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
      .send({ investigation, input, budget: { operations: 40, tokens: null } });
  }

  async function one<T>(sql: string, values: unknown[]): Promise<T> {
    const { rows } = await api.sql.query(sql, values);

    return rows[0] as T;
  }

  /** The ledger's count and whether its numbers are dense from 1. */
  async function ledgerOf(investigation: string): Promise<{ count: number; dense: boolean }> {
    return one(
      `select count(*)::int as count,
              coalesce(bool_and(cite_no = position), true) as dense
         from (select cite_no, row_number() over (order by cite_no)::int as position
                 from ${SCHEMA_NAME}.source_records where investigation_id = $1) numbered`,
      [investigation],
    );
  }

  describe("the SPI, through the route", () => {
    const ALL = [FAKE_SLUG, "web", "code", "competitor", "tickets", "telemetry"];

    it.each([
      [FAKE_SLUG, "query", { locatorPrefix: "https://skylink" }],
      [FAKE_SLUG, "fetch", { locator: FAKE_CORPUS[0].locator }],
      ["web", "search", { query: "gust docking", limit: 5 }],
      [
        "code",
        "query",
        { op: "blame", repo: "helios-firmware", path: "src/dock/dock_ctrl.c", range: "213-215" },
      ],
      ["competitor", "query", { op: "changes", rival: "Skylink", windowDays: 365 }],
      ["tickets", "query", { op: "search", q: "battery", limit: 10 }],
      ["telemetry", "query", { op: "metric_window", metric: "merge_rate", window: "30d" }],
    ])("%s %s answers, and the ledger numbers what it archived", async (slug, op, input) => {
      const investigation = await running(ALL);
      const before = await ledgerOf(investigation);

      const response = await invoke(investigation, slug, op, input);
      const result = bodyOf<ToolInvocationResult>(response);

      expect(response.status).toBe(200);
      expect(result).toMatchObject({ tool: slug, operation: op, skipped: null });
      expect(result.payload).not.toBeNull();
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.usage.operations).toBe(1);
      expect(result.budget.operations).toBe(39);

      const after = await ledgerOf(investigation);

      expect(after.count).toBe(
        before.count + result.sources.filter((source) => !source.deduplicated).length,
      );
      expect(after.dense).toBe(true);
      for (const source of result.sources) {
        expect(
          await one(
            `select investigation_id, tool_slug, cite_no from ${SCHEMA_NAME}.source_records where id = $1`,
            [source.id],
          ),
        ).toEqual({ investigation_id: investigation, tool_slug: slug, cite_no: source.citeNo });
      }
    });

    it("refuses an answer with no source record, as designed, and archives nothing", async () => {
      const investigation = await running([FAKE_SLUG]);
      const before = await ledgerOf(investigation);

      fake.sourceless = true;

      const refused = await invoke(investigation, FAKE_SLUG, "query", {
        locatorPrefix: "https://skylink",
      });

      // A tool outside its contract is an upstream fault, answered as one: the engine is told the
      // tool broke, not that it asked wrongly.
      expect(refused.status).toBe(502);
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe(RESEARCH_TOOL_ERRORS.contractViolation);
      expect(await ledgerOf(investigation)).toEqual(before);
    });

    it("archives a record once, however many attempts fetch it", async () => {
      const investigation = await running([FAKE_SLUG]);
      const locator = FAKE_CORPUS[1].locator;

      const first = bodyOf<ToolInvocationResult>(
        await invoke(investigation, FAKE_SLUG, "fetch", { locator }).expect(200),
      );
      // The attempt dies and the next one repeats the operation in flight.
      const again = bodyOf<ToolInvocationResult>(
        await invoke(investigation, FAKE_SLUG, "fetch", { locator }).expect(200),
      );

      expect(first.sources[0]?.deduplicated).toBe(false);
      expect(again.sources[0]).toMatchObject({
        id: first.sources[0]?.id,
        citeNo: first.sources[0]?.citeNo,
        deduplicated: true,
      });
      expect(await ledgerOf(investigation)).toEqual({ count: 1, dense: true });
    });
  });

  describe("the lifecycle", () => {
    it.each(REASONS)(
      "a run that ends %s keeps its ledger, checkpoint and usage",
      async (reason) => {
        const investigation = await running([FAKE_SLUG]);

        await invoke(investigation, FAKE_SLUG, "fetch", { locator: FAKE_CORPUS[0].locator }).expect(
          200,
        );
        await loopWrite(api, investigation, "checkpoint", {
          attempt: 1,
          seq: 2,
          checkpoint: { version: "loop-v1", phase: "iterate", iteration: 1 },
          durationMs: 4_200,
          usage: [usage(1, 10)],
        }).expect(200);
        await loopWrite(api, investigation, "finish", {
          attempt: 1,
          outcome: "failed",
          reason,
          detail: `The run ended with ${reason}.`,
          durationMs: 5_000,
          usage: [usage(2, 5)],
          seq: 3,
          checkpoint: { version: "loop-v1", phase: "iterate", iteration: 1, failed: true },
        }).expect(200);

        expect(
          await one(
            `select i.status, l.failure_reason, l.checkpoint ->> 'phase' as phase,
                  (i.actuals is not null) as actuals,
                  (select count(*)::int from ${SCHEMA_NAME}.source_records where investigation_id = i.id) as sources,
                  (select count(*)::int from ${SCHEMA_NAME}.investigation_usage where investigation_id = i.id) as usage
             from ${SCHEMA_NAME}.investigations i
             join ${SCHEMA_NAME}.investigation_loops l on l.investigation_id = i.id
            where i.id = $1`,
            [investigation],
          ),
        ).toEqual({
          status: "failed",
          failure_reason: reason,
          phase: "iterate",
          actuals: true,
          sources: 1,
          usage: 2,
        });
      },
    );

    it("keeps what a cancelled run gathered — a designed partial", async () => {
      const investigation = await running([FAKE_SLUG]);

      await invoke(investigation, FAKE_SLUG, "fetch", { locator: FAKE_CORPUS[0].locator }).expect(
        200,
      );
      await loopWrite(api, investigation, "checkpoint", {
        attempt: 1,
        seq: 2,
        checkpoint: { version: "loop-v1", phase: "iterate", iteration: 1 },
        durationMs: 1_000,
        usage: [usage(1, 10)],
      }).expect(200);

      await seeded
        .as(seeded.people.admin, "post", `/api/v1/research/investigations/${investigation}/cancel`)
        .expect(200);

      // The cancel is honoured at the loop's next checkpoint — the engine is told, stops after
      // the operation in flight, and ends the run as cancelled with everything it gathered.
      const acknowledged = await loopWrite(api, investigation, "checkpoint", {
        attempt: 1,
        seq: 3,
        checkpoint: { version: "loop-v1", phase: "iterate", iteration: 2 },
        durationMs: 1_500,
        usage: [],
      }).expect(200);

      expect(bodyOf<{ cancelRequested: boolean }>(acknowledged).cancelRequested).toBe(true);
      await loopWrite(api, investigation, "finish", {
        attempt: 1,
        outcome: "cancelled",
        durationMs: 1_600,
        usage: [],
        seq: 4,
        checkpoint: { version: "loop-v1", phase: "iterate", iteration: 2 },
      }).expect(200);

      expect(
        await one(
          `select i.status,
                  (select count(*)::int from ${SCHEMA_NAME}.source_records where investigation_id = i.id) as sources,
                  (select count(*)::int from ${SCHEMA_NAME}.investigation_usage where investigation_id = i.id) as usage
             from ${SCHEMA_NAME}.investigations i where i.id = $1`,
          [investigation],
        ),
      ).toEqual({ status: "cancelled", sources: 1, usage: 1 });
      // A tool call after the cancel is refused: the run is no longer running.
      expect(
        (await invoke(investigation, FAKE_SLUG, "fetch", { locator: FAKE_CORPUS[1].locator }))
          .status,
      ).toBe(409);
    });
  });
});

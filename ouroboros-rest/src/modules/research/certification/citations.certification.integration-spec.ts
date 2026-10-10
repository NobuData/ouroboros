/**
 * Citation, matrix, export and estimate discipline, certified over the development seeds (CM.7,
 * [#626](https://github.com/NobuData/ouroboros/issues/626)).
 *
 * Mockup 22's four load-bearing claims are promises that fail quietly: a junction check removed
 * still produces a brief, a slightly more confident one; a numbering that drifts still renders.
 * These cases read what the seed wrote for `RS-127` and `RS-124` — never a literal id — and hold
 * the composed system to the claims: every finding cites its own ledger, a planted uncited
 * finding is refused, an export's numbers survive a re-render and a grown ledger, a matrix
 * severity reproduces from the stored input, an uncited cell is refused, and an unpriced
 * estimate carries no dollar figure anywhere.
 */

import { createHash } from "node:crypto";

import { ApiHarness } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { EngineClient } from "../../engine/engine.client";
import type { ErrorEnvelope } from "../../errors/error.envelope";
import { readBriefExport } from "../briefs/brief.export";
import type { BriefLedgerResource, BriefResource } from "../briefs/brief.resources";
import { BRIEF_ERRORS } from "../briefs/briefs.errors";
import { MatrixBuilderService, planMatrix } from "../briefs/matrix-builder.service";
import { parseMatrixInput } from "../briefs/matrix.input";
import type { InvestigationDetailResource } from "../lifecycle/lifecycle.resources";
import { INVESTIGATION_LOOP_ERRORS } from "../loop/investigation-loop.errors";
import type { ScopeEstimateResource } from "../resources";
import {
  loopWrite,
  moneyMentions,
  queuedInvestigation,
  seedResearch,
  type SeededInvestigation,
  type SeededResearch,
} from "./certification.fixture";

const BASE = "/api/v1/research/investigations";

/** The engine's start, as the seeded loop recorded it. */
const START = {
  loopVersion: "loop-v1",
  alias: "researcher-long-ctx",
  resolutionRef: "r1",
  task: "investigate:certification",
};

/** A model the shipped price catalog does not price. */
const UNPRICED_MODEL = "claude-internal-preview";

describe("citation, matrix, export and estimate discipline, certified over the seeds", () => {
  let api: ApiHarness;
  let seeded: SeededResearch;
  let rs127: SeededInvestigation;

  beforeAll(async () => {
    api = await ApiHarness.start();
    seeded = await seedResearch(api);
    rs127 = await seeded.investigation("RS-127");
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A read of an investigation's brief surface, as any member's browser makes it. */
  function read(investigation: SeededInvestigation, route: string) {
    return seeded.as(seeded.people.viewer, "get", `${BASE}/${investigation.id}/${route}`);
  }

  async function one<T>(sql: string, values: unknown[]): Promise<T> {
    const { rows } = await api.sql.query(sql, values);

    return rows[0] as T;
  }

  /** Archive a source under an investigation, as a tool call would. */
  async function archive(investigationId: string, tag: string): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.source_records
         (investigation_id, tool_slug, kind, title, locator, retrieved_at, content_hash, excerpt)
       values ($1, 'web', 'web', $2, $3, now(), $4, $5)
       returning id`,
      [
        investigationId,
        `Source ${tag}`,
        `https://example.com/certification/${tag}`,
        `sha256:${createHash("sha256").update(tag).digest("hex")}`,
        `What ${tag} said.`,
      ],
    );

    return rows[0].id;
  }

  describe("every claim cited", () => {
    it("finds every finding of RS-127's brief cited, each citation resolving to its own ledger", async () => {
      const brief = bodyOf<BriefResource>(await read(rs127, "brief").expect(200));
      const ledger = bodyOf<BriefLedgerResource>(await read(rs127, "sources").expect(200));
      const labels = new Map(ledger.items.map((item) => [item.sourceId, item.label]));
      const spans = brief.brief.paragraphs.flatMap((paragraph) => paragraph.spans);
      const findings = spans.filter((span) => span.claim?.type === "finding");
      const questions = spans.filter((span) => span.claim?.type === "open_question");

      expect(findings.length).toBeGreaterThan(0);
      expect(ledger.total).toBeGreaterThan(0);

      for (const finding of findings) {
        expect(finding.cites.length).toBeGreaterThan(0);
        expect(finding.claim?.demoted).toBe(false);

        for (const cite of finding.cites) {
          // The marker is the ledger's own label for that record, not a number of the brief's.
          expect(labels.get(cite.sourceId)).toBe(cite.label);
        }
      }

      // An open question may cite nothing — that is what it is — and says whether it was offered
      // as a finding first.
      for (const question of questions) expect(typeof question.claim?.demoted).toBe("boolean");

      // The same discipline in the rows: no finding without a junction row, every junction row
      // pointing into this investigation's ledger, the ledger numbered densely from 1.
      expect(
        await one(
          `select (select count(*)::int from ${SCHEMA_NAME}.brief_claims c
                    where c.brief_id = $1 and c.claim_type = 'finding'
                      and not exists (select 1 from ${SCHEMA_NAME}.brief_claim_sources j
                                       where j.claim_id = c.id)) as uncited_findings,
                  (select count(*)::int from ${SCHEMA_NAME}.brief_claim_sources j
                     join ${SCHEMA_NAME}.brief_claims c on c.id = j.claim_id
                    where c.brief_id = $1
                      and not exists (select 1 from ${SCHEMA_NAME}.source_records s
                                       where s.id = j.source_id and s.investigation_id = $2)) as foreign_sources,
                  (select bool_and(numbered.cite_no = numbered.position)
                     from (select cite_no, row_number() over (order by cite_no)::int as position
                             from ${SCHEMA_NAME}.source_records where investigation_id = $2) numbered) as dense`,
          [brief.brief.id, rs127.id],
        ),
      ).toEqual({ uncited_findings: 0, foreign_sources: 0, dense: true });
    });

    it("refuses a planted uncited finding, and keeps it only as a demoted open question", async () => {
      const id = await queuedInvestigation(api, seeded.workspace.id, "gap_analysis", ["web"]);

      await loopWrite(api, id, "start", START).expect(200);

      const source = await archive(id, "one");
      const body = {
        paragraphs: [
          { spans: [{ text: "The gap is control, not sensors.", claim: "c1" }] },
          { spans: [{ text: "Rivals dock at 9 m/s.", claim: "c2" }] },
        ],
      };
      const planted = {
        attempt: 1,
        durationMs: 61_000,
        usage: [],
        body,
        claims: [
          {
            ref: "c1",
            type: "finding",
            text: "The gap is control.",
            sources: [source],
            demoted: false,
          },
          // Offered as a finding, citing nothing: the junction check's one job.
          {
            ref: "c2",
            type: "finding",
            text: "Rivals dock at 9 m/s.",
            sources: [],
            demoted: false,
          },
        ],
        deliverables: {},
      };

      const refused = await loopWrite(api, id, "brief", planted).expect(422);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe(INVESTIGATION_LOOP_ERRORS.claimUncited);
      expect(
        await one(
          `select count(*)::int as briefs from ${SCHEMA_NAME}.briefs where investigation_id = $1`,
          [id],
        ),
      ).toEqual({ briefs: 0 });

      // The same claim, demoted the way the engine's citation gate demotes it, is kept — as a
      // question, and marked as one that was offered as a finding.
      await loopWrite(api, id, "brief", {
        ...planted,
        claims: [
          planted.claims[0],
          {
            ref: "c2",
            type: "open_question",
            text: "Rivals dock at 9 m/s.",
            sources: [],
            demoted: true,
          },
        ],
      }).expect(200);

      const delivered = bodyOf<BriefResource>(
        await seeded.as(seeded.people.viewer, "get", `${BASE}/${id}/brief`).expect(200),
      );
      const spans = delivered.brief.paragraphs.flatMap((paragraph) => paragraph.spans);

      expect(
        spans.map((span) => [span.claim?.type, span.claim?.demoted, span.cites.length]),
      ).toEqual([
        ["finding", false, 1],
        ["open_question", true, 0],
      ]);
    });
  });

  describe("export numbering", () => {
    it("renders the same bytes twice, and keeps every number when the ledger grows", async () => {
      const first = await read(rs127, "brief/export").expect(200);
      const second = await read(rs127, "brief/export").expect(200);

      expect(second.text).toBe(first.text);

      const before = readBriefExport(first.text);
      const panel = bodyOf<BriefLedgerResource>(await read(rs127, "sources").expect(200));

      // The export numbers its sources as the panel labels them, and the body's markers are
      // drawn from that same set.
      expect(before.sources.map((source) => source.label)).toEqual(
        panel.items.map((item) => item.label),
      );
      expect(new Set(before.markers).size).toBeGreaterThan(0);
      for (const marker of before.markers) {
        expect(before.sources.some((source) => source.label === marker)).toBe(true);
      }

      // The ledger grows — a later iteration archived one more record — and nothing already
      // numbered moves: the new record takes the next number, every earlier line is byte-equal.
      await archive(rs127.id, "late");

      const after = readBriefExport((await read(rs127, "brief/export").expect(200)).text);

      expect(after.sources.slice(0, before.sources.length)).toEqual(before.sources);
      expect(after.sources).toHaveLength(before.sources.length + 1);
      expect(after.sources.at(-1)?.label).toBe(
        `[${String(before.sources.length + 1).padStart(2, "0")}]`,
      );
      expect(after.markers).toEqual(before.markers);
    });
  });

  describe("matrix discipline", () => {
    it("reproduces every seeded severity and its derivation from the stored input", async () => {
      const brief = bodyOf<BriefResource>(await read(rs127, "brief").expect(200));
      const stored = await one<{ payload: Record<string, unknown> }>(
        `select payload from ${SCHEMA_NAME}.investigation_deliverable_inputs
          where investigation_id = $1 and deliverable = 'matrix'`,
        [rs127.id],
      );
      const plan = planMatrix(parseMatrixInput(stored.payload));
      const seededRows = brief.matrix?.rows ?? [];

      // The seed's severities are the rule's; its derivations are the mockup's hand-written
      // sentences (the rule's own are asserted for determinism below, and against the mockup's
      // inputs in `matrix.severity.spec.ts`).
      expect(seededRows.length).toBeGreaterThan(0);
      expect(plan.rows.map((row) => [row.capability, row.severity])).toEqual(
        seededRows.map((row) => [row.capability, row.gap.severity]),
      );
      for (const row of plan.rows) expect(row.derivation).toMatch(/→ (lead|low|med|high|wip)$/);
      // And the rule is a function of its inputs: planning the same input twice says the same.
      expect(planMatrix(parseMatrixInput(stored.payload))).toEqual(plan);
    });

    it("refuses a cited status that cites nothing, and builds no matrix from it", async () => {
      const id = await queuedInvestigation(api, seeded.workspace.id, "gap_analysis", ["web"]);

      await loopWrite(api, id, "start", START).expect(200);

      const source = await archive(id, "cell");

      await loopWrite(api, id, "brief", {
        attempt: 1,
        durationMs: 10_000,
        usage: [],
        body: { paragraphs: [{ spans: [{ text: "Control, not sensors.", claim: "c1" }] }] },
        claims: [
          { ref: "c1", type: "finding", text: "Control.", sources: [source], demoted: false },
        ],
        deliverables: {
          matrix: {
            title: "Docking vs. the field",
            us: "Helios",
            rivals: ["Skylink"],
            rows: [
              {
                capability: "Docking in gusts",
                gap: "high",
                cells: [
                  { subject: "Helios", status: "partial", sources: [source] },
                  // `shipping` is a claim about Skylink, and it cites nothing.
                  { subject: "Skylink", status: "shipping", sources: [] },
                ],
              },
            ],
            epic: "Docking parity",
            tickets: [],
          },
        },
      }).expect(200);

      await expect(
        api.nest.get(MatrixBuilderService).build(seeded.workspace.id, id),
      ).rejects.toMatchObject({ code: BRIEF_ERRORS.matrixCellUncited });
      expect(
        await one(
          `select count(*)::int as matrices from ${SCHEMA_NAME}.capability_matrices where investigation_id = $1`,
          [id],
        ),
      ).toEqual({ matrices: 0 });
    });
  });

  describe("estimate honesty", () => {
    const deepDive = () => ({ kind: "gap_analysis", depth: "deep_dive", tools: [...rs127.tools] });

    it("prices RS-127's deep dive from the shipped catalog, as the seed stored it", async () => {
      const response = await seeded
        .as(seeded.people.viewer, "post", "/api/v1/research/estimates")
        .send(deepDive());
      const answer = bodyOf<ScopeEstimateResource>(response);
      const stored = await one<{ estimate: { cost_cents: { min: number; max: number } } }>(
        `select estimate from ${SCHEMA_NAME}.investigations where id = $1`,
        [rs127.id],
      );

      expect(response.status).toBe(200);
      expect(answer.costCents).not.toBeNull();
      expect(answer.costCents).toEqual(stored.estimate.cost_cents);
      expect(moneyMentions(answer).length).toBeGreaterThan(0);
      expect(answer.label).toMatch(/\$/);
    });

    it("carries no dollar figure anywhere once the researcher is unpriced", async () => {
      const { rowCount } = await api.sql.query(
        `update ${SCHEMA_NAME}.model_aliases set model_id = $2
          where organization_id = $1 and alias = 'researcher-long-ctx'`,
        [seeded.workspace.id, UNPRICED_MODEL],
      );

      expect(rowCount).toBe(1);

      try {
        const estimate = await seeded
          .as(seeded.people.viewer, "post", "/api/v1/research/estimates")
          .send(deepDive());

        expect(estimate.status).toBe(200);
        expect(bodyOf<ScopeEstimateResource>(estimate).costCents).toBeNull();
        expect(moneyMentions(estimate.body)).toEqual([]);

        // The whole lifecycle on that estimate: the start's answer, the list's row and the detail.
        jest.spyOn(api.nest.get(EngineClient), "investigate").mockImplementation((request) =>
          Promise.resolve({
            investigation: request.investigation,
            task: `investigate:${request.investigation}`,
            state: "accepted",
            loopVersion: "loop-v1",
          }),
        );

        const started = await seeded.as(seeded.people.member, "post", BASE).send({
          question: "Is an unpriced researcher still honest?",
          kind: "gap_analysis",
          depth: "quick",
          tools: ["web"],
        });

        expect(started.status).toBe(201);
        // The one figure left is the measured spend meter, and it reads zero because no model
        // call has been made: measured, not estimated, and not a dollar.
        const meters = (payload: unknown): string[] =>
          moneyMentions(payload).filter((mention) => !/\.spendCents = 0$/.test(mention));

        expect(meters(started.body)).toEqual([]);

        const id = bodyOf<{ investigation: { id: string } }>(started).investigation.id;
        const detail = await seeded.as(seeded.people.viewer, "get", `${BASE}/${id}`).expect(200);
        const list = await seeded
          .as(seeded.people.viewer, "get", `${BASE}?status=active`)
          .expect(200);
        const row = bodyOf<{ items: { id: string }[] }>(list).items.find((item) => item.id === id);

        expect(meters(detail.body)).toEqual([]);
        expect(row).toBeDefined();
        expect(meters(row)).toEqual([]);
        expect(bodyOf<InvestigationDetailResource>(detail).estimate?.costCents ?? null).toBeNull();

        await seeded.as(seeded.people.member, "post", `${BASE}/${id}/cancel`).expect(200);
      } finally {
        await api.sql.query(
          `update ${SCHEMA_NAME}.model_aliases set model_id = 'claude-sonnet-4-6'
            where organization_id = $1 and alias = 'researcher-long-ctx'`,
          [seeded.workspace.id],
        );
      }
    });

    it("would notice a dollar figure anywhere in a payload", () => {
      // The assertion above means nothing unless this detector can fail: a label, a number under
      // a money key, deep in a list — each is found and named, and an honest null is not.
      expect(
        moneyMentions({
          estimate: { label: "~$6", sources: { min: 40, max: 60 } },
          rows: [{ actuals: { spendCents: 152 } }, { note: "about 19¢ of it" }],
          unpriced: { costCents: null, label: "est. 40–60 sources" },
        }),
      ).toEqual([
        '$.estimate.label: "~$6"',
        "$.rows[0].actuals.spendCents = 152",
        '$.rows[1].note: "about 19¢ of it"',
      ]);
    });
  });
});

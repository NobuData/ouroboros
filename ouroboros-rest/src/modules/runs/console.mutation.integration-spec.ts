import type request from "supertest";

import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { AWS_ACCESS_KEY_ID, GITHUB_PAT, STRIPE_SECRET_KEY } from "../guardrails/guardrails.fixture";
import { INGEST_ERRORS } from "../ingest/ingest.errors";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";

/**
 * **The three mechanisms whose removal must turn a named test red** — AP.6
 * ([#308](https://github.com/NobuData/ouroboros/issues/308)).
 *
 * > Disabling idempotency, the transition validator, or the evidence constraint each turns a
 * > specific, named test red.
 *
 * One `describe` per mechanism, named for it, so the mutation a reviewer performs and the test
 * that must fail are the same words. `ouroboros-rest/README.md` § *Console suites & mutation
 * checks* lists the three mutations and the result each produced when this suite landed.
 *
 *   * **idempotency** — `IngestService.replayed()` plus the receipt `commitReceipt()` records.
 *   * **the transition validator** — `canTransition()` in `ingest.transitions.ts`.
 *   * **the evidence constraint** — V048's `guardrail_evaluations_evidence_*` CHECKs.
 *
 * Each test asserts the *effect* the mechanism exists for, not the mechanism: a row count that
 * did not double, a stage that did not move, a credential the database would not hold. That is
 * what makes the test fail when the mechanism is taken away, whatever else still stands.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The simulator's credential. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

describe("mutation checks", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Call the internal channel as the simulator. */
  function internal(method: "post" | "put", path: string, body: object): request.Test {
    return api.anonymous(method, path).set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET).send(body);
  }

  /** A workspace with a mirrored ticket and a published workflow version. */
  async function bench(): Promise<IngestBench> {
    return seedIngestBench(api, await api.signUp());
  }

  /** Open a run under `key`. */
  async function open(seeded: IngestBench, key: string): Promise<RunOpenedResource> {
    return bodyOf<RunOpenedResource>(
      await internal("post", "/internal/runs", { idempotencyKey: key, ...seeded.open }).expect(201),
    );
  }

  /** Every table a write lands in, counted for one run. */
  async function rowsOf(run: string): Promise<Record<string, string>> {
    const { rows } = await api.sql.query<Record<string, string>>(
      `select (select count(*) from ${SCHEMA_NAME}.run_stages where run_id = $1)::text as stages,
              (select count(*) from ${SCHEMA_NAME}.run_events where run_id = $1)::text as events,
              (select count(*) from ${SCHEMA_NAME}.run_files where run_id = $1)::text as files,
              (select count(*) from ${SCHEMA_NAME}.guardrail_evaluations where run_id = $1)::text
                as verdicts,
              (select count(*) from ${SCHEMA_NAME}.run_commits where run_id = $1)::text as commits,
              (select count(*) from ${SCHEMA_NAME}.token_usage where run_id = $1)::text as usage`,
      [run],
    );

    return rows[0];
  }

  // -------------------------------------------------------------------------------------------
  describe("idempotency", () => {
    it("idempotency: a replayed write stores nothing twice and answers the first answer", async () => {
      const seeded = await bench();
      const run = await open(seeded, "open-1");
      const writes: [string, "post" | "put", string, object][] = [
        ["open", "post", "/internal/runs", { idempotencyKey: "open-1", ...seeded.open }],
        [
          "stage",
          "post",
          `/internal/runs/${run.id}/stage-transitions`,
          { idempotencyKey: "w", stageKey: "analyze", status: "active" },
        ],
        [
          "events",
          "post",
          `/internal/runs/${run.id}/events`,
          { idempotencyKey: "w", events: [{ hint: 1, actor: "system", body: "x" }] },
        ],
        [
          "files",
          "put",
          `/internal/runs/${run.id}/files`,
          { idempotencyKey: "w", files: [{ path: "a.c", status: "added", additions: 1 }] },
        ],
        [
          "commits",
          "post",
          `/internal/runs/${run.id}/commits`,
          {
            idempotencyKey: "w",
            commits: [{ sha: "a41c9e2", message: "m", committedAt: "2026-09-22T14:30:12.000Z" }],
          },
        ],
        [
          "resources",
          "post",
          `/internal/runs/${run.id}/resources`,
          {
            idempotencyKey: "w",
            spend: { provider: "anthropic", model: "m", tokensIn: 10, tokensOut: 2 },
          },
        ],
      ];

      const firsts: unknown[] = [bodyOf(await internal("post", "/internal/runs", writes[0][3]))];
      for (const [, method, path, body] of writes.slice(1)) {
        firsts.push(bodyOf(await internal(method, path, body).expect((r) => r.status < 300)));
      }
      const once = await rowsOf(run.id);

      // Every write again, sequentially and then twice concurrently — the executor's two
      // retries: the one after a lost answer and the one that raced the first.
      for (const [index, [name, method, path, body]] of writes.entries()) {
        const replays = [
          await internal(method, path, body),
          ...(await Promise.all([internal(method, path, body), internal(method, path, body)])),
        ];

        for (const replay of replays) {
          expect(`${name}: ${String(replay.status)}`).toBe(`${name}: ${index === 0 ? 201 : 200}`);
          expect(bodyOf(replay)).toEqual(firsts[index]);
        }
      }

      expect(await rowsOf(run.id)).toEqual(once);
      expect(once).toEqual({
        stages: "1",
        events: "1",
        files: "1",
        verdicts: "4",
        commits: "1",
        usage: "1",
      });

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count from ${SCHEMA_NAME}.runs where organization_id = $1`,
        [seeded.workspace.id],
      );
      expect(rows[0].count).toBe("1");
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("transition validator", () => {
    /**
     * Each illegal move, as the transitions that set it up and the one that must be refused.
     * Every status the machine has appears as a `from`, and both creations it forbids.
     */
    const ILLEGAL: readonly {
      readonly from: string | null;
      readonly setUp: readonly string[];
      readonly to: string;
    }[] = [
      { from: null, setUp: [], to: "succeeded" },
      { from: null, setUp: [], to: "failed" },
      { from: "pending", setUp: ["pending"], to: "succeeded" },
      { from: "pending", setUp: ["pending"], to: "failed" },
      { from: "active", setUp: ["active"], to: "pending" },
      { from: "active", setUp: ["active"], to: "skipped" },
      { from: "succeeded", setUp: ["active", "succeeded"], to: "failed" },
      { from: "failed", setUp: ["active", "failed"], to: "succeeded" },
      { from: "skipped", setUp: ["skipped"], to: "active" },
    ];

    it("transition validator: pending → succeeded and every other illegal move is refused, and the stage does not move", async () => {
      const seeded = await bench();

      for (const [index, { from, setUp, to }] of ILLEGAL.entries()) {
        const run = await open(seeded, `open-${String(index)}`);
        // Keys are unique per workspace and operation, not per run, so each case namespaces its own.
        const move = (key: string, status: string) =>
          internal("post", `/internal/runs/${run.id}/stage-transitions`, {
            idempotencyKey: `case-${String(index)}-${key}`,
            stageKey: "implement",
            status,
          });

        for (const [step, status] of setUp.entries()) {
          await move(`set-${String(step)}`, status).expect(200);
        }

        const refused = await move("illegal", to);
        const name = `${String(from)} → ${to}`;

        expect(`${name}: ${String(refused.status)}`).toBe(`${name}: 409`);
        expect(bodyOf<ErrorEnvelope>(refused)).toMatchObject({
          code: INGEST_ERRORS.stageTransitionInvalid,
          details: { stageKey: "implement", attempt: 1, from, to },
        });

        const { rows } = await api.sql.query<{ status: string }>(
          `select status from ${SCHEMA_NAME}.run_stages where run_id = $1 and stage_key = 'implement'`,
          [run.id],
        );
        expect(`${name}: ${JSON.stringify(rows.map((row) => row.status))}`).toBe(
          `${name}: ${JSON.stringify(from === null ? [] : [from])}`,
        );
      }
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("evidence constraint", () => {
    /** Write one verdict row straight to the table, past the service's own screening. */
    async function writeEvidence(run: string, evidence: unknown): Promise<unknown> {
      return api.sql
        .query(
          `insert into ${SCHEMA_NAME}.guardrail_evaluations
             (run_id, "check", verdict, evidence, ruleset_version, policy_ref, change_set_seq)
           values ($1, 'secrets', 'fail', $2::jsonb, 'v3', 1, 1)`,
          [run, JSON.stringify(evidence)],
        )
        .then(
          () => undefined,
          (error: unknown) => error,
        );
    }

    /** Places a writer could put a credential, one per row. */
    const PLANTED: readonly [string, Record<string, unknown>][] = [
      ["detail", { path: "drivers/can/keys.h", line: 1, detail: `matched ${AWS_ACCESS_KEY_ID}` }],
      ["path", { path: `config/${GITHUB_PAT}.env`, line: 1, rule_id: "github-pat" }],
      ["rule_id", { path: "drivers/can/keys.h", line: 1, rule_id: STRIPE_SECRET_KEY }],
      ["glob", { path: "drivers/can/keys.h", glob: `drivers/${AWS_ACCESS_KEY_ID}/**` }],
      ["an invented key", { path: "drivers/can/keys.h", line: 1, snippet: "k = 1" }],
      ["line", { path: "drivers/can/keys.h", line: AWS_ACCESS_KEY_ID }],
    ];

    it("evidence constraint: a credential written straight into evidence is refused by the database", async () => {
      const run = await open(await bench(), "open-1");

      // The positive control: the shape the service writes is accepted, so the refusals below
      // are about the credential and not about a malformed row.
      expect(
        await writeEvidence(run.id, {
          path: "drivers/can/keys.h",
          line: 1,
          rule_id: "aws-access-key-id",
          detail: "1 finding in 1 file.",
        }),
      ).toBeUndefined();

      for (const [where, evidence] of PLANTED) {
        const error = (await writeEvidence(run.id, evidence)) as
          { code?: string; constraint?: string } | undefined;

        expect(`${where}: ${String(error?.code)}`).toBe(`${where}: 23514`);
        expect(`${where}: ${String(error?.constraint)}`).toMatch(
          new RegExp(`^${where}: guardrail_evaluations_evidence_`),
        );
      }

      const { rows } = await api.sql.query<{ trace: string }>(
        `select evidence::text as trace from ${SCHEMA_NAME}.guardrail_evaluations where run_id = $1`,
        [run.id],
      );

      expect(rows).toHaveLength(1);
      for (const secret of [AWS_ACCESS_KEY_ID, GITHUB_PAT, STRIPE_SECRET_KEY]) {
        expect(rows[0].trace).not.toContain(secret);
      }
    });
  });
});

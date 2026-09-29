import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { routeTable } from "../auth/route.table.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { uploadBody } from "../farm/artifacts/upload.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { FlakeSummaryResource } from "../flakes/flakes.resources";
import type {
  TestRunPageResource,
  TestRunTimelineResource,
} from "../test-results-read/results.resources";
import {
  BUILDS,
  CORRECTION_NOTE,
  FLOOD_CASE,
  buildFiles,
  expectedCounts,
} from "./failing-hil.fixture";
import {
  FailingHilScenario,
  scenarioEnvironment,
  type FailingHilPlay,
} from "./failing-hil.scenario.fixture";

/**
 * The test plane end to end (AT.6, [#334](https://github.com/NobuData/ouroboros/issues/334)):
 * the `failing-HIL` scenario replayed on the real contracts, and every route the test-results
 * epic (#321) added answering `404` to another workspace.
 *
 *   * **The scenario** — Build 1 mass-fails, Build 2 is partial, a person classifies the overshoot
 *     a product bug with a note, the correction round reaches the executor and opens attempt 2,
 *     and Build 3 is green. Every result arrives through AT.2's upload path.
 *   * **Isolation** — the routes are enumerated from the application's own route table, so a
 *     route this epic adds later without a case here fails the enumeration rather than being
 *     skipped. Each is asked by a stranger holding a real session in a real workspace of their
 *     own, about the scenario's ids.
 *
 * One play serves the whole file: the scenario is the expensive part, and every case reads it
 * without writing anything another case reads.
 *
 * ```bash
 * yarn test:integration src/modules/test-plane
 * ```
 */

describe("the test plane", () => {
  let api: ApiHarness;
  let volume: string;
  let scenario: FailingHilScenario;
  let play: FailingHilPlay;

  beforeAll(async () => {
    volume = await mkdtemp(join(tmpdir(), "ouro-test-plane-"));
    api = await ApiHarness.start(scenarioEnvironment(volume));
    scenario = new FailingHilScenario(api);
    play = await scenario.play();
  });

  afterAll(async () => {
    scenario.drop();
    await api.truncate();
    await api.close();
    await rm(volume, { recursive: true, force: true });
  });

  /** A GET in the scenario's workspace, as its owner. */
  function owner(path: string) {
    return scenario.as(play.owner, play.bench, "get", path);
  }

  describe("the failing-HIL scenario", () => {
    it("reads 49/63 → 61/63 → 63/63 on the timeline the page renders", async () => {
      const timeline = bodyOf<TestRunTimelineResource>(
        await owner(`/api/v1/runs/${play.run.id}/test-runs`).expect(200),
      );

      expect(
        timeline.attempts.map((attempt) => [
          attempt.attemptSeq,
          attempt.commitSha?.slice(0, 7),
          attempt.strip.total,
          attempt.strip.passed,
          attempt.strip.failed,
          attempt.build?.jobId,
        ]),
      ).toEqual([
        [1, "a3f19c2", 63, 49, 14, play.builds[0].jobId],
        [2, "c81d4e7", 63, 61, 2, play.builds[1].jobId],
        [3, "f42b9a0", 63, 63, 0, play.builds[2].jobId],
      ]);
      expect(timeline.attempts.map((attempt) => attempt.strip.passedDelta)).toEqual([
        null,
        expect.objectContaining({ value: 12, versusAttemptSeq: 1 }),
        expect.objectContaining({ value: 2, versusAttemptSeq: 2 }),
      ]);
      expect(timeline.latestTestRunId).toBe(play.builds[2].testRunId);
      for (const [index, build] of play.builds.entries()) {
        expect(build.receipt.results).toMatchObject({ total: 63 });
        expect(expectedCounts(BUILDS[index]).total).toBe(63);
      }
    });

    it("composes the correction round: the note is the steer and the transcript, and attempt 2 opened", async () => {
      expect(play.classification.routing).toMatchObject({
        route: "correction_round",
        targetAttempt: 2,
      });
      expect(play.steer).toMatchObject({
        kind: "steer",
        payload: CORRECTION_NOTE,
        retryStage: true,
      });

      const { rows: entries } = await api.sql.query<{ body: string; attempt: number }>(
        `select body, attempt from ${SCHEMA_NAME}.run_events where run_id = $1 and actor = 'user'`,
        [play.run.id],
      );
      expect(entries).toEqual([{ body: CORRECTION_NOTE, attempt: 1 }]);

      const { rows: stages } = await api.sql.query<{ attempt: number; status: string }>(
        `select attempt, status from ${SCHEMA_NAME}.run_stages
          where run_id = $1 and stage_key = 'implement' order by attempt`,
        [play.run.id],
      );
      expect(stages).toEqual([
        { attempt: 1, status: "failed" },
        { attempt: 2, status: "succeeded" },
      ]);

      const { rows: classifications } = await api.sql.query<{ class: string; test_run_id: string }>(
        `select c.class, s.test_run_id from ${SCHEMA_NAME}.failure_classifications c
           join ${SCHEMA_NAME}.test_cases k on k.id = c.test_case_id
           join ${SCHEMA_NAME}.test_suites s on s.id = k.test_suite_id
          where c.organization_id = $1`,
        [play.bench.workspace.id],
      );
      expect(classifications).toEqual([
        { class: "product_bug", test_run_id: play.builds[1].testRunId },
      ]);
    });

    it("took every result through the upload path — a closed ledger and stored files per build", async () => {
      for (const build of play.builds) {
        const { rows: ledgers } = await api.sql.query<{
          closed_at: Date | null;
          test_run_id: string | null;
        }>(
          `select closed_at, test_run_id from ${SCHEMA_NAME}.build_job_artifact_uploads
            where build_job_id = $1`,
          [build.jobId],
        );
        expect(ledgers).toEqual([
          { closed_at: expect.any(Date) as unknown, test_run_id: build.testRunId },
        ]);

        const { rows: runs } = await api.sql.query<{ build_job_id: string; run_id: string }>(
          `select build_job_id, run_id from ${SCHEMA_NAME}.test_runs where id = $1`,
          [build.testRunId],
        );
        expect(runs).toEqual([{ build_job_id: build.jobId, run_id: play.run.id }]);
      }

      const page = bodyOf<TestRunPageResource>(
        await owner(`/api/v1/test-runs/${play.builds[1].testRunId}`).expect(200),
      );
      expect(
        page.artifacts.map((artifact) => [artifact.name, artifact.kind, artifact.state]),
      ).toEqual([
        ["junit-build2.xml", "junit", "available"],
        ["ouro-hil-results.json", "hil", "available"],
      ]);
      // The flood's comparative is composed from Build 1's stored measurement: "was 37".
      const flood = page.physical.find((kase) => kase.name === FLOOD_CASE);
      expect(flood?.measurements[0].comparative).toContain("37");
    });
  });

  describe("isolation", () => {
    let stranger: Person;
    let elsewhere: Workspace;

    beforeAll(async () => {
      stranger = await api.signUp();
      elsewhere = await api.workspace(stranger);
    });

    /** A request as the stranger, in their own workspace. */
    function asStranger(method: "get" | "post" | "put", path: string) {
      return api.as(stranger)(method, path).set(TENANT_HEADER, elsewhere.slug);
    }

    /** Build 2's overshoot case key. */
    async function overshootKey(): Promise<string> {
      const { rows } = await api.sql.query<{ case_key: string }>(
        `select case_key from ${SCHEMA_NAME}.test_cases where id = $1`,
        [play.overshootCaseId],
      );

      return rows[0].case_key;
    }

    /** One of the scenario's artifacts. */
    async function artifactId(): Promise<string> {
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ${SCHEMA_NAME}.test_artifacts where test_run_id = $1 order by name limit 1`,
        [play.builds[1].testRunId],
      );

      return rows[0].id;
    }

    /**
     * Every route of the epic, by signature: how to fill its path from the scenario, the body a
     * write sends, and the refusal code a stranger gets.
     */
    const CASES: Record<
      string,
      {
        path: () => string | Promise<string>;
        body?: object;
        code: string;
        /** Whether the owner can read it — the control that the path itself is right. */
        ownerReads: boolean;
      }
    > = {
      "GET /api/v1/runs/:id/test-runs": {
        path: () => `/api/v1/runs/${play.run.id}/test-runs`,
        code: "run_not_found",
        ownerReads: true,
      },
      "GET /api/v1/test-runs/:id": {
        path: () => `/api/v1/test-runs/${play.builds[1].testRunId}`,
        code: "test_run_not_found",
        ownerReads: true,
      },
      "GET /api/v1/test-runs/:id/cases/:caseId/failure": {
        path: () =>
          `/api/v1/test-runs/${play.builds[1].testRunId}/cases/${play.overshootCaseId}/failure`,
        code: "test_run_not_found",
        ownerReads: true,
      },
      "GET /api/v1/artifacts/:id": {
        path: async () => `/api/v1/artifacts/${await artifactId()}`,
        code: "artifact_not_found",
        ownerReads: true,
      },
      "GET /api/v1/test-runs/:id/hints": {
        path: () => `/api/v1/test-runs/${play.builds[1].testRunId}/hints`,
        code: "test_run_not_found",
        ownerReads: true,
      },
      "GET /api/v1/test-runs/:id/classifications": {
        path: () => `/api/v1/test-runs/${play.builds[1].testRunId}/classifications`,
        code: "test_run_not_found",
        ownerReads: true,
      },
      "POST /api/v1/test-runs/:id/cases/:caseId/classify": {
        path: () =>
          `/api/v1/test-runs/${play.builds[1].testRunId}/cases/${play.overshootCaseId}/classify`,
        body: { class: "infra_rig" },
        code: "test_run_not_found",
        ownerReads: false,
      },
      "GET /api/v1/test-runs/:id/rerun": {
        path: () => `/api/v1/test-runs/${play.builds[1].testRunId}/rerun`,
        code: "test_run_not_found",
        ownerReads: true,
      },
      "POST /api/v1/test-runs/:id/rerun": {
        path: () => `/api/v1/test-runs/${play.builds[1].testRunId}/rerun`,
        body: { scope: "failed" },
        code: "test_run_not_found",
        ownerReads: false,
      },
      "POST /api/v1/test-runs/:id/waivers": {
        path: () => `/api/v1/test-runs/${play.builds[1].testRunId}/waivers`,
        body: { reason: "a stranger's waiver" },
        code: "test_run_not_found",
        ownerReads: false,
      },
      "PUT /api/v1/runs/:id/pr-intents": {
        path: () => `/api/v1/runs/${play.run.id}/pr-intents`,
        body: { blockUntilGreen: true },
        code: "run_not_found",
        ownerReads: false,
      },
      "GET /api/v1/flakes/cases/:caseKey": {
        path: async () => `/api/v1/flakes/cases/${await overshootKey()}`,
        code: "flake_case_not_found",
        ownerReads: true,
      },
    };

    /**
     * The epic's routes the application registered: the test-results reads, the triage routes,
     * the flake reads and the upload.
     */
    function epicRoutes(): string[] {
      return routeTable(api.nest)
        .map((route) => route.signature)
        .filter((signature) =>
          /^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\/(test-runs|artifacts|flakes|runs\/:id\/test-runs|runs\/:id\/pr-intents|farm\/jobs\/:id\/artifacts)(\/|$)/.test(
            signature,
          ),
        );
    }

    it("has a case for every route the epic added — enumerated, not sampled", () => {
      expect(epicRoutes().sort()).toEqual(
        [
          ...Object.keys(CASES),
          "GET /api/v1/flakes/summary",
          "POST /api/v1/farm/jobs/:id/artifacts",
        ].sort(),
      );
    });

    it.each(Object.keys(CASES))("%s is a 404 to another workspace", async (signature) => {
      const entry = CASES[signature];
      const method = signature.startsWith("POST")
        ? "post"
        : signature.startsWith("PUT")
          ? "put"
          : "get";
      const path = await entry.path();

      if (entry.ownerReads) await owner(path).expect(200);

      const answer = await asStranger(method, path)
        .send(entry.body ?? {})
        .expect(404);
      expect(answer.body).toMatchObject({ code: entry.code });
    });

    it("writes nothing for a stranger's classify, re-run, waiver or toggle", async () => {
      const count = async (table: string) => {
        const { rows } = await api.sql.query<{ n: string }>(
          `select count(*)::text as n from ${SCHEMA_NAME}.${table} where organization_id = $1`,
          [play.bench.workspace.id],
        );
        return Number(rows[0].n);
      };

      expect({
        classifications: await count("failure_classifications"),
        jobs: await count("build_jobs"),
        waivers: await count("pr_waivers"),
        intents: await count("run_pr_intents"),
      }).toEqual({ classifications: 1, jobs: 3, waivers: 0, intents: 0 });
    });

    it("GET /api/v1/flakes/summary counts only the asker's workspace", async () => {
      // The scenario flakes nothing, so the owner's side is given one watched case to count.
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.flake_scores
           (organization_id, github_repo_id, case_key, score, window_runs, formula_version, state)
         values ($1, $2, $3, 0.5, 3, 1, 'watching')`,
        [play.bench.workspace.id, play.bench.workspace.repoId, await overshootKey()],
      );

      try {
        const mine = bodyOf<FlakeSummaryResource>(
          await owner("/api/v1/flakes/summary").expect(200),
        );
        const theirs = bodyOf<FlakeSummaryResource>(
          await asStranger("get", "/api/v1/flakes/summary").expect(200),
        );

        expect(mine).toMatchObject({ watching: 1 });
        expect(theirs).toMatchObject({ watching: 0, quarantined: 0, candidates: [] });
      } finally {
        await api.sql.query(`delete from ${SCHEMA_NAME}.flake_scores where organization_id = $1`, [
          play.bench.workspace.id,
        ]);
      }
    });

    it("POST /api/v1/farm/jobs/:id/artifacts names no workspace: anything but the job's own token is refused", async () => {
      // The upload is authenticated by the job's token, not a session (#330), so its refusal is
      // the token's `401` — the same answer for a stranger, a spent token and another job's.
      const body = uploadBody(buildFiles(BUILDS[0], 0));
      const path = `/api/v1/farm/jobs/${play.builds[0].jobId}/artifacts`;

      const refused = await api
        .as(stranger)("post", path)
        .set(TENANT_HEADER, elsewhere.slug)
        .set("content-type", body.contentType)
        .send(body.body)
        .expect(401);
      expect(refused.body).toMatchObject({ code: "farm_artifact_upload_refused" });

      const { rows } = await api.sql.query<{ n: string }>(
        `select count(*)::text as n from ${SCHEMA_NAME}.test_artifacts a
           join ${SCHEMA_NAME}.test_runs t on t.id = a.test_run_id
          where t.build_job_id = $1`,
        [play.builds[0].jobId],
      );
      expect(Number(rows[0].n)).toBe(2);
    });
  });
});

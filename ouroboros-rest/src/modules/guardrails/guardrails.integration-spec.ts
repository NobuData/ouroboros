import { Logger } from "@nestjs/common";

import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { ChangeSetResource, RunOpenedResource } from "../ingest/ingest.resources";
import type { GuardrailInput } from "./guardrails.checks";
import {
  AWS_ACCESS_KEY_ID,
  GITHUB_PAT,
  SLACK_BOT_TOKEN,
  STRIPE_SECRET_KEY,
} from "./guardrails.fixture";
import { MOCKUP_INPUT, RULE_MATRIX, type MatrixCell } from "./guardrails.matrix.fixture";

/**
 * Can a matrix cell be driven through the real API with the ingestion bench?
 *
 * The bench pins `standard-fix` (whose `implement` has `touch_ci: false` and whose terminal
 * auto-merges with no vote rule) and can give the run a plan or not, and hunks or not. A cell
 * whose input asks for any other stage permissions or review policy stays at the unit scale —
 * `guardrails.checks.spec.ts` runs all of them there.
 *
 * @param cell - A cell of {@link RULE_MATRIX}.
 * @returns Whether its input is one the bench can reproduce.
 */
function reachable(cell: MatrixCell): boolean {
  return (
    JSON.stringify(cell.input.permissions) === JSON.stringify(MOCKUP_INPUT.permissions) &&
    JSON.stringify(cell.input.review) === JSON.stringify(MOCKUP_INPUT.review)
  );
}

/**
 * A matrix input's change-set, as the body of `PUT /internal/runs/:id/files`.
 *
 * @param input - The cell's input.
 * @returns One reported file per scanned file, hunks carried through when the input has them.
 */
function asReport(input: GuardrailInput): unknown[] {
  return input.files.map((file) => ({
    path: file.path,
    status: "modified",
    additions: Math.max(
      1,
      (file.hunks ?? []).flatMap((hunk) => hunk.lines).filter((line) => line.kind === "add").length,
    ),
    ...(file.hunks === undefined ? {} : { hunks: file.hunks }),
  }));
}

/**
 * **The guardrail evaluation service, over a socket and against a migrated database** — AP.3
 * ([#305](https://github.com/NobuData/ouroboros/issues/305)).
 *
 * The acceptance criteria that exist only at this scale, because they are about what the
 * database holds after a real change-set report:
 *
 *   * a planted AWS access-key pattern fails `secrets` with rule-id and line evidence, and **no
 *     secret text is stored anywhere** — the verdict rows, the receipt, the audit trail and the
 *     logs are all searched for it;
 *   * a diff touching `.github/workflows/ci.yml` fails `ci_config` under `touch_ci: false`;
 *   * a path outside the pinned stage's scope fails `allowed_paths` naming the glob it violated;
 *   * `review_required` is `not_applicable` for `standard-fix` — the mockup's `○`;
 *   * re-evaluating a fixed change-set flips the latest verdict to `pass` while the failing
 *     evaluation remains in history.
 *
 * AP.6 ([#308](https://github.com/NobuData/ouroboros/issues/308)) adds:
 *
 *   * **the rule matrix end to end** — every cell of `guardrails.matrix.fixture.ts` the bench can
 *     reproduce, reported through the API and read back from the card's view;
 *   * **evidence hygiene, repeatedly** — several credential formats, reported more than once, and
 *     none of them anywhere afterwards;
 *   * **the ≤ 50 ms budget**, read from the service's own timing line.
 *
 * The whole matrix — including the cells that need a stage with `touch_ci: true` or a review
 * policy other than `standard-fix`'s — is `guardrails.checks.spec.ts`.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

describe("guardrail evaluation", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** Post as the executor. */
  function post(method: "post" | "put", path: string, body: unknown) {
    return api
      .anonymous(method, path)
      .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
      .send(body as object);
  }

  /**
   * A bench whose ticket is also a mirrored, estimated GitHub issue — so the run has a plan.
   *
   * The ingestion bench opens runs for a canonical ticket; the plan lives on the mirrored issue
   * the run's `(repository, number)` names, which is what the service reads.
   */
  async function plannedBench(files: readonly string[]): Promise<IngestBench> {
    const bench = await seedIngestBench(api, await api.signUp());

    // No plan files is no plan: the run's ticket is then not a mirrored, estimated issue.
    if (files.length === 0) {
      return bench;
    }
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_issues
              (organization_id, github_repo_id, number, title, body, state, labels,
               gh_created_at, gh_updated_at, gh_url, sizing_status)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', null, 'open', '[]'::jsonb,
               now(), now(), 'https://github.com/acme/helios/issues/482', 'sized')
       returning id`,
      [bench.workspace.id, bench.workspace.repoId],
    );

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.issue_estimates
              (github_issue_id, version, effort, confidence, suggested_workflow, routed_model,
               breakdown, risk, risk_note, trace)
       values ($1, 1, 's', 90, 'standard-fix', 'claude-fable-5', $2::jsonb, 'low', 'Small.',
               '{"estimator":"heuristic-v0","sized_at":"2026-09-16T15:00:00.000Z","tokens_used":0,"signals":[]}'::jsonb)`,
      [
        rows[0].id,
        JSON.stringify({ files, est_tokens: 1000, cycle_min: 5, cycle_max: 10, est_minutes: 20 }),
      ],
    );

    return bench;
  }

  /** Open a run and move it into `implement`, whose `touch_ci` is false. */
  async function implementingRun(bench: IngestBench): Promise<string> {
    const run = bodyOf<RunOpenedResource>(
      await post("post", "/internal/runs", { idempotencyKey: "open", ...bench.open }).expect(201),
    );

    await post("post", `/internal/runs/${run.id}/stage-transitions`, {
      idempotencyKey: "implement",
      stageKey: "implement",
      status: "active",
    }).expect(200);

    return run.id;
  }

  /** Report a change-set. */
  async function report(run: string, key: string, files: unknown[]): Promise<ChangeSetResource> {
    return bodyOf<ChangeSetResource>(
      await post("put", `/internal/runs/${run}/files`, { idempotencyKey: key, files }).expect(200),
    );
  }

  /** One added line as a hunk. */
  const added = (newStart: number, text: string) => [
    {
      newStart,
      lines: [
        { kind: "ctx", text: "/* context */" },
        { kind: "add", text },
      ],
    },
  ];

  /** The card's read: the latest verdict per check. */
  async function latest(
    run: string,
  ): Promise<Record<string, { verdict: string; evidence: unknown }>> {
    const { rows } = await api.sql.query<{ check: string; verdict: string; evidence: unknown }>(
      `select "check", verdict, evidence from ${SCHEMA_NAME}.v_run_guardrails_latest
        where run_id = $1`,
      [run],
    );

    return Object.fromEntries(
      rows.map((row) => [row.check, { verdict: row.verdict, evidence: row.evidence }]),
    );
  }

  it("fails secrets on a planted AWS key with rule and line — and stores the key nowhere", async () => {
    const logged: string[] = [];
    const spies = (["log", "debug", "warn", "error", "verbose", "fatal"] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => JSON.stringify(arg) ?? String(arg)).join(" "));
      }),
    );

    try {
      const bench = await plannedBench(["drivers/can/telemetry_buf.c"]);
      const run = await implementingRun(bench);

      const answer = await report(run, "files-1", [
        {
          path: "drivers/can/telemetry_buf.c",
          status: "modified",
          additions: 1,
          hunks: added(213, `static const char *k = "${AWS_ACCESS_KEY_ID}";`),
        },
      ]);

      expect(answer.guardrailFailures).toEqual(["secrets"]);
      expect(answer.needsHuman).toBe(true);
      expect((await latest(run)).secrets).toEqual({
        verdict: "fail",
        evidence: {
          path: "drivers/can/telemetry_buf.c",
          line: 214,
          rule_id: "aws-access-key-id",
          detail: "1 finding in 1 file.",
        },
      });

      // Every place the report could have left a trace: the verdicts, the change-set rows,
      // the receipt that makes the report idempotent, the transcript, and the audit trail.
      const traces = await api.sql.query<{ trace: string }>(
        `select row_to_json(g)::text as trace from ${SCHEMA_NAME}.guardrail_evaluations g
          union all select row_to_json(f)::text from ${SCHEMA_NAME}.run_files f
          union all select row_to_json(r)::text from ${SCHEMA_NAME}.run_ingest_receipts r
          union all select row_to_json(e)::text from ${SCHEMA_NAME}.run_events e
          union all select row_to_json(a)::text from ${SCHEMA_NAME}.audit_events a`,
      );

      expect(traces.rows.length).toBeGreaterThan(0);

      for (const { trace } of traces.rows) {
        expect(trace).not.toContain(AWS_ACCESS_KEY_ID);
      }

      expect(logged.join("\n")).not.toContain(AWS_ACCESS_KEY_ID);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("fails ci_config when a workflow file is touched and the stage's touch_ci is false", async () => {
    const run = await implementingRun(await plannedBench(["drivers/can/telemetry_buf.c"]));

    const answer = await report(run, "files-1", [
      { path: "drivers/can/telemetry_buf.c", status: "modified", additions: 1 },
      { path: ".github/workflows/ci.yml", status: "modified", additions: 1 },
    ]);

    expect(answer.guardrailFailures).toContain("ci_config");
    expect((await latest(run)).ci_config).toEqual({
      verdict: "fail",
      evidence: {
        path: ".github/workflows/ci.yml",
        glob: ".github/workflows/**",
        detail: "1 CI file touched while touch_ci is false on stage implement.",
      },
    });
  });

  it("fails allowed_paths for a path outside the plan's scope, naming the glob it violated", async () => {
    const run = await implementingRun(await plannedBench(["drivers/can/telemetry_buf.c"]));

    await report(run, "files-1", [
      { path: "drivers/can/telemetry_buf.c", status: "modified", additions: 1 },
      { path: "drivers/spi/bus.c", status: "modified", additions: 1 },
    ]);

    expect((await latest(run)).allowed_paths).toEqual({
      verdict: "fail",
      evidence: {
        path: "drivers/spi/bus.c",
        glob: "drivers/can/**",
        detail: "1 path outside the declared scope.",
      },
    });
  });

  it("draws the mockup's card for a clean change-set: three passes and the ○, policy v1", async () => {
    const run = await implementingRun(await plannedBench(["drivers/can/telemetry_buf.c"]));

    const answer = await report(run, "files-1", [
      {
        path: "drivers/can/telemetry_buf.c",
        status: "modified",
        additions: 1,
        hunks: added(40, "k_msgq_put(&tel_msgq, tx_frame, K_NO_WAIT);"),
      },
    ]);

    expect(answer).toMatchObject({ guardrailChecks: 4, guardrailFailures: [], needsHuman: false });

    const { rows } = await api.sql.query<{
      check: string;
      verdict: string;
      ruleset_version: string | null;
      policy_ref: number;
    }>(
      `select "check", verdict, ruleset_version, policy_ref
         from ${SCHEMA_NAME}.v_run_guardrails_latest where run_id = $1 order by "check"`,
      [run],
    );

    expect(rows).toEqual([
      { check: "allowed_paths", verdict: "pass", ruleset_version: null, policy_ref: 1 },
      { check: "ci_config", verdict: "pass", ruleset_version: "ci-v1", policy_ref: 1 },
      { check: "review_required", verdict: "not_applicable", ruleset_version: null, policy_ref: 1 },
      { check: "secrets", verdict: "pass", ruleset_version: "v3", policy_ref: 1 },
    ]);
  });

  it("flips the latest verdict to pass on a fixed change-set, keeping the failure in history", async () => {
    const run = await implementingRun(await plannedBench(["drivers/can/telemetry_buf.c"]));
    const file = (text: string) => ({
      path: "drivers/can/telemetry_buf.c",
      status: "modified",
      additions: 1,
      hunks: added(10, text),
    });

    const failing = await report(run, "files-1", [file(`key = "${AWS_ACCESS_KEY_ID}"`)]);
    const fixed = await report(run, "files-2", [file('key = getenv("AWS_ACCESS_KEY_ID")')]);

    expect(failing.needsHuman).toBe(true);
    expect(fixed.needsHuman).toBe(false);
    expect((await latest(run)).secrets.verdict).toBe("pass");

    const { rows } = await api.sql.query<{ verdict: string; change_set_seq: number }>(
      `select verdict, change_set_seq from ${SCHEMA_NAME}.guardrail_evaluations
        where run_id = $1 and "check" = 'secrets' order by change_set_seq`,
      [run],
    );

    expect(rows).toEqual([
      { verdict: "fail", change_set_seq: 1 },
      { verdict: "pass", change_set_seq: 2 },
    ]);
  });

  /** Spy on every Logger level, collecting what is written. */
  function captureLogs(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const spies = (["log", "debug", "warn", "error", "verbose", "fatal"] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => JSON.stringify(arg) ?? String(arg)).join(" "));
      }),
    );

    return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
  }

  describe("the rule matrix, end to end (AP.6)", () => {
    const cells = RULE_MATRIX.filter(reachable);

    it("reaches every check, and every verdict each check can reach with this policy", () => {
      expect([...new Set(cells.map((cell) => `${cell.check}:${cell.verdict}`))].sort()).toEqual([
        "allowed_paths:fail",
        "allowed_paths:not_applicable",
        "allowed_paths:pass",
        "ci_config:fail",
        "ci_config:pass",
        "review_required:not_applicable",
        "secrets:fail",
        "secrets:not_applicable",
        "secrets:pass",
      ]);
    });

    it.each(cells.map((cell) => [cell.check, cell.verdict, cell.because, cell] as const))(
      "%s → %s when %s",
      async (check, verdict, _because, cell) => {
        const run = await implementingRun(await plannedBench(cell.input.planFiles ?? []));

        const answer = await report(run, "files-1", asReport(cell.input));
        const card = await latest(run);

        expect(card[check].verdict).toBe(verdict);
        // A `fail` must reach the executor as well as the card — the loud half of the verdict.
        expect(answer.guardrailFailures.includes(check)).toBe(verdict === "fail");

        if (cell.evidence !== undefined) {
          expect(card[check].evidence).toEqual(cell.evidence);
        }
      },
    );
  });

  it("stores no credential of any format, however many times one is reported (AP.6)", async () => {
    const planted = [AWS_ACCESS_KEY_ID, GITHUB_PAT, SLACK_BOT_TOKEN, STRIPE_SECRET_KEY];
    const logs = captureLogs();

    try {
      const run = await implementingRun(await plannedBench(["drivers/can/telemetry_buf.c"]));

      // Three reports, each planting every format: the same temptation, recurring.
      for (const round of [1, 2, 3]) {
        const answer = await report(
          run,
          `files-${String(round)}`,
          planted.map((secret, index) => ({
            path: `drivers/can/keys_${String(index)}.h`,
            status: "added",
            additions: 1,
            hunks: added(round * 10, `#define KEY_${String(index)} "${secret}"`),
          })),
        );

        expect(answer.guardrailFailures).toContain("secrets");
      }

      expect((await latest(run)).secrets.verdict).toBe("fail");

      const traces = await api.sql.query<{ trace: string }>(
        `select row_to_json(g)::text as trace from ${SCHEMA_NAME}.guardrail_evaluations g
          union all select row_to_json(f)::text from ${SCHEMA_NAME}.run_files f
          union all select row_to_json(r)::text from ${SCHEMA_NAME}.run_ingest_receipts r
          union all select row_to_json(e)::text from ${SCHEMA_NAME}.run_events e
          union all select row_to_json(a)::text from ${SCHEMA_NAME}.audit_events a`,
      );
      const stored = traces.rows.map((row) => row.trace).join("\n");
      const logged = logs.lines.join("\n");

      // Twelve verdict rows at least: three reports of four checks.
      expect(traces.rows.length).toBeGreaterThanOrEqual(12);

      for (const secret of planted) {
        expect(stored).not.toContain(secret);
        expect(logged).not.toContain(secret);
      }
    } finally {
      logs.restore();
    }
  });

  it("judges the mockup's change-set within the 50 ms budget, as the service times it (AP.6)", async () => {
    const logs = captureLogs();

    try {
      const run = await implementingRun(await plannedBench(MOCKUP_INPUT.planFiles ?? []));

      await report(run, "files-1", asReport(MOCKUP_INPUT));

      const timings = logs.lines
        .map((line) => /change-set \d+: .* in ([\d.]+) ms/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => Number(match[1]));

      expect(timings).toHaveLength(1);
      expect(timings[0]).toBeLessThanOrEqual(50);
    } finally {
      logs.restore();
    }
  });
});

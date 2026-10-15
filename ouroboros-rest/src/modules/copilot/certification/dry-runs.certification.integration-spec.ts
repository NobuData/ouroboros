/**
 * Copilot certification — what this service does with a dry run (CD.6,
 * [#564](https://github.com/NobuData/ouroboros/issues/564)).
 *
 * The harness is the engine's, and the engine's own suite proves that each forbidden capability
 * is blocked inside it. This suite certifies the other side of the wire — that nothing a dry run
 * reports can be recorded as anything but what it was, and that a dry run reaches nothing that is
 * not a dry run's:
 *
 *   * **The guard matrix.** For every capability the harness description forbids and every
 *     guard it names — read from the engine's committed description, never listed here — a run
 *     whose result carries one blocked call is recorded `failed`, with the audit stored and
 *     served exactly as sent, relayed as `guard_blocked`, and with no suggestion computed; and
 *     no table of the workspace other than the dry run's own changed by a row or a byte.
 *   * **The safety strip.** Every column holds for the committed harness, and stops holding the
 *     moment the mechanism behind it is taken out of the description.
 *   * **The overlay diff.** Stored and served byte for byte, truncation carried, and found in
 *     no other table.
 *   * **Dry run ⟂ run.** After complete, failed and budget-stopped dry runs, every run
 *     read-model and metric answers what it answered before; the dry runs' cost is on the
 *     dry-run history and nowhere else.
 *   * **The budget.** The harness is sent the workspace's cap, or the draft's own spend guard
 *     when that is tighter.
 */

import { SCHEMA_NAME } from "../../db/schema";
import type { DryRunHistoryResource, DryRunResource } from "../../dry-runs/dry-runs.resources";
import { DryRunRunner } from "../../dry-runs/dry-runs.runner";
import { safetyStrip, type DryRunSafetyResource } from "../../dry-runs/dry-runs.safety";
import type { DryRunStreamEvent } from "../../dry-runs/dry-runs.stream";
import { EngineClient } from "../../engine/engine.client";
import { engineDryRunHarnessSchema, type EngineDryRunHarness } from "../../engine/engine.dryruns";
import {
  IMPLEMENT_NODE,
  PINNED,
  eventsOf,
  startCopilotStage,
  type CopilotStage,
  type StagedWorkflow,
} from "./certification.fixture";
import {
  DRY_RUN_TABLES,
  called,
  chain,
  changedTables,
  drafted,
  dryRunTables,
  dryRunsPath,
  footprint,
  holding,
  modelStage,
  ran,
  suggestionsOf,
  watchedTables,
  type DraftEdge,
  type DraftNode,
  type TableState,
  type WatchedTable,
} from "./dry-run-plane.fixture";
import {
  harnessExample,
  runOf,
  stage as row,
  type WireEvent,
  type WireRequest,
} from "./scripted-engine.fixture";

/** The harness description the engine commits to, in the engine's names. */
const DESCRIBED = harnessExample() as {
  guards: { name: string; refuses: string }[];
  forbidden_capabilities: string[];
  tools: { name: string; effect: string }[];
};

/** One blocked call, as the harness audits it. */
interface AuditEntry {
  readonly guard: string;
  readonly call: string;
  readonly count: number;
  readonly stage_key: string | null;
}

/** One row of the guard matrix: what was attempted, and the audit entry the harness reports. */
interface GuardRow {
  readonly subject: string;
  readonly entry: AuditEntry;
}

/**
 * The matrix, from the description itself: every forbidden capability attempted against the
 * allow-list (the guard that decides which tools exist), and every guard holding once — with a
 * stage and without one, more than once and once.
 */
const GUARD_ROWS: readonly GuardRow[] = [
  ...DESCRIBED.forbidden_capabilities.map((capability, index): GuardRow => ({
    subject: `capability ${capability}`,
    entry: {
      guard: DESCRIBED.guards[0].name,
      call: capability,
      count: index + 1,
      stage_key: index % 2 === 0 ? "implement" : null,
    },
  })),
  ...DESCRIBED.guards.map((guard): GuardRow => ({
    subject: `guard ${guard.name}`,
    entry: {
      guard: guard.name,
      call: `refused-by-${guard.name}`,
      count: 1,
      stage_key: "cve-check",
    },
  })),
];

/**
 * Tables the requests themselves write, whatever they ask for: the sign-in library keeps each
 * caller's `session` row fresh as it is used.
 */
const REQUEST_BOOKKEEPING: readonly string[] = ["session"];

/** A stage skipped with nothing to do — on a clean run, the row a suggestion is filed for. */
const SKIPPED_ROW = row(2, "cve-check", {
  verdict: "skipped",
  how: "skipped",
  note: "skipped",
  skip_reason: "no CVE reference in the ticket",
  skip_kind: "nothing_to_do",
  skip_input: "cve",
});

/**
 * A run the harness reports as complete, whatever its audit says.
 *
 * @param audit - The blocked calls it reports.
 * @returns The script.
 */
function reportedComplete(audit: readonly AuditEntry[]) {
  return (request: WireRequest): WireEvent[] =>
    runOf(request, [row(1, "implement"), SKIPPED_ROW], {
      status: "complete",
      guard_audit: audit,
      guards_clean: audit.length === 0,
    });
}

/** A unified diff no formatter would leave alone: tabs, CRLF, no final newline, non-ASCII. */
const OVERLAY_MARKER = "certification-overlay-7f3a91c2";
const OVERLAY_DIFF = [
  "--- a/drivers/can/arbitration.c",
  "+++ b/drivers/can/arbitration.c",
  "@@ -41,3 +41,4 @@",
  " \tint lost = 0;  ",
  "-\treturn lost;\r",
  `+\t/* ${OVERLAY_MARKER} — ±1 retry, “quoted” */`,
  "+\treturn lost > 0 ? -EAGAIN : 0;",
  "\\ No newline at end of file",
].join("\n");

/** What the diff touched, as the harness summarises it. */
const OVERLAY_PATHS = [{ path: "drivers/can/arbitration.c", added: 2, removed: 1 }];

/** A plan excerpt the harness cut short. */
const PLAN_EXCERPT = "1. Count arbitration-lost interrupts.\n2. Back off after the third";

/** The reads a run, a queue, a dashboard or a metric is served from. */
const RUN_READS = [
  "/api/v1/runs?status=active",
  "/api/v1/runs?status=terminal",
  "/api/v1/queue",
  "/api/v1/dashboard",
  "/api/v1/insights",
  "/api/v1/insights?range=7d",
  "/api/v1/insights/interventions",
  "/api/v1/routing",
  "/api/v1/routing/spend",
] as const;

/** The fields of a read that say when it was read, not what it read. */
const CLOCKS: readonly string[] = ["generatedAt", "asOf", "now", "serverTime", "elapsedSeconds"];

/**
 * A response body without the fields that only say when it was read.
 *
 * @param value - The body.
 * @returns The body, less every one of {@link CLOCKS} — a running run's `elapsedSeconds` is
 *   the one the seeded reads actually carry.
 */
function withoutClocks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutClocks);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !CLOCKS.includes(key))
      .map(([key, inner]) => [key, withoutClocks(inner)]),
  );
}

describe("copilot certification — the guard audit, the overlay and dry-run isolation (#564)", () => {
  let stage: CopilotStage;
  let serial = 0;
  /** Every table of the schema other than a dry run's own (and the callers' sessions). */
  let others: WatchedTable[];
  /** Every stray engine call of the suite; the engine forgets its own before each test. */
  const strays: string[] = [];
  /** Every event a runner relayed to its subscribers, by dry run. */
  const relayed = new Map<string, DryRunStreamEvent[]>();

  beforeAll(async () => {
    stage = await startCopilotStage();
    others = await watchedTables(stage, [...DRY_RUN_TABLES, ...REQUEST_BOOKKEEPING]);
  });

  afterAll(async () => {
    await stage.close();
  });

  beforeEach(() => {
    stage.engine.reset();

    // Observe — not replace — what the runner relays: the scripted harness answers at once, so
    // a subscriber arriving over HTTP would only ever be replayed the record.
    const emit = (
      DryRunRunner.prototype as unknown as {
        emit(live: { events: DryRunStreamEvent[] }, event: DryRunStreamEvent): void;
      }
    ).emit;
    jest
      .spyOn(DryRunRunner.prototype as unknown as { emit: typeof emit }, "emit")
      .mockImplementation(function relay(this: DryRunRunner, live, event) {
        emit.call(this, live, event);
        const [first] = live.events;
        if (first.kind === "accepted") relayed.set(first.dryRun.id, [...live.events]);
      });
  });

  afterEach(() => {
    strays.push(...stage.engine.strays);
  });

  /** A workflow of this suite: implement, then a CVE check, then a person. */
  function workflow(): Promise<StagedWorkflow> {
    serial += 1;

    return drafted(
      stage,
      `Cert dry runs ${String(serial)}`,
      chain(IMPLEMENT_NODE, modelStage("cve-check", 560)),
    );
  }

  describe("the guard matrix", () => {
    let subject: StagedWorkflow;
    let before: Record<string, TableState>;
    const failed: DryRunResource[] = [];

    beforeAll(async () => {
      subject = await workflow();
      before = await footprint(stage, others);
    });

    it("is drawn from the harness description: every forbidden capability and every guard has a row", () => {
      const parsed = engineDryRunHarnessSchema.parse(DESCRIBED);

      expect(parsed.forbiddenCapabilities.length).toBeGreaterThan(0);
      expect(parsed.guards.length).toBeGreaterThan(0);
      expect(GUARD_ROWS.map((entry) => entry.subject).sort()).toEqual(
        [
          ...parsed.forbiddenCapabilities.map((capability) => `capability ${capability}`),
          ...parsed.guards.map((guard) => `guard ${guard.name}`),
        ].sort(),
      );
      // The capabilities the issue names as absent are among them.
      expect(parsed.forbiddenCapabilities).toEqual(
        expect.arrayContaining([
          "repository_write",
          "pull_request",
          "farm_dispatch",
          "ticket_source_write",
          "credential_access",
        ]),
      );
    });

    it.each(GUARD_ROWS.map((entry) => [entry.subject, entry] as const))(
      "%s: a blocked call fails the run, is stored and served as sent, and computes no suggestion",
      async (_subject, { entry }) => {
        // The harness itself calls the run complete: the rule is this service's to enforce.
        stage.engine.scriptRun(reportedComplete([entry]));

        const run = await ran(stage, subject.id);
        failed.push(run);
        const served = { guard: entry.guard, call: entry.call, count: entry.count };
        const audit = [
          entry.stage_key === null ? served : { ...served, stage_key: entry.stage_key },
        ];

        expect(run.status).toBe("failed");
        expect(run.guardsClean).toBe(false);
        expect(run.guardAudit).toEqual(audit);
        expect(run.failureReason).toContain(
          `refused ${String(entry.count)} call${entry.count === 1 ? "" : "s"}`,
        );

        // Stored as sent — the record, not a rendering of it.
        const stored = await stage.one<{
          status: string;
          guard_audit: unknown;
          guards_clean: boolean;
        }>(`select status, guard_audit, guards_clean from ${SCHEMA_NAME}.dry_runs where id = $1`, [
          run.id,
        ]);
        expect(stored).toEqual({ status: "failed", guard_audit: audit, guards_clean: false });

        // Relayed while it ran: the blocked call, then a `done` that says failed.
        const live = relayed.get(run.id) ?? [];
        expect(live.filter((event) => event.kind === "guard_blocked")).toEqual([
          {
            kind: "guard_blocked",
            guard: entry.guard,
            call: entry.call,
            stageKey: entry.stage_key ?? "",
          },
        ]);
        expect(live.at(-1)).toMatchObject({
          kind: "done",
          dryRun: { id: run.id, status: "failed", guardsClean: false, guardAudit: audit },
        });

        // And to whoever asks afterwards, from the record.
        const replayed = eventsOf(
          (
            await stage
              .as(stage.people.viewer, "get", dryRunsPath(subject.id, `/${run.id}/events`))
              .expect(200)
          ).text,
        ) as unknown as DryRunStreamEvent[];
        expect(replayed.at(-1)).toMatchObject({
          kind: "done",
          dryRun: { status: "failed", guardAudit: audit },
        });

        // A run whose guards had to hold is not reasoned about: no rule ran over its rows.
        expect(run.stages.map((entry_) => entry_.skipKind)).toContain("nothing_to_do");
        expect(await suggestionsOf(stage, subject.id, run.id)).toEqual([]);
      },
    );

    it("fails a run for its audit alone: the same result with nothing blocked completes, and is reasoned about", async () => {
      stage.engine.scriptRun(reportedComplete([]));

      const run = await ran(stage, subject.id);

      expect(run).toMatchObject({
        status: "complete",
        guardsClean: true,
        guardAudit: [],
        failureReason: null,
      });
      expect((await suggestionsOf(stage, subject.id, run.id)).map((entry) => entry.ruleId)).toEqual(
        ["skipped-nothing-to-do"],
      );
    });

    it("lists the failed runs in the history as not clean, each once", async () => {
      const history = (
        await stage.as(stage.people.viewer, "get", dryRunsPath(subject.id)).expect(200)
      ).body as DryRunHistoryResource;
      const byId = new Map(history.runs.map((entry) => [entry.id, entry]));

      expect(failed).toHaveLength(GUARD_ROWS.length);
      expect(history.count).toBe(GUARD_ROWS.length + 1);
      for (const run of failed) {
        expect(byId.get(run.id)).toMatchObject({ status: "failed", guardsClean: false });
      }
    });

    it("changed no table of the workspace but the dry run's own — not by a row, not by a byte", async () => {
      // The matrix did write: that is what makes an unchanged footprint mean something.
      const written = await footprint(stage, dryRunTables());
      expect(written.dry_runs.rows).toBeGreaterThanOrEqual(GUARD_ROWS.length + 1);
      expect(others.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          "tickets",
          "runs",
          "run_events",
          "pull_requests",
          "build_jobs",
          "workflows",
          "workflow_versions",
          "draft_operations",
        ]),
      );

      expect(changedTables(before, await footprint(stage, others))).toEqual([]);
    });

    it("sent the read credential to the harness and kept it out of every record and answer", async () => {
      stage.engine.scriptRun(reportedComplete([]));
      const run = await ran(stage, subject.id);
      const [request] = stage.engine.runs;

      // In the request, for this request…
      expect(request.repository).toEqual({
        slug: PINNED.slug,
        pinned_sha: PINNED.sha,
        token: PINNED.token,
      });
      // …and nowhere the workspace keeps anything, the dry run's own tables included.
      expect(await holding(stage, PINNED.token, [...dryRunTables(), ...others])).toEqual([]);
      // The control: the same search does find what a dry run stores.
      expect(await holding(stage, PINNED.sha, dryRunTables())).toEqual(["dry_runs"]);

      const answers = await Promise.all(
        ["", `/${run.id}`, `/${run.id}/events`, `/${run.id}/suggestions`, "/safety"].map((rest) =>
          stage.as(stage.people.owner, "get", dryRunsPath(subject.id, rest)).expect(200),
        ),
      );
      for (const answer of answers) expect(answer.text).not.toContain(PINNED.token);
    });

    it("lets a member start a dry run and a viewer only read one", async () => {
      const ticketId = await stage.ticket();
      const { draftRev } = await stage.draft(subject.id);

      await stage
        .as(stage.people.viewer, "post", dryRunsPath(subject.id))
        .send({ ticketId, draftRev })
        .expect(403);
      expect(stage.engine.runs).toEqual([]);

      stage.engine.scriptRun(reportedComplete([]));
      const started = await stage
        .as(stage.people.member, "post", dryRunsPath(subject.id))
        .send({ ticketId, draftRev })
        .expect(201);
      const { id } = started.body as DryRunResource;
      await stage.api.nest.get(DryRunRunner).settled(id);

      const read = await stage
        .as(stage.people.viewer, "get", dryRunsPath(subject.id, `/${id}`))
        .expect(200);
      expect((read.body as DryRunResource).status).toBe("complete");
    });
  });

  describe("the safety strip", () => {
    const committed = engineDryRunHarnessSchema.parse(DESCRIBED);

    /** The ids of the columns a description leaves not holding. */
    const broken = (harness: EngineDryRunHarness): string[] =>
      safetyStrip(harness)
        .columns.filter((column) => !column.holds)
        .map((column) => column.id);

    /** The description without the tools of one effect. */
    const withoutEffect = (effect: string): EngineDryRunHarness => ({
      ...committed,
      tools: committed.tools.filter((tool) => tool.effect !== effect),
    });

    /** The description without one forbidden capability. */
    const permitting = (capability: string): EngineDryRunHarness => ({
      ...committed,
      forbiddenCapabilities: committed.forbiddenCapabilities.filter((name) => name !== capability),
    });

    it("says every column holds for the committed harness, each on the mechanism the description names", async () => {
      const subject = await workflow();
      const strip = (
        await stage.as(stage.people.viewer, "get", dryRunsPath(subject.id, "/safety")).expect(200)
      ).body as DryRunSafetyResource;
      const toolsOf = (effect: string) =>
        DESCRIBED.tools.filter((tool) => tool.effect === effect).map((tool) => tool.name);

      expect(strip.columns.map((column) => [column.id, column.holds])).toEqual([
        ["simulated_writes", true],
        ["replayed_infra", true],
        ["real_models", true],
      ]);
      expect(strip.columns[0].mechanism).toMatchObject({
        kind: "overlay",
        tools: toolsOf("simulated_write"),
      });
      expect(strip.columns[1].mechanism).toMatchObject({
        kind: "estimator_service",
        tools: toolsOf("replay"),
      });
      expect(strip.columns[2].mechanism.kind).toBe("gateway_routing");
      // The guards are the description's, word for word; each pill claim rests on a capability
      // the description forbids.
      expect(strip.guards).toEqual(DESCRIBED.guards);
      expect(strip.absent.map((entry) => entry.claim)).toEqual([
        "no writes",
        "no PRs",
        "no merges",
      ]);
      for (const entry of strip.absent) {
        expect(DESCRIBED.forbidden_capabilities).toContain(entry.capability);
      }
      expect(strip.blockedCallFailsRun).toBe(true);
      // Derived here, from the description: the strip the route served is the pure function's.
      expect(strip).toEqual(JSON.parse(JSON.stringify(safetyStrip(committed))));
    });

    it.each([
      ["no tool writes to the overlay", withoutEffect("simulated_write"), ["simulated_writes"]],
      [
        "writes land somewhere other than memory",
        { ...committed, writes: "repository" },
        ["simulated_writes"],
      ],
      ["a repository write is not forbidden", permitting("repository_write"), ["simulated_writes"]],
      [
        "the allow-list guard is gone",
        { ...committed, guards: committed.guards.filter((guard) => guard.name !== "allow_list") },
        ["simulated_writes"],
      ],
      ["no guard is left at all", { ...committed, guards: [] }, ["simulated_writes"]],
      ["no tool replays history", withoutEffect("replay"), ["replayed_infra"]],
      [
        "estimates come from somewhere else",
        { ...committed, replayEstimatesPath: "/internal/builds" },
        ["replayed_infra"],
      ],
      ["a farm dispatch is not forbidden", permitting("farm_dispatch"), ["replayed_infra"]],
      [
        "model calls bypass the invocation gateway",
        { ...committed, invokePath: "https://api.provider.example/v1/messages" },
        ["real_models"],
      ],
      ["credentials are not forbidden", permitting("credential_access"), ["real_models"]],
    ] as const)("stops saying a column holds when %s", (_what, doctored, columns) => {
      expect(broken(committed)).toEqual([]);
      expect(broken(doctored)).toEqual(columns);
    });

    it("drops a pill claim with the capability that backed it", () => {
      expect(safetyStrip(permitting("pull_request")).absent.map((entry) => entry.claim)).toEqual([
        "no writes",
      ]);
      expect(
        safetyStrip(permitting("repository_write")).absent.map((entry) => entry.claim),
      ).toEqual(["no PRs", "no merges"]);
    });

    it("refuses a description whose tool has an effect outside read, simulated write and replay", () => {
      const [first, ...rest] = DESCRIBED.tools;

      expect(engineDryRunHarnessSchema.safeParse(DESCRIBED).success).toBe(true);
      expect(
        engineDryRunHarnessSchema.safeParse({
          ...DESCRIBED,
          tools: [{ ...first, effect: "write" }, ...rest],
        }).success,
      ).toBe(false);
    });

    it("serves what the installed harness describes — a harness without its overlay is served as not holding", async () => {
      const subject = await workflow();
      jest
        .spyOn(stage.api.nest.get(EngineClient), "dryRunHarness")
        .mockResolvedValueOnce(withoutEffect("simulated_write"));

      const strip = (
        await stage.as(stage.people.viewer, "get", dryRunsPath(subject.id, "/safety")).expect(200)
      ).body as DryRunSafetyResource;

      expect(strip.columns.map((column) => [column.id, column.holds])).toEqual([
        ["simulated_writes", false],
        ["replayed_infra", true],
        ["real_models", true],
      ]);
    });
  });

  describe("the overlay diff", () => {
    it("is stored and served byte for byte, truncation carried, and reaches no other table", async () => {
      const subject = await workflow();
      const before = await footprint(stage, others);
      const excerptBytes = Buffer.byteLength(PLAN_EXCERPT, "utf8");

      stage.engine.scriptRun((request) =>
        runOf(
          request,
          [
            row(1, "implement", {
              metrics: { files_touched: 1, lines_added: 2, lines_removed: 1 },
            }),
          ],
          {
            artifacts: [
              {
                kind: "overlay_diff",
                content: OVERLAY_DIFF,
                truncated: false,
                original_bytes: Buffer.byteLength(OVERLAY_DIFF, "utf8"),
                path_summary: OVERLAY_PATHS,
              },
              {
                kind: "plan_excerpt",
                content: PLAN_EXCERPT,
                truncated: true,
                original_bytes: excerptBytes + 4096,
              },
            ],
          },
        ),
      );

      const run = await ran(stage, subject.id);

      expect(run.status).toBe("complete");
      expect(run.artifacts).toEqual([
        {
          kind: "overlay_diff",
          content: OVERLAY_DIFF,
          truncated: false,
          originalBytes: Buffer.byteLength(OVERLAY_DIFF, "utf8"),
          pathSummary: OVERLAY_PATHS,
        },
        {
          kind: "plan_excerpt",
          content: PLAN_EXCERPT,
          truncated: true,
          originalBytes: excerptBytes + 4096,
          pathSummary: null,
        },
      ]);

      // The bytes, not just an equal-looking string.
      const stored = await stage.api.sql.query<{
        kind: string;
        bytes: Buffer;
        original_bytes: string;
        truncated: boolean;
      }>(
        `select kind, convert_to(content, 'UTF8') as bytes, original_bytes, truncated
           from ${SCHEMA_NAME}.dry_run_artifacts where dry_run_id = $1 order by kind`,
        [run.id],
      );
      expect(stored.rows.map((artifact) => artifact.kind)).toEqual([
        "overlay_diff",
        "plan_excerpt",
      ]);
      expect(Buffer.compare(stored.rows[0].bytes, Buffer.from(OVERLAY_DIFF, "utf8"))).toBe(0);
      expect(Buffer.compare(stored.rows[1].bytes, Buffer.from(PLAN_EXCERPT, "utf8"))).toBe(0);
      expect(Number(stored.rows[1].original_bytes)).toBe(excerptBytes + 4096);
      expect(
        Buffer.compare(
          Buffer.from(run.artifacts[0].content, "utf8"),
          Buffer.from(OVERLAY_DIFF, "utf8"),
        ),
      ).toBe(0);

      // The simulated diff is a dry run's artifact and nothing else's: no other table of the
      // workspace holds it, and none changed while it was recorded.
      expect(await holding(stage, OVERLAY_MARKER, dryRunTables())).toEqual(["dry_run_artifacts"]);
      expect(await holding(stage, OVERLAY_MARKER, others)).toEqual([]);
      expect(changedTables(before, await footprint(stage, others))).toEqual([]);
    });
  });

  describe("dry run ⟂ run", () => {
    it("leaves every run read-model, metric and spend figure as it was, and accounts for itself on the dry-run history only", async () => {
      const subject = await workflow();
      const read = async () => {
        const bodies: Record<string, unknown> = {};
        for (const path of RUN_READS) {
          bodies[path] = withoutClocks(
            (await stage.as(stage.people.owner, "get", path).expect(200)).body,
          );
        }

        return bodies;
      };
      // One seeded run, read whole: its console page must not move either.
      const seeded = await stage.one<{ id: string }>(
        `select id from ${SCHEMA_NAME}.runs where organization_id = $1 order by started_at desc, id limit 1`,
        [stage.workspace.id],
      );
      expect(seeded).toBeDefined();
      const runPage = async () =>
        withoutClocks(
          (
            await stage
              .as(stage.people.owner, "get", `/api/v1/runs/${seeded?.id ?? ""}`)
              .expect(200)
          ).body,
        );

      // Read once first: a read-model that fills itself on first read has done so before the
      // footprint is taken.
      await read();
      const before = {
        reads: await read(),
        page: await runPage(),
        rows: await footprint(stage, others),
      };

      // A priced complete run, a failed one, a budget stop, and a complete run with no price.
      stage.engine.scriptRun(
        (request) =>
          runOf(request, [row(1, "implement", { metrics: { tokens: 900, cost_cents: 41 } })], {
            cost_cents: 41,
            tokens: 900,
          }),
        reportedComplete([
          { guard: DESCRIBED.guards[0].name, call: "repository_write", count: 1, stage_key: null },
        ]),
        (request) =>
          runOf(request, [row(1, "implement", { metrics: { cost_cents: 17 } })], {
            status: "budget_stopped",
            failure_reason: "The run budget was reached.",
            cost_cents: 17,
          }),
        (request) => runOf(request, [row(1, "implement")], { cost_cents: null }),
      );
      const runs = [
        await ran(stage, subject.id),
        await ran(stage, subject.id),
        await ran(stage, subject.id),
        await ran(stage, subject.id),
      ];
      expect(runs.map((run) => run.status)).toEqual([
        "complete",
        "failed",
        "budget_stopped",
        "complete",
      ]);

      const after = {
        reads: await read(),
        page: await runPage(),
        rows: await footprint(stage, others),
      };

      for (const path of RUN_READS) expect(after.reads[path]).toEqual(before.reads[path]);
      expect(after.page).toEqual(before.page);
      expect(changedTables(before.rows, after.rows)).toEqual([]);
      // No answer names a dry run, either.
      for (const run of runs) expect(JSON.stringify(after.reads)).not.toContain(run.id);

      // The accounting exists — on the dry-run history, as the sum of the priced runs.
      const priced = runs
        .map((run) => run.totals.costCents)
        .filter((cost): cost is number => cost !== null);
      const history = (
        await stage.as(stage.people.viewer, "get", dryRunsPath(subject.id)).expect(200)
      ).body as DryRunHistoryResource;
      const summed = await stage.one<{ cents: number }>(
        `select sum(cost_cents)::int as cents from ${SCHEMA_NAME}.dry_runs where workflow_id = $1`,
        [subject.id],
      );

      // The failed run keeps the bill the harness reported with it (the scripted default).
      expect(priced).toEqual([41, 3, 17]);
      expect(history.count).toBe(4);
      expect(history.spend).toEqual({ costCents: 41 + 3 + 17, unpriced: 1 });
      expect(summed?.cents).toBe(41 + 3 + 17);
    });
  });

  describe("the budget", () => {
    it("sends the harness the workspace's cap, and the draft's spend guard only when that is tighter", async () => {
      const subject = await workflow();
      const session = await stage.session(subject.id);
      const settings = await stage.one<{ cap: number }>(
        `select dry_run_cap_cents as cap from ${SCHEMA_NAME}.workspace_settings_effective
          where organization_id = $1`,
        [stage.workspace.id],
      );
      const cap = settings?.cap ?? 0;
      expect(cap).toBeGreaterThan(1);

      /** Start a run and answer what the start said of its budget, and what the harness was sent. */
      const budgeted = async () => {
        stage.engine.reset();
        stage.engine.scriptRun(reportedComplete([]));
        const { draftRev } = await stage.draft(subject.id);
        const started = await stage
          .as(stage.people.owner, "post", dryRunsPath(subject.id))
          .send({ ticketId: await stage.ticket(), draftRev })
          .expect(201);
        await stage.api.nest.get(DryRunRunner).settled((started.body as DryRunResource).id);

        return { said: (started.body as DryRunResource).budget, sent: stage.engine.runs[0].budget };
      };
      const sentOf = (cents: number) => ({
        run_cost_cents: cents,
        stage_cost_cents: null,
        run_tokens: null,
        stage_tokens: null,
      });
      const guard = (cents: number) =>
        called(stage, subject.id, session, [
          "set_guard",
          { guard: "spend_guard", params: { per_run_cap_cents: cents } },
        ]);

      // No guard: the workspace's cap, alone.
      expect(await budgeted()).toEqual({
        said: {
          capCents: cap,
          source: "workspace_cap",
          workspaceCapCents: cap,
          draftGuardCents: null,
        },
        sent: sentOf(cap),
      });

      // A guard above the cap never raises it.
      expect(await guard(cap + 100)).toEqual(["proposed"]);
      expect(await budgeted()).toEqual({
        said: {
          capCents: cap,
          source: "workspace_cap",
          workspaceCapCents: cap,
          draftGuardCents: cap + 100,
        },
        sent: sentOf(cap),
      });

      // A tighter guard is the budget, to the cent.
      expect(await guard(cap - 1)).toEqual(["proposed"]);
      expect(await budgeted()).toEqual({
        said: {
          capCents: cap - 1,
          source: "draft_guard",
          workspaceCapCents: cap,
          draftGuardCents: cap - 1,
        },
        sent: sentOf(cap - 1),
      });
    });
  });

  describe("the blank path (#1744)", () => {
    it("dry-runs a draft the copilot built by operations alone on a workflow created with a name only", async () => {
      serial += 1;
      const blank = await stage.workflow(`Cert dry runs ${String(serial)} blank`);
      const session = await stage.session(blank.id);
      const document = chain(IMPLEMENT_NODE, modelStage("cve-check", 560)) as {
        readonly trigger: Record<string, unknown>;
        readonly nodes: readonly DraftNode[];
        readonly edges: readonly DraftEdge[];
      };
      const calls = [
        ["set_trigger", { trigger: document.trigger }] as const,
        ...document.nodes.map((node) => ["add_stage", { node }] as const),
        ...document.edges.map((edge) => ["add_edge", { edge }] as const),
      ];

      expect(await called(stage, blank.id, session, ...calls)).toEqual(calls.map(() => "applied"));
      // The stored draft is the document itself — `dsl_version` included — not `{}` grown by
      // the operations.
      expect((await stage.draft(blank.id)).definition).toEqual(document);

      stage.engine.scriptRun(reportedComplete([]));
      const run = await ran(stage, blank.id, session);

      // Past the pre-check, which refused a blank workflow's draft at `/dsl_version` before.
      expect(run).toMatchObject({ status: "complete", failureReason: null });
    });
  });

  it("called no engine route but the dry run's own, and no write on any", () => {
    expect(strays).toEqual([]);
  });
});

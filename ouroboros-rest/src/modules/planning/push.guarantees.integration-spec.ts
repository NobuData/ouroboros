import { Logger } from "@nestjs/common";

import {
  estimateAnswer,
  planAnswer,
  startEngineStub,
  type EngineStub,
} from "../../testing/engine.stub.fixture";
import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { BacklogQueueService } from "../backlog/queue.service";
import { SCHEMA_NAME } from "../db/schema";
import { planGoldenCase } from "../engine/engine.fixture";
import { EstimationOrchestrator } from "../estimation/estimation.orchestrator";
import type { OctokitLike } from "../github/github.client";
import { OCTOKIT_FACTORY } from "../github/github.client.factory";
import { budgetHeaders, httpError } from "../github/github.fixture";
import { recordingFactory } from "../ticket-sources/providers/github.provider.fixture";
import { ADD_SUB_ISSUE_ROUTE, CREATE_ISSUE_ROUTE } from "../ticket-sources/providers/github.write";
import {
  writeRecording,
  type WriteRecording,
  type WriteRecordingOptions,
} from "../ticket-sources/providers/github.write-recordings.fixture";
import {
  callAs,
  countOf,
  insertEpic,
  insertTickets,
  mirrorIssues,
  planningWorkspace,
  type PlanningWorkspace,
} from "./planning.integration.fixture";
import type {
  BacklogHealthResource,
  BatchResource,
  GeneratedBatchResource,
  PushResultResource,
} from "./planning.resources";
import { BLOCKER_NOT_PUSHED } from "./push.errors";

/**
 * The push's guarantees, over HTTP, against a migrated database (AL.6,
 * [#282](https://github.com/NobuData/ouroboros/issues/282)).
 *
 * Push is the one operation that writes into somebody else's system, and the regressions worth
 * insuring against **do not throw** — a missing idempotency probe doubles a retried push's issues,
 * a lost dependency order leaves `blocked_by` links unmade, a forked queue path queues unsized
 * work, a Blocked metric reading only `planned` edges under-reports. Each case below is written so
 * that one of those regressions turns it red:
 *
 * ```
 * contract round-trip     /v0/plan stub ─▶ persisted drafts and planned edges, verbatim
 * dependency order        a plan whose key order contradicts its dependency order
 * fallback mode           a GitHub without the dependency API; the report says `fallback`
 * partial failure/resume  one refused create ─▶ resume creates exactly the missing issues
 * duplicate probe         an issue GitHub holds but the push never recorded ─▶ found, not re-made
 * epic mirror             a second (and a mirror-less third) push finds the one parent issue
 * queue-small             pushed XS/S through INTAKE-M.3, the sized-only rule intact
 * health                  Blocked over the pushed planned edges and synced ones alike
 * ```
 *
 * Nothing stands in but the engine (the contract-faithful stub) and GitHub (the recorded write
 * GitHub behind the real provider, swapped per case and able to refuse one call).
 *
 * ```bash
 * yarn test:integration push.guarantees
 * ```
 */

const BATCHES = "/api/v1/planning/batches";

/** One call the recorded GitHub refuses, once. */
interface Fault {
  /** The route. */
  readonly route: string;
  /** Which call to that route — by its parameters and the recording as it stands. */
  readonly matches: (params: Readonly<Record<string, unknown>>, github: WriteRecording) => boolean;
  /** The HTTP status GitHub answers. */
  readonly status: number;
}

/** Healthy budget headers, so a refusal is a refusal and never read as a throttle. */
const HEALTHY = budgetHeaders({ remaining: 4999 });

/**
 * The golden OTA plan with its dependencies turned around, so key order and dependency order
 * disagree — the only shape in which a push that walks keys differs from one that walks blockers:
 *
 * ```
 * OTA-3 ─▶ OTA-1 ─▶ OTA-4 ─▶ OTA-6
 *   └────▶ OTA-2 ─▶ OTA-5
 * ```
 */
const INVERTED_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  "OTA-1": ["OTA-3"],
  "OTA-2": ["OTA-3"],
  "OTA-3": [],
  "OTA-4": ["OTA-1"],
  "OTA-5": ["OTA-2"],
  "OTA-6": ["OTA-4"],
};

/** Blockers first, ties by key: what the inverted plan must be created in. */
const INVERTED_PUSH_ORDER = ["OTA-3", "OTA-1", "OTA-2", "OTA-4", "OTA-5", "OTA-6"];

/** The golden drafts' titles by local key. */
const TITLES = new Map(
  planGoldenCase().response.drafts.map((draft) => [draft.local_key, draft.title]),
);

/**
 * A draft's title.
 *
 * @param localKey - `OTA-3`.
 * @returns The golden plan's title for it.
 */
function titleOf(localKey: string): string {
  const title = TITLES.get(localKey);

  if (title === undefined) {
    throw new Error(`the golden plan has no ${localKey}`);
  }

  return title;
}

describe("the push's guarantees, over HTTP against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;
  let github: WriteRecording;
  let world: PlanningWorkspace;
  const faults: Fault[] = [];

  /**
   * The Octokit the application is handed: whatever recording the case set up, refusing each
   * arranged fault once. Delegating rather than binding one recording is what lets a case choose a
   * GitHub without the dependency API after the application has started.
   */
  const octokit: OctokitLike = {
    request: (route, params = {}) => {
      const index = faults.findIndex(
        (fault) => fault.route === route && fault.matches(params, github),
      );

      if (index >= 0) {
        const [fault] = faults.splice(index, 1);

        return Promise.reject(httpError(fault.status, HEALTHY));
      }

      return github.octokit.request(route, params);
    },
    paginate: {
      iterator: (route, params) => github.octokit.paginate.iterator(route, params),
    },
  };

  beforeAll(async () => {
    engine = await startEngineStub();
    github = writeRecording();
    api = await ApiHarness.start(
      {
        OURO_ENGINE_URL: engine.url,
        OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
        OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS: "86400",
      },
      [{ provide: OCTOKIT_FACTORY, useValue: recordingFactory(octokit).factory }],
    );
  });

  afterAll(async () => {
    await api.close();
    await engine.stop();
  });

  beforeEach(async () => {
    engine.reset();
    faults.length = 0;
    github = writeRecording();
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    world = await planningWorkspace(api);
  });

  afterEach(async () => {
    const unfaithful = [...engine.violations];

    await api.truncate();

    expect(unfaithful).toEqual([]);
    expect(faults).toEqual([]);
  });

  /**
   * Use a differently shaped GitHub for this case.
   *
   * @param options - The recording's options.
   */
  function useGithub(options: WriteRecordingOptions): void {
    github = writeRecording(options);
  }

  /** Answer the planner with the inverted plan. */
  function planInverted(): void {
    engine.respondToPlan(() =>
      planAnswer({
        drafts: planGoldenCase().response.drafts.map((draft) => ({
          ...draft,
          dependencies: INVERTED_DEPENDENCIES[draft.local_key],
        })),
      }),
    );
  }

  /**
   * Generate a batch as the member and wait for sizing.
   *
   * @param body - What else the generator card sends.
   * @returns The batch.
   */
  async function generate(body: Record<string, unknown> = {}): Promise<GeneratedBatchResource> {
    const golden = planGoldenCase().request as { narrative: string; outline: string };
    const response = await callAs(api, world.bench.slug, world.people.member, "post", BATCHES)
      .send({
        prompt: golden.narrative,
        outline: golden.outline,
        targetSourceId: world.sourceId,
        milestone: "Helios 2.1",
        ...body,
      })
      .expect(201);

    await api.nest.get(EstimationOrchestrator).settled();

    return bodyOf<GeneratedBatchResource>(response);
  }

  /**
   * Push, or resume, a batch as an admin.
   *
   * @param batchId - The batch.
   * @param step - `push` or `push/resume`.
   * @returns The push result.
   */
  async function push(
    batchId: string,
    step: "push" | "push/resume" = "push",
  ): Promise<PushResultResource> {
    const response = await callAs(
      api,
      world.bench.slug,
      world.people.admin,
      "post",
      `${BATCHES}/${batchId}/${step}`,
    ).expect(200);

    return bodyOf<PushResultResource>(response);
  }

  /**
   * The push keys the recorded GitHub's issues carry, one entry per issue.
   *
   * @returns The keys, sorted — a duplicate shows up twice.
   */
  function pushKeys(): string[] {
    return github.issues
      .flatMap((issue) => /ouroboros:push-key (\S+)/.exec(issue.body ?? "")?.[1] ?? [])
      .sort();
  }

  /**
   * The recorded GitHub's issue numbers by title.
   *
   * @returns Numbers by title.
   */
  function numbersByTitle(): Map<string, number> {
    return new Map(github.issues.map((issue) => [issue.title, issue.number]));
  }

  it("round-trips the /v0/plan contract into persisted drafts and planned edges, verbatim", async () => {
    const golden = planGoldenCase();
    const batch = await generate();

    expect(engine.plans).toHaveLength(1);
    expect(engine.plans[0]).toMatchObject({
      narrative: (golden.request as { narrative: string }).narrative,
      outline: (golden.request as { outline: string }).outline,
    });

    const s = SCHEMA_NAME;
    const { rows: stored } = await api.sql.query<{
      local_key: string;
      title: string;
      body: string | null;
      suggested_workflow: string | null;
      selected: boolean;
      push_state: string;
      provenance: string;
    }>(
      `select local_key, title, body, suggested_workflow, selected, push_state, provenance
         from ${s}.ticket_drafts where batch_id = $1 order by local_key`,
      [batch.id],
    );

    expect(
      stored.map((row) => ({
        local_key: row.local_key,
        title: row.title,
        body: row.body ?? "",
        suggested_workflow: row.suggested_workflow,
      })),
    ).toEqual(
      golden.response.drafts.map((draft) => ({
        local_key: draft.local_key,
        title: draft.title,
        body: draft.body,
        suggested_workflow: draft.suggested_workflow,
      })),
    );
    expect(
      stored.every(
        (row) => row.selected && row.push_state === "pending" && row.provenance === "planned",
      ),
    ).toBe(true);

    const { rows: edges } = await api.sql.query<{
      blocker: string;
      blocked: string;
      origin: string;
    }>(
      `select blocker.local_key as blocker, blocked.local_key as blocked, d.origin
         from ${s}.ticket_dependencies d
         join ${s}.ticket_drafts blocker on blocker.id = d.blocker_draft_id
         join ${s}.ticket_drafts blocked on blocked.id = d.blocked_draft_id
        where blocked.batch_id = $1
        order by blocked.local_key, blocker.local_key`,
      [batch.id],
    );

    expect(edges).toEqual(
      golden.response.drafts.flatMap((draft) =>
        draft.dependencies.map((blocker) => ({
          blocker,
          blocked: draft.local_key,
          origin: "planned",
        })),
      ),
    );

    // And the read the page renders says the same.
    const read = bodyOf<BatchResource>(
      await callAs(
        api,
        world.bench.slug,
        world.people.viewer,
        "get",
        `${BATCHES}/${batch.id}`,
      ).expect(200),
    );

    expect(read).toMatchObject({ planner: golden.response.planner, status: "sized" });
    expect(read.drafts.map((draft) => [draft.localKey, draft.dependencies])).toEqual(
      golden.response.drafts.map((draft) => [draft.local_key, draft.dependencies]),
    );
    expect(read.summary).toMatchObject({ allSized: true, sizedCount: 6 });
  });

  it("creates blockers first, so every blocked_by link is made against an issue that exists", async () => {
    planInverted();

    const batch = await generate();
    const pushed = await push(batch.id);

    expect(pushed.report).toMatchObject({ outcome: "pushed", pushedThisRun: 6 });
    expect(pushed.report.links).toEqual({ native: 5, fallback: 0 });
    expect(github.issues.map((issue) => issue.title)).toEqual(INVERTED_PUSH_ORDER.map(titleOf));

    const numbers = numbersByTitle();
    const expected = Object.entries(INVERTED_DEPENDENCIES)
      .flatMap(([blocked, blockers]) =>
        blockers.map((blocker) => [numbers.get(titleOf(blocker)), numbers.get(titleOf(blocked))]),
      )
      .sort();

    expect([...github.relations].sort()).toEqual(expected);
    // A link is made when its later end is created — never before its blocker exists.
    expect(github.relations.every(([blocker, blocked]) => blocker < blocked)).toBe(true);
  });

  it("falls back to body markers on a GitHub without the dependency API, and reports the mode", async () => {
    useGithub({ nativeDependencies: false });
    planInverted();

    const batch = await generate();
    const pushed = await push(batch.id);

    expect(pushed.report).toMatchObject({ outcome: "pushed", pushedThisRun: 6 });
    expect(pushed.report.links).toEqual({ native: 0, fallback: 5 });
    expect(github.relations).toEqual([]);

    const numbers = numbersByTitle();

    expect([...github.ledger().dependencies].sort()).toEqual(
      Object.entries(INVERTED_DEPENDENCIES)
        .flatMap(([blocked, blockers]) =>
          blockers.map((blocker) => [
            String(numbers.get(titleOf(blocker))),
            String(numbers.get(titleOf(blocked))),
          ]),
        )
        .sort(),
    );
  });

  it("stops short on a refused create, and a resume creates exactly the missing issues", async () => {
    planInverted();
    faults.push({
      route: CREATE_ISSUE_ROUTE,
      matches: (params) => params.title === titleOf("OTA-1"),
      status: 422,
    });

    const batch = await generate();
    const partial = await push(batch.id);
    const states = new Map(partial.report.drafts.map((draft) => [draft.localKey, draft]));

    expect(partial.report).toMatchObject({
      outcome: "partial",
      batchStatus: "pushing",
      pushedThisRun: 3,
    });
    expect(states.get("OTA-1")).toMatchObject({
      pushState: "failed",
      error: { code: "validation" },
    });
    // What waits on the failure is not created; what does not, is.
    expect(states.get("OTA-4")).toMatchObject({
      pushState: "failed",
      error: { code: BLOCKER_NOT_PUSHED },
    });
    expect(states.get("OTA-6")).toMatchObject({
      pushState: "failed",
      error: { code: BLOCKER_NOT_PUSHED },
    });
    expect(["OTA-2", "OTA-3", "OTA-5"].map((key) => states.get(key)?.pushState)).toEqual([
      "pushed",
      "pushed",
      "pushed",
    ]);

    const before = github.issues.map((issue) => issue.title);

    const resumed = await push(batch.id, "push/resume");

    expect(resumed.report).toMatchObject({
      outcome: "pushed",
      batchStatus: "pushed",
      pushedThisRun: 3,
    });
    expect(github.issues.map((issue) => issue.title).slice(before.length)).toEqual(
      ["OTA-1", "OTA-4", "OTA-6"].map(titleOf),
    );
    expect(pushKeys()).toHaveLength(6);
    expect(new Set(pushKeys()).size).toBe(6);
    expect(github.relations).toHaveLength(5);
    await expect(
      countOf(
        api,
        `select count(*)::int as count from ${SCHEMA_NAME}.tickets where source_id = $1`,
        [world.sourceId],
      ),
    ).resolves.toBe(6);
  });

  it.each([
    ["the recent-issues listing", 100],
    ["search, when the listing is too busy to hold it", 1],
  ])(
    "finds an issue GitHub already holds through %s, so a resume creates nothing already created",
    async (_, recentPageSize) => {
      useGithub({ recentPageSize });
      planInverted();

      const epicId = await insertEpic(api, world.bench.id);

      // OTA-1 is created in GitHub, then its sub-issue link is refused: the issue exists, and the
      // draft is recorded failed — exactly the state a push dying after the tracker's 201 leaves.
      faults.push({
        route: ADD_SUB_ISSUE_ROUTE,
        matches: (params, recording) =>
          recording.issues.find((issue) => issue.id === params.sub_issue_id)?.title ===
          titleOf("OTA-1"),
        status: 403,
      });

      const batch = await generate({ epicId });
      const partial = await push(batch.id);

      expect(partial.report.outcome).toBe("partial");
      expect(partial.report.drafts.find((draft) => draft.localKey === "OTA-1")).toMatchObject({
        pushState: "failed",
        error: { code: "permission" },
      });
      expect(github.issues.filter((issue) => issue.title === titleOf("OTA-1"))).toHaveLength(1);

      const createsBefore = github.calls.filter((call) => call.route === CREATE_ISSUE_ROUTE).length;
      const resumed = await push(batch.id, "push/resume");

      expect(resumed.report).toMatchObject({ outcome: "pushed", pushedThisRun: 3 });
      // OTA-1 was found; only OTA-4 and OTA-6 were created.
      expect(
        github.calls.filter((call) => call.route === CREATE_ISSUE_ROUTE).length - createsBefore,
      ).toBe(2);
      expect(github.issues.filter((issue) => issue.title === titleOf("OTA-1"))).toHaveLength(1);
      expect(pushKeys()).toHaveLength(6);
      expect(new Set(pushKeys()).size).toBe(6);
      expect(github.ledger().containers).toHaveLength(1);
      expect(github.subIssues).toHaveLength(6);
      expect(github.relations).toHaveLength(5);
    },
  );

  it("wires every push of an epic to its one parent issue, even after the stored mirror is lost", async () => {
    const epicId = await insertEpic(api, world.bench.id);
    const s = SCHEMA_NAME;

    const first = await push((await generate({ epicId })).id);
    const second = await push((await generate({ epicId })).id);

    expect(github.ledger().containers).toHaveLength(1);

    const [parent] = github.ledger().containers;

    expect(first.report.epic).toEqual({ mapping: "parent_issue", externalRef: parent });
    expect(second.report.epic).toEqual(first.report.epic);

    // The mirror row is gone — a restore, a manual cleanup — and the marker probe must still find
    // the parent rather than file a second one.
    await api.sql.query(`delete from ${s}.epic_mirrors where epic_id = $1`, [epicId]);

    const third = await push((await generate({ epicId })).id);

    expect(third.report.epic).toEqual(first.report.epic);
    expect(github.ledger().containers).toEqual([parent]);
    expect(github.subIssues).toHaveLength(18);
    expect(github.subIssues.every(([of]) => String(of) === parent)).toBe(true);

    const { rows: mirrors } = await api.sql.query<{ external_ref: string }>(
      `select external_ref from ${s}.epic_mirrors where epic_id = $1`,
      [epicId],
    );

    expect(mirrors).toEqual([{ external_ref: parent }]);
    await expect(
      countOf(api, `select count(*)::int as count from ${s}.epic_tickets where epic_id = $1`, [
        epicId,
      ]),
    ).resolves.toBe(18);
  });

  it("queues pushed XS/S drafts through INTAKE-M.3 alone, and never an unsized one", async () => {
    // Odd drafts XS, even drafts M — keyed on the draft's own number, since sizing is concurrent.
    engine.respond((attempt) => {
      const issue = engine.requests[attempt - 1].issue as { number: number };

      return estimateAnswer({ effort: issue.number % 2 === 1 ? "xs" : "m" });
    });

    // The golden plan is pushed in key order into an empty GitHub, so OTA-n becomes issue #n. The
    // sync has mirrored #1 and #3 sized, and #5 not yet sized.
    const mirrored = await mirrorIssues(api, world.bench.id, [
      [1, "sized"],
      [3, "sized"],
      [5, "unsized"],
    ]);
    const queue = api.nest.get(BacklogQueueService);
    const queueSelection = jest.spyOn(queue, "queueSelection");

    const batch = await generate({ queueSmall: true });
    const pushed = await push(batch.id);

    expect(pushed.report.outcome).toBe("pushed");
    expect(pushed.queueSmall).toEqual({
      queued: ["OTA-1", "OTA-3"],
      skipped: [{ localKey: "OTA-5", reason: "not_sized" }],
    });
    // Through M.3's own service — one call, naming exactly the sized mirrors.
    expect(queueSelection).toHaveBeenCalledTimes(1);
    expect(queueSelection).toHaveBeenCalledWith(world.bench.id, {
      issueIds: [mirrored.get(1), mirrored.get(3)],
    });

    const { rows: queued } = await api.sql.query<{ issue_number: number }>(
      `select issue_number from ${SCHEMA_NAME}.queue_items
        where organization_id = $1 order by issue_number`,
      [world.bench.id],
    );

    expect(queued.map((row) => row.issue_number)).toEqual([1, 3]);
  });

  it("counts Blocked over the push's planned edges and synced edges alike", async () => {
    planInverted();

    const batch = await generate();
    const pushed = await push(batch.id);
    const ticketOf = new Map(pushed.report.drafts.map((draft) => [draft.localKey, draft.ticketId]));
    const health = async (): Promise<BacklogHealthResource> =>
      bodyOf<BacklogHealthResource>(
        await callAs(
          api,
          world.bench.slug,
          world.people.viewer,
          "get",
          "/api/v1/planning/health",
        ).expect(200),
      );

    // Five of the six pushed tickets wait on another, through the planned edges the push rewrote.
    expect(await health()).toMatchObject({ open: 6, blocked: { count: 5 } });

    // A block a human made in GitHub, mirrored by the sync: an open ticket blocking OTA-3.
    const [external] = await insertTickets(api, world, [{ number: 900 }]);

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.ticket_dependencies
         (organization_id, blocker_ticket_id, blocked_ticket_id, origin)
       values ($1, $2, $3, 'synced')`,
      [world.bench.id, external, ticketOf.get("OTA-3")],
    );

    expect(await health()).toMatchObject({ open: 7, blocked: { count: 6 } });

    // Closing the synced blocker resolves it; the planned blocks stand.
    await api.sql.query(`update ${SCHEMA_NAME}.tickets set state = 'closed' where id = $1`, [
      external,
    ]);

    expect(await health()).toMatchObject({ open: 6, blocked: { count: 5 } });
  });
});

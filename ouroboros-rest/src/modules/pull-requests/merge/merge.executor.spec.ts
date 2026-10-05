import { Logger } from "@nestjs/common";

import type { PrSyncOutcome } from "../pr-sync.repository";
import type { CriteriaMatrixResource } from "../criteria/criteria.resources";
import { GateListeners } from "../gates/gate.listeners";
import { hasPrCommentMarker } from "../../ticket-sources/ticket-source.pr";
import {
  IN_MEMORY_DEFAULT_BRANCH,
  IN_MEMORY_MERGER,
  InMemoryPrHost,
  InMemoryPrTicketSourceProvider,
} from "../../ticket-sources/providers/in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  InMemoryTracker,
} from "../../ticket-sources/providers/in-memory.provider.fixture";
import { EVIDENCE_COMMENT_KEY } from "./merge.evidence";
import {
  MergeExecutorService,
  hostFailure,
  mayMerge,
  refusedEdit,
  type MergeHost,
} from "./merge.executor";
import { TOKEN_IDENTITY } from "./merge.identity";
import { parseDisarmReason, type RecheckGates } from "./merge.recheck";
import { ADMIN, MEMBER, MemoryConstraintFailure, MemoryMergeStore } from "./merge.store.fixture";
import type { PublishedOrgPolicy } from "../../policies/org-policy.document";
import { snapshotOf } from "../../policies/policy-resolution.service";

/**
 * The merge executor (AX.4, [#360](https://github.com/NobuData/ouroboros/issues/360)) against the
 * in-memory git host and a store whose transaction is the PR row's lock — the issue's acceptance
 * criteria, one by one: the armed merge on the last gate's flip, the TOCTOU refusals and the
 * concurrent gate mutation that cannot slip through, the host's conflict and protection, the
 * verified ticket close, the edited evidence comment, the epic note, identity honesty, and an audit
 * actor for every arm, disarm and merge. The plan's edit is AY.7's
 * ([#369](https://github.com/NobuData/ouroboros/issues/369)).
 */

const ORG = "org-360";

/** The source every host call runs against. */
const CONTEXT = {
  sourceId: "src-360",
  organizationId: ORG,
  config: { project: IN_MEMORY_PROJECT },
  credentials: IN_MEMORY_TOKEN,
} as const;

/** Five of seven satisfied, two still running — where the person armed. */
const PENDING: RecheckGates = { mergeReady: false, red: [], satisfied: 5, required: 7 };
/** The last gate flipped. */
const GREEN: RecheckGates = { mergeReady: true, red: [], satisfied: 7, required: 7 };
/** A previously green gate went red on re-evaluation. */
const RED: RecheckGates = { mergeReady: false, red: ["Physical HIL"], satisfied: 6, required: 7 };

const KEN = { id: "user-ken", roles: ADMIN };

/** Two planning epics of the workspace, and one of another's. */
const OTA = "5eed001f-0000-4000-8000-000000000001";
const BLE = "5eed001f-0000-4000-8000-000000000002";
const FOREIGN = "5eed001f-0000-4000-8000-0000000000ff";

/** One matrix row. */
const MATRIX = {
  prId: "pr-514",
  counts: { total: 1, verified: 1, waived: 0, unverified: 0 },
  criteria: [{ claim: "Frames arrive in queue order", status: "verified", waiver: null }],
} as unknown as CriteriaMatrixResource;

/** Flush the microtask queue a few times — enough for a queued lock to be taken if it could. */
async function ticks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

/**
 * A host with one open PR on `loop/482`, a store mirroring it at revision 1, and the executor.
 *
 * @param options - The host's merger, the ticket's key and whether the PR has a run.
 * @returns Everything a case needs.
 */
function build(
  options: {
    merger?: string;
    ticketKey?: string | null;
    dryRun?: boolean;
    /** The published org policy (#481) — none unless a case publishes one. */
    orgPolicy?: PublishedOrgPolicy | null;
  } = {},
) {
  const host = new InMemoryPrHost(options.merger === undefined ? {} : { merger: options.merger });
  const issue = host.openIssue();

  host.push("loop/482", [{ path: "src/can/telemetry.c", additions: 53, deletions: 13 }]);

  const pull = host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
    branch: "loop/482",
    base: IN_MEMORY_DEFAULT_BRANCH,
    title: "fix(can): preserve ISR frame order in telemetry path",
    body: null,
  });
  const provider = new InMemoryPrTicketSourceProvider(new InMemoryTracker(), host);
  const store = new MemoryMergeStore(
    {
      id: "pr-514",
      organizationId: ORG,
      sourceId: CONTEXT.sourceId,
      number: pull.number,
      title: pull.title,
      state: "verifying",
      runId: "run-482",
      ticketKey: options.ticketKey === undefined ? `#${String(issue)}` : options.ticketKey,
    },
    {
      revisions: [{ id: "rev-1", seq: 1, headSha: host.headOf(pull) }],
      gates: PENDING,
      summary: [{ label: "Build", required: true, verdict: "green", evidence: "forge-01" }],
    },
  );
  const synced: number[] = [];
  const adapter = {
    get: (_org: string, _source: string, number: number) => provider.getPR(CONTEXT, number),
    merge: jest.fn((_org: string, _source: string, number: number, input) =>
      provider.mergePR(CONTEXT, number, input),
    ),
    comment: (_org: string, _source: string, number: number, comment) =>
      provider.commentPR(CONTEXT, number, comment),
    sync: (_org: string, _source: string, number: number) => {
      synced.push(number);
      return Promise.resolve({} as PrSyncOutcome);
    },
  } satisfies MergeHost;
  const listeners = new GateListeners();
  // The workspace's dry-run policy (BA.3, #382) — off unless a case turns it on. `reads` counts
  // the uncached reads, which is what the execution re-check must use.
  const policy = {
    active: options.dryRun ?? false,
    reads: 0,
    dryRun(): Promise<boolean> {
      return Promise.resolve(this.active);
    },
    dryRunNow(): Promise<boolean> {
      this.reads += 1;
      return Promise.resolve(this.active);
    },
  };
  // The org policy document (#481), through the resolver's snapshot port; a case may publish anew.
  const orgPolicy = {
    current: options.orgPolicy ?? null,
    snapshot(): Promise<ReturnType<typeof snapshotOf>> {
      return Promise.resolve(snapshotOf(this.current));
    },
  };
  const executor = new MergeExecutorService(
    store,
    adapter,
    { matrix: () => Promise.resolve(MATRIX) },
    listeners,
    policy,
    orgPolicy,
  );

  executor.onModuleInit();

  return {
    host,
    provider,
    store,
    adapter,
    executor,
    listeners,
    pull,
    issue,
    synced,
    policy,
    orgPolicy,
  };
}

/**
 * Tell the executor the gate engine evaluated the PR, and wait for what it scheduled.
 *
 * @param built - The fixture.
 */
async function evaluated(built: ReturnType<typeof build>): Promise<void> {
  const { gates } = built.store.state;

  built.listeners.emit({
    prId: "pr-514",
    organizationId: ORG,
    revisionId: built.store.state.revisions.at(-1)?.id ?? null,
    state: built.store.state.pr.state,
    mergeReady: gates.mergeReady,
    redCount: gates.red.length,
  });
  await built.executor.settled();
}

describe("MergeExecutorService — the armed merge", () => {
  it("merges an armed PR when the staged last gate flips, and records what it did", async () => {
    const built = build();
    const { host, store, executor, pull, issue } = built;

    const armed = await executor.arm(ORG, "pr-514", KEN, "rev-1");

    await executor.settled();
    expect(armed).toMatchObject({
      armed: true,
      armedBy: "user-ken",
      armedAgainstRevisionId: "rev-1",
    });
    expect(store.state.pr.state).toBe("armed");
    expect(host.ledger().merged).toEqual([]);

    // Pending gates are the promise the person made: nothing is disarmed.
    await evaluated(built);
    expect(store.state.plan?.armed).toBe(true);

    await store.gateEvaluation((state) => {
      state.gates = GREEN;
    });
    await evaluated(built);

    const result = store.state.plan?.mergedResult;

    expect(host.ledger().merged).toEqual([pull.number]);
    expect(result).toMatchObject({
      identity_used: IN_MEMORY_MERGER,
      actions_executed: ["close_ticket", "comment_evidence", "delete_branch"],
    });
    expect(result?.sha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(host.ledger().closedIssues).toEqual([issue]);
    expect(host.ledger().branches).not.toContain("loop/482");
    expect(store.state.run).toEqual({ status: "merged", prNumber: pull.number, finished: true });
    expect(built.synced).toEqual([pull.number]);
    expect(store.state.audit).toEqual([
      { action: "armed", actorId: "user-ken" },
      { action: "merged", actorId: "user-ken" },
    ]);
  });

  it("fires at once when armed on an already-green revision", async () => {
    const built = build();

    built.store.state.gates = GREEN;
    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.settled();

    expect(built.host.ledger().merged).toEqual([built.pull.number]);
  });

  it("asks the host nothing while an armed PR's gates are only pending", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.settled();

    const requests = built.host.requests.length;

    await evaluated(built);

    expect(built.host.requests).toHaveLength(requests);
    expect(built.store.state.plan?.armed).toBe(true);
  });

  it("does nothing for a PR nobody armed", async () => {
    const built = build();

    built.store.state.gates = GREEN;
    await evaluated(built);

    expect(built.host.ledger().merged).toEqual([]);
    expect(built.store.transactions).toBe(0);
  });
});

describe("MergeExecutorService — TOCTOU", () => {
  it("never merges when a gate goes red between arm and fire, and records why", async () => {
    const built = build();
    const { store, executor, host } = built;

    await executor.arm(ORG, "pr-514", KEN, "rev-1");
    await executor.settled();
    await store.gateEvaluation((state) => {
      state.gates = RED;
      state.pr = { ...state.pr, state: "blocked" };
    });
    await evaluated(built);

    expect(host.ledger().merged).toEqual([]);
    expect(built.adapter.merge).not.toHaveBeenCalled();
    expect(store.state.plan?.armed).toBe(false);
    expect(parseDisarmReason(store.state.plan?.disarmReason ?? null)).toEqual({
      code: "gate_red",
      message: "Physical HIL is red on revision 1.",
    });
    expect((await executor.plan(ORG, "pr-514")).disarmReason?.code).toBe("gate_red");
    // A re-check is not a person.
    expect(store.state.audit.at(-1)).toEqual({ action: "disarmed", actorId: null });
  });

  it("re-checks rather than trusting the event — ready when announced, red when it runs", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.settled();
    built.store.state.gates = GREEN;
    built.executor.gateEvaluated({
      prId: "pr-514",
      organizationId: ORG,
      revisionId: "rev-1",
      state: "armed",
      mergeReady: true,
      redCount: 0,
    });
    // Before the scheduled run takes the lock, a re-evaluation turns a gate red.
    built.store.state.gates = RED;
    await built.executor.settled();

    expect(built.host.ledger().merged).toEqual([]);
    expect(built.store.state.plan?.disarmReason).toMatch(/^gate_red: /);
    expect(built.store.state.pr.state).toBe("verifying");
  });

  it("holds the PR through the merge: a concurrent gate evaluation waits and cannot slip in", async () => {
    const built = build();
    const { store, executor, adapter, provider, host } = built;
    let flip: Promise<void> | undefined;
    let redWhenMerging: number | undefined;

    await executor.arm(ORG, "pr-514", KEN, "rev-1");
    await executor.settled();
    store.state.gates = GREEN;
    adapter.merge.mockImplementation(async (_org, _source, number, input) => {
      // The gate engine evaluates now and turns a gate red — it must queue behind the executor.
      flip = store.gateEvaluation((state) => {
        state.gates = RED;
      });
      await ticks();
      redWhenMerging = store.state.gates.red.length;

      return provider.mergePR(CONTEXT, number, input);
    });

    const outcome = await executor.run(ORG, "pr-514", { kind: "armed" });
    await flip;

    expect(redWhenMerging).toBe(0);
    expect(outcome.kind).toBe("merged");
    expect(host.ledger().merged).toHaveLength(1);
    // The evaluation ran after the merge committed.
    expect(store.state.gates.red).toEqual(["Physical HIL"]);
  });

  it("reads what an evaluation already holding the PR wrote — and refuses", async () => {
    const built = build();
    const { store, executor } = built;
    let release: () => void = () => undefined;

    await executor.arm(ORG, "pr-514", KEN, "rev-1");
    await executor.settled();
    store.state.gates = GREEN;

    const evaluation = store.gateEvaluation(async (state) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      state.gates = RED;
    });
    const running = executor.run(ORG, "pr-514", { kind: "armed" });

    await ticks();
    release();
    await evaluation;

    expect(await running).toMatchObject({ kind: "refused", disarmed: true });
    expect(built.adapter.merge).not.toHaveBeenCalled();
  });

  it("refuses a new commit landing on the host after arming — the head-sha check", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.settled();
    built.host.push("loop/482", [{ path: "src/can/isr.h", additions: 1, deletions: 0 }]);
    built.store.state.gates = GREEN;
    await evaluated(built);

    expect(built.host.ledger().merged).toEqual([]);
    expect(parseDisarmReason(built.store.state.plan?.disarmReason ?? null)?.code).toBe(
      "host_head_moved",
    );
  });

  it("refuses a revision recorded after arming — the armed revision is not the head", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.settled();
    await built.store.gateEvaluation((state) => {
      state.revisions.push({ id: "rev-2", seq: 2, headSha: "d00dfeed11" });
      state.gates = GREEN;
    });
    await evaluated(built);

    expect(built.adapter.merge).not.toHaveBeenCalled();
    expect(built.store.state.plan?.disarmReason).toMatch(/^head_moved: /);
  });

  it("disarms on a host conflict rather than retrying blindly", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.settled();
    built.host.conflict(built.pull.number);
    built.store.state.gates = GREEN;
    await evaluated(built);
    await evaluated(built);

    expect(built.adapter.merge).not.toHaveBeenCalled();
    expect(built.host.requests).not.toContain("merge");
    expect(parseDisarmReason(built.store.state.plan?.disarmReason ?? null)).toEqual({
      code: "host_conflict",
      message: "The host reports a merge conflict with the base branch.",
    });
  });

  it("disarms on a branch-protection refusal of the merge itself", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.settled();
    built.host.protect();
    built.store.state.gates = GREEN;
    await evaluated(built);

    expect(built.host.ledger().merged).toEqual([]);
    expect(parseDisarmReason(built.store.state.plan?.disarmReason ?? null)).toEqual({
      code: "host_refused",
      message: "The host refused the merge — branch protection, a required check or a conflict.",
    });
  });

  it("disarms when the host cannot be read", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.settled();
    built.host.refuse("upstream");
    built.store.state.gates = GREEN;
    await evaluated(built);

    expect(built.store.state.plan?.disarmReason).toMatch(
      /^host_refused: The host could not be read/,
    );
  });
});

describe("MergeExecutorService — post-merge actions", () => {
  it("detects and reports a keyword close that cannot happen, rather than assuming it", async () => {
    const built = build({ ticketKey: "PROJ-142" });

    built.store.state.gates = GREEN;

    const outcome = await built.executor.merge(ORG, "pr-514", KEN);
    const [[, body]] = built.host.comments(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, built.pull.number);

    expect(outcome.ticket).toEqual({
      key: "PROJ-142",
      closed: false,
      detail: "PROJ-142 is not closed by a keyword on this host — close it in its tracker",
    });
    expect(outcome.failedActions).toContainEqual({
      action: "close_ticket",
      detail: "PROJ-142 is not closed by a keyword on this host — close it in its tracker",
    });
    expect(outcome.plan.mergedResult?.actionsExecuted).not.toContain("close_ticket");
    expect(body).toContain("**Ticket** — PROJ-142 not closed:");
  });

  it("publishes the evidence summary by editing the comment already there, never a second", async () => {
    const built = build();

    await built.provider.commentPR(CONTEXT, built.pull.number, {
      key: EVIDENCE_COMMENT_KEY,
      body: "An earlier summary.",
    });
    built.store.state.gates = GREEN;
    await built.executor.merge(ORG, "pr-514", KEN);

    const comments = built.host.comments(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, built.pull.number);
    const [[, body]] = comments;

    expect(comments).toHaveLength(1);
    expect(hasPrCommentMarker(body, EVIDENCE_COMMENT_KEY)).toBe(true);
    expect(body).toContain("### Ouroboros evidence summary");
    expect(body).toContain("| Build | green | forge-01 |");
    expect(body).toContain("- verified — Frames arrive in queue order");
    expect(body).toContain("**Spend** — 412,301 tokens in · 38,112 out · $4.12");
    expect(body).toContain(`**Ticket** — #${String(built.issue)} closed`);
    expect(body).not.toContain("An earlier summary.");
  });

  it("writes the epic note when toggled, once", async () => {
    const built = build();

    await built.executor.plan(ORG, "pr-514");
    built.store.state.plan = {
      ...(built.store.state.plan as NonNullable<typeof built.store.state.plan>),
      backAnnotateEpic: true,
      epicId: "epic-ota",
    };
    built.store.state.gates = GREEN;

    const outcome = await built.executor.merge(ORG, "pr-514", KEN);

    expect(built.store.state.epicNotes).toHaveLength(1);
    expect(built.store.state.epicNotes[0]).toMatchObject({ epicId: "epic-ota", prId: "pr-514" });
    expect(built.store.state.epicNotes[0].body).toMatch(
      /^merged PR #\d+ — fix\(can\): preserve ISR frame order in telemetry path · closes #\d+ · [0-9a-f]{7}$/,
    );
    expect(outcome.plan.mergedResult?.actionsExecuted).toContain("back_annotate_epic");
  });

  it("records the configured token, never a [bot] identity, while merges are token-based", async () => {
    const built = build({ merger: "ouroboros-app[bot]" });

    built.store.state.gates = GREEN;

    const outcome = await built.executor.merge(ORG, "pr-514", KEN);

    expect(outcome.plan.mergedResult?.identityUsed).toBe(TOKEN_IDENTITY);
  });

  it("records the direct caller as the merge's actor", async () => {
    const built = build();

    built.store.state.gates = GREEN;
    await built.executor.merge(ORG, "pr-514", { id: "user-mara", roles: ADMIN });

    expect(built.store.state.audit).toEqual([{ action: "merged", actorId: "user-mara" }]);
  });

  it("keeps the merge when mirroring it afterwards fails", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const built = build();

    built.adapter.sync = () => Promise.reject(new Error("host down"));
    built.store.state.gates = GREEN;

    await expect(built.executor.merge(ORG, "pr-514", KEN)).resolves.toMatchObject({
      plan: { mergedResult: { identityUsed: IN_MEMORY_MERGER } },
    });
    expect(warn).toHaveBeenCalledWith("Could not mirror the merge of pr pr-514.", "host down");
    warn.mockRestore();
  });
});

describe("MergeExecutorService — arm, disarm and merge routes", () => {
  it("refuses arming against a revision that is no longer the head", async () => {
    const built = build();

    await expect(built.executor.arm(ORG, "pr-514", KEN, "rev-0")).rejects.toMatchObject({
      code: "merge_revision_stale",
    });
  });

  it("refuses arming a PR that is blocked, open, or already merged", async () => {
    const built = build();

    built.store.state.pr = { ...built.store.state.pr, state: "blocked" };
    await expect(built.executor.arm(ORG, "pr-514", KEN, "rev-1")).rejects.toMatchObject({
      code: "merge_plan_not_armable",
    });

    built.store.state.pr = { ...built.store.state.pr, state: "verifying" };
    built.store.state.gates = GREEN;
    await built.executor.merge(ORG, "pr-514", KEN);
    await expect(built.executor.arm(ORG, "pr-514", KEN, "rev-1")).rejects.toMatchObject({
      code: "merge_plan_merged",
    });
    await expect(built.executor.merge(ORG, "pr-514", KEN)).rejects.toMatchObject({
      code: "merge_plan_merged",
    });
  });

  it("lets a member arm only when the pinned workflow auto-merges", async () => {
    const built = build();
    const member = { id: "user-sam", roles: MEMBER };

    await expect(built.executor.arm(ORG, "pr-514", member, "rev-1")).rejects.toMatchObject({
      code: "merge_not_policy_eligible",
    });

    built.store.autoMerge = true;

    await expect(built.executor.arm(ORG, "pr-514", member, "rev-1")).resolves.toMatchObject({
      armed: true,
      armedBy: "user-sam",
    });
  });

  it("answers a repeated arm with the plan unchanged, and audits one arm", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");

    expect(built.store.state.audit).toEqual([{ action: "armed", actorId: "user-ken" }]);
  });

  it("disarms for a person, naming them, and puts the PR back to verifying", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");

    const plan = await built.executor.disarm(ORG, "pr-514", { id: "user-mara" });

    expect(plan).toMatchObject({ armed: false, disarmReason: null, armedBy: null });
    expect(built.store.state.pr.state).toBe("verifying");
    expect(built.store.state.audit.at(-1)).toEqual({ action: "disarmed", actorId: "user-mara" });
    await expect(built.executor.disarm(ORG, "pr-514", { id: "user-mara" })).resolves.toMatchObject({
      armed: false,
    });
  });

  it("refuses a direct merge of pending gates without touching the plan", async () => {
    const built = build();

    await expect(built.executor.merge(ORG, "pr-514", KEN)).rejects.toMatchObject({
      code: "merge_recheck_failed",
      details: { reason: "gates_pending", disarmed: false },
    });
    expect(built.adapter.merge).not.toHaveBeenCalled();
  });

  it("refuses a direct merge that finds a red gate, and disarms an armed plan", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.settled();
    built.store.state.gates = RED;

    await expect(built.executor.merge(ORG, "pr-514", KEN)).rejects.toMatchObject({
      code: "merge_recheck_failed",
      details: { reason: "gate_red", disarmed: true },
    });
  });

  it("answers 404 for a PR of another workspace, on every route", async () => {
    const built = build();

    await expect(built.executor.plan("org-other", "pr-514")).rejects.toMatchObject({
      code: "pull_request_not_found",
    });
    await expect(built.executor.arm("org-other", "pr-514", KEN, "rev-1")).rejects.toMatchObject({
      code: "pull_request_not_found",
    });
    await expect(built.executor.disarm("org-other", "pr-514", KEN)).rejects.toMatchObject({
      code: "pull_request_not_found",
    });
    await expect(built.executor.merge("org-other", "pr-514", KEN)).rejects.toMatchObject({
      code: "pull_request_not_found",
    });
  });

  it("materializes the plan with the defaults on a first read", async () => {
    const built = build();

    expect(await built.executor.plan(ORG, "pr-514")).toMatchObject({
      strategy: "squash",
      deleteBranch: true,
      closeTicket: true,
      commentEvidence: true,
      backAnnotateEpic: false,
      armed: false,
      mergedResult: null,
    });
  });

  it("stops listening at shutdown", async () => {
    const built = build();

    await built.executor.arm(ORG, "pr-514", KEN, "rev-1");
    await built.executor.settled();
    built.executor.onModuleDestroy();
    built.store.state.gates = GREEN;
    await evaluated(built);

    expect(built.host.ledger().merged).toEqual([]);
  });

  it("logs, and survives, a scheduled run that throws", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const built = build();

    built.store.plan = () => Promise.reject(new Error("pool exhausted"));
    await evaluated(built);

    expect(error).toHaveBeenCalledWith("The armed merge of pr pr-514 failed.", "pool exhausted");
    error.mockRestore();
  });
});

describe("MergeExecutorService — editing the plan (#369)", () => {
  /**
   * The fixture, with the workspace's epics on its roadmap.
   *
   * @returns Everything a case needs.
   */
  function editable() {
    const built = build();

    built.store.state.epics = [OTA, BLE];
    built.store.people.set("user-ken", "Ken S");

    return built;
  }

  it("round-trips the message and each toggle, one field at a time", async () => {
    const { executor } = editable();

    expect(
      await executor.edit(ORG, "pr-514", KEN, { commitMessage: "fix(can): reworded" }),
    ).toMatchObject({ commitMessage: "fix(can): reworded", closeTicket: true });
    expect(await executor.edit(ORG, "pr-514", KEN, { closeTicket: false })).toMatchObject({
      commitMessage: "fix(can): reworded",
      closeTicket: false,
      commentEvidence: true,
    });
    expect(await executor.edit(ORG, "pr-514", KEN, { commentEvidence: false })).toMatchObject({
      closeTicket: false,
      commentEvidence: false,
    });
    expect(await executor.plan(ORG, "pr-514")).toMatchObject({
      commitMessage: "fix(can): reworded",
      closeTicket: false,
      commentEvidence: false,
      backAnnotateEpic: false,
      epicId: null,
    });
  });

  it("round-trips the epic picker: choose, switch on, choose another, clear", async () => {
    const { executor } = editable();

    expect(await executor.edit(ORG, "pr-514", KEN, { epicId: OTA })).toMatchObject({
      epicId: OTA,
      backAnnotateEpic: false,
    });
    expect(await executor.edit(ORG, "pr-514", KEN, { backAnnotateEpic: true })).toMatchObject({
      epicId: OTA,
      backAnnotateEpic: true,
    });
    expect(await executor.edit(ORG, "pr-514", KEN, { epicId: BLE })).toMatchObject({
      epicId: BLE,
      backAnnotateEpic: true,
    });
    // Nothing left to annotate: the toggle goes with the epic.
    expect(await executor.edit(ORG, "pr-514", KEN, { epicId: null })).toMatchObject({
      epicId: null,
      backAnnotateEpic: false,
    });
  });

  it("audits every edit with its actor and the columns that changed — never the message", async () => {
    const { executor, store } = editable();

    await executor.edit(ORG, "pr-514", KEN, { commitMessage: "fix(can): reworded" });
    await executor.edit(ORG, "pr-514", KEN, { epicId: OTA, backAnnotateEpic: true });

    expect(store.state.audit).toEqual([
      { action: "edited", actorId: "user-ken", fields: ["commit_message"] },
      { action: "edited", actorId: "user-ken", fields: ["back_annotate_epic", "epic_id"] },
    ]);
  });

  it("writes nothing for an edit that changes nothing", async () => {
    const { executor, store } = editable();
    const before = await executor.plan(ORG, "pr-514");

    expect(await executor.edit(ORG, "pr-514", KEN, {})).toEqual(before);
    expect(await executor.edit(ORG, "pr-514", KEN, { closeTicket: true })).toEqual(before);
    expect(
      await executor.edit(ORG, "pr-514", KEN, {
        commitMessage: undefined,
        closeTicket: undefined,
        commentEvidence: undefined,
        backAnnotateEpic: undefined,
        epicId: undefined,
      }),
    ).toEqual(before);
    expect(store.state.audit).toEqual([]);
  });

  it("materializes a plan nobody has read yet, then edits it", async () => {
    const { executor, store } = editable();

    expect(store.state.plan).toBeUndefined();
    expect(await executor.edit(ORG, "pr-514", KEN, { closeTicket: false })).toMatchObject({
      strategy: "squash",
      deleteBranch: true,
      closeTicket: false,
    });
  });

  it("refuses switching back-annotate on with no epic, and an edit that contradicts itself", async () => {
    const { executor, store } = editable();

    await expect(
      executor.edit(ORG, "pr-514", KEN, { backAnnotateEpic: true }),
    ).rejects.toMatchObject({ status: 422, code: "merge_plan_epic_required" });

    await executor.edit(ORG, "pr-514", KEN, { epicId: OTA, backAnnotateEpic: true });
    await expect(
      executor.edit(ORG, "pr-514", KEN, { epicId: null, backAnnotateEpic: true }),
    ).rejects.toMatchObject({ status: 422, code: "merge_plan_epic_required" });
    expect(store.state.plan).toMatchObject({ epicId: OTA, backAnnotateEpic: true });
  });

  it("refuses an epic that is not this workspace's, as one that does not exist", async () => {
    const { executor, store } = editable();

    await expect(executor.edit(ORG, "pr-514", KEN, { epicId: FOREIGN })).rejects.toMatchObject({
      status: 422,
      code: "merge_plan_epic_not_found",
      details: { epicId: FOREIGN },
    });
    expect(store.state.plan?.epicId ?? null).toBeNull();
    expect(store.state.audit).toEqual([]);
  });

  it("answers an epic that went between the read and the write as not found, not a 500", async () => {
    const { executor, store } = editable();

    store.vanishing = BLE;

    await expect(executor.edit(ORG, "pr-514", KEN, { epicId: BLE })).rejects.toMatchObject({
      status: 422,
      code: "merge_plan_epic_not_found",
    });
    // The transaction rolled back: no plan was left half-written.
    expect(store.state.plan?.epicId ?? null).toBeNull();
  });

  it("refuses editing an armed plan, and allows it again once disarmed", async () => {
    const { executor, store } = editable();

    await executor.arm(ORG, "pr-514", KEN, "rev-1");
    await executor.settled();

    await expect(executor.edit(ORG, "pr-514", KEN, { closeTicket: false })).rejects.toMatchObject({
      status: 409,
      code: "merge_plan_armed",
    });
    expect(store.state.plan).toMatchObject({ armed: true, closeTicket: true });

    await executor.disarm(ORG, "pr-514", KEN);

    expect(await executor.edit(ORG, "pr-514", KEN, { closeTicket: false })).toMatchObject({
      armed: false,
      closeTicket: false,
    });
  });

  it("refuses editing a merged plan, and the plan of a PR its host owns", async () => {
    const closed = editable();

    closed.store.state.pr = { ...closed.store.state.pr, state: "closed" };
    await expect(
      closed.executor.edit(ORG, "pr-514", KEN, { closeTicket: false }),
    ).rejects.toMatchObject({ status: 409, code: "pull_request_not_open" });

    // Merged on the host, not by this plan: there is no merged_result to be final.
    const elsewhere = editable();

    elsewhere.store.state.pr = { ...elsewhere.store.state.pr, state: "merged" };
    await expect(
      elsewhere.executor.edit(ORG, "pr-514", KEN, { closeTicket: false }),
    ).rejects.toMatchObject({ status: 409, code: "pull_request_not_open" });

    const merged = editable();

    merged.store.state.gates = GREEN;
    await merged.executor.merge(ORG, "pr-514", KEN);
    await expect(
      merged.executor.edit(ORG, "pr-514", KEN, { closeTicket: false }),
    ).rejects.toMatchObject({ status: 409, code: "merge_plan_merged" });
    expect(merged.store.state.plan?.closeTicket).toBe(true);
  });

  it("lets a member edit only when the pinned workflow auto-merges, and writes no plan otherwise", async () => {
    const { executor, store } = editable();
    const member = { id: "user-sam", roles: MEMBER };

    await expect(
      executor.edit(ORG, "pr-514", member, { closeTicket: false }),
    ).rejects.toMatchObject({ status: 403, code: "merge_not_policy_eligible" });
    // Refused before any transaction: not even the default plan was written.
    expect(store.state.plan).toBeUndefined();
    expect(store.transactions).toBe(0);

    store.autoMerge = true;

    expect(await executor.edit(ORG, "pr-514", member, { closeTicket: false })).toMatchObject({
      closeTicket: false,
    });
    expect(store.state.audit.at(-1)).toMatchObject({ action: "edited", actorId: "user-sam" });
  });

  it("refuses a viewer, whatever the pin", async () => {
    const { executor, store } = editable();

    store.autoMerge = true;

    await expect(
      executor.edit(ORG, "pr-514", { id: "user-vi", roles: ["viewer"] }, { closeTicket: false }),
    ).rejects.toMatchObject({ code: "merge_not_policy_eligible" });
  });

  it("answers 404 for a PR of another workspace", async () => {
    const { executor } = editable();

    await expect(
      executor.edit("org-other", "pr-514", KEN, { closeTicket: false }),
    ).rejects.toMatchObject({ code: "pull_request_not_found" });
  });

  it("merges the edited message, and leaves a ticket its keyword no longer names open", async () => {
    const built = editable();
    const { executor, store, host, adapter } = built;

    await executor.edit(ORG, "pr-514", KEN, { commitMessage: "fix(can): preserve frame order" });
    store.state.gates = GREEN;

    const outcome = await executor.merge(ORG, "pr-514", KEN);

    expect(adapter.merge).toHaveBeenCalledWith(
      ORG,
      CONTEXT.sourceId,
      built.pull.number,
      expect.objectContaining({ message: "fix(can): preserve frame order" }),
    );
    // The toggle was left on, and the message no longer closes: reported, never assumed.
    expect(outcome.plan.closeTicket).toBe(true);
    expect(outcome.plan.mergedResult?.actionsExecuted).not.toContain("close_ticket");
    expect(outcome.failedActions.map((failure) => failure.action)).toContain("close_ticket");
    expect(host.ledger().closedIssues).toEqual([]);
  });
});

describe("MergeExecutorService — who armed (#369)", () => {
  it("names the person who armed, and nobody once disarmed", async () => {
    const built = build();

    built.store.people.set("user-ken", "Ken S");

    expect(await built.executor.arm(ORG, "pr-514", KEN, "rev-1")).toMatchObject({
      armedBy: "user-ken",
      armedByPerson: { id: "user-ken", name: "Ken S" },
    });
    expect(await built.executor.plan(ORG, "pr-514")).toMatchObject({
      armedByPerson: { id: "user-ken", name: "Ken S" },
    });
    expect(await built.executor.disarm(ORG, "pr-514", KEN)).toMatchObject({
      armedBy: null,
      armedByPerson: null,
    });
  });

  it("names nobody for a person who has since gone — the arm is still an arm", async () => {
    const built = build();

    expect(await built.executor.arm(ORG, "pr-514", KEN, "rev-1")).toMatchObject({
      armed: true,
      armedBy: "user-ken",
      armedByPerson: null,
    });
  });

  it("names nobody on a merged plan — the receipt states the host's identity instead", async () => {
    const built = build();

    built.store.people.set("user-ken", "Ken S");
    built.store.state.gates = GREEN;

    const outcome = await built.executor.merge(ORG, "pr-514", KEN);

    expect(outcome.plan).toMatchObject({ armedBy: null, armedByPerson: null });
    expect(outcome.plan.mergedResult?.identityUsed).toBe(IN_MEMORY_MERGER);
  });
});

describe("refusedEdit", () => {
  it("reads V058's refusal by the constraint's name", () => {
    expect(
      refusedEdit(
        "pr-514",
        null,
        new MemoryConstraintFailure("23514", "pr_merge_plans_back_annotate_has_epic"),
      ),
    ).toMatchObject({ status: 422, code: "merge_plan_epic_required" });
    expect(
      refusedEdit(
        "pr-514",
        OTA,
        new MemoryConstraintFailure("23514", "pr_merge_plans_epic_in_organization"),
      ),
    ).toMatchObject({ status: 422, code: "merge_plan_epic_not_found", details: { epicId: OTA } });
    expect(
      refusedEdit(
        "pr-514",
        OTA,
        new MemoryConstraintFailure("23503", "pr_merge_plans_epic_id_fkey"),
      ),
    ).toMatchObject({ status: 422, code: "merge_plan_epic_not_found" });
    expect(
      refusedEdit(
        "pr-514",
        null,
        new MemoryConstraintFailure("23514", "pr_merge_plans_merged_final"),
      ),
    ).toMatchObject({ status: 409, code: "merge_plan_merged" });
  });

  it("passes on what it does not know, so nothing is mistaken for a bad epic", () => {
    const blank = new MemoryConstraintFailure("23514", "pr_merge_plans_commit_message_present");
    const dropped = new Error("connection terminated");

    expect(refusedEdit("pr-514", OTA, blank)).toBe(blank);
    expect(refusedEdit("pr-514", OTA, dropped)).toBe(dropped);
    expect(refusedEdit("pr-514", OTA, { code: "23514" })).toEqual({ code: "23514" });
  });
});

describe("mayMerge", () => {
  it("lets an owner or admin always, a member only under an auto-merging pin, a viewer never", () => {
    expect(mayMerge(["owner"], false)).toBe(true);
    expect(mayMerge(["admin"], false)).toBe(true);
    expect(mayMerge(["member"], false)).toBe(false);
    expect(mayMerge(["member"], true)).toBe(true);
    expect(mayMerge(["viewer"], true)).toBe(false);
  });
});

describe("hostFailure", () => {
  it("never passes a provider's detail through", () => {
    expect(hostFailure("comment", new Error("secret token abc"))).toBe(
      "The host could not comment.",
    );
  });
});

describe("MergeExecutorService — the dry-run policy (BA.3, #382)", () => {
  it("refuses an arm with the designed, machine-readable reason, and arms nothing", async () => {
    const { store, executor } = build({ dryRun: true });

    await expect(executor.arm(ORG, "pr-514", KEN, "rev-1")).rejects.toMatchObject({
      status: 409,
      response: {
        code: "dry_run_policy_active",
        message: expect.stringContaining("dry-run policy active") as string,
        details: { prId: "pr-514", reason: "dry_run_policy_active", policy: "dry_run" },
      },
    });
    expect(store.state.plan?.armed ?? false).toBe(false);
    expect(store.state.pr.state).toBe("verifying");
    expect(store.state.audit).toEqual([]);
  });

  it("refuses a direct merge of a green PR, and never calls the host's merge", async () => {
    const built = build({ dryRun: true });

    built.store.state.gates = GREEN;

    await expect(built.executor.merge(ORG, "pr-514", KEN)).rejects.toMatchObject({
      response: { code: "dry_run_policy_active" },
    });
    expect(built.adapter.merge).not.toHaveBeenCalled();
    expect(built.host.ledger().merged).toEqual([]);
  });

  it("re-checks at execution: a plan armed before dry-run turned on is disarmed, never merged", async () => {
    const built = build();
    const { store, executor, host, policy } = built;

    await executor.arm(ORG, "pr-514", KEN, "rev-1");
    await executor.settled();

    // Dry-run turns on while the plan waits; then the last gate flips.
    policy.active = true;
    await store.gateEvaluation((state) => {
      state.gates = GREEN;
    });
    const readsBefore = policy.reads;
    await evaluated(built);

    expect(host.ledger().merged).toEqual([]);
    expect(built.adapter.merge).not.toHaveBeenCalled();
    expect(policy.reads).toBeGreaterThan(readsBefore);
    expect(store.state.plan?.armed).toBe(false);
    expect(parseDisarmReason(store.state.plan?.disarmReason ?? null)).toEqual({
      code: "dry_run_policy_active",
      message: expect.stringContaining("dry-run policy active") as string,
    });
    expect(store.state.pr.state).toBe("verifying");
  });

  it("answers a direct merge that meets dry-run at execution with the same designed refusal", async () => {
    const built = build();
    const { executor, policy } = built;

    built.store.state.gates = GREEN;
    // Off at the route's check, on by the time the run reads it.
    let reads = 0;
    policy.dryRunNow = () => {
      reads += 1;
      return Promise.resolve(reads > 1);
    };

    await expect(executor.merge(ORG, "pr-514", KEN)).rejects.toMatchObject({
      response: { code: "dry_run_policy_active" },
    });
    expect(built.adapter.merge).not.toHaveBeenCalled();
  });

  it("renders the policy on the plan, overriding a workflow's auto-merge without touching it", async () => {
    const { store, executor } = build({ dryRun: true });

    store.autoMerge = true;

    await expect(executor.plan(ORG, "pr-514")).resolves.toMatchObject({
      dryRun: {
        active: true,
        reason: "dry-run policy active",
        autoMerge: { requested: true, effective: false, overridden: true },
      },
    });
    // The pinned workflow still asks for auto-merge — overridden, not mutated.
    expect(store.autoMerge).toBe(true);
  });

  it("restores the workflow's auto-merge exactly once dry-run is off", async () => {
    const built = build({ dryRun: true });
    const { store, executor, policy, host, pull } = built;

    store.autoMerge = true;
    await expect(executor.arm(ORG, "pr-514", KEN, "rev-1")).rejects.toMatchObject({
      response: { code: "dry_run_policy_active" },
    });

    policy.active = false;

    await expect(executor.plan(ORG, "pr-514")).resolves.toMatchObject({
      dryRun: {
        active: false,
        reason: null,
        autoMerge: { requested: true, effective: true, overridden: false },
      },
    });

    // And the merge path is the one it always was.
    await executor.arm(ORG, "pr-514", KEN, "rev-1");
    await store.gateEvaluation((state) => {
      state.gates = GREEN;
    });
    await evaluated(built);
    expect(host.ledger().merged).toEqual([pull.number]);
  });

  it("still lets anyone disarm, and anyone read, while dry-run is active", async () => {
    const built = build();
    const { executor, policy, store } = built;

    await executor.arm(ORG, "pr-514", KEN, "rev-1");
    policy.active = true;

    await expect(executor.disarm(ORG, "pr-514", { id: "user-mara" })).resolves.toMatchObject({
      armed: false,
      dryRun: { active: true },
    });
    expect(store.state.plan?.armed).toBe(false);
  });
});

/** Mockup 17's policy v7: auto-merge `effort ≤ M · non-refactor`, a new repo's first 10 loops in dry-run. */
const POLICY_V7: PublishedOrgPolicy = {
  version: 7,
  publishedAt: new Date("2026-10-04T13:48:00Z"),
  rules: {
    auto_merge: {
      enabled: true,
      conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] },
    },
    human_review: {
      enabled: true,
      conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
    },
    dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
  },
};

describe("MergeExecutorService — the org policy's auto_merge rule (BQ.2, #481)", () => {
  /** A PR whose workflow auto-merges, past its repository's dry-run loops, under policy v7. */
  function eligible() {
    const built = build({ orgPolicy: POLICY_V7 });

    built.store.autoMerge = true;
    built.store.facts = { ticket: { labels: ["bug"], effort: "s" }, loop: 11 };

    return built;
  }

  const member = { id: "user-sam", roles: MEMBER };

  it("makes a small non-refactor PR with green gates eligible — a member may arm it and it merges", async () => {
    const built = eligible();
    const { store, executor, host, pull } = built;

    built.store.memberRoles.set("user-sam", MEMBER);
    await expect(executor.arm(ORG, "pr-514", member, "rev-1")).resolves.toMatchObject({
      armed: true,
      autoMergePolicy: { eligible: true, ruleId: "auto_merge", version: 7 },
      dryRun: { active: false, autoMerge: { requested: true, effective: true } },
    });

    await store.gateEvaluation((state) => {
      state.gates = GREEN;
    });
    await evaluated(built);

    expect(host.ledger().merged).toEqual([pull.number]);
  });

  it.each([
    ["the refactor label", { labels: ["bug", "refactor"], effort: "s" as const }],
    ["effort above M", { labels: ["bug"], effort: "l" as const }],
  ])(
    "makes it ineligible with %s — a member's arm is refused, naming the rule and version",
    async (_why, ticket) => {
      const built = eligible();

      built.store.facts = { ticket, loop: 11 };

      await expect(built.executor.arm(ORG, "pr-514", member, "rev-1")).rejects.toMatchObject({
        status: 403,
        response: {
          code: "merge_not_policy_eligible",
          message: expect.stringContaining(
            "does not meet the auto_merge conditions in policy v7",
          ) as string,
          details: { prId: "pr-514", ruleId: "auto_merge", policyVersion: 7 },
        },
      });
      expect(built.store.state.plan?.armed ?? false).toBe(false);
      expect(await built.executor.plan(ORG, "pr-514")).toMatchObject({
        autoMergePolicy: { eligible: false, version: 7 },
        dryRun: { autoMerge: { requested: true, effective: false, overridden: false } },
      });
    },
  );

  it("re-checks at execution: a refactor label added after a member armed it refuses the merge", async () => {
    const built = eligible();
    const { store, executor, host } = built;

    store.memberRoles.set("user-sam", MEMBER);
    await executor.arm(ORG, "pr-514", member, "rev-1");

    store.facts = { ticket: { labels: ["refactor"], effort: "s" }, loop: 11 };
    await store.gateEvaluation((state) => {
      state.gates = GREEN;
    });
    await evaluated(built);

    expect(host.ledger().merged).toEqual([]);
    expect(store.state.plan?.armed).toBe(false);
    expect(parseDisarmReason(store.state.plan?.disarmReason ?? null)).toEqual({
      code: "auto_merge_policy_ineligible",
      message: expect.stringContaining("auto_merge conditions in policy v7") as string,
    });
  });

  it("re-checks with the version in force at execution — a publish switching auto-merge off stops it", async () => {
    const built = eligible();
    const { store, executor, host, orgPolicy } = built;

    store.memberRoles.set("user-sam", MEMBER);
    await executor.arm(ORG, "pr-514", member, "rev-1");

    orgPolicy.current = {
      ...POLICY_V7,
      version: 8,
      rules: { ...POLICY_V7.rules, auto_merge: { ...POLICY_V7.rules.auto_merge, enabled: false } },
    };
    await store.gateEvaluation((state) => {
      state.gates = GREEN;
    });
    await evaluated(built);

    expect(host.ledger().merged).toEqual([]);
    expect(parseDisarmReason(store.state.plan?.disarmReason ?? null)?.message).toContain(
      "Auto-merge is off in policy v8.",
    );
  });

  it("lets a plan an owner or admin armed merge — they decided for themselves", async () => {
    const built = eligible();
    const { store, executor, host, pull } = built;

    store.facts = { ticket: { labels: ["refactor"], effort: "s" }, loop: 11 };
    store.memberRoles.set("user-ken", ADMIN);
    await executor.arm(ORG, "pr-514", KEN, "rev-1");
    await store.gateEvaluation((state) => {
      state.gates = GREEN;
    });
    await evaluated(built);

    expect(host.ledger().merged).toEqual([pull.number]);
  });

  it("refuses an armed plan whose armer has since left the workspace", async () => {
    const built = eligible();
    const { store, executor, host } = built;

    store.memberRoles.set("user-ken", ADMIN);
    await executor.arm(ORG, "pr-514", KEN, "rev-1");
    store.memberRoles.delete("user-ken");
    store.facts = { ticket: { labels: ["refactor"], effort: "s" }, loop: 11 };
    await store.gateEvaluation((state) => {
      state.gates = GREEN;
    });
    await evaluated(built);

    expect(host.ledger().merged).toEqual([]);
    expect(parseDisarmReason(store.state.plan?.disarmReason ?? null)?.code).toBe(
      "auto_merge_policy_ineligible",
    );
  });

  it("changes nothing for a workspace that has published no policy", async () => {
    const built = build();

    built.store.autoMerge = true;
    built.store.facts = { ticket: { labels: ["refactor"], effort: "xl" }, loop: 1 };

    await expect(built.executor.arm(ORG, "pr-514", member, "rev-1")).resolves.toMatchObject({
      armed: true,
      autoMergePolicy: { eligible: true, version: null },
      dryRun: { active: false, source: null },
    });
  });

  it("does not let the rule widen anything — a workflow that does not auto-merge still needs an admin", async () => {
    const built = eligible();

    built.store.autoMerge = false;

    await expect(built.executor.arm(ORG, "pr-514", member, "rev-1")).rejects.toMatchObject({
      response: { code: "merge_not_policy_eligible", details: { prId: "pr-514" } },
    });
  });
});

describe("MergeExecutorService — dry-run for a new repository's first loops (BQ.2, #481)", () => {
  it("refuses arming a PR inside its repository's first 10 loops, naming the rule — the switch is off", async () => {
    const built = build({ orgPolicy: POLICY_V7 });

    built.store.facts = { ticket: { labels: [], effort: "s" }, loop: 3 };

    await expect(built.executor.arm(ORG, "pr-514", KEN, "rev-1")).rejects.toMatchObject({
      status: 409,
      response: {
        code: "dry_run_policy_active",
        message: expect.stringContaining(
          "Loop 3 of this repository is inside the first 10",
        ) as string,
        details: { source: "dry_run_new_repos", policyVersion: 7 },
      },
    });
    expect(await built.executor.plan(ORG, "pr-514")).toMatchObject({
      dryRun: { active: true, source: "dry_run_new_repos", policyVersion: 7 },
    });
  });

  it("lets the 11th loop merge", async () => {
    const built = build({ orgPolicy: POLICY_V7 });

    built.store.facts = { ticket: { labels: [], effort: "s" }, loop: 11 };
    built.store.state.gates = GREEN;

    await expect(built.executor.merge(ORG, "pr-514", KEN)).resolves.toMatchObject({
      plan: { dryRun: { active: false, source: null } },
    });
    expect(built.host.ledger().merged).toEqual([built.pull.number]);
  });

  it("keeps the org-wide switch the stricter override — the 11th loop is refused while it is on", async () => {
    const built = build({ orgPolicy: POLICY_V7, dryRun: true });

    built.store.facts = { ticket: { labels: [], effort: "s" }, loop: 11 };

    await expect(built.executor.arm(ORG, "pr-514", KEN, "rev-1")).rejects.toMatchObject({
      response: {
        code: "dry_run_policy_active",
        details: { source: "org_override", policyVersion: null },
      },
    });
  });

  it("disarms at execution a plan whose repository count says dry-run — read with the uncached policy", async () => {
    const built = build({ orgPolicy: POLICY_V7 });
    const { store, executor, host } = built;

    store.facts = { ticket: { labels: [], effort: "s" }, loop: 11 };
    await executor.arm(ORG, "pr-514", KEN, "rev-1");

    built.orgPolicy.current = {
      ...POLICY_V7,
      version: 8,
      rules: {
        ...POLICY_V7.rules,
        dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 20 } },
      },
    };
    await store.gateEvaluation((state) => {
      state.gates = GREEN;
    });
    await evaluated(built);

    expect(host.ledger().merged).toEqual([]);
    expect(parseDisarmReason(store.state.plan?.disarmReason ?? null)).toEqual({
      code: "dry_run_policy_active",
      message: expect.stringContaining("policy v8") as string,
    });
  });
});

/**
 * An in-memory {@link MergeStore} — one PR, its plan, its gates and the rows a merge writes — for
 * the executor's unit suite.
 *
 * AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)). **Its transaction is a lock.**
 * PostgreSQL's `for update` on the PR row is what serialises the executor with the gate engine;
 * here every transaction and every {@link MemoryMergeStore.gateEvaluation} queue on one mutex, so a
 * suite can start a gate evaluation while the executor is mid-merge and watch it wait. A transaction
 * that throws rolls its writes back, as PostgreSQL's would.
 *
 * It is a `.fixture.ts`: nothing that ships imports it.
 */

import type { OrganizationRole, PrMergedResult, PullRequestState } from "../../db/schema";
import type { SpendTotals } from "../../runs/run.spend";
import type { SummaryGate } from "./merge.evidence";
import type { RecheckGates, RecheckRevision } from "./merge.recheck";
import type {
  LockedPr,
  MergePr,
  MergeStore,
  MergeTransaction,
  StoredMergePlan,
} from "./merge.repository";

/** An audit row the V058/V064 trigger would write. */
export interface MemoryAuditRow {
  readonly action: "armed" | "disarmed" | "merged";
  readonly actorId: string | null;
}

/** The whole state, cloned per transaction for rollback. */
export interface MemoryState {
  pr: MergePr;
  plan: StoredMergePlan | undefined;
  revisions: RecheckRevision[];
  gates: RecheckGates;
  summary: SummaryGate[];
  epicNotes: { epicId: string; prId: string; body: string }[];
  run: { status: string; prNumber: number | null; finished: boolean } | null;
  audit: MemoryAuditRow[];
}

/** A plan with the table's defaults. */
function defaultPlan(prId: string, message: string): StoredMergePlan {
  return {
    id: `plan-${prId}`,
    prId,
    strategy: "squash",
    deleteBranch: true,
    commitMessage: message,
    closeTicket: true,
    commentEvidence: true,
    backAnnotateEpic: false,
    epicId: null,
    armed: false,
    armedBy: null,
    armedAt: null,
    armedAgainstRevisionId: null,
    disarmReason: null,
    mergedResult: null,
    updatedAt: new Date("2026-09-27T10:00:00Z"),
  };
}

/** The in-memory store. */
export class MemoryMergeStore implements MergeStore {
  /** The state — readable and writable by the suite between runs. */
  state: MemoryState;

  /** Whether the PR's pinned workflow auto-merges. */
  autoMerge = false;

  /** How many transactions ran. */
  transactions = 0;

  /** The lock's tail. */
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * @param pr - The PR.
   * @param options - Its revisions, gates and run.
   */
  constructor(
    pr: MergePr,
    options: {
      readonly revisions: RecheckRevision[];
      readonly gates: RecheckGates;
      readonly summary?: SummaryGate[];
      readonly run?: boolean;
    },
  ) {
    this.state = {
      pr,
      plan: undefined,
      revisions: options.revisions,
      gates: options.gates,
      summary: options.summary ?? [],
      epicNotes: [],
      run: options.run === false ? null : { status: "review", prNumber: null, finished: false },
      audit: [],
    };
  }

  /** @inheritdoc */
  pr(organizationId: string, prId: string): Promise<MergePr | undefined> {
    const { pr } = this.state;

    return Promise.resolve(
      pr.id === prId && pr.organizationId === organizationId ? { ...pr } : undefined,
    );
  }

  /** @inheritdoc */
  plan(prId: string): Promise<StoredMergePlan | undefined> {
    return Promise.resolve(this.state.pr.id === prId ? this.state.plan : undefined);
  }

  /** @inheritdoc */
  autoMerges(): Promise<boolean> {
    return Promise.resolve(this.autoMerge);
  }

  /** @inheritdoc */
  transaction<T>(work: (tx: MergeTransaction) => Promise<T>): Promise<T> {
    return this.locked(async () => {
      this.transactions += 1;

      const before = structuredClone(this.state);

      try {
        return await work(new MemoryMergeTransaction(this.state));
      } catch (error) {
        this.state = before;
        throw error;
      }
    });
  }

  /**
   * A gate evaluation — the gate engine's transaction, on the same lock.
   *
   * @param change - What the evaluation writes.
   * @returns When it has run.
   */
  gateEvaluation(change: (state: MemoryState) => void | Promise<void>): Promise<void> {
    return this.locked(async () => {
      await change(this.state);
    });
  }

  /**
   * Run something under the lock.
   *
   * @param work - What to run.
   * @returns What it returned.
   */
  private locked<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work);

    this.tail = run.catch(() => undefined);

    return run;
  }
}

/** One transaction over the state. */
class MemoryMergeTransaction implements MergeTransaction {
  /** @param state - The state. */
  constructor(private readonly state: MemoryState) {}

  /** @inheritdoc */
  lock(organizationId: string, prId: string): Promise<LockedPr | undefined> {
    const { pr } = this.state;

    if (pr.id !== prId || pr.organizationId !== organizationId) {
      return Promise.resolve(undefined);
    }

    return Promise.resolve({
      pr: { ...pr },
      plan: this.state.plan,
      latest: this.state.revisions.at(-1) ?? null,
    });
  }

  /** @inheritdoc */
  materialize(prId: string): Promise<StoredMergePlan> {
    this.state.plan ??= defaultPlan(
      prId,
      `${this.state.pr.title}\n\nCloses ${this.state.pr.ticketKey ?? "nothing"}.`,
    );

    return Promise.resolve(this.state.plan);
  }

  /** @inheritdoc */
  gates(): Promise<RecheckGates> {
    return Promise.resolve({ ...this.state.gates, red: [...this.state.gates.red] });
  }

  /** @inheritdoc */
  summaryGates(): Promise<SummaryGate[]> {
    return Promise.resolve(this.state.summary);
  }

  /** @inheritdoc */
  arm(planId: string, actorId: string, revisionId: string): Promise<StoredMergePlan> {
    return this.write(planId, (plan) => {
      if (!plan.armed) {
        this.state.audit.push({ action: "armed", actorId });
      }

      return {
        ...plan,
        armed: true,
        armedBy: actorId,
        armedAt: new Date(),
        armedAgainstRevisionId: revisionId,
        disarmReason: null,
      };
    });
  }

  /** @inheritdoc */
  disarm(
    planId: string,
    by: { actorId: string; reason: null } | { actorId: null; reason: string },
  ): Promise<StoredMergePlan> {
    return this.write(planId, (plan) => {
      if (plan.armed) {
        this.state.audit.push({
          action: "disarmed",
          actorId: by.reason === null ? by.actorId : null,
        });
      }

      return {
        ...plan,
        armed: false,
        armedBy: null,
        armedAt: null,
        armedAgainstRevisionId: null,
        disarmReason: by.reason,
      };
    });
  }

  /** @inheritdoc */
  recordMerge(
    planId: string,
    result: PrMergedResult,
    actorId: string | null,
  ): Promise<StoredMergePlan> {
    if (result.identity_used.toLowerCase().includes("[bot]")) {
      return Promise.reject(new Error("pr_merge_plans_identity_not_bot"));
    }

    return this.write(planId, (plan) => {
      this.state.audit.push({ action: "merged", actorId });

      return {
        ...plan,
        armed: false,
        armedBy: null,
        armedAt: null,
        armedAgainstRevisionId: null,
        disarmReason: null,
        mergedResult: result,
      };
    });
  }

  /** @inheritdoc */
  setPrState(_prId: string, state: PullRequestState): Promise<void> {
    this.state.pr = { ...this.state.pr, state };

    return Promise.resolve();
  }

  /** @inheritdoc */
  writeEpicNote(epicId: string, prId: string, body: string): Promise<void> {
    if (!this.state.epicNotes.some((note) => note.epicId === epicId && note.prId === prId)) {
      this.state.epicNotes.push({ epicId, prId, body });
    }

    return Promise.resolve();
  }

  /** @inheritdoc */
  finalizeRun(_organizationId: string, _runId: string, prNumber: number): Promise<boolean> {
    const { run } = this.state;

    if (run === null || run.finished) {
      return Promise.resolve(false);
    }

    this.state.run = { status: "merged", prNumber, finished: true };

    return Promise.resolve(true);
  }

  /** @inheritdoc */
  spend(): Promise<SpendTotals> {
    return Promise.resolve({
      tokensIn: 412_301,
      tokensOut: 38_112,
      costCents: "412",
      unpricedEvents: 0,
    });
  }

  /**
   * Update the plan.
   *
   * @param planId - The plan.
   * @param change - The update.
   * @returns The plan after it.
   */
  private write(
    planId: string,
    change: (plan: StoredMergePlan) => StoredMergePlan,
  ): Promise<StoredMergePlan> {
    const { plan } = this.state;

    if (plan?.id !== planId) {
      return Promise.reject(new Error(`no plan ${planId}`));
    }

    if (plan.mergedResult !== null) {
      return Promise.reject(new Error("pr_merge_plans_merged_final"));
    }

    this.state.plan = { ...change(plan), updatedAt: new Date() };

    return Promise.resolve(this.state.plan);
  }
}

/** Roles, for the suites' actors. */
export const ADMIN: readonly OrganizationRole[] = ["admin"];
/** A member's roles. */
export const MEMBER: readonly OrganizationRole[] = ["member"];

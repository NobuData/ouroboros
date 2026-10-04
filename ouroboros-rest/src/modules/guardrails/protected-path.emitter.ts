/**
 * The `protected_path_allow_once` emitter — AP.3's protected-path verdict files *"Allow a one-time
 * edit to a protected path?"*.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), AP.3
 * ([#305](https://github.com/NobuData/ouroboros/issues/305)). When a change-set report's
 * `allowed_paths` check fails on a protected path, the ingest service — after the report commits —
 * hands the run here, and this reads the verdict's evidence and the file's diff stat and files the
 * card with the diff context it needs to be answerable without leaving the page:
 *
 * ```
 * AP.3 verdict{protected path, run #1851} ─▶ emit(protected_path_allow_once,
 *   {subject, edit_summary: "add one line", path, diff_lines: 3}, key: guardrails / run:<id>:path:<path>)
 *   ─▶ item (warn) · pill +1
 * ```
 *
 * **Idempotent per stage attempt and retry.** AP.3 evaluates on every report of every attempt, so
 * one blocked run reports the same failure many times; the key is the run and the path, and the
 * registry's upsert keeps one card — refreshed with the newest diff stat — however often it fires.
 *
 * The verdict names the **first** protected path it refused (in code-unit order); a change-set
 * touching two protected paths files the first, and the second once the first is allowed.
 *
 * **Out-of-band settlement**: the run ending (merged, failed or cancelled from the console) closes
 * the card as `policy(source_resolved)`. A run waiting on a person (`needs_human`) is still asking.
 */

import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { clipFact, runCardFacts, type RunCardFacts } from "../decisions/decision.refs";
import type { DecisionEmission } from "../decisions/decision.types";
import { DecisionSourceWatcher, runTerminatedDetector } from "../decisions/decision.watchers";
import { describeForLog } from "../errors/failure";

/** The kind. */
export const PROTECTED_PATH_KIND = "protected_path_allow_once";

/** The plane's name in the idempotency key. */
export const PROTECTED_PATH_PLANE = "guardrails";

/** The run statuses after which an allow-once question is moot. */
export const RUN_ENDED_STATUSES = ["merged", "failed", "canceled"] as const;

/** Small counts read as words, the way the card reads — *add one line*. */
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * A count as the card says it.
 *
 * @param count - A whole number.
 * @param noun - The singular noun.
 * @returns `one line`, `3 → three lines`, `12 lines`.
 */
function counted(count: number, noun: string): string {
  const number = count < WORDS.length ? WORDS[count] : String(count);

  return `${number} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * What the edit does to the file, from its diff stat.
 *
 * @param additions - Lines added.
 * @param deletions - Lines removed.
 * @returns `add one line`, `remove two lines`, `change 14 lines`.
 */
export function editSummary(additions: number, deletions: number): string {
  if (deletions === 0) {
    return `add ${counted(additions, "line")}`;
  }

  if (additions === 0) {
    return `remove ${counted(deletions, "line")}`;
  }

  return `change ${counted(additions + deletions, "line")}`;
}

/** The verdict and the diff stat the card is composed from. */
export interface ProtectedPathFacts {
  readonly run: RunCardFacts;
  /** The protected path the verdict refused. */
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/**
 * The emission for one refused protected path.
 *
 * @param facts - The run, the path and its diff stat.
 * @returns The emission.
 */
export function protectedPathEmission(facts: ProtectedPathFacts): DecisionEmission {
  return {
    organizationId: facts.run.organizationId,
    kindId: PROTECTED_PATH_KIND,
    payload: {
      subject: clipFact(facts.run.subject, 120),
      edit_summary: clipFact(editSummary(facts.additions, facts.deletions), 80),
      path: facts.path,
      diff_lines: Math.max(1, facts.additions + facts.deletions),
    },
    refs: [...facts.run.refs, { type: "path", id: facts.path, label: facts.path }],
    key: { plane: PROTECTED_PATH_PLANE, sourceRef: `run:${facts.run.runId}:path:${facts.path}` },
  };
}

@Injectable()
export class ProtectedPathEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProtectedPathEmitter.name);

  private readonly unsubscribe: (() => void)[] = [];

  /**
   * @param database - The pool, for the verdict and the diff stat.
   * @param registry - Where the card is filed.
   * @param watcher - Where the run-ended detector registers. Optional so a suite can omit it.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: DecisionKindRegistry,
    @Optional() private readonly watcher?: DecisionSourceWatcher,
  ) {}

  /** Register how an allow-once question settles out of band. */
  onModuleInit(): void {
    if (this.watcher !== undefined) {
      this.unsubscribe.push(
        this.watcher.register(
          runTerminatedDetector([PROTECTED_PATH_KIND], [...RUN_ENDED_STATUSES]),
        ),
      );
    }
  }

  /** Unregister. */
  onModuleDestroy(): void {
    for (const stop of this.unsubscribe.splice(0)) {
      stop();
    }
  }

  /**
   * A change-set report's `allowed_paths` check failed: file (or refresh) the card for the
   * protected path it refused. Never throws — the report has committed, and the next report of the
   * run files what this one could not.
   *
   * @param runId - The run.
   * @returns When the card is filed, or there was none to file (the latest `allowed_paths` verdict
   *   is not a protected-path refusal — an out-of-scope path fails the check too, and asks nobody).
   */
  async verdictFailed(runId: string): Promise<void> {
    try {
      const facts = await this.read(runId);

      if (facts !== undefined) {
        await this.registry.emit(protectedPathEmission(facts));
      }
    } catch (error) {
      this.logger.error(
        `Could not file the protected-path decision for run ${runId}; the next report will.`,
        describeForLog(error),
      );
    }
  }

  /**
   * The run's latest `allowed_paths` refusal of a protected path, and that file's diff stat.
   *
   * @param runId - The run.
   * @returns The facts, or undefined when the latest verdict refused no protected path.
   */
  private async read(runId: string): Promise<ProtectedPathFacts | undefined> {
    const db = this.database.db;
    const verdict = await db
      .selectFrom("v_run_guardrails_latest")
      .select(["verdict", "evidence"])
      .where("run_id", "=", runId)
      .where("check", "=", "allowed_paths")
      .executeTakeFirst();
    const path = verdict?.evidence?.path;

    // `checkAllowedPaths` says "N paths inside a protected path." only for a protected-path
    // refusal; a path outside the plan's scope fails without asking anybody for an exception.
    if (
      verdict?.verdict !== "fail" ||
      path === undefined ||
      !(verdict.evidence?.detail ?? "").includes("inside a protected path")
    ) {
      return undefined;
    }

    const run = await runCardFacts(db, runId);

    if (run === undefined) {
      return undefined;
    }

    const file = await db
      .selectFrom("run_files")
      .select(["additions", "deletions"])
      .where("run_id", "=", runId)
      .where("path", "=", path)
      .executeTakeFirst();

    return { run, path, additions: file?.additions ?? 0, deletions: file?.deletions ?? 0 };
  }
}

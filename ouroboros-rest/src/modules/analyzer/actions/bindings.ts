/**
 * Binding → plan: what an Apply would hand which plane, and the sentence that says so (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514), decisions A4/A5).
 *
 * **The preview is generated from the payload the apply executes**, in one function per plane, so
 * the two cannot drift: {@link ActionPlan.change} is exactly what `actions.service.ts` passes to
 * the owning plane's service, and {@link ActionPlan.summary} is written from those same fields.
 * {@link planFingerprint} hashes the payload, so an apply can insist on the plan the person saw.
 *
 * Previews name the **concrete** change — the runner, the pool, the window, the stage — never the
 * category. Pure: the workflow plan is handed its base document by the caller.
 *
 * | plane | apply composes | preview names |
 * |---|---|---|
 * | `farm_config` | `PoolWindowsService.add` | runner, pool, days, UTC window |
 * | `job_hook` | `JobHooksService.register` | repository, title filter, command, pool |
 * | `workflow` | `WorkflowsService.proposeDraft` | workflow, the stage delta, the version it would become |
 * | `test_gate` | — no plane owns per-stage PR/merge gates: not appliable, says so | the gate split |
 * | `planning` | — drafted, never applied | the ticket or spike |
 */

import { createHash } from "node:crypto";

import type { DraftBase } from "../../workflows/workflows.service";
import type { WorkflowDocument } from "../../workflows/dsl.schema";
import type { ActionBinding } from "../composer/composer.types";
import { addPathStage, DeltaRefusal, moveStageBefore, type DeltaResult } from "./workflow.delta";

/** The farm payload of a pool move. */
export interface PoolWindowChange {
  runner: string;
  pool: string;
  daysOfWeek: number[];
  startsAt: string;
  endsAt: string;
}

/** The farm payload of a job hook. */
export interface JobHookChange {
  repo: string;
  pool: string;
  event: "merge";
  titleContains: string | null;
  label: string;
  title: string;
  command: string[];
}

/** The workflow payload: the proposed document, the base it was computed on, and the note. */
export interface WorkflowDraftChange {
  workflowId: string;
  slug: string;
  /** The draft slot's etag when the base was read — the proposal's `If-Match`. */
  ifMatch: string;
  /** The version this draft becomes when a person publishes it. */
  nextVersion: number;
  changeNote: string;
  definition: WorkflowDocument;
}

/** What an Apply would do — or why it cannot. */
export type ActionPlan =
  | {
      kind: "pool_window";
      plane: "farm_config";
      summary: string;
      lands: string;
      change: PoolWindowChange;
    }
  | { kind: "job_hook"; plane: "job_hook"; summary: string; lands: string; change: JobHookChange }
  | {
      kind: "workflow_draft";
      plane: "workflow";
      summary: string;
      lands: string;
      change: WorkflowDraftChange;
    }
  | {
      kind: "unavailable";
      plane: ActionBinding["plane"];
      summary: string;
      lands: string;
      /** Why it cannot be applied, said to the person. */
      reason: string;
    };

/** What a plan is built from: the suggestion as the composer stored it. */
export interface PlanSubject {
  id: string;
  repoRef: string;
  title: string;
  evidenceLine: string;
  needsSpike: boolean;
  kind: "build_process" | "workflow" | "ticket_draft";
  binding: ActionBinding;
}

/** The weekday names, ISO order. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The `HH:MM` the farm stores; the composer may say `14:00` or `14:00:00`. */
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/;

/** The longest change note V029 stores. */
const CHANGE_NOTE_MAX = 500;

/**
 * Days as a person says them: *weekdays*, *weekends*, *every day*, or *Mon, Wed*.
 *
 * @param days - ISO weekdays, sorted.
 * @returns The phrase.
 */
export function daysPhrase(days: readonly number[]): string {
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "on weekdays (Mon–Fri)";
  if (key === "6,7") return "on weekends";
  if (key === "1,2,3,4,5,6,7") return "every day";
  return `on ${days.map((day) => WEEKDAYS[day - 1]).join(", ")}`;
}

/**
 * A string field of a change payload.
 *
 * @param change - The payload.
 * @param key - The field.
 * @returns The trimmed string, or `undefined` when absent or blank.
 */
function field(change: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = change[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * An unavailable plan.
 *
 * @param plane - The binding's plane.
 * @param summary - What the change would have been.
 * @param reason - Why it cannot be applied.
 * @returns The plan.
 */
function unavailable(plane: ActionBinding["plane"], summary: string, reason: string): ActionPlan {
  return { kind: "unavailable", plane, summary, lands: "nowhere — not applied", reason };
}

/**
 * The plan for a suggestion whose binding needs no base document.
 *
 * @param subject - The suggestion.
 * @returns The plan. A workflow binding answers `undefined`: build it with {@link workflowPlan}.
 */
export function planOf(subject: PlanSubject): ActionPlan | undefined {
  const { binding } = subject;
  switch (binding.plane) {
    case "farm_config":
      return poolWindowPlan(binding.change);
    case "job_hook":
      return jobHookPlan(subject);
    case "workflow":
      return undefined;
    case "test_gate":
      return testGatePlan(binding.change);
    case "planning":
      return unavailable(
        "planning",
        subject.needsSpike
          ? `Draft a spike ticket: ${subject.title}`
          : `Draft a ticket: ${subject.title}`,
        subject.needsSpike
          ? "this suggestion needs a spike before anything can be applied — draft it as a ticket"
          : "a ticket suggestion is drafted into the backlog, not applied",
      );
  }
}

/**
 * A pool move: `{runner, pool, days_of_week, starts_at, ends_at}` → a farm pool window.
 *
 * @param change - The binding's payload.
 * @returns The plan.
 */
function poolWindowPlan(change: Readonly<Record<string, unknown>>): ActionPlan {
  const runner = field(change, "runner");
  const pool = field(change, "pool");
  const starts = TIME.exec(field(change, "starts_at") ?? "");
  const ends = TIME.exec(field(change, "ends_at") ?? "");
  const rawDays = Array.isArray(change.days_of_week) ? change.days_of_week : [];
  const daysOfWeek = [...new Set(rawDays)]
    .filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b);

  if (runner === undefined || pool === undefined || starts === null || ends === null) {
    return unavailable(
      "farm_config",
      "Move a runner between pools for a window of the day",
      "the binding does not name a runner, a pool and a UTC window",
    );
  }
  const startsAt = `${starts[1]}:${starts[2]}`;
  const endsAt = `${ends[1]}:${ends[2]}`;
  if (daysOfWeek.length === 0 || endsAt <= startsAt) {
    return unavailable(
      "farm_config",
      `Move ${runner} to ${pool}`,
      "the binding's window is not a set of weekdays and a range inside one UTC day",
    );
  }

  return {
    kind: "pool_window",
    plane: "farm_config",
    summary:
      `${runner} joins ${pool} between ${startsAt}–${endsAt} UTC ${daysPhrase(daysOfWeek)}; ` +
      "outside that window it stays in its own pool.",
    lands: "Build farm · pool windows",
    change: { runner, pool, daysOfWeek, startsAt, endsAt },
  };
}

/**
 * A job hook: `{on, run, title?, pool?}` → a farm merge hook on the suggestion's repository.
 *
 * @param subject - The suggestion.
 * @returns The plan.
 */
function jobHookPlan(subject: PlanSubject): ActionPlan {
  const change = subject.binding.change;
  const run = field(change, "run");
  const pool = field(change, "pool");
  const titleContains = field(change, "title") ?? null;

  if (field(change, "on") !== "merge" || run === undefined) {
    return unavailable("job_hook", subject.title, "the binding names no merge event and command");
  }
  if (pool === undefined) {
    return unavailable(
      "job_hook",
      `On every merge into ${subject.repoRef}, run \`${run}\``,
      "the binding names no pool for the job to run in",
    );
  }

  const filter = titleContains === null ? "" : ` whose title contains “${titleContains}”`;
  return {
    kind: "job_hook",
    plane: "job_hook",
    summary:
      `On every merge into ${subject.repoRef}${filter}, the farm submits \`${run}\` in ${pool}, ` +
      "at the merged commit of the base branch.",
    lands: "Build farm · job hooks",
    change: {
      repo: subject.repoRef,
      pool,
      event: "merge",
      titleContains,
      label: "post-merge hook",
      title: subject.title.slice(0, 512),
      command: run.split(/\s+/),
    },
  };
}

/**
 * The gate split: no plane owns it, so it is described and refused.
 *
 * @param change - `{pr_builds, merge_gate}`.
 * @returns The unavailable plan.
 */
function testGatePlan(change: Readonly<Record<string, unknown>>): ActionPlan {
  const list = (key: string): string =>
    Array.isArray(change[key]) ? (change[key] as unknown[]).map(String).join(", ") : "?";
  return unavailable(
    "test_gate",
    `PR builds run ${list("pr_builds")}; ${list("merge_gate")} run only at the merge gate.`,
    "no plane owns per-stage PR and merge gates yet, so this cannot be applied — draft it as a " +
      "ticket or dismiss it",
  );
}

/**
 * The change note a workflow draft carries: the suggestion and its evidence, cited.
 *
 * @param subject - The suggestion.
 * @returns At most 500 characters.
 */
export function changeNoteOf(subject: PlanSubject): string {
  const head = `Proposed by the Build Analyzer (suggestion ${subject.id}): ${subject.title}. Evidence: `;
  const room = CHANGE_NOTE_MAX - head.length - 1;
  const evidence =
    subject.evidenceLine.length <= room
      ? subject.evidenceLine
      : `${subject.evidenceLine.slice(0, Math.max(0, room - 1))}…`;
  return `${head}${evidence}.`.slice(0, CHANGE_NOTE_MAX);
}

/**
 * The plan for a workflow suggestion, on the base document the workflow plane answered.
 *
 * @param subject - The suggestion.
 * @param base - The workflow's draft or current version, and the etag it was read at.
 * @param document - `base.definition`, parsed — `undefined` when it does not parse.
 * @returns The plan; unavailable when the binding or the base cannot carry the delta.
 */
export function workflowPlan(
  subject: PlanSubject,
  base: DraftBase,
  document: WorkflowDocument | undefined,
): ActionPlan {
  const change = subject.binding.change;
  const slug = base.workflow.slug;
  const nextVersion = (base.workflow.current_version ?? 0) + 1;

  if (document === undefined) {
    return unavailable(
      "workflow",
      subject.title,
      `${slug}'s ${base.from === "draft" ? "draft" : "current version"} does not parse, so no delta can be drafted on it`,
    );
  }

  let delta: DeltaResult;
  try {
    const move = field(change, "move");
    const before = field(change, "before");
    const stage = field(change, "add_stage");
    const paths = Array.isArray(change.when_paths)
      ? change.when_paths.filter((path): path is string => typeof path === "string")
      : [];
    if (move !== undefined && before !== undefined) {
      delta = moveStageBefore(document, move, before);
    } else if (stage !== undefined && paths.length > 0) {
      delta = addPathStage(document, paths, stage);
    } else {
      return unavailable("workflow", subject.title, "the binding names no stage delta");
    }
  } catch (error) {
    if (error instanceof DeltaRefusal) {
      return unavailable("workflow", subject.title, error.message);
    }
    throw error;
  }

  const onto = base.from === "draft" ? "the open draft" : `v${String(base.version)}`;
  return {
    kind: "workflow_draft",
    plane: "workflow",
    summary:
      `${slug}: a draft on ${onto} ${delta.change}. It becomes v${String(nextVersion)} only when ` +
      "a person publishes it.",
    lands: `Workflow studio · ${slug} draft`,
    change: {
      workflowId: base.workflow.id,
      slug,
      ifMatch: base.etag,
      nextVersion,
      changeNote: changeNoteOf(subject),
      definition: delta.document,
    },
  };
}

/**
 * The plan's fingerprint — what an apply checks it is executing the plan the person saw.
 *
 * @param plan - The plan.
 * @returns `sha256:<hex>` over the plan's kind, summary and payload.
 */
export function planFingerprint(plan: ActionPlan): string {
  const payload = plan.kind === "unavailable" ? { reason: plan.reason } : { change: plan.change };
  const text = JSON.stringify({ kind: plan.kind, summary: plan.summary, ...payload });
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

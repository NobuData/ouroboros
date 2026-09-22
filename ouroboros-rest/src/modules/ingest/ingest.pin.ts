/**
 * The pinned workflow, read as the six facts a stage row needs — and nothing else.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)) validates a stage
 * transition *"against the AO.1 state machine and the pinned DSL's attempt limits"*, and
 * V045 stores five of this file's outputs directly on `run_stages`:
 *
 * ```
 * stage_key    ← the node's id            the DSL node id the executor reports
 * stage_label  ← the node's title         a snapshot, so a March run still reads as March
 * position     ← where it sits            what orders the stepper
 * max_attempts ← limits.max_retries + 1   the /3 of "attempt 2/3"
 * token_budget ← limits.token_budget      the 400k of the Resources meter
 * ```
 *
 * plus the node's **kind**, which is what a gate-return note prints — *"loop returned from
 * gate ↺"*.
 *
 * ---------------------------------------------------------------------------
 * **Every one of these is a snapshot, and that is decision F8 doing its work.** A workflow
 * can be republished, renamed or deleted, and a closed run must still answer for what it
 * actually ran under. The pin is resolved once per report and written onto the stage row, so
 * a run whose workflow was republished mid-flight keeps the labels and the limits it started
 * with — and a run whose workflow was *deleted* keeps rendering, because nothing in the
 * console joins back to a document.
 *
 * **It does not re-validate the document.** `dsl.validator.ts` runs at publish time and a
 * stored version is one that passed it; running the whole validator here would make an
 * ingestion request pay for a check that already happened and, worse, could refuse a report
 * against a document the studio accepted under an earlier rule. What this file does is
 * *read* — narrowly, with the published schemas, tolerating anything it does not need.
 *
 * **`max_retries` is retries and `max_attempts` is attempts**, which is a place an off-by-one
 * would be invisible: the DSL says *"retry at most twice"* and the stepper prints *"attempt
 * 2/3"*. V045's column comment is explicit — *"total attempts rather than retries because the
 * total is the number rendered"* — so the `+ 1` happens here, once, rather than at each
 * reader.
 */

import { NodeShapeSchema, WorkflowRootSchema } from "../workflows/dsl.schema";
import type { RunStageReturnKind } from "../db/schema";

/** What the ingestion contract needs to know about one stage of a pinned workflow. */
export interface PinnedStage {
  /** The DSL node id — `implement`, `checks-green`. `run_stages.stage_key`. */
  readonly stageKey: string;
  /** The node's title as the pinned version had it. `run_stages.stage_label`. */
  readonly label: string;
  /** Where it sits in the document, from 1. `run_stages.position`. */
  readonly position: number;
  /**
   * What kind of node it is, in the vocabulary `run_stages.returned_from_kind` accepts —
   * the DSL's five types with `flow` resolved into `gate` or `decision` (§4.4), because
   * those are two different words in the sentence a return note composes.
   */
  readonly kind: RunStageReturnKind;
  /**
   * How many attempts this stage allows — `limits.max_retries + 1`.
   *
   * `undefined` for every node that is not an `llm`, which is the only type carrying a
   * `limits` object. V045 stores null there, and *"this stage has no limit"* is then a
   * transition the attempt check cannot refuse rather than one it refuses at 1.
   */
  readonly maxAttempts?: number;
  /** The stage's `limits.token_budget`, or `undefined` for a node with no limits object. */
  readonly tokenBudget?: number;
}

/** A pinned workflow, as much of it as the ingestion contract reads. */
export interface PinnedWorkflow {
  /** Every stage, by `stage_key`. */
  readonly stages: ReadonlyMap<string, PinnedStage>;
  /**
   * How many stages the document has — what a freshly opened run's `stage_total` is set to.
   *
   * V008's three current-stage columns are still `not null`, and this is the honest value for
   * the third of them at the moment a run opens: the number of stages the pinned document
   * draws. Once the run has stage history, `runs_with_stage` resolves the meter from
   * `run_stage_current` instead and this number stops being read.
   */
  readonly stageTotal: number;
  /** The first stage in document order, or `undefined` for a document with no nodes. */
  readonly firstStage?: PinnedStage;
}

/**
 * The DSL node types, mapped to the words a stage row uses.
 *
 * Four of the five are the same word. `flow` is the one that is not, and it becomes two —
 * see {@link flowKind}.
 */
const DIRECT_KINDS = {
  trigger: "trigger",
  llm: "llm",
  infra: "infra",
  term: "term",
} as const satisfies Partial<Record<string, RunStageReturnKind>>;

/**
 * Which of the two words a `flow` node is.
 *
 * @param config - The node's config, still opaque.
 * @returns `gate` or `decision`. A config whose `kind` is neither — which the publish gate
 *   makes impossible — reads as `gate`, because a fork that holds is the conservative thing
 *   to say about a fork nobody can classify: it describes a run that came back, which is the
 *   only reason this word is ever printed.
 */
function flowKind(config: Record<string, unknown>): RunStageReturnKind {
  return config.kind === "decision" ? "decision" : "gate";
}

/**
 * Read a stored workflow definition into the facts a stage row needs.
 *
 * @param definition - `workflow_versions.definition`, as the database returns it. Unknown
 *   rather than typed, because a column's *stored* shape is a fact about the day it was
 *   written and this function's job is to be robust to that.
 * @returns The stages, keyed by node id, in document order. A definition that is not a
 *   workflow document at all — which a published version cannot be, and a hand-edited row
 *   can — yields an empty pin rather than a throw: the caller then refuses the *stage* with
 *   `stage_not_in_pin`, which is a machine-readable answer, where a parse error would be a
 *   `500` naming zod.
 */
export function readPinnedWorkflow(definition: unknown): PinnedWorkflow {
  const root = WorkflowRootSchema.safeParse(definition);

  if (!root.success) {
    return { stages: new Map(), stageTotal: 0 };
  }

  const stages = new Map<string, PinnedStage>();
  let first: PinnedStage | undefined;

  root.data.nodes.forEach((candidate, index) => {
    const node = NodeShapeSchema.safeParse(candidate);

    if (!node.success) {
      return;
    }

    const { id, type, title, config } = node.data;
    const limits = readLimits(config);
    const stage: PinnedStage = {
      stageKey: id,
      label: title,
      // Document order, from 1, and over the whole `nodes` array — including the ones this
      // loop may have skipped. A position is *where a stage sits in the document*, so
      // renumbering around an unreadable node would move every stage after it.
      position: index + 1,
      kind: type === "flow" ? flowKind(config) : DIRECT_KINDS[type],
      ...(limits === undefined
        ? {}
        : { maxAttempts: limits.maxRetries + 1, tokenBudget: limits.tokenBudget }),
    };

    stages.set(id, stage);
    first ??= stage;
  });

  return {
    stages,
    // The document's own node count, not the map's: a node this reader could not parse is
    // still a stage of the workflow, and a total that shrank because of one would make the
    // meter read `4/7` on a seven-stage document.
    stageTotal: root.data.nodes.length,
    ...(first === undefined ? {} : { firstStage: first }),
  };
}

/** The two numbers an `llm` node's `limits` object carries. */
interface StageLimits {
  /** `limits.max_retries` — retries, not attempts. */
  readonly maxRetries: number;
  /** `limits.token_budget`. */
  readonly tokenBudget: number;
}

/**
 * Read a node's limits, if it has any.
 *
 * @param config - The node's config.
 * @returns The two numbers, or `undefined` when the node carries no `limits` object — which
 *   is every type that is not `llm`. Read field by field rather than through `LlmConfigSchema`
 *   because that schema requires the *whole* model config, and a node missing an unrelated
 *   field would then silently lose its attempt limit.
 */
function readLimits(config: Record<string, unknown>): StageLimits | undefined {
  const limits = config.limits;

  if (typeof limits !== "object" || limits === null) {
    return undefined;
  }

  const { max_retries: maxRetries, token_budget: tokenBudget } = limits as Record<string, unknown>;

  return Number.isInteger(maxRetries) && Number.isInteger(tokenBudget)
    ? { maxRetries: maxRetries as number, tokenBudget: tokenBudget as number }
    : undefined;
}

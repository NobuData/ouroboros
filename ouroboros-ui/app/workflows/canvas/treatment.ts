/**
 * How each stage and each connection is drawn (S.3,
 * [#149](https://github.com/NobuData/ouroboros/issues/149)) — mockup 04's five node treatments,
 * the type line and the chip row on each node, and the tone and placement of each edge's label
 * — decided from the document as pure functions.
 *
 * **React-free**, like `graph.ts` beside it, so each decision is a unit test over two values
 * rather than a claim about a rendered page. `stage-node.tsx` and `stage-edge.tsx` draw what this
 * module decides.
 *
 * ### Chips are derived on every render, and stored nowhere
 *
 * A node's chips are computed from its `config` — the skill or the prompt, the route, the command
 * and the pool, the predicate, the merge — each time the node draws. The document is the one
 * place a stage's configuration lives, so an edit to a stage's skill *is* an edit to its chip,
 * with no second write to forget. The trigger node is the one stage whose chip is not read from
 * its own config: the DSL keeps the predicate on the document's root trigger and says the canvas
 * renders it as the node's chip (`docs/WORKFLOW_DSL.md` § 3), so that is what it reads.
 *
 * Every read is defensive, for the reason `graph.ts` gives: a draft is stored unvalidated, and a
 * config the canvas cannot read is drawn with fewer chips rather than refused.
 *
 * ### Where the chips say something other than the mockup
 *
 * The mockup is a picture and the seed is the document, and in a few places the two differ; a
 * chip says what the document says. A pinned stage names a **registry alias** (`coder-max`) where
 * the mockup prints a model id (`claude-fable-5`), because the alias is what the document holds
 * and resolving it is the route's business (CH.6, #589). The gate prints `required checks: 3`
 * where the mockup prints `14`, because the seed's predicate names three checks and the DSL
 * records the fourteen as a repository's count rather than the document's (§ 5). A decision
 * prints its predicate (`effort ≤ M`) where the mockup prints a note, and *Split* its prompt and
 * route where the mockup prints a sentence, because neither sentence is in the document. And the
 * test stage prints the runner pool beside its command, because the seed names both.
 */

import type { WorkflowDefinition } from "@/app/api/workflows";

import { EFFORTS, readTrigger } from "../view";

import type { Connection, Point, Stage } from "./graph";
import { FLOW_ROLE_WORDS, STAGE_KIND_WORDS } from "./view";

/* ------------------------------------------------------------------ reading a config */

/** A config as the canvas holds one — whatever the document had, as a record. */
type Config = Readonly<Record<string, unknown>>;

/**
 * Anything, as a record when it is one.
 *
 * @param value Anything.
 * @returns The value, when it is a non-null object that is not an array; `null` otherwise.
 */
function asRecord(value: unknown): Config | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Config)
    : null;
}

/**
 * Anything, as a word when it is one.
 *
 * @param value Anything.
 * @returns The string, when it is a non-empty one; `null` otherwise.
 */
function asText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Anything, as a list of words.
 *
 * @param value Anything.
 * @returns The strings in it, in order, when it is an array; empty otherwise.
 */
function asTexts(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/* ------------------------------------------------------------------ the node's shape */

/**
 * Whether a stage is drawn as the mockup's **mini pill** rather than as a box.
 *
 * The mockup draws exactly one: *Back to queue*, the terminal the split branch ends in. It is
 * the one terminal that is not an outcome — the run hands the ticket back rather than finishing
 * it — and it has nothing to print in a chip (its `options` are closed and empty), so it is
 * drawn as the small thing it is. Every other terminal is a box.
 *
 * @param stage Its kind and config.
 * @returns `true` for a `term` stage whose action is `back_to_queue`.
 */
export function isPill(stage: Pick<Stage, "kind" | "config">): boolean {
  return stage.kind === "term" && stage.config.action === "back_to_queue";
}

/**
 * A node id as the word a type line prints — `analyze` → *Analyze*, `effort-recheck` → *Effort
 * recheck*.
 *
 * @param id The node's id, as the document spells it.
 * @returns The id with its hyphens read as spaces and its first letter raised; the id itself
 *   when that leaves nothing.
 */
export function roleOf(id: string): string {
  const words = id
    .split("-")
    .filter((word) => word !== "")
    .join(" ");

  return words === "" ? id : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * What a node's type line says after its glyph — the mockup's *Trigger*, *Analyze*, *Decision*,
 * *Build*, *Gate*, *Terminal*.
 *
 * The mockup prints what a stage **is for**, and the document says that in two different
 * places. A trigger and a terminal are what their type says. A flow node is a *decision* or a
 * *gate*, and its config says which (`docs/WORKFLOW_DSL.md` § 4.4). A model or an infra stage
 * carries no such word in its config — its role is the name its author gave it, which is the
 * id the edges and the run journal quote (`analyze`, `implement`, `build`, `test`), so that is
 * what is printed. The accessible name keeps the type's own word (`view.ts`'s `stageName`),
 * because a screen reader is told what kind of stage it is on, and the id is not that.
 *
 * @param stage Its id, kind and config.
 * @returns The word.
 */
export function stageRole(stage: Pick<Stage, "id" | "kind" | "config">): string {
  switch (stage.kind) {
    case "flow": {
      const { kind } = stage.config;
      return kind === "decision" || kind === "gate" ? FLOW_ROLE_WORDS[kind] : STAGE_KIND_WORDS.flow;
    }
    case "llm":
    case "infra":
      return roleOf(stage.id);
    case "trigger":
    case "term":
      return STAGE_KIND_WORDS[stage.kind];
  }
}

/* ------------------------------------------------------------------ the chip row */

/**
 * What a chip reports. One of each at most per stage, so it doubles as the chip's key, and the
 * runner chip is the one that carries a dot — the mockup's warn dot beside `runner pool-a`.
 */
export type ChipKind =
  | "effort"
  | "labels"
  | "source"
  | "skill"
  | "prompt"
  | "model"
  | "route"
  | "command"
  | "runner"
  | "predicate"
  | "merge";

/** One chip on a node. */
export interface StageChip {
  /** What it reports. */
  readonly kind: ChipKind;
  /** What it prints. */
  readonly text: string;
}

/** The chip a model stage in prompt mode carries — the mockup's `prompt template`. */
export const PROMPT_TEMPLATE_CHIP = "prompt template";

/** The chip a model stage that inherits its task's route carries — the mockup's `routed by task`. */
export const ROUTED_BY_TASK_CHIP = "routed by task";

/** How an effort comparison is printed — the mockup's `≤`. */
const EFFORT_SYMBOLS: Readonly<Record<string, string>> = {
  lt: "<",
  lte: "≤",
  eq: "=",
  gte: "≥",
  gt: ">",
};

/**
 * A predicate in the few words a chip holds — `effort ≤ M`, `required checks: 3`.
 *
 * One grammar serves a flow node's `predicate` and an edge's `condition`
 * (`docs/WORKFLOW_DSL.md` § 5), so one reader serves both. For `checks`, a predicate naming its
 * checks is printed as their count — the mockup's `required checks: N` — and one that names none
 * means *every check the run produced*, which is what it says.
 *
 * @param predicate The predicate, or `null`.
 * @returns The words, or `null` for a predicate the canvas cannot read.
 */
export function predicateWords(predicate: Config | null): string | null {
  if (predicate === null) return null;

  switch (predicate.kind) {
    case "always":
      return "always";
    case "effort": {
      const { op, value } = predicate;
      const symbol = typeof op === "string" && Object.hasOwn(EFFORT_SYMBOLS, op) ? EFFORT_SYMBOLS[op] : null;
      const effort = typeof value === "string" && (EFFORTS as readonly string[]).includes(value) ? value : null;
      return symbol === null || effort === null ? null : `effort ${symbol} ${effort.toUpperCase()}`;
    }
    case "labels": {
      const values = asTexts(predicate.values);
      const { op } = predicate;
      return (op === "any" || op === "all" || op === "none") && values.length > 0
        ? `labels ${op}: ${values.join(", ")}`
        : null;
    }
    case "source": {
      const values = asTexts(predicate.values);
      const { op } = predicate;
      return (op === "in" || op === "not_in") && values.length > 0
        ? `source ${op === "in" ? "in" : "not in"}: ${values.join(", ")}`
        : null;
    }
    case "checks": {
      const names = Array.isArray(predicate.names) ? asTexts(predicate.names) : null;
      if (predicate.op === "all_passed") {
        return names === null ? "all checks passed" : `required checks: ${names.length}`;
      }
      if (predicate.op === "any_failed") {
        return names === null ? "any check failed" : `failed checks: any of ${names.length}`;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * The trigger node's chips: the document's root trigger, one chip per condition.
 *
 * @param trigger The document's root `trigger`, as stored.
 * @returns `effort ≤ M`, `labels: …`, `source: …` — each present when its condition is.
 */
function triggerChips(trigger: unknown): StageChip[] {
  const document: WorkflowDefinition = { trigger };
  const facts = readTrigger(document);
  if (facts === null) return [];

  const chips: StageChip[] = [];
  if (facts.effortLte !== null) chips.push({ kind: "effort", text: `effort ≤ ${facts.effortLte.toUpperCase()}` });
  if (facts.labels.length > 0) chips.push({ kind: "labels", text: `labels: ${facts.labels.join(", ")}` });
  if (facts.source !== null) chips.push({ kind: "source", text: `source: ${facts.source}` });

  return chips;
}

/**
 * A model stage's chips: what it is given (a skill, or its prompt alone) and how its model is
 * chosen (a pinned alias, or its task's route) — the inspector's two segments, as chips.
 *
 * @param config The stage's config.
 * @returns Up to two chips.
 */
function modelChips(config: Config): StageChip[] {
  const chips: StageChip[] = [];
  const skill = asText(config.skill);

  if (config.mode === "skill" && skill !== null) chips.push({ kind: "skill", text: `skill:${skill}` });
  if (config.mode === "prompt") chips.push({ kind: "prompt", text: PROMPT_TEMPLATE_CHIP });

  const routing = asRecord(config.routing);
  const alias = asText(asRecord(routing?.pinned_model)?.alias);

  if (alias !== null) chips.push({ kind: "model", text: alias });
  else if (asText(routing?.inherit_task) !== null) chips.push({ kind: "route", text: ROUTED_BY_TASK_CHIP });

  return chips;
}

/**
 * An infra stage's chips: its command, then the pool it runs on. Both are optional in the DSL
 * (§ 4.3), and a stage with neither runs the repository's default on the default pool, which is
 * nothing this document says and so nothing a chip prints.
 *
 * @param config The stage's config.
 * @returns Up to two chips.
 */
function infraChips(config: Config): StageChip[] {
  const chips: StageChip[] = [];
  const command = asText(config.command);
  const pool = asText(config.runner_pool);

  if (command !== null) chips.push({ kind: "command", text: command });
  if (pool !== null) chips.push({ kind: "runner", text: `runner ${pool}` });

  return chips;
}

/**
 * A flow node's chip: its predicate.
 *
 * @param config The stage's config.
 * @returns One chip, or none for a predicate the canvas cannot read.
 */
function flowChips(config: Config): StageChip[] {
  const words = predicateWords(asRecord(config.predicate));

  return words === null ? [] : [{ kind: "predicate", text: words }];
}

/**
 * A terminal's chip: how the pull request merges, and what becomes of the branch — the mockup's
 * `squash · delete branch`, whose two halves the DSL requires together (§ 4.5). The other two
 * actions carry closed, empty options, and print nothing.
 *
 * @param config The stage's config.
 * @returns One chip, or none.
 */
function terminalChips(config: Config): StageChip[] {
  if (config.action !== "open_pr_automerge") return [];

  const options = asRecord(config.options);
  const method = asText(options?.merge_method);
  if (method === null) return [];

  const branch =
    options?.delete_branch === true ? "delete branch" : options?.delete_branch === false ? "keep branch" : null;

  return [{ kind: "merge", text: branch === null ? method : `${method} · ${branch}` }];
}

/**
 * A stage's chip row, derived from its configuration.
 *
 * @param stage Its kind and config.
 * @param trigger The document's root `trigger` — read for the trigger node alone, and ignored for
 *   every other kind.
 * @returns The chips, in the order the node prints them. Empty when there is nothing to print.
 */
export function stageChips(stage: Pick<Stage, "kind" | "config">, trigger?: unknown): readonly StageChip[] {
  switch (stage.kind) {
    case "trigger":
      return triggerChips(trigger);
    case "llm":
      return modelChips(stage.config);
    case "infra":
      return infraChips(stage.config);
    case "flow":
      return flowChips(stage.config);
    case "term":
      return terminalChips(stage.config);
  }
}

/* ------------------------------------------------------------------ the edges */

/**
 * The three ways an edge's line is drawn, each with an arrowhead of its own: the plain path, the
 * **active** path (accent, glowing — an execution path, when one is drawn) and the **loop**
 * (dashed accent-deep — the ouroboros edge).
 */
export const EDGE_VARIANTS = ["plain", "active", "loop"] as const;

/** One of the three. */
export type EdgeVariant = (typeof EDGE_VARIANTS)[number];

/**
 * Which arrowhead an edge ends in.
 *
 * An edge on the execution path is **active** whatever its kind, because the path is what the
 * highlight exists to show; a loop that the path takes keeps its dash (`canvas.css` draws the
 * two together) and takes the active arrowhead with the active colour.
 *
 * @param connection The edge's kind.
 * @param onPath Whether the edge is on the execution path being drawn.
 * @returns The variant.
 */
export function edgeVariant(connection: Pick<Connection, "kind">, onPath: boolean): EdgeVariant {
  if (onPath) return "active";

  return connection.kind === "loop" ? "loop" : "plain";
}

/**
 * The four hues a label's pill takes, and the neutral pill for a label that reports no outcome.
 */
export type LabelTone = "plain" | "accent" | "warn" | "ok" | "err";

/**
 * What an edge's label is coloured as — the mockup's `≤ M ↓` accent, `> M ↘` warn, `pass →` ok,
 * `fail ↺` err.
 *
 * **Derived from the condition, never from the label's text**, because the label is presentation
 * the DSL never evaluates (§ 6) and a tone read out of an arrow glyph would be a guess. The
 * outcome a condition names is the tone: checks that passed are ok and checks that failed are
 * err; an effort *within* a bound (`<`, `≤`, `=`) keeps the ticket on the loop's main line and is
 * the accent, and one *past* it (`>`, `≥`) is the case worth a second look and is warn. A loop
 * whose condition says neither is still a return to an earlier stage after something did not
 * hold, and is err. Anything else — labels, source, `always`, a default edge — reports no
 * outcome and is plain.
 *
 * @param connection The edge's kind and condition.
 * @returns The tone.
 */
export function labelTone(connection: Pick<Connection, "kind" | "condition">): LabelTone {
  const { condition } = connection;

  if (condition?.kind === "checks") {
    if (condition.op === "all_passed") return "ok";
    if (condition.op === "any_failed") return "err";
  }
  if (condition?.kind === "effort") {
    if (condition.op === "lt" || condition.op === "lte" || condition.op === "eq") return "accent";
    if (condition.op === "gt" || condition.op === "gte") return "warn";
  }

  return connection.kind === "loop" ? "err" : "plain";
}

/** Where a label sits against its edge: on the line, above it, or beside it. */
export type LabelAnchor = "on" | "above" | "beside";

/**
 * Where a label sits against its edge.
 *
 * The mockup never lays a pill across a straight edge: `pass →` sits **above** its horizontal
 * edge and `≤ M ↓` **beside** its vertical one, and only the curved edges (`> M ↘`, `fail ↺`)
 * carry their pill **on** the line. The stage's edges between neighbours are short —
 * seventy-eight pixels along a row — so a pill laid on one would cover the line and meet its
 * arrowhead.
 *
 * @param source Where the edge leaves, in canvas pixels.
 * @param target Where it arrives.
 * @returns `above` for a horizontal edge, `beside` for a vertical one, `on` for a curve. Within a
 *   pixel counts as straight, because handle positions are measured and land on fractions.
 */
export function labelAnchor(source: Point, target: Point): LabelAnchor {
  if (Math.abs(source.y - target.y) < 1) return "above";
  if (Math.abs(source.x - target.x) < 1) return "beside";

  return "on";
}

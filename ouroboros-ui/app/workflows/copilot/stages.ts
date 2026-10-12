/**
 * The draft's stage list, decided as functions with inputs and outputs (CE.3,
 * [#567](https://github.com/NobuData/ouroboros/issues/567)) — mockup 20's
 * `DRAFT — SECURITY-PATCH · UNPUBLISHED` card.
 *
 * **Nothing about a row is stored.** A row is composed, on every render, from four things the
 * service already holds: the draft's document, who each stage is by (`nodeProvenance`, #556),
 * the references that resolve to nothing yet (decision **W7**), and the workspace's model
 * aliases. So a stage reconfigured on the canvas is a row that changes here, with no second copy
 * for anybody to keep in step.
 *
 * **Framework-free and pure**, the way `copilot-view.ts` is: no React, no `next/*`, and the API
 * types are type-only imports. The card (`stages-card.tsx`) draws what this decides.
 *
 * ### Rows are the graph, in the order a run walks it
 *
 * {@link stageOrder} is a stable topological order: the trigger first, ties in document order,
 * stages nothing leads to from the trigger last and still listed. A loop edge is a return and
 * orders nothing; any other cycle is broken at its earliest stage rather than looped on.
 *
 * ### Parallel twins are one row
 *
 * Two stages of one type and one title, fed by the same stages, are one step done twice — the
 * mockup's `review ×2`. They fold into one row whose tags are both stages', in order. That is how
 * the seed's ten nodes are the mockup's nine rows.
 *
 * ### Where a row says something other than the mockup
 *
 * The mockup is a picture and the seed is the document. `test` prints its runner pool beside
 * `twister full`, because the seed names both (the canvas prints both for the same reason —
 * `canvas/treatment.ts`). A reference that resolves to nothing is drawn as a warning, which the
 * mockup does not draw and the issue requires.
 *
 * ### Between two reads, the stream is the draft
 *
 * {@link advanceStageDraft} keeps one working draft and folds into it everything that arrives:
 * a server read, a poll's answer, the conversation's applied operations, a finished reply's
 * draft. An operation is applied once, in the order the stream delivered it; a read older than
 * what the stream has already built is dropped rather than drawn.
 */

import type { Reading } from "@/app/api/reading";
import type { CopilotDraft, CopilotNodeProvenance, CopilotPromotion, CopilotWarning } from "@/app/api/workflow-copilot";
import type { WorkflowDefinition } from "@/app/api/workflows";

import { type Stage, type StageKind, readConnections, readStages } from "../canvas/graph";
import { ROUTED_BY_TASK_CHIP, predicateWords } from "../canvas/treatment";
import { STAGE_GLYPHS, STAGE_KIND_WORDS } from "../canvas/view";
import { readTrigger } from "../view";

import type { OperationShape } from "./conversation";
import type { CopilotLive, LiveOperation } from "./copilot-live";
import { GUARD_ENFORCEMENT_WORDS } from "./copilot-view";

/* ------------------------------------------------------------------ what the list reads */

/** Who a stage of the draft is by, as the draft's operation log says (#556). */
export type StageProvenance = CopilotNodeProvenance["provenance"];

/** One stage's provenance — an entry of the draft's `nodeProvenance`. */
export type NodeProvenance = CopilotNodeProvenance;

/**
 * The draft as the stage list reads it: the service's `CopilotDraft`. `nodeProvenance` is read
 * defensively all the same — an answer without it draws no pill rather than throwing.
 */
export type StageDraft = CopilotDraft;

/** The workspace's model aliases, as far as a tag needs them. */
export interface AliasModel {
  readonly alias: string;
  readonly modelId: string;
}

/* ------------------------------------------------------------------ small readers */

/** A config, a node, a trigger — whatever the document had, as a record. */
type Fields = Readonly<Record<string, unknown>>;

/**
 * Anything, as a record when it is one.
 *
 * @param value Anything.
 * @returns The value, when it is a non-null object that is not an array; `null` otherwise.
 */
function asRecord(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
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
 * A document's nodes, as stored — every entry, readable or not.
 *
 * @param definition The document.
 * @returns The array, or an empty one.
 */
function rawNodes(definition: WorkflowDefinition | null): readonly unknown[] {
  return Array.isArray(definition?.nodes) ? definition.nodes : [];
}

/**
 * A document's edges, as stored.
 *
 * @param definition The document.
 * @returns The array, or an empty one.
 */
function rawEdges(definition: WorkflowDefinition | null): readonly unknown[] {
  return Array.isArray(definition?.edges) ? definition.edges : [];
}

/**
 * Each stage's `description`, by node id — the one field of a node the canvas's reader leaves in
 * the document.
 *
 * @param definition The document.
 * @returns The descriptions that are non-empty strings.
 */
function descriptions(definition: WorkflowDefinition | null): ReadonlyMap<string, string> {
  const found = new Map<string, string>();

  for (const node of rawNodes(definition)) {
    const fields = asRecord(node);
    const id = asText(fields?.id);
    const description = asText(fields?.description);
    if (id !== null && description !== null && !found.has(id)) found.set(id, description);
  }

  return found;
}

/* ------------------------------------------------------------------ order */

/**
 * The draft's stages in the order a run walks them.
 *
 * A stable topological order over the edges that are not loops: at each step the earliest stage
 * in the document whose predecessors have all been listed. The stages a trigger leads to come
 * first (a document with no trigger starts from the stages nothing leads into); the rest follow,
 * ordered the same way among themselves. A cycle that is not a loop edge — a draft is stored
 * unvalidated — is broken at its earliest stage, so every stage is listed exactly once.
 *
 * @param definition The document, or `null` for a workflow with none.
 * @returns Every stage the document holds, once.
 */
export function stageOrder(definition: WorkflowDefinition | null): readonly Stage[] {
  const stages = readStages(definition);
  const flow = readConnections(definition, stages).filter((edge) => edge.kind !== "loop" && edge.from !== edge.to);

  const next = new Map<string, string[]>();
  for (const edge of flow) next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);

  const entered = new Set(flow.map((edge) => edge.to));
  const triggers = stages.filter((stage) => stage.kind === "trigger");
  const starts = triggers.length > 0 ? triggers : stages.filter((stage) => !entered.has(stage.id));

  const reachable = new Set<string>();
  const queue = starts.map((stage) => stage.id);
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...(next.get(id) ?? []));
  }

  /**
   * Order one group of stages among themselves.
   *
   * @param group The stages, in document order.
   * @returns The same stages, each after the group's stages that lead to it.
   */
  const order = (group: readonly Stage[]): Stage[] => {
    const within = new Set(group.map((stage) => stage.id));
    const waiting = new Map<string, number>(group.map((stage) => [stage.id, 0]));
    for (const edge of flow) {
      if (within.has(edge.from) && within.has(edge.to)) waiting.set(edge.to, (waiting.get(edge.to) ?? 0) + 1);
    }

    const left = [...group];
    const listed: Stage[] = [];
    while (left.length > 0) {
      const ready = left.findIndex((stage) => waiting.get(stage.id) === 0);
      // Nothing is ready only inside a cycle: its earliest stage is taken, and the walk goes on.
      const [taken] = left.splice(ready === -1 ? 0 : ready, 1);
      listed.push(taken);
      for (const to of next.get(taken.id) ?? []) {
        if (within.has(to)) waiting.set(to, Math.max(0, (waiting.get(to) ?? 0) - 1));
      }
    }

    return listed;
  };

  return [
    ...order(stages.filter((stage) => reachable.has(stage.id))),
    ...order(stages.filter((stage) => !reachable.has(stage.id))),
  ];
}

/* ------------------------------------------------------------------ warnings */

/** What an unresolved reference is, in the two words a tag has room for. */
export const WARNING_SUMMARIES: Readonly<Record<CopilotWarning["code"], string>> = {
  "reference.unknown_skill": "skill does not exist",
  "reference.unknown_task": "kind not in catalog",
  "reference.unknown_alias": "alias does not exist",
};

/**
 * The references a later issue is known to resolve, by code and name — where the thing that is
 * missing will come from. No date is promised: an issue number is a place to look, not a
 * schedule.
 */
const ARRIVALS: Readonly<Record<string, string>> = {
  "reference.unknown_task:exploit-verify":
    "The exploit-verify stage kind, with its sandboxed proof-of-concept runner, arrives with #570.",
  "reference.unknown_skill:advisory-db": "The advisory-db skill arrives with #571.",
};

/**
 * What is missing, in plain words, and where it will come from.
 *
 * @param warning The unresolved reference.
 * @returns The sentences — what the name resolves to (nothing), what that stops, and what
 *   resolves it.
 */
export function warningExplanation(warning: Pick<CopilotWarning, "code" | "name">): string {
  const arrival = ARRIVALS[`${warning.code}:${warning.name}`];

  switch (warning.code) {
    case "reference.unknown_task":
      return (
        `This stage's task kind, ${warning.name}, isn't in the catalog yet — the draft can't run on real issues until it exists. ` +
        (arrival ?? "It resolves once a task kind with that name exists in this workspace's model routing.")
      );
    case "reference.unknown_skill":
      return (
        `No skill named ${warning.name} exists in this workspace yet — the stage has nothing to load, and the draft can't run on real issues until it does. ` +
        (arrival ?? "It resolves once a skill with that name is created in this workspace.")
      );
    case "reference.unknown_alias":
      return (
        `No model alias named ${warning.name} exists in this workspace's registry yet — the stage has no model to run on, and the draft can't run on real issues until it does. ` +
        "It resolves once that alias is added to the model registry, or the stage is pinned to one that exists."
      );
  }
}

/** A tag's warning: what the service said, and what this page says about it. */
export interface StageTagWarning {
  /** The reference's kind. */
  readonly code: CopilotWarning["code"];
  /** The name that resolved to nothing. */
  readonly name: string;
  /** The two words beside the tag — *skill does not exist*. */
  readonly summary: string;
  /** What is missing and where it will come from — {@link warningExplanation}. */
  readonly explanation: string;
  /** The service's own sentence for the reference. */
  readonly message: string;
}

/**
 * A warning, as a tag carries it.
 *
 * @param warning The unresolved reference.
 * @returns The tag's warning.
 */
function tagWarning(warning: CopilotWarning): StageTagWarning {
  return {
    code: warning.code,
    name: warning.name,
    summary: WARNING_SUMMARIES[warning.code],
    explanation: warningExplanation(warning),
    message: warning.message,
  };
}

/* ------------------------------------------------------------------ tags */

/** One config tag on a row. */
export interface StageTag {
  /** A key stable among the row's tags. */
  readonly key: string;
  /** What it prints — `skill:advisory-db`, `claude-sonnet-5`, `pool-a`. */
  readonly text: string;
  /** The unresolved reference this tag names, or `null` for a tag that resolves. */
  readonly warning: StageTagWarning | null;
}

/** What a terminal's action means for the pull request — the mockup's `never auto-merge`. */
export const TERMINAL_POLICY_WORDS: Readonly<Record<string, string>> = {
  needs_review: "never auto-merge",
  open_pr_automerge: "auto-merge",
  back_to_queue: "back to queue",
};

/** What separates the parts of a stage's description, each of which is a tag. */
export const DESCRIPTION_SEPARATOR = " · ";

/** What a tag composer is given. */
export interface TagFacts {
  /** The document's root `trigger` — read for the trigger stage alone. */
  readonly trigger: unknown;
  /** The stage's `description`, or `null`. */
  readonly description: string | null;
  /** The workspace's aliases; an alias this list lacks is printed as its own name. */
  readonly aliases: readonly AliasModel[];
  /** The draft's unresolved references. */
  readonly warnings: readonly CopilotWarning[];
}

/**
 * One stage's config tags, composed from its configuration.
 *
 * In this order: the trigger's conditions, one tag per value (`label:security`, `effort ≤ M`,
 * `source:github`); `skill:<slug>` for a stage in skill mode; the model — a pinned alias
 * resolved to its model id, or `routed by task` for a stage that inherits its task's route, or
 * `task:<kind>` in warning when that task kind resolves to nothing; a flow node's predicate; the
 * runner pool; each part of the stage's description; a terminal's policy. Two tags that say the
 * same thing — compared without case — are one.
 *
 * A reference in the draft's warnings marks the tag that names it. A warning on this stage that
 * no tag names is still drawn, as a tag of its own, so nothing unresolved is ever silent.
 *
 * @param stage The stage.
 * @param facts What the stage's configuration is read against.
 * @returns The tags, in order.
 */
export function stageTags(stage: Pick<Stage, "id" | "kind" | "config">, facts: TagFacts): readonly StageTag[] {
  const mine = facts.warnings.filter((warning) => warning.node === stage.id);
  const used = new Set<CopilotWarning>();
  const tags: StageTag[] = [];
  const said = new Set<string>();

  /**
   * Add a tag, unless one already says it.
   *
   * @param kind What the tag reports — the first half of its key.
   * @param text What it prints.
   * @param code The reference it names, when it names one: a warning of that code and name marks it.
   * @param name The name the reference is by. Defaults to the tag's text.
   */
  const add = (kind: string, text: string, code?: CopilotWarning["code"], name: string = text): void => {
    const folded = text.trim().toLowerCase();
    if (folded === "" || said.has(folded)) return;
    said.add(folded);

    const warning = code === undefined ? undefined : mine.find((entry) => entry.code === code && entry.name === name);
    if (warning !== undefined) used.add(warning);
    tags.push({ key: `${kind}:${text}`, text, warning: warning === undefined ? null : tagWarning(warning) });
  };

  const { config } = stage;

  if (stage.kind === "trigger") {
    const trigger = readTrigger({ trigger: facts.trigger });
    for (const label of trigger?.labels ?? []) add("label", `label:${label}`);
    if (trigger !== null && trigger.effortLte !== null) add("effort", `effort ≤ ${trigger.effortLte.toUpperCase()}`);
    if (trigger !== null && trigger.source !== null) add("source", `source:${trigger.source}`);
  }

  if (stage.kind === "llm") {
    const skill = asText(config.skill);
    if (config.mode === "skill" && skill !== null) add("skill", `skill:${skill}`, "reference.unknown_skill", skill);

    const routing = asRecord(config.routing);
    const alias = asText(asRecord(routing?.pinned_model)?.alias);
    const task = asText(routing?.inherit_task);

    if (alias !== null) {
      const model = facts.aliases.find((entry) => entry.alias === alias)?.modelId ?? alias;
      add("model", model, "reference.unknown_alias", alias);
    } else if (task !== null) {
      const unknown = mine.some((entry) => entry.code === "reference.unknown_task" && entry.name === task);
      if (unknown) add("task", `task:${task}`, "reference.unknown_task", task);
      else add("route", ROUTED_BY_TASK_CHIP);
    }
  }

  if (stage.kind === "flow") {
    const words = predicateWords(asRecord(config.predicate));
    if (words !== null) add("predicate", words);
  }

  const pool = asText(config.runner_pool);
  if (pool !== null) add("pool", pool);

  for (const part of (facts.description ?? "").split(DESCRIPTION_SEPARATOR)) add("says", part.trim());

  if (stage.kind === "term") {
    const policy = typeof config.action === "string" ? TERMINAL_POLICY_WORDS[config.action] : undefined;
    if (policy !== undefined) add("policy", policy);
  }

  for (const warning of mine) {
    if (used.has(warning)) continue;
    tags.push({ key: `unresolved:${warning.code}:${warning.name}`, text: warning.name, warning: tagWarning(warning) });
  }

  return tags;
}

/* ------------------------------------------------------------------ rows */

/** How each provenance is said on a row. A person's stage, and a published one, say nothing. */
export const PROVENANCE_PILLS: Readonly<Record<StageProvenance, string | null>> = {
  copilot: "added by copilot",
  suggestion: "added by suggestion",
  human: null,
  published: null,
};

/** One row of the stage list. */
export interface StageRow {
  /** The row's first node — what its element id, its key and its `edit` link are made from. */
  readonly id: string;
  /** Every node the row stands for, the first included. More than one for folded twins. */
  readonly nodeIds: readonly string[];
  /** Its place in the list — `01`. */
  readonly number: string;
  /** Which of the five kinds. */
  readonly kind: StageKind;
  /** The kind's glyph, as the canvas draws it. */
  readonly glyph: string;
  /** The kind, in a word — for a reader who cannot see the glyph. */
  readonly kindWord: string;
  /** What the row is called — the stage's title, `review ×2` for folded twins. */
  readonly name: string;
  /** Its config tags, in order. */
  readonly tags: readonly StageTag[];
  /** `added by copilot`, or `null`. On a folded row, only when every stage it stands for has it. */
  readonly pill: string | null;
}

/** What the rows are composed from. */
export interface RowFacts {
  /** The draft's document, or `null`. */
  readonly definition: WorkflowDefinition | null;
  /** Who each stage is by. */
  readonly provenance: readonly NodeProvenance[];
  /** The draft's unresolved references. */
  readonly warnings: readonly CopilotWarning[];
  /** The workspace's aliases. */
  readonly aliases: readonly AliasModel[];
}

/**
 * A row's two-digit number.
 *
 * @param index The row's index, from zero.
 * @returns `01`, `02`, … `10`.
 */
export function rowNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * Compose the stage list's rows.
 *
 * @param facts The draft, its provenance, its warnings and the workspace's aliases.
 * @returns One row per stage in flow order, parallel twins folded into one.
 */
export function stageRows(facts: RowFacts): readonly StageRow[] {
  const { definition } = facts;
  const ordered = stageOrder(definition);
  const says = descriptions(definition);
  const byNode = new Map(facts.provenance.map((entry) => [entry.nodeId, entry.provenance]));

  // Who feeds each stage, as one comparable string: twins are fed by the same stages.
  const feeders = new Map<string, string[]>();
  for (const edge of readConnections(definition, ordered)) {
    if (edge.kind === "loop") continue;
    feeders.set(edge.to, [...(feeders.get(edge.to) ?? []), edge.from]);
  }
  const fedBy = (id: string): string => [...new Set(feeders.get(id) ?? [])].sort().join("\u0000");

  const groups: Stage[][] = [];
  const groupOf = new Map<string, Stage[]>();
  for (const stage of ordered) {
    const feeds = fedBy(stage.id);
    // A stage nothing feeds is parallel to nothing, whatever it is called.
    const key = feeds === "" ? null : `${stage.kind}\u0000${stage.title}\u0000${feeds}`;
    const twin = key === null ? undefined : groupOf.get(key);

    if (twin !== undefined) {
      twin.push(stage);
    } else {
      const group = [stage];
      groups.push(group);
      if (key !== null) groupOf.set(key, group);
    }
  }

  return groups.map((group, index) => {
    const [first] = group;
    const tags: StageTag[] = [];
    const said = new Set<string>();

    for (const stage of group) {
      const composed = stageTags(stage, {
        trigger: definition?.trigger,
        description: says.get(stage.id) ?? null,
        aliases: facts.aliases,
        warnings: facts.warnings,
      });
      for (const tag of composed) {
        const folded = tag.text.toLowerCase();
        if (said.has(folded)) continue;
        said.add(folded);
        tags.push(group.length === 1 ? tag : { ...tag, key: `${stage.id}:${tag.key}` });
      }
    }

    const pills = group.map((stage) => PROVENANCE_PILLS[byNode.get(stage.id) ?? "human"]);

    return {
      id: first.id,
      nodeIds: group.map((stage) => stage.id),
      number: rowNumber(index),
      kind: first.kind,
      glyph: STAGE_GLYPHS[first.kind],
      kindWord: STAGE_KIND_WORDS[first.kind],
      name: group.length === 1 ? first.title : `${first.title} ×${group.length}`,
      tags,
      pill: pills.every((pill) => pill !== null && pill === pills[0]) ? pills[0] : null,
    };
  });
}

/* ------------------------------------------------------------------ the head */

/** The label of the link to the code view, as mockup 20 writes it. */
export const VIEW_AS_CODE_LABEL = "View as code →";

/** What a row's link to the canvas says. */
export const EDIT_LABEL = "edit";

/**
 * A row's `edit` link, named for a reader who hears it out of its row.
 *
 * @param name The row's name.
 * @returns *Edit analyze on the canvas*.
 */
export function editName(name: string): string {
  return `Edit ${name} on the canvas`;
}

/**
 * The card's title — the mockup's `DRAFT — SECURITY-PATCH · UNPUBLISHED`, which the card's head
 * sets in capitals.
 *
 * @param name The workflow's name.
 * @param currentVersion The version in force, or `null` for a workflow that has published
 *   nothing — the rail's own *not published*.
 * @returns `Draft — security-patch · unpublished`, or `Draft — standard-fix` for a workflow
 *   with a version in force.
 */
export function stagesTitle(name: string, currentVersion: number | null): string {
  return currentVersion === null ? `Draft — ${name} · unpublished` : `Draft — ${name}`;
}

/**
 * The head's revision tag.
 *
 * @param label The draft's label, as the service composes it — `v0.3`.
 * @returns `draft v0.3`.
 */
export function revTag(label: string): string {
  return `draft ${label}`;
}

/** A draft label's two numbers. */
export interface DraftRev {
  /** The version in force when the draft was begun; `0` for a workflow that has published nothing. */
  readonly published: number;
  /** The draft's revision — one per applied batch of operations. */
  readonly rev: number;
}

/**
 * Read a draft's label.
 *
 * @param label `v{published}.{rev}`, as the service composes it.
 * @returns The two numbers, or `null` for a label that is not one.
 */
export function parseDraftLabel(label: string): DraftRev | null {
  const match = /^v(\d+)\.(\d+)$/.exec(label);

  return match === null ? null : { published: Number(match[1]), rev: Number(match[2]) };
}

/**
 * Compose a draft's label, the way the service does.
 *
 * @param rev The two numbers.
 * @returns `v0.3`.
 */
export function draftLabel(rev: DraftRev): string {
  return `v${rev.published}.${rev.rev}`;
}

/* ------------------------------------------------------------------ the footer */

/** The runnable-state line for a draft with an unresolved reference — the mockup's. */
export const NOT_RUNNABLE = "draft not yet runnable on real issues";

/** The runnable-state line for a draft with none. */
export const RUNNABLE_ONCE_PROMOTED = "draft runnable once promoted";

/** One part of the footer. */
export interface FooterPart {
  /** A key stable among the parts. */
  readonly key: string;
  /** What it prints. */
  readonly text: string;
  /**
   * `warn` for what is not a protection or not yet true — a guard nothing holds a real run to,
   * a draft that cannot run — and `plain` for the rest. The words say it; the hue repeats it.
   */
  readonly tone: "plain" | "warn";
}

/**
 * How many stages, in words.
 *
 * @param count The number of rows — twins counted once, as the list draws them.
 * @returns `1 stage`, `9 stages`.
 */
export function stageCount(count: number): string {
  return count === 1 ? "1 stage" : `${count} stages`;
}

/**
 * The footer, all of it derived: the stage count, each guard a promote would carry, and whether
 * the draft could run.
 *
 * A guard is printed with the service's own label. One that is `dry_run_only` is never drawn as
 * protection: it says *not enforced on real runs yet* beside its label, on the warning hue — the
 * promote confirmation's words (`promote-summary.tsx`).
 *
 * The runnable line claims only what the draft supports: *not yet runnable* while any reference
 * is unresolved, *runnable once promoted* for a draft with stages and none, and nothing at all
 * where there is no draft.
 *
 * @param facts The rows, the draft's warnings and the promotion summary — a summary that could
 *   not be read contributes no guard.
 * @returns The parts, in order. Empty when there are no rows.
 */
export function footerParts(facts: {
  readonly rows: number;
  readonly warnings: readonly CopilotWarning[];
  readonly promotion: Reading<CopilotPromotion> | null;
}): readonly FooterPart[] {
  if (facts.rows === 0) return [];

  const parts: FooterPart[] = [{ key: "count", text: stageCount(facts.rows), tone: "plain" }];

  for (const guard of facts.promotion?.ok === true ? facts.promotion.value.guards : []) {
    parts.push(
      guard.enforcement === "enforced"
        ? { key: `guard:${guard.id}`, text: guard.label, tone: "plain" }
        : {
            key: `guard:${guard.id}`,
            text: `${guard.label} (${GUARD_ENFORCEMENT_WORDS[guard.enforcement].toLowerCase()})`,
            tone: "warn",
          },
    );
  }

  parts.push(
    facts.warnings.length > 0
      ? { key: "runnable", text: NOT_RUNNABLE, tone: "warn" }
      : { key: "runnable", text: RUNNABLE_ONCE_PROMOTED, tone: "plain" },
  );

  return parts;
}

/* ------------------------------------------------------------------ the states */

/** The stage list's accessible name. */
export const STAGES_LABEL = "Draft stages";

/** The scrolling wrapper's accessible name. */
export const STAGES_SCROLL_LABEL = "Draft stages, scrollable";

/** The empty state's title. */
export const NO_STAGES_TITLE = "No stages yet";

/** The empty state's note: where the stages will come from. */
export const NO_STAGES_NOTE =
  "This draft has no stages. They appear here as the conversation builds them, and as they are added on the canvas.";

/** The empty state's link to the canvas. */
export const OPEN_CANVAS_LABEL = "Open the canvas";

/** The banner over a draft that could not be read. */
export const DRAFT_FAILED_HEADLINE = "The draft's stages could not be read.";

/** The note over a list a later read could not refresh. */
export const STALE_HEADLINE = "These stages may be out of date.";

/** What the stale note's control says. */
export const STALE_RETRY_LABEL = "Read again";

/** What is said when the draft's poll reached nothing. */
export const UNREACHABLE_DRAFT = "The draft could not be reached, so this is the list as it was last read.";

/** What is said when the draft's poll was answered with something that is not a draft. */
export const UNREADABLE_DRAFT = "The draft came back in a shape this page could not read, so this is the list as it was last read.";

/** The info button's name on a warning tag. */
export const WARNING_BUTTON_PREFIX = "What is missing";

/**
 * A warning tag's info button, named.
 *
 * @param text The tag's text.
 * @returns *What is missing: skill:advisory-db*.
 */
export function warningButtonName(text: string): string {
  return `${WARNING_BUTTON_PREFIX}: ${text}`;
}

/* ------------------------------------------------------------------ the live draft */

/**
 * An operation's stage — `params.node`, as the stream spells it.
 *
 * @param op The operation.
 * @returns The node, when it is an object with a string id.
 */
function nodeOf(op: OperationShape): (Fields & { readonly id: string }) | null {
  const node = asRecord(op.params?.node);

  return node !== null && asText(node.id) !== null ? (node as Fields & { readonly id: string }) : null;
}

/**
 * An operation's edge ends — `params.edge`, or `from`/`to` beside the kind.
 *
 * @param op The operation.
 * @returns The edge as stored and its two ends, or `null` when either end is missing.
 */
function edgeOf(op: OperationShape): { readonly edge: Fields; readonly from: string; readonly to: string } | null {
  const params = op.params ?? {};
  const edge = asRecord(params.edge) ?? params;
  const from = asText(edge.from);
  const to = asText(edge.to);

  return from === null || to === null ? null : { edge, from, to };
}

/**
 * Whether a stored node carries an id.
 *
 * @param node A node, as stored.
 * @param id The id.
 * @returns True when it does.
 */
function hasId(node: unknown, id: string): boolean {
  return asRecord(node)?.id === id;
}

/**
 * Whether a stored edge joins an ordered pair.
 *
 * @param edge An edge, as stored.
 * @param from Its source.
 * @param to Its target.
 * @returns True when it does.
 */
function joins(edge: unknown, from: string, to: string): boolean {
  const fields = asRecord(edge);

  return fields?.from === from && fields.to === to;
}

/**
 * Apply one operation to a document — the draft operations of #556, as the service applies them.
 *
 * | Kind | Params | What it does |
 * |---|---|---|
 * | `add_stage` | `{node}` | appends the node; replaces it in place when the id is already there |
 * | `set_stage` | `{node}` | replaces the node with that id, in place; nothing when there is none |
 * | `remove_stage` | `{id}` | removes the node and every edge touching it |
 * | `add_edge` | `{edge}` | appends the edge; nothing when that ordered pair is already joined |
 * | `remove_edge` | `{from, to}` | removes the edge joining that ordered pair |
 * | `set_trigger` | `{trigger}` | replaces the document's trigger |
 *
 * **It never throws and never guesses.** An operation of another kind (`set_guard` is recorded
 * beside the draft, not in it), one whose params this cannot read — an older trace's
 * `add_stage {id}` names a stage and carries none — and one that changes nothing all return the
 * document **itself**, so a caller can tell by identity.
 *
 * @param definition The document, or `null` for a draft with none yet.
 * @param op The operation.
 * @returns The document after it — the same object when nothing changed.
 */
export function applyOperation(definition: WorkflowDefinition | null, op: OperationShape): WorkflowDefinition | null {
  const nodes = rawNodes(definition);
  const edges = rawEdges(definition);
  const base: WorkflowDefinition = definition ?? {};

  switch (op.kind) {
    case "add_stage":
    case "set_stage": {
      const node = nodeOf(op);
      if (node === null) return definition;

      const at = nodes.findIndex((entry) => hasId(entry, node.id));
      if (at === -1) return op.kind === "add_stage" ? { ...base, nodes: [...nodes, node] } : definition;

      return { ...base, nodes: nodes.map((entry, index) => (index === at ? node : entry)) };
    }

    case "remove_stage": {
      const id = asText(op.params?.id) ?? nodeOf(op)?.id ?? null;
      if (id === null || !nodes.some((entry) => hasId(entry, id))) return definition;

      return {
        ...base,
        nodes: nodes.filter((entry) => !hasId(entry, id)),
        edges: edges.filter((entry) => {
          const fields = asRecord(entry);
          return fields?.from !== id && fields?.to !== id;
        }),
      };
    }

    case "add_edge": {
      const found = edgeOf(op);
      if (found === null || edges.some((entry) => joins(entry, found.from, found.to))) return definition;

      return { ...base, edges: [...edges, found.edge] };
    }

    case "remove_edge": {
      const found = edgeOf(op);
      if (found === null || !edges.some((entry) => joins(entry, found.from, found.to))) return definition;

      return { ...base, edges: edges.filter((entry) => !joins(entry, found.from, found.to)) };
    }

    case "set_trigger": {
      const trigger = asRecord(op.params?.trigger);

      return trigger === null ? definition : { ...base, trigger };
    }

    default:
      return definition;
  }
}

/**
 * The stage a live operation changed, for the row's brief highlight.
 *
 * @param definition The document after the operation.
 * @param op The operation.
 * @returns The ids of the stages whose rows changed: the stage added or replaced, the trigger
 *   stages for a new trigger, the stage an edge now leads to. Empty for a removal.
 */
function touched(definition: WorkflowDefinition | null, op: OperationShape): readonly string[] {
  switch (op.kind) {
    case "add_stage":
    case "set_stage": {
      const node = nodeOf(op);
      return node === null ? [] : [node.id];
    }
    case "set_trigger":
      return readStages(definition)
        .filter((stage) => stage.kind === "trigger")
        .map((stage) => stage.id);
    case "add_edge": {
      const found = edgeOf(op);
      return found === null ? [] : [found.to];
    }
    default:
      return [];
  }
}

/** The working draft the card draws, and what it has already folded in. */
export interface StageDraftState {
  /** The document, or `null` before the first operation. */
  readonly definition: WorkflowDefinition | null;
  /** Who each stage is by. */
  readonly provenance: readonly NodeProvenance[];
  /** The unresolved references. */
  readonly warnings: readonly CopilotWarning[];
  /** The revision label — the service's, or composed from the newest applied operation. */
  readonly label: string;
  /**
   * The revision of the last draft a read returned, or `null` when its label could not be read.
   * An operation at or behind it is already in that draft; one ahead of it is not — and a batch's
   * operations all carry the batch's one revision, so this, not the working label, is the line.
   */
  readonly baseRev: number | null;
  /**
   * How many times each stage has been changed by a live operation since the card mounted, by
   * node id — what the row's highlight is keyed on, so a second change shows as a second flash.
   */
  readonly fresh: Readonly<Record<string, number>>;
  /** What has been folded in already, by identity — so nothing is applied twice. */
  readonly seen: {
    readonly server: StageDraft | null;
    readonly polled: StageDraft | null;
    readonly live: StageDraft | null;
    /** The ordinal of the last live operation considered. */
    readonly ordinal: number;
  };
}

/** Everything that can move the working draft. */
export interface StageDraftInputs {
  /** The draft the route read, or `null` when that read failed. */
  readonly server: StageDraft | null;
  /** The poll's last answer, or `null` before one. */
  readonly polled: StageDraft | null;
  /** What the conversation has done in this page session (`copilot-live.ts`). */
  readonly live: CopilotLive;
}

/**
 * Whether a draft that has just arrived replaces the working one.
 *
 * **Newer wins.** Within one published version a draft's revision only grows, so a read whose
 * revision is behind the working draft's — an answer overtaken by the stream — is dropped. A
 * read from another published version (a promote happened) is not comparable and is taken. An
 * answer with **no document** is how a discard reads, and is taken too — except while a reply is
 * arriving, when it can only be a read from before the reply began.
 *
 * @param candidate The draft that arrived.
 * @param state The working draft.
 * @param streaming Whether a reply is arriving.
 * @returns True when the candidate is drawn.
 */
export function supersedes(candidate: StageDraft, state: Pick<StageDraftState, "label">, streaming: boolean): boolean {
  const arrived = parseDraftLabel(candidate.label);
  const held = parseDraftLabel(state.label);

  if (arrived === null || held === null) return true;
  if (arrived.published !== held.published) return true;
  if (arrived.rev >= held.rev) return true;

  return candidate.definition === null && !streaming;
}

/**
 * Take a draft that arrived as the working draft.
 *
 * @param state The state so far.
 * @param draft The draft.
 * @returns The state, drawing that draft.
 */
function take(state: StageDraftState, draft: StageDraft): StageDraftState {
  return {
    ...state,
    definition: draft.definition,
    provenance: draft.nodeProvenance ?? [],
    warnings: draft.warnings,
    label: draft.label,
    baseRev: parseDraftLabel(draft.label)?.rev ?? null,
  };
}

/**
 * Fold one live operation into the working draft.
 *
 * Only an operation the service **applied**, and only one whose revision is ahead of the last
 * draft a read returned: a proposed guard changed nothing, and an operation at or behind that
 * revision is already in that draft. A stage the copilot adds carries its pill at once —
 * the authoritative read replaces it — and the warnings an operation introduced are drawn with
 * it.
 *
 * @param state The state so far.
 * @param operation The operation.
 * @returns The state after it — the same object when it changed nothing.
 */
function fold(state: StageDraftState, operation: LiveOperation): StageDraftState {
  if (operation.outcome !== "applied" || operation.draftRev === null) return state;

  if (state.baseRev !== null && operation.draftRev <= state.baseRev) return state;

  const { op } = operation;
  const definition = applyOperation(state.definition, op);
  const held = parseDraftLabel(state.label);
  const label =
    held === null
      ? state.label
      : draftLabel({ published: held.published, rev: Math.max(held.rev, operation.draftRev) });

  const added = op.kind === "add_stage" ? nodeOf(op)?.id : undefined;
  const removed = op.kind === "remove_stage" ? (asText(op.params?.id) ?? nodeOf(op)?.id) : undefined;

  let { provenance, warnings } = state;
  if (added !== undefined && definition !== state.definition) {
    provenance = [
      ...provenance.filter((entry) => entry.nodeId !== added),
      { nodeId: added, provenance: "copilot", addedRev: operation.draftRev },
    ];
  }
  if (removed !== undefined && removed !== null) {
    provenance = provenance.filter((entry) => entry.nodeId !== removed);
    warnings = warnings.filter((entry) => entry.node !== removed);
  }
  const fresh = operation.warnings.filter(
    (entry) => !warnings.some((known) => known.code === entry.code && known.node === entry.node && known.name === entry.name),
  );
  if (fresh.length > 0) warnings = [...warnings, ...fresh];

  const changed = definition === state.definition ? [] : touched(definition, op);
  const marks = { ...state.fresh };
  for (const id of changed) marks[id] = (marks[id] ?? 0) + 1;

  return { ...state, definition, provenance, warnings, label, fresh: changed.length === 0 ? state.fresh : marks };
}

/**
 * The working draft a card opens on.
 *
 * The route's read is the newest thing there is when the card mounts: what the conversation did
 * earlier in this page session is already in it, so those operations and that finished draft are
 * marked seen rather than replayed. The one exception is a reply **still arriving** — its
 * operations are ahead of the read, and {@link advanceStageDraft} folds them in.
 *
 * @param server The draft the route read, or `null` when it could not.
 * @param live What the conversation has done in this page session.
 * @returns The state.
 */
export function openStageDraft(server: StageDraft | null, live: CopilotLive): StageDraftState {
  const opened: StageDraftState = {
    definition: server?.definition ?? null,
    provenance: server?.nodeProvenance ?? [],
    warnings: server?.warnings ?? [],
    label: server?.label ?? "",
    baseRev: server === null ? null : (parseDraftLabel(server.label)?.rev ?? null),
    fresh: {},
    seen: {
      server,
      polled: null,
      live: live.draft,
      ordinal: live.streaming ? 0 : live.operations.length,
    },
  };

  return advanceStageDraft(opened, { server, polled: null, live });
}

/**
 * Fold in whatever has arrived since the last render.
 *
 * In this order: the stream's new operations, oldest first — each applied once, by its ordinal;
 * then a finished reply's draft, a poll's answer and the route's read, each only when it is a
 * new object and {@link supersedes} what is drawn. A conversation started again empties the
 * stream's list, and the count starts again with it.
 *
 * @param state The state so far.
 * @param inputs The three sources, as they stand.
 * @returns The state — **the same object** when nothing new arrived, so a caller can hold it in
 *   React state and set it during render without looping.
 */
export function advanceStageDraft(state: StageDraftState, inputs: StageDraftInputs): StageDraftState {
  const { server, polled, live } = inputs;
  let next = state;

  // A list shorter than the count is a list that was reset.
  let done = live.operations.length < state.seen.ordinal ? 0 : state.seen.ordinal;
  for (const operation of live.operations) {
    if (operation.ordinal <= done) continue;
    done = operation.ordinal;
    next = fold(next, operation);
  }

  const arrivals: readonly (readonly [keyof Omit<StageDraftState["seen"], "ordinal">, StageDraft | null])[] = [
    ["live", live.draft],
    ["polled", polled],
    ["server", server],
  ];
  for (const [source, draft] of arrivals) {
    if (draft === null || draft === state.seen[source]) continue;
    if (supersedes(draft, next, live.streaming)) next = take(next, draft);
  }

  const seen = { server, polled, live: live.draft, ordinal: live.operations.length };
  const unmoved =
    seen.server === state.seen.server &&
    seen.polled === state.seen.polled &&
    seen.live === state.seen.live &&
    seen.ordinal === state.seen.ordinal;

  return unmoved && next === state ? state : { ...next, seen };
}

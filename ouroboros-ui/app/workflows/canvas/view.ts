/**
 * Every word the canvas prints, and the sentences it composes (S.2,
 * [#148](https://github.com/NobuData/ouroboros/issues/148); editing S.5,
 * [#151](https://github.com/NobuData/ouroboros/issues/151)).
 *
 * The labels, the reasons and the hint live here rather than in the component for the reason
 * `app/workflows/view.ts` gives: each is an agreement with a test or with another module, and a
 * string typed twice is one that drifts. **Framework-free** — nothing here imports React or the
 * library — so the pure modules beside it can name a stage without pulling a component in.
 */

import type { CanvasSelection, StageKind } from "./graph";
import type { EditRule } from "./rules";

/* ------------------------------------------------------------------ the canvas */

/** The canvas region's accessible name. */
export const CANVAS_LABEL = "Canvas";

/**
 * How each node type is named to a screen reader, and on a node whose type is its role.
 *
 * The DSL's words are `trigger`, `llm`, `infra`, `flow` and `term`. A node's type line prints
 * the stage's *role* — the mockup's *Analyze*, *Gate*, *Terminal* — which `treatment.ts`'s
 * `stageRole` derives, and which is these words for a trigger, a terminal and a flow node of no
 * known kind. The accessible name always says what kind of stage it is, in a word a reader
 * would use.
 */
export const STAGE_KIND_WORDS: Readonly<Record<StageKind, string>> = {
  trigger: "Trigger",
  llm: "Model",
  infra: "Infra",
  flow: "Flow",
  term: "Terminal",
};

/** The glyph each type's line begins with — the mockup's `▸ ◆ ▣ ◇ ●`, hidden from a screen reader. */
export const STAGE_GLYPHS: Readonly<Record<StageKind, string>> = {
  trigger: "▸",
  llm: "◆",
  infra: "▣",
  flow: "◇",
  term: "●",
};

/** What a flow node's type line says, by its config's `kind` — the mockup's *Decision* and *Gate*. */
export const FLOW_ROLE_WORDS: Readonly<Record<"decision" | "gate", string>> = {
  decision: "Decision",
  gate: "Gate",
};

/**
 * A stage's accessible name — *Model stage: Code the change*.
 *
 * @param stage Its kind and title.
 * @returns The name.
 */
export function stageName(stage: { readonly kind: StageKind; readonly title: string }): string {
  return `${STAGE_KIND_WORDS[stage.kind]} stage: ${stage.title}`;
}

/**
 * An edge's accessible name — *Write attack plan to Code the change*, with its label when it
 * has one.
 *
 * @param from The source stage's title.
 * @param to The target stage's title.
 * @param label What the edge prints, or `null`.
 * @returns The name.
 */
export function edgeName(from: string, to: string, label: string | null): string {
  const path = `${from} to ${to}`;

  return label === null ? path : `${path} (${label})`;
}

/* ------------------------------------------------------------------ the toolbar */

/** The zoom group's accessible name. */
export const ZOOM_LABEL = "Zoom";

/** The mockup's **−**. */
export const ZOOM_OUT_LABEL = "Zoom out";

/** The mockup's **+**. */
export const ZOOM_IN_LABEL = "Zoom in";

/** The mockup's **100%**, which is a control here: it returns to the origin at actual size. */
export const ZOOM_HOME_LABEL = "Return to 100%";

/** The mockup's second toolbar control. */
export const AUTO_LAYOUT_LABEL = "Auto-layout";

/** Why Auto-layout cannot act on a canvas with nothing on it. */
export const AUTO_LAYOUT_EMPTY = "Nothing to lay out yet — add a stage first.";

/** The mockup's third toolbar control. */
export const ADD_STAGE_LABEL = "Add stage ▾";

/** The menu Add stage opens — the catalog's node types. */
export const ADD_STAGE_MENU_LABEL = "Stage types";

/** Why Add stage cannot act when the catalog (#145) could not be read. */
export const CATALOG_UNREAD_REASON = "The stage catalog could not be read, so there is nothing to add from.";

/**
 * The menu's name when it was opened by a double-click on an edge, or **Insert stage** — it inserts
 * rather than adds.
 *
 * @param from The title of the stage the edge leaves.
 * @param to The title of the stage it arrives at.
 * @returns The name.
 */
export function insertMenuLabel(from: string, to: string): string {
  return `Insert a stage between ${from} and ${to}`;
}

/** The undo and redo group's accessible name. */
export const HISTORY_LABEL = "Edit history";

/** Undo, and why it cannot act. */
export const UNDO_LABEL = "Undo";
export const NOTHING_TO_UNDO = "Nothing to undo yet.";

/** Redo, and why it cannot act. */
export const REDO_LABEL = "Redo";
export const NOTHING_TO_REDO = "Nothing to redo.";

/**
 * The mockup's hint, with the keyboard beside the mouse.
 *
 * The mockup's reads *⌥ drag to pan · double-click edge to add stage*, and both halves work now.
 * The keyboard is added, because a hint that names only the mouse tells a keyboard reader the
 * canvas is not for them.
 */
export const CANVAS_HINT =
  "⌥ drag to pan · double-click edge to add stage · Tab to a stage, arrows move it, Delete removes it · ⌘/Ctrl+Z undoes";

/**
 * What the toolbar says once a canvas with no autosave behind it has been edited.
 *
 * In the studio the session's autosave (S.6, [#152](https://github.com/NobuData/ouroboros/issues/152))
 * hands the canvas its own status line instead (`saveNote`); a canvas mounted on its own holds its
 * edits in memory only, and a page that let a reader build a graph and reload would have lied by
 * omission.
 */
export const UNSAVED_NOTE = "Edited, not saved.";

/** What the toolbar says over a document with no stages — a blank draft. */
export const NO_STAGES_NOTE = "No stages yet — add one from Add stage ▾.";

/**
 * The selection, in a sentence — the one place a keyboard reader is told what pressing Enter on
 * a stage or an edge did, and where to go next: the inspector beside the canvas.
 *
 * @param selection What is selected.
 * @param stageCount How many stages the canvas holds, for the sentence when nothing is.
 * @returns The sentence. Empty when nothing is selected on a canvas that has stages, because
 *   *nothing selected* is the ordinary state and does not need announcing.
 */
export function selectionSentence(selection: CanvasSelection, stageCount: number): string {
  if (selection === null) return stageCount === 0 ? NO_STAGES_NOTE : "";

  switch (selection.kind) {
    case "node":
      return `${selection.stage.title} selected — configure it in the inspector.`;
    case "edge":
      return `Edge ${selection.connection.from} → ${selection.connection.to} selected — edit it in the inspector.`;
    case "many":
      return `${count(selection.nodes, "stage")} and ${count(selection.edges, "edge")} selected.`;
  }
}

/**
 * A count with its noun — *1 stage*, *3 edges*.
 *
 * @param n How many.
 * @param noun The singular.
 * @returns The phrase.
 */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ the rules, in words */

/**
 * Why an edit was refused — one sentence per structural rule an edit can break (`rules.ts`'s
 * `EditRule`), said where the edit was made: on the canvas's notice line, beside the Add stage menu's
 * item, or under the inspector field that would break it. Each says what the rule protects, not only
 * that it exists, because *not allowed* teaches nothing about the next attempt.
 */
export const RULE_REASONS: Readonly<Record<EditRule, string>> = {
  "document.multiple_triggers": "A workflow can only have one trigger.",
  "edge.unknown_from": "That connection starts at a stage the workflow does not hold.",
  "edge.unknown_to": "That connection ends at a stage the workflow does not hold.",
  "edge.duplicate": "Those two stages are already connected in that direction.",
  "edge.self_reference": "A stage cannot connect to itself.",
  "edge.into_trigger": "Nothing can arrive at the trigger — it is where a run starts.",
  "edge.out_of_terminal": "Nothing can leave a terminal — it is where a run ends.",
  "edge.branch_without_condition": "A branch edge needs a condition — choose what it tests.",
  "edge.unexpected_condition": "A default edge is always taken, so it cannot carry a condition.",
  "edge.loop_not_upstream": "A loop edge must return upstream — to a stage that leads back to where the loop starts.",
};

/**
 * What the notice line says when a connection drawn on the canvas is refused.
 *
 * @param rule The rule it would have broken.
 * @returns The sentence.
 */
export function connectionRefused(rule: EditRule): string {
  return `Not connected: ${RULE_REASONS[rule]}`;
}

/* ------------------------------------------------------------------ deleting */

/** The confirmation's two answers. */
export const DELETE_CONFIRM_LABEL = "Delete";
export const DELETE_CANCEL_LABEL = "Cancel";

/** What a delete would remove, as the confirmation words it. */
export interface DeletionSummary {
  /** The titles of the stages it removes. */
  readonly stages: readonly string[];
  /** The edges it removes by name, as `from → to`. */
  readonly edges: readonly string[];
  /** How many more edges go with the stages, because they leave or arrive at one. */
  readonly attached: number;
}

/**
 * The confirmation a delete asks — its title and the sentence under it.
 *
 * The body says what goes with the named things and that **Undo** brings it back, because the edges
 * a stage takes with it are the part a reader does not see they are agreeing to.
 *
 * @param summary What the delete removes.
 * @returns The title and the body.
 */
export function deletePrompt(summary: DeletionSummary): { readonly title: string; readonly body: string } {
  const { stages, edges, attached } = summary;
  let title: string;

  if (stages.length === 1 && edges.length === 0) title = `Delete ${stages[0]}?`;
  else if (stages.length === 0 && edges.length === 1) title = `Delete the edge ${edges[0]}?`;
  else title = `Delete ${count(stages.length, "stage")} and ${count(edges.length, "edge")}?`;

  const pronoun = stages.length === 1 ? "it" : "them";
  const along =
    attached === 0
      ? ""
      : attached === 1
        ? `One edge connected to ${pronoun} goes too. `
        : `${attached} edges connected to ${pronoun} go too. `;
  const total = stages.length + edges.length + attached;

  return { title, body: `${along}Undo brings ${total === 1 ? "it" : "them"} back.` };
}

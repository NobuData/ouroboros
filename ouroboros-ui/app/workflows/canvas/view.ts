/**
 * Every word the canvas prints, and the two sentences it composes (S.2,
 * [#148](https://github.com/NobuData/ouroboros/issues/148)).
 *
 * The labels, the reasons and the hint live here rather than in the component for the reason
 * `app/workflows/view.ts` gives: each is an agreement with a test or with another module, and a
 * string typed twice is one that drifts. **Framework-free** — nothing here imports React or the
 * library — so the pure modules beside it can name a stage without pulling a component in.
 */

import type { CanvasSelection, StageKind } from "./graph";

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

/** Why it cannot act yet — the layout is S.5's. */
export const AUTO_LAYOUT_SOON =
  "Auto-layout arrives with #151 — a layered, left-to-right layout that untangles a graph.";

/** The mockup's third toolbar control. */
export const ADD_STAGE_LABEL = "Add stage ▾";

/** Why it cannot act yet — adding is S.5's, over the catalog R.3 serves. */
export const ADD_STAGE_SOON =
  "Adding a stage arrives with #151, with the stage catalog (#145) as its menu.";

/**
 * The mockup's hint, rewritten for what this canvas does.
 *
 * The mockup's reads *⌥ drag to pan · double-click edge to add stage*. The second half is
 * S.5's and is not advertised until it works; what is added is the keyboard, because a hint
 * that names only the mouse tells a keyboard reader the canvas is not for them.
 */
export const CANVAS_HINT = "⌥ or space + drag to pan · scroll to zoom · Tab to a stage, arrows move it";

/**
 * What the toolbar says once a stage has been moved.
 *
 * The move is in the draft the canvas holds and nowhere else until S.6's autosave
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)) writes it, and a page that let a
 * reader drag twelve stages into place and reload would have lied by omission.
 */
export const UNSAVED_NOTE = "Moved, not saved — autosave arrives with #152.";

/** What the toolbar says over a document with no stages — a blank draft. */
export const NO_STAGES_NOTE = "No stages yet. Adding one arrives with #151.";

/**
 * The selection, in a sentence — the stand-in for the inspector until S.4 mounts it, and the
 * one place a keyboard reader is told what pressing Enter on a stage did.
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
      return `${selection.stage.title} selected — the inspector arrives with #150.`;
    case "edge":
      return `Edge ${selection.connection.from} → ${selection.connection.to} selected — edge editing arrives with #151.`;
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
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

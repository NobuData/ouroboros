/**
 * What the code-editor leg ([#170](https://github.com/NobuData/ouroboros/issues/170)) expects the
 * seeded `standard-fix` code view to draw — copied on purpose, for the reason `seed.ts` gives: an
 * expectation read out of the code under test is one that agrees with any bug in it.
 *
 * The colours are `docs/design/tokens.css`'s, as a browser reports them. The editor's sheet
 * (`ouroboros-ui/app/workflows/code/code-editor.css`) is meant to put each syntax class, the
 * gutter and the caret on one of them; this file is the leg's independent statement of which.
 *
 * V.8 ([#176](https://github.com/NobuData/ouroboros/issues/176)) adds the golden listing, the frame
 * around the editor, and the round-trip's and the publish gate's edits — each a whole line of the
 * seeded file, before and after, so a reader can find it in `standard-fix.loop.ts` by eye.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SABOTAGE } from "./studio";

/** The code view, opened on the seeded workflow. */
export const CODE_PATH = "/workflows/standard-fix/code";

/** The page's `<h1>`: the workflow's file name. */
export const CODE_TITLE = "standard-fix.loop.ts";

/** The file card's accessible name (`app/workflows/code/code-view.ts`'s `FILE_LABEL`). */
export const FILE_LABEL = "Workflow code";

/** The editable region's accessible name: the file's path. */
export const FILE_PATH = "workflows/standard-fix.loop.ts";

/** The file card's note for a role that may type into the file, before anything is typed (V.4, #172). */
export const SAVE_NOTE = "Saves as you type.";

/** The file card's note for a reader who may not. */
export const READ_ONLY_NOTE = "Read-only";

/** One colour in each palette, as `getComputedStyle` spells it. */
export interface PaletteColour {
  readonly light: string;
  readonly dark: string;
}

/** The tokens the editor's skin is drawn in. */
export const EDITOR_COLOURS = {
  /** `--inset`: the well and the gutter. */
  inset: { light: "rgb(239, 244, 247)", dark: "rgb(15, 21, 25)" },
  /** `--ink-faint`: line numbers and comments. */
  inkFaint: { light: "rgb(92, 111, 122)", dark: "rgb(126, 144, 153)" },
  /** `--accent`: keywords, the caret, the current line's number. */
  accent: { light: "rgb(7, 112, 142)", dark: "rgb(61, 214, 245)" },
  /** `--accent-deep`: the current line's inset. */
  accentDeep: { light: "rgb(5, 88, 114)", dark: "rgb(23, 147, 196)" },
  /** `--accent-tint`: the current line. */
  accentTint: { light: "rgba(7, 112, 142, 0.1)", dark: "rgba(61, 214, 245, 0.12)" },
  /** `--ok`: strings. */
  ok: { light: "rgb(11, 112, 72)", dark: "rgb(62, 220, 151)" },
  /** `--warn`: numbers. */
  warn: { light: "rgb(122, 76, 0)", dark: "rgb(245, 184, 61)" },
  /** `--model`: callees. */
  model: { light: "rgb(91, 52, 196)", dark: "rgb(167, 139, 250)" },
} as const satisfies Record<string, PaletteColour>;

/**
 * Colours CodeMirror's own base theme would paint — its light gutter, its dark gutter, its black
 * caret — which must never be what the browser computes.
 */
export const CODEMIRROR_DEFAULTS = {
  gutter: ["rgb(245, 245, 245)", "rgb(51, 51, 56)"],
  caret: ["rgb(0, 0, 0)", "rgb(221, 221, 221)"],
} as const;

/** The syntax class, one text it colours in the seeded file's first lines, and its token. */
export const SYNTAX_SAMPLES = [
  { className: "code-editor__keyword", text: "import", colour: "accent" },
  { className: "code-editor__string", text: '"@ouroboros/sdk"', colour: "ok" },
  { className: "code-editor__callee", text: "defineLoop", colour: "model" },
  { className: "code-editor__number", text: "200_000", colour: "warn" },
] as const satisfies readonly {
  className: string;
  text: string;
  colour: keyof typeof EDITOR_COLOURS;
}[];

/** The line the pair is photographed with the caret on — `export default defineLoop(…)`. */
export const CARET_LINE = 3;

/** The longest a keystroke's event handlers may run, in milliseconds: one 60fps frame. */
export const FRAME_MS = 16.7;

/* ------------------------------------------------------------------ V.8: the golden listing */

/**
 * The golden listing, line by line — U.1's committed fixture, which `ouroboros-rest`'s printer suite
 * holds byte-identical to the print of the seeded document.
 *
 * **Read from the fixture rather than written out**, for `support/studio.ts`' `seededDefinition`
 * reason: it is the golden the product is held to, not a payload the product produced, and a second
 * copy of 160 lines here would be one that suite never checks.
 *
 * @returns The file's lines, split on line feeds — the last is `""`, for the trailing newline.
 */
export function goldenListing(): readonly string[] {
  const fixture = resolve(
    __dirname,
    "../../../schemas/workflow-dsl/fixtures/code/standard-fix.loop.ts",
  );

  return readFileSync(fixture, "utf8").split("\n");
}

/** Mockup 05's subline, verbatim (`code-view.ts`' `CODE_SUBLINE`) — the claim this leg certifies. */
export const CODE_SUBLINE =
  "The same loop as the visual canvas — every graph compiles to this typed DSL and back, losslessly.";

/** The status bar's accessible name (`code-status.ts`' `STATUS_BAR_LABEL`). */
export const STATUS_BAR_LABEL = "Editor status";

/** The status bar's words while the file and the draft agree (`code-status.ts`' `SYNC_WORDS`). */
export const SYNCED_WORDS = "synced with visual editor";

/**
 * The status bar's draft label for a seeded draft — `v15 draft` on a cold stack. The number is the
 * version in force plus one, which every green publish moves, so it is matched rather than written.
 */
export const DRAFT_LABEL = /^v\d+ draft$/;

/** The status bar's right cluster before the cursor has moved (`code-status.ts`' `statusRight`). */
export const STATUS_RIGHT_AT_START = "DSL analyzer · Ln 1, Col 1 · UTF-8";

/** The right panel's accessible name (`code-panel.ts`' `PANEL_LABEL`). */
export const PANEL_LABEL = "Loop checks and outline";

/** The segmented control's two live segments (`mode-switch.ts`' `SURFACE_LABELS`). */
export const VISUAL_TAB = "Visual";
export const CODE_TAB = "Code";

/* ------------------------------------------------------------------ V.8: the round-trip */

/**
 * The code → visual half: *Implement*'s token budget, as a line of the file before and after, and as
 * the inspector's field must then show it (`inspector.ts`' `formatTokenBudget`).
 */
export const BUDGET_EDIT = {
  before: "tokenBudget: 400_000,",
  after: "tokenBudget: 500_000,",
  inspector: "500k",
} as const;

/** The stage the visual → code half moves, and where the seed puts it (the layout block's line). */
export const MOVED_STAGE = { id: "implement", x: 588, y: 420 } as const;

/**
 * The layout block's line for a stage at a position — the canvas's own lines at the foot of the file.
 *
 * @param id - The stage.
 * @param x - Its x, as the canvas stores it.
 * @param y - Its y.
 * @returns `// node implement 588 420`.
 */
export function layoutLine(id: string, x: number, y: number): string {
  return `// node ${id} ${x} ${y}`;
}

/* ------------------------------------------------------------------ V.8: the publish gate */

/**
 * The sabotage the code view's publish test types, and what anchors it.
 *
 * The same refusal the studio leg certifies (`SABOTAGE`: *Implement* pinned to `coder-maxx`), reached
 * by typing the file instead of writing the draft over the API — so the gate's finding has to come back
 * **into the code**: on the lines of the stage call it is about (`code-findings.ts`), and not on a
 * neighbour's. `stageLine` is the `llm("implement", {` line the finding's jump puts the cursor on;
 * `elsewhere` is a line of *Understand & scope*, which must carry no mark.
 */
export const CODE_SABOTAGE = {
  seeded: 'model: route.task("implement"),',
  sabotaged: `model: route.alias("${SABOTAGE.alias}"),`,
  stageLine: 71,
  elsewhere: 'skill: "repo-map",',
} as const;

/** The change note the code view's repaired publish carries. */
export const CODE_REPAIR_NOTE =
  "Implement inherits its task's route again, typed in code (e2e, V.8).";

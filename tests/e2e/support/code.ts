/**
 * What the code-editor leg ([#170](https://github.com/NobuData/ouroboros/issues/170)) expects the
 * seeded `standard-fix` code view to draw — copied on purpose, for the reason `seed.ts` gives: an
 * expectation read out of the code under test is one that agrees with any bug in it.
 *
 * The colours are `docs/design/tokens.css`'s, as a browser reports them. The editor's sheet
 * (`ouroboros-ui/app/workflows/code/code-editor.css`) is meant to put each syntax class, the
 * gutter and the caret on one of them; this file is the leg's independent statement of which.
 */

/** The code view, opened on the seeded workflow. */
export const CODE_PATH = "/workflows/standard-fix/code";

/** The page's `<h1>`: the workflow's file name. */
export const CODE_TITLE = "standard-fix.loop.ts";

/** The file card's accessible name (`app/workflows/code/code-view.ts`'s `FILE_LABEL`). */
export const FILE_LABEL = "Workflow code";

/** The editable region's accessible name: the file's path. */
export const FILE_PATH = "workflows/standard-fix.loop.ts";

/** The file card's note for a role that may type into the file. */
export const UNSAVED_NOTE = "Edits are not saved yet — saving arrives with #172.";

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

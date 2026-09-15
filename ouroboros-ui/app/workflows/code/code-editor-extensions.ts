import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { dslSyntax } from "./dsl-language";

/**
 * What the workflow code editor is made of — V.2
 * ([#170](https://github.com/NobuData/ouroboros/issues/170)), decision **C1**.
 *
 * CodeMirror 6 is assembled from extensions rather than configured, so the editor is exactly the
 * list below and nothing CodeMirror's `basicSetup` would add: no fold gutter, no bracket matching,
 * no search panel, no autocompletion. Each of those brings its own default colours, and the
 * sheet (`code-editor.css`) re-colours only what is mounted here — so what is not mounted cannot
 * leak. W.1's `dslIntelligence(table)` joins this list when a page reads the symbol table.
 *
 * ### Two variants
 *
 * - **Editable** — the mockup's editor: numbered lines, the current line and its accent gutter,
 *   the drawn selection and the glow caret, undo history and the default keymap. Tab is not
 *   bound, so the keyboard can still leave the editor.
 * - **Read-only** — for a file no reader may change (the config file, V.3) and for a role that
 *   may not publish. No caret, no current line, no history and no keymap: nothing that suggests
 *   the text can be typed into. It is still focusable, so the keyboard can scroll it and select
 *   from it.
 */

/**
 * How long one blink of the caret takes, in milliseconds — mockup 05's `caretblink 1.1s`.
 * CodeMirror's default is 1200.
 */
export const CARET_BLINK_MS = 1100;

/** What an editor is built for. */
export interface EditorOptions {
  /** Whether the text may be changed. */
  readonly readOnly: boolean;
  /** The editable region's accessible name — the file's path. */
  readonly label: string;
}

/**
 * The editor's extensions.
 *
 * @param options See {@link EditorOptions}.
 * @returns The extensions for a new `EditorState`, in precedence order.
 */
export function editorExtensions({ readOnly, label }: EditorOptions): Extension[] {
  const shared: Extension[] = [
    dslSyntax(),
    lineNumbers(),
    highlightSpecialChars(),
    EditorState.tabSize.of(2),
    EditorView.contentAttributes.of({ "aria-label": label }),
  ];

  if (readOnly) {
    return [
      ...shared,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      // A non-editable content element is not focusable on its own.
      EditorView.contentAttributes.of({ tabindex: "0", "aria-readonly": "true" }),
    ];
  }

  return [
    ...shared,
    history(),
    drawSelection({ cursorBlinkRate: CARET_BLINK_MS }),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
  ];
}

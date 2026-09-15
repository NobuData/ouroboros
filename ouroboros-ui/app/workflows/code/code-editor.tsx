"use client";

import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { editorExtensions } from "./code-editor-extensions";

import "./code-editor.css";

/**
 * The workflow code editor — V.2 ([#170](https://github.com/NobuData/ouroboros/issues/170)):
 * CodeMirror 6 in mockup 05's `.ed` skin, over one file's text.
 *
 * ### Before the script runs, the text is already there
 *
 * CodeMirror needs the DOM, so it mounts after hydration. Until then the component draws the text
 * as a plain `<pre>` in the editor's own metrics, and the sheet hides that `<pre>` the moment
 * CodeMirror has put anything into its host (`.code-editor__host:not(:empty)`). The first paint
 * is the file rather than an empty card, and nothing in React tracks whether the editor mounted.
 *
 * ### The text is the buffer, and typing never rebuilds the editor
 *
 * `text` is what the editor should hold. When it changes to something the editor does not already
 * hold — another draft after a navigation, a buffer restored by the tab strip (V.3,
 * [#171](https://github.com/NobuData/ouroboros/issues/171)) — it is put into the editor in place,
 * as one change kept out of the undo history. A `text` that is what the editor just reported
 * changes nothing, so a parent that feeds each edit back as `text` costs no rebuild per keystroke.
 * A change of `readOnly` or `label` does rebuild the editor, over the latest text.
 *
 * ### Edits are reported
 *
 * `onChange` hears every change made in the editor, with the whole document. A change put in from
 * `text` is not reported, so the parent never hears its own value echoed back. Saving what it hears
 * is the save loop's (V.4, [#172](https://github.com/NobuData/ouroboros/issues/172)).
 */

/** Marks a change that came from the `text` prop rather than from the editor. */
const FROM_PROP = Annotation.define<true>();

/** What the editor takes. */
export interface CodeEditorProps {
  /** The file's text. */
  readonly text: string;
  /** The editable region's accessible name — the file's path. */
  readonly label: string;
  /** Whether the text may be changed. Defaults to `false`. */
  readonly readOnly?: boolean;
  /** Called with the whole document after each change made in the editor. */
  readonly onChange?: (text: string) => void;
}

/**
 * The editor.
 *
 * @param props See {@link CodeEditorProps}.
 * @returns The editor's wrapper: CodeMirror's host, and the text drawn until it mounts.
 */
export function CodeEditor({ text, label, readOnly = false, onChange }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // What the editor is built over and who hears it, read when a view is built or reports — so
  // neither has to rebuild it. Declared first, so it is current before the effects below run.
  const latest = useRef({ text, onChange });

  useEffect(() => {
    latest.current = { text, onChange };
  }, [text, onChange]);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;

    const reporter = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.transactions.every((transaction) => transaction.annotation(FROM_PROP) === true)) return;

      latest.current.onChange?.(update.state.doc.toString());
    });

    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: latest.current.text,
        extensions: [editorExtensions({ readOnly, label }), reporter],
      }),
    });
    view.current = created;

    return () => {
      created.destroy();
      view.current = null;
    };
  }, [label, readOnly]);

  useEffect(() => {
    const current = view.current;
    if (current === null || current.state.doc.toString() === text) return;

    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: text },
      annotations: [FROM_PROP.of(true), Transaction.addToHistory.of(false)],
    });
  }, [text]);

  return (
    <div className={readOnly ? "code-editor code-editor--read-only" : "code-editor"}>
      <div className="code-editor__host" ref={host} />
      <pre className="code-editor__static">
        <code>{text}</code>
      </pre>
    </div>
  );
}

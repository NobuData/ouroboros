"use client";

import { EditorState } from "@codemirror/state";
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
 * ### The text is the file as read
 *
 * `text` is what the page read. When a different text arrives — another draft, after a
 * navigation — the editor is rebuilt over it, and so is it when `readOnly` or `label` changes.
 * Keeping typed changes across such a change, and saving them, is the save loop's (V.4,
 * [#172](https://github.com/NobuData/ouroboros/issues/172)).
 */

/** What the editor takes. */
export interface CodeEditorProps {
  /** The file's text. */
  readonly text: string;
  /** The editable region's accessible name — the file's path. */
  readonly label: string;
  /** Whether the text may be changed. Defaults to `false`. */
  readonly readOnly?: boolean;
}

/**
 * The editor.
 *
 * @param props See {@link CodeEditorProps}.
 * @returns The editor's wrapper: CodeMirror's host, and the text drawn until it mounts.
 */
export function CodeEditor({ text, label, readOnly = false }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;

    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: text, extensions: editorExtensions({ readOnly, label }) }),
    });

    return () => view.destroy();
  }, [text, label, readOnly]);

  return (
    <div className={readOnly ? "code-editor code-editor--read-only" : "code-editor"}>
      <div className="code-editor__host" ref={host} />
      <pre className="code-editor__static">
        <code>{text}</code>
      </pre>
    </div>
  );
}

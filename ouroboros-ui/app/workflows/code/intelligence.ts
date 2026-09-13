import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

import type { CodeSymbolTable } from "@/app/api/workflows";

import { dslCompletions } from "./completions";
import { dslHover } from "./hover";

/**
 * The workflow code editor's intelligence, as one CodeMirror extension — W.1
 * ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * Decision **C5**: completions and hover docs from what is already known statically, not a
 * language server. The editor (V.2, #170) mounts this with the table the page read:
 *
 * ```ts
 * new EditorView({ extensions: [basicSetup, dslIntelligence(table)], … });
 * ```
 *
 * `table` is `GET /api/v1/workflows/code-symbols`, read server-side (`workflows.codeSymbols()`)
 * and passed to the client component that owns the editor.
 */

/**
 * Completions and hover docs over one table.
 *
 * @param table The code symbol table the service served.
 * @returns The extensions. The completion source replaces CodeMirror's defaults rather than
 *   joining them, so nothing but the table is offered.
 */
export function dslIntelligence(table: CodeSymbolTable): Extension {
  return [autocompletion({ override: [dslCompletions(table)] }), dslHover(table)];
}

/**
 * A workflow's document as the code view's text — or nothing, when the text would not be the
 * document. U.3 ([#167](https://github.com/NobuData/ouroboros/issues/167)).
 *
 * ```ts
 * projectWorkflowCode("standard-fix", draft.definition);
 * // "import { defineLoop, … } from \"@ouroboros/sdk\";\n…"  — or undefined
 * ```
 *
 * **The printer takes validated documents (U.1), and a draft is not one.** The canvas saves what
 * it holds: `{}` for a blank canvas, a model stage still missing its route, a key the DSL does not
 * have. Printing such a draft would show text that is not the draft, and saving that text back —
 * which is what a code editor does — would quietly replace the draft with it. Decision **C3**
 * rules that out: switching editors never converts or loses state.
 *
 * **So the rule is the round trip itself.** A document has a projection exactly when printing it
 * and reading the print back gives the same document. That is the printer's and the parser's own
 * contract, `parse(print(doc))` is `doc` (#168 property-tests it over valid documents), checked for
 * the one document being shown. It admits more than validation does, and on purpose: a graph with
 * an unreachable stage prints and reads back faithfully, and the code view is an editor for work
 * in progress. It admits nothing lossy.
 *
 * The cost is one parse per read, which is the cost of one save.
 */

import { isDeepStrictEqual } from "node:util";

import { parseWorkflowCode } from "./code.parser";
import { printWorkflowCode } from "./code.printer";
import type { WorkflowDocument } from "./dsl.schema";

/**
 * Print a document as a workflow file, if the file would read back as that document.
 *
 * @param slug - The workflow's slug, which `defineLoop` names. A slug the printer refuses has no
 *   projection either.
 * @param definition - A stored document — a draft's or a version's — and not trusted to be
 *   anything in particular.
 * @returns The file's text, or `undefined` when the document has none: the printer could not spell
 *   it, or what it spelled reads back as something else.
 */
export function projectWorkflowCode(slug: string, definition: unknown): string | undefined {
  let text: string;

  try {
    // Unvalidated on purpose; see this file's header. A document without what the printer reads
    // fails inside it, as a `TypeError` as often as a `WorkflowCodePrintError`, and the two mean
    // the same thing here: this document has no spelling.
    text = printWorkflowCode(slug, definition as WorkflowDocument).text;
  } catch {
    return undefined;
  }

  const reread = parseWorkflowCode(text);

  return reread.errors.length === 0 &&
    reread.slug === slug &&
    isDeepStrictEqual(reread.document, definition)
    ? text
    : undefined;
}

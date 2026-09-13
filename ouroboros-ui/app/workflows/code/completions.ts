import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";

import type { CodeCompletion, CodeSymbolTable } from "@/app/api/workflows";

import { completionPlace, type CompletionPlace } from "./context";
import { indexSymbols, signatureDetail, type SymbolIndex } from "./symbols";

/**
 * Schema-driven completions for the workflow code editor — W.1
 * ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * A CodeMirror completion source over the code symbol table: `completionPlace` names the scope
 * the cursor is in, and the table says what that scope offers. **Context is the whole point** —
 * inside `llm("implement", { … })` the scope is `stage.llm.options`, so only a model stage's keys
 * are offered, never every key the language has.
 *
 * Workspace names — task routes, skills — arrive marked as suggestions (decision **P7**) and are
 * labelled *suggested*: a name that is not offered is still a name the file may use, and the
 * validator, not the editor, is what flags an unknown one.
 */

/** How CodeMirror draws each kind of completion. */
const COMPLETION_TYPES = {
  function: "function",
  method: "method",
  property: "property",
  constant: "constant",
  value: "enum",
  snippet: "text",
} as const satisfies Record<CodeCompletion["kind"], string>;

/** What a suggested workspace name prints beside its label. */
export const SUGGESTION_DETAIL = "suggested";

/** What may be typed inside quotes before the offered list no longer applies. */
const QUOTED_WORD = /^[^"'`\\]*$/;

/** What may be typed outside quotes before it no longer applies. */
const BARE_WORD = /^[\w$]*$/;

/**
 * One table entry as a CodeMirror completion.
 *
 * @param entry The entry.
 * @param place Where it will be inserted.
 * @param index The table's symbols, for the entry's card.
 * @returns The completion. A string value is quoted unless the cursor is already inside quotes;
 *   its doc, when the schema has one, is the completion's info.
 */
function toCompletion(entry: CodeCompletion, place: CompletionPlace, index: SymbolIndex): Completion {
  const symbol = entry.symbol === undefined ? undefined : index.symbols.get(entry.symbol);
  const detail = entry.suggestion === true ? SUGGESTION_DETAIL : symbol && signatureDetail(symbol);
  const quoted = JSON.stringify(entry.label);

  return {
    label: entry.label,
    type: COMPLETION_TYPES[entry.kind],
    ...(detail ? { detail } : {}),
    ...(symbol?.doc === undefined ? {} : { info: symbol.doc }),
    ...(entry.kind === "value"
      ? { apply: place.quoted ? quoted.slice(1, -1) : quoted }
      : {}),
  };
}

/**
 * The completions at an offset, without CodeMirror.
 *
 * @param index The indexed table.
 * @param text The whole file.
 * @param pos The cursor.
 * @param explicit Whether the author asked (Ctrl-Space) rather than typed.
 * @returns What to offer and where it replaces from, or `null` for nothing. Unasked, nothing is
 *   offered at an empty position that is neither a member (`route.`) nor inside quotes, so the
 *   list does not open on every space.
 */
export function completionsAt(
  index: SymbolIndex,
  text: string,
  pos: number,
  explicit: boolean,
): CompletionResult | null {
  const place = completionPlace(text, pos);
  if (place === null) return null;

  const entries = index.scopes.get(place.scope);
  if (entries === undefined || entries.length === 0) return null;

  const typedNothing = place.from === pos && !place.quoted && text[pos - 1] !== ".";
  if (typedNothing && !explicit) return null;

  return {
    from: place.from,
    options: entries.map((entry) => toCompletion(entry, place, index)),
    validFor: place.quoted ? QUOTED_WORD : BARE_WORD,
  };
}

/**
 * The completion source for a table.
 *
 * @param table The code symbol table the service served.
 * @returns A CodeMirror `CompletionSource`, indexed once.
 */
export function dslCompletions(table: CodeSymbolTable): CompletionSource {
  const index = indexSymbols(table);

  return (context: CompletionContext) =>
    completionsAt(index, context.state.doc.toString(), context.pos, context.explicit);
}

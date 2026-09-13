import type { CodeCompletion, CodeSymbol, CodeSymbolTable } from "@/app/api/workflows";

/**
 * The code symbol table, indexed for the editor — W.1
 * ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * The service serves scopes and symbols as lists, in the order the grammar and the schema give
 * them. The completion source and the hover source both look them up by name on every keystroke
 * or pointer move, so they share one index built once per table.
 */

/** A table, by name. */
export interface SymbolIndex {
  /** What each scope offers. */
  readonly scopes: ReadonlyMap<string, readonly CodeCompletion[]>;
  /** What each symbol's card says. */
  readonly symbols: ReadonlyMap<string, CodeSymbol>;
}

/**
 * Index a table.
 *
 * @param table The table the service served.
 * @returns Its scopes and symbols by name. A name listed twice keeps its first entry — the
 *   service lists each once, and an index must not let a later duplicate rewrite a card.
 */
export function indexSymbols(table: CodeSymbolTable): SymbolIndex {
  const scopes = new Map<string, readonly CodeCompletion[]>();
  const symbols = new Map<string, CodeSymbol>();

  for (const { scope, completions } of table.scopes) {
    if (!scopes.has(scope)) scopes.set(scope, completions);
  }
  for (const symbol of table.symbols) {
    if (!symbols.has(symbol.symbol)) symbols.set(symbol.symbol, symbol);
  }

  return { scopes, symbols };
}

/**
 * A signature without its name — what a completion prints beside its label.
 *
 * @param symbol The symbol.
 * @returns `(name: TaskKind): ModelRoute` for `route.task`, `: integer` for `retries`, or `""`
 *   for a signature that is only a name.
 */
export function signatureDetail(symbol: CodeSymbol): string {
  return symbol.signature
    .filter((part) => part.role !== "name")
    .map((part) => part.text)
    .join("");
}

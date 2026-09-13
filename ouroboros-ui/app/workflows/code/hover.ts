import type { Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";

import type { CodeSymbol, CodeSymbolTable } from "@/app/api/workflows";

import { hoverTarget } from "./context";
import {
  HOVER_DOC_CLASS,
  HOVER_DOC_SIGNATURE_CLASS,
  HOVER_DOC_TEXT_CLASS,
  SIGNATURE_CLASSES,
} from "./hover-doc-classes";
import { indexSymbols, type SymbolIndex } from "./symbols";

/**
 * Hover docs for the workflow code editor — W.1
 * ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * `hoverTarget` names the symbol under the pointer; the code symbol table says what its card
 * says. **When the table does not describe the symbol, there is no tooltip** — not an empty
 * card, not a guess from the name. The ticket's honesty criterion is exactly this branch:
 * a plausible-looking card for a symbol nobody documented would be worse than silence.
 */

/** A symbol found under the pointer, with the text it spans. */
export interface HoverHit {
  /** The described symbol. */
  readonly symbol: CodeSymbol;
  /** Where the spanned text starts. */
  readonly from: number;
  /** Where it ends. */
  readonly to: number;
}

/**
 * The described symbol under an offset, without CodeMirror.
 *
 * @param index The indexed table.
 * @param text The whole file.
 * @param pos The offset the pointer is over.
 * @returns The symbol and its span, or `null` when there is no symbol there or the table does
 *   not describe it.
 */
export function hoverAt(index: SymbolIndex, text: string, pos: number): HoverHit | null {
  const target = hoverTarget(text, pos);
  const symbol = target === null ? undefined : index.symbols.get(target.symbol);

  return target === null || symbol === undefined
    ? null
    : { symbol, from: target.from, to: target.to };
}

/**
 * The card's markup, as DOM — the same markup `HoverDocCard` renders.
 *
 * Built with `textContent` throughout, so a description is text and never markup.
 *
 * @param symbol The symbol.
 * @param document The document the editor lives in.
 * @returns The card element.
 */
export function hoverCardElement(symbol: CodeSymbol, document: Document): HTMLElement {
  const card = document.createElement("div");
  card.className = HOVER_DOC_CLASS;

  const signature = document.createElement("div");
  signature.className = HOVER_DOC_SIGNATURE_CLASS;
  for (const part of symbol.signature) {
    const run = document.createElement("span");
    const partClass = SIGNATURE_CLASSES[part.role];
    if (partClass !== null) run.className = partClass;
    run.textContent = part.text;
    signature.append(run);
  }
  card.append(signature);

  if (symbol.doc !== undefined) {
    const doc = document.createElement("p");
    doc.className = HOVER_DOC_TEXT_CLASS;
    doc.textContent = symbol.doc;
    card.append(doc);
  }

  return card;
}

/**
 * CodeMirror's own tooltip chrome, removed: the card is the tooltip, drawn on the design
 * system's tokens by `code.css`, rather than a card inside CodeMirror's default grey box.
 */
const tooltipChrome = EditorView.baseTheme({
  ".cm-tooltip.cm-tooltip-hover": { backgroundColor: "transparent", border: "none" },
});

/**
 * The hover extension for a table.
 *
 * @param table The code symbol table the service served.
 * @returns The extension: a hover tooltip over described symbols, indexed once.
 */
export function dslHover(table: CodeSymbolTable): Extension {
  const index = indexSymbols(table);

  return [
    hoverTooltip((view, pos): Tooltip | null => {
      const hit = hoverAt(index, view.state.doc.toString(), pos);
      if (hit === null) return null;

      return {
        pos: hit.from,
        end: hit.to,
        above: true,
        create: () => ({ dom: hoverCardElement(hit.symbol, view.dom.ownerDocument) }),
      };
    }),
    tooltipChrome,
  ];
}

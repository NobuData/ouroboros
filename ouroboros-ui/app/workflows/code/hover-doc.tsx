import type { CodeSymbol } from "@/app/api/workflows";

import {
  HOVER_DOC_CLASS,
  HOVER_DOC_SIGNATURE_CLASS,
  HOVER_DOC_TEXT_CLASS,
  SIGNATURE_CLASSES,
} from "./hover-doc-classes";

import "./code.css";

/**
 * The hover-doc card — mockup 05's **Types** card (W.1,
 * [#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * ```
 * route.task(name: TaskKind): ModelRoute
 * Resolves the model assigned to a task kind in Model Routing.
 * ```
 *
 * The signature's runs are coloured by role — the symbol in the model hue, types in the accent —
 * and the doc line is the schema's description, verbatim. **A symbol with no description draws
 * no doc line**, and there is no card at all for a name the table does not describe: the caller
 * holds a `CodeSymbol` or draws nothing, so this component cannot be asked to invent one.
 *
 * The Types panel (V.5, #173) mounts it for the symbol at the cursor; the editor's hover tooltip
 * builds the same markup from `hover.ts`, so the two cannot drift. Both themes are the tokens'.
 */

/** What the card takes. */
export interface HoverDocCardProps {
  /** The symbol, as the code symbol table describes it. */
  readonly symbol: CodeSymbol;
  /** Placement only, never colour or type. */
  readonly className?: string;
}

/**
 * The card.
 *
 * @param props See {@link HoverDocCardProps}.
 * @returns The card.
 */
export function HoverDocCard({ symbol, className }: HoverDocCardProps) {
  return (
    <div className={className === undefined ? HOVER_DOC_CLASS : `${HOVER_DOC_CLASS} ${className}`}>
      <div className={HOVER_DOC_SIGNATURE_CLASS}>
        {symbol.signature.map((part, index) => {
          const partClass = SIGNATURE_CLASSES[part.role];
          return partClass === null ? (
            <span key={index}>{part.text}</span>
          ) : (
            <span className={partClass} key={index}>
              {part.text}
            </span>
          );
        })}
      </div>
      {symbol.doc !== undefined && <p className={HOVER_DOC_TEXT_CLASS}>{symbol.doc}</p>}
    </div>
  );
}

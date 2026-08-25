import { cx } from "@/app/ui";

import type { Monogram, MonogramTint } from "./cards";

import "./providers.css";

/**
 * The provider monogram — the tinted square of two letters at the head of mockup 07's cards
 * (AE.2, [#228](https://github.com/NobuData/ouroboros/issues/228)), and in the provider cell
 * of mockup 21's allowed-models table (CI.2,
 * [#592](https://github.com/NobuData/ouroboros/issues/592)).
 *
 * **One component, two sizes, and no second implementation.** The two surfaces sit one subnav
 * click apart and draw the same five squares — `AN`, `GH`, `CU`, `OL`, `VL` — so two copies
 * of the tint map would drift in colour and shape the first time either was touched. The
 * letters and the tint are decided by `app/providers/cards.ts`'s `monogramFor` (or, for the
 * registry, the letters are the server's and only the tint is looked up there); this file
 * draws whatever it is handed.
 *
 * `aria-hidden`, always: the square repeats in shape what the name beside it says in words,
 * and a screen reader announcing *A N Anthropic* would be reading the decoration first.
 */

/** How large the square is drawn. */
export type MonogramSize =
  /** The mockup's 42px card square. The default. */
  | "card"
  /** The mockup's 24px table-cell square — mockup 21's `.mg`. */
  | "cell";

/**
 * The modifier each tint adds. Every tint has one — a monogram never falls back to another's
 * — and the names are written out so the sheet's own suite can find each of them rendered.
 */
const TINT_CLASS: Record<MonogramTint, string> = {
  model: "providers-card__monogram--model",
  accent: "providers-card__monogram--accent",
  warn: "providers-card__monogram--warn",
  ok: "providers-card__monogram--ok",
  neutral: "providers-card__monogram--neutral",
};

/** What the square takes. */
export interface ProviderMonogramProps {
  /** The letters and the tint, already decided. */
  readonly monogram: Monogram;
  /** Which size. Defaults to `card`. */
  readonly size?: MonogramSize;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/**
 * The square.
 *
 * @param props See {@link ProviderMonogramProps}.
 * @returns The square, hidden from the accessibility tree.
 */
export function ProviderMonogram({ monogram, size = "card", className }: ProviderMonogramProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "providers-card__monogram",
        TINT_CLASS[monogram.tint],
        size === "cell" && "providers-card__monogram--cell",
        className,
      )}
    >
      {monogram.letters}
    </span>
  );
}

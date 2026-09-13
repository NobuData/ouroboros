import type { CodeSignaturePart } from "@/app/api/workflows";

/**
 * The hover card's class names — mockup 05's `.hover-doc` treatment, in `code.css`.
 *
 * One module for both renderings of the card: the React component the Types panel (V.5, #173)
 * mounts, and the DOM the editor's hover tooltip builds. Written as literals so the style suite
 * can hold every class `code.css` declares to one that is rendered.
 */

/** The card. */
export const HOVER_DOC_CLASS = "code-hover-doc";

/** The signature line. */
export const HOVER_DOC_SIGNATURE_CLASS = "code-hover-doc__signature";

/** The doc line — the schema's description. */
export const HOVER_DOC_TEXT_CLASS = "code-hover-doc__doc";

/**
 * The class each coloured signature run wears: the mockup's `sig-fn` and `sig-ty`. A plain run
 * wears none and takes the card's colour.
 */
export const SIGNATURE_CLASSES = {
  name: "code-hover-doc__name",
  type: "code-hover-doc__type",
  text: null,
} as const satisfies Record<CodeSignaturePart["role"], string | null>;

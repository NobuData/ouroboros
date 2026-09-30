/**
 * The one comparison key two facts are "the same fact" by — shared by every writer that dedupes:
 * BF.4's rule-file import ([#413](https://github.com/NobuData/ouroboros/issues/413)) and BF.3's
 * proposers ([#412](https://github.com/NobuData/ouroboros/issues/412)). One function, so an
 * imported rule and a promoted correction note cannot disagree about whether they match.
 *
 * The key is for **matching only**. The stored text keeps its casing and its inline-code spans
 * verbatim — `K_NO_WAIT` and `k_msgq` are the technically load-bearing part of a fact.
 */

/**
 * Normalize a fact's text for dedupe: case, width, inline markup, whitespace and trailing
 * punctuation do not make two rules different.
 *
 * @param text - A fact's text.
 * @returns The comparison key.
 */
export function normalizeFactText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.;:!,]+$/, "");
}

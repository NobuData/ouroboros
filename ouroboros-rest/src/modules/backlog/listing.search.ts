/**
 * What the search box means — *"Filter by title, #number, or label…"* as two values a
 * statement can use (M.1, [#110](https://github.com/NobuData/ouroboros/issues/110)).
 *
 * Pure, and a file of its own, because the interesting part is a rule rather than a query: one
 * box promises three matches, and the one that is a pattern match has to survive a person typing
 * a `%` into a filter. Testing that against a database would be testing PostgreSQL's `like`;
 * testing it here is testing the promise.
 *
 * ## `#485` is a number, and `485` is too
 *
 * The placeholder writes the hash and a person copying an issue reference brings it along, so
 * the hash is optional punctuation rather than the thing that makes a search numeric. What is
 * *not* done is guessing further: `485` is also a perfectly good substring of a title, so the
 * number match is an **additional** disjunct rather than a mode the box switches into. The
 * acceptance criterion — `q="#485"` returns exactly one row — holds because one issue carries
 * that number, not because the other matches were suppressed.
 *
 * ## Escaping is not optional
 *
 * `like`'s wildcards are `%` and `_`, and both are ordinary characters in an issue title.
 * Without escaping, `q=100%` matches every title beginning `100` and `q=a_b` matches `axb` —
 * results a person cannot explain and cannot turn off. The escape character is the backslash,
 * PostgreSQL's own default, so the pattern needs no `escape` clause; the backslash itself is
 * escaped first, which is the ordering every one of these functions gets wrong exactly once.
 */

/** The characters `like` reads as syntax, plus the escape character itself. */
const LIKE_SYNTAX = /[\\%_]/g;

/** A search that names an issue number: an optional `#`, then digits, and nothing else. */
const ISSUE_REFERENCE = /^#?(\d{1,9})$/;

/**
 * Escape a person's text so `like` matches it literally.
 *
 * @param term - What was typed.
 * @returns It, with `\`, `%` and `_` escaped — safe to wrap in `%…%` and hand to `ilike` under
 *   PostgreSQL's default escape character.
 */
export function escapeLike(term: string): string {
  return term.replace(LIKE_SYNTAX, (character) => `\\${character}`);
}

/** A search, as the statement uses it. */
export interface SearchTerms {
  /** The `ilike` pattern for the title — the term, escaped, wrapped in `%`. */
  readonly pattern: string;
  /**
   * The issue number the search names, or `undefined` when it names none.
   *
   * Bounded at nine digits by {@link ISSUE_REFERENCE} rather than by a range check: `number` is
   * an `integer` column, and a search for a twelve-digit string is a search for a title, not a
   * query that should fail on overflow.
   */
  readonly number?: number;
}

/**
 * Read the search box.
 *
 * @param term - What was typed, already trimmed and known non-empty by `listing.dto.ts`.
 * @returns The pattern every match uses, and the issue number if the text is one.
 */
export function searchTerms(term: string): SearchTerms {
  const reference = ISSUE_REFERENCE.exec(term);

  return {
    pattern: `%${escapeLike(term)}%`,
    ...(reference === null ? {} : { number: Number(reference[1]) }),
  };
}

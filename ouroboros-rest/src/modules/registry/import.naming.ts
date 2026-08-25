/**
 * The naming template — *what would you call this model?*, answered for a whole connection at
 * once ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * The import wizard's premise is that **humans still choose the names**; a suggestion is what
 * saves forty people from typing forty of them, not a decision made on their behalf. So every
 * function here is deterministic, pure, and produces something an operator overwrites — and
 * when it cannot produce anything it says so ({@link suggestAliasName} answers `null`) rather
 * than inventing a name nobody chose.
 *
 * ```
 * claude-fable-5 ┐                        ┌ fable-5
 * claude-opus-5  ├─ shared prefix "claude" ┼ opus-5
 * claude-haiku-4-5 ┘                      └ haiku-4-5
 *
 * qwen3-coder:32b ─ no shared prefix ────── qwen3-coder-32b
 * local/llama-4-maverick ─────────────────── llama-4-maverick
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The prefix is derived from the connection's own catalog, never from a table of vendors.**
 *
 * `claude-opus-5` should be suggested as `opus-5`, and the tempting way to get there is a
 * map from provider kind to brand word. That map is a thing somebody has to maintain, it is
 * wrong the week a vendor renames a family, and it has nothing to say about the local models
 * an Ollama connection lists. {@link sharedModelPrefix} asks the data instead: when **every**
 * model a connection discovered begins with the same segment, that segment is noise for
 * telling them apart, so it goes. When they do not agree — `qwen3-coder`, `llama4`, `phi4` —
 * nothing is stripped, because there is no noise to remove.
 *
 * The rule needs **two or more** models to fire. A "shared" prefix over a single model is just
 * that model's first word, and stripping it turns `gpt-5-codex` into `5-codex` — a name that
 * is legal, meaningless, and not what anybody would have typed.
 *
 * ---------------------------------------------------------------------------
 * **Collisions are suffixed, and length is a refusal rather than a truncation.**
 *
 * `-2`, `-3`, … against every name the workspace already has *and* every name suggested
 * earlier in the same list, so no two rows of one wizard arrive pre-filled with one name.
 * V015 stops at 64 characters; a base longer than that is shortened, because a suggestion is
 * editable and an empty cell helps nobody, but a suffix that would not fit even then ends the
 * search — see {@link suggestAliasName}.
 */

import { MAX_ALIAS_LENGTH } from "./aliases.dto";

/** What separates the segments of both a model id and an alias. */
export const SEGMENT_SEPARATOR = "-";

/**
 * How many numbered variants of one base are tried before the suggestion is given up on.
 *
 * Ninety-nine, which is far past any real registry and is a bound rather than a limit: the
 * loop that walks it is over names in a workspace, and a loop over a set somebody controls
 * needs an end that does not depend on their good behaviour.
 */
export const MAX_NAME_ORDINAL = 99;

/**
 * A model id folded into the shape V015 stores an alias in.
 *
 * Namespace dropped (`local/llama-4-maverick` → `llama-4-maverick`), lower-cased, and every
 * run of anything that is not a letter or a digit turned into one hyphen — which is what
 * makes `qwen3-coder:32b` into `qwen3-coder-32b` and `deepseek-v3.2` into `deepseek-v3-2`.
 *
 * @param modelId - The provider's own identifier, exactly as discovery reported it.
 * @returns The folded name, which matches V015's alias pattern, or `""` when the id folds
 *   away to nothing at all — an id of punctuation, which no provider publishes and which this
 *   answers honestly rather than by throwing.
 */
export function foldModelId(modelId: string): string {
  const tail = modelId.slice(modelId.lastIndexOf("/") + 1);

  return tail
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, SEGMENT_SEPARATOR)
    .replace(/^-+|-+$/g, "");
}

/**
 * The leading segment every one of these names shares, or null when there is none to drop.
 *
 * See this file's header for why the answer comes from the catalog rather than from a table
 * of vendor names.
 *
 * @param folded - The connection's model ids, already through {@link foldModelId}. Order is
 *   irrelevant.
 * @returns The shared first segment, or null when there are fewer than two names, when they do
 *   not all begin with the same one, or when dropping it would leave any of them empty.
 */
export function sharedModelPrefix(folded: readonly string[]): string | null {
  if (folded.length < 2) {
    return null;
  }

  const [first, ...rest] = folded;
  const prefix = first.split(SEGMENT_SEPARATOR)[0];

  if (prefix === "") {
    return null;
  }

  for (const name of rest) {
    if (name.split(SEGMENT_SEPARATOR)[0] !== prefix) {
      return null;
    }
  }

  // A model whose whole id *is* the prefix would be left with no name at all. One such row is
  // enough to call the prefix off for the list, because a wizard where one row is suggested
  // `""` and the rest are shortened is worse than one where none of them are.
  return folded.every((name) => name.length > prefix.length + SEGMENT_SEPARATOR.length)
    ? prefix
    : null;
}

/**
 * The base name for one model — the short name, before collisions are considered.
 *
 * @param modelId - The provider's own identifier.
 * @param sharedPrefix - What {@link sharedModelPrefix} answered for the connection, or null.
 * @returns The base, or `""` when the id folds away to nothing.
 */
export function shortModelName(modelId: string, sharedPrefix: string | null): string {
  const folded = foldModelId(modelId);

  if (sharedPrefix === null) {
    return folded;
  }

  const head = `${sharedPrefix}${SEGMENT_SEPARATOR}`;

  return folded.startsWith(head) ? folded.slice(head.length) : folded;
}

/**
 * The name to pre-fill a candidate row with, or null when none can be offered.
 *
 * @param base - What {@link shortModelName} answered.
 * @param taken - Every name that is already spoken for: the workspace's aliases, plus the
 *   suggestions made for rows above this one.
 * @returns A name that fits V015 and is not in `taken`, or **null** when the base is empty or
 *   every variant up to {@link MAX_NAME_ORDINAL} is taken. Null is the honest answer, and the
 *   row it belongs to arrives with an empty cell for somebody to fill in.
 */
export function suggestAliasName(base: string, taken: ReadonlySet<string>): string | null {
  const plain = fitted(base, "");

  if (plain === null) {
    return null;
  }

  if (!taken.has(plain)) {
    return plain;
  }

  for (let ordinal = 2; ordinal <= MAX_NAME_ORDINAL; ordinal += 1) {
    const candidate = fitted(base, `${SEGMENT_SEPARATOR}${ordinal.toString()}`);

    if (candidate !== null && !taken.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * A base and a suffix, shortened until the pair fits V015's ceiling.
 *
 * The base is what gives, never the suffix: the suffix is the only part that makes the name
 * unique, and a name shortened out of its ordinal is a name that collides again.
 *
 * @param base - The short model name.
 * @param suffix - `""`, or `-2`, `-3`, …
 * @returns The name, or null when nothing of the base survives — an empty base, or a base
 *   whose every surviving character was a hyphen.
 */
function fitted(base: string, suffix: string): string | null {
  const head = base.slice(0, MAX_ALIAS_LENGTH - suffix.length).replace(/-+$/, "");

  return head === "" ? null : `${head}${suffix}`;
}

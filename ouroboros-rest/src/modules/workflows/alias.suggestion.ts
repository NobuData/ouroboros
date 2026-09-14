/**
 * *Did you mean coder-max?* — the designed publish error's suggestion, and its two sentences.
 *
 * CH.6 ([#589](https://github.com/NobuData/ouroboros/issues/589)) turns mockup 21's governance row
 * — *routes and workflows may only reference registry aliases; raw model strings are rejected at
 * publish time* — into a refusal, and a refusal that only said *no* would leave the author to go
 * and find the registry's spelling of the thing they meant. So the refusal names the node, says
 * what is wrong, and offers the alias the author most plausibly meant.
 *
 * ---------------------------------------------------------------------------
 * **A raw model id is answered by the registry's own binding, not by spelling.** `claude-fable-5`
 * and `coder-max` share no letters worth measuring; what connects them is the row that says
 * `coder-max` *means* `claude-fable-5`. So the first question is always *which alias resolves to
 * the string that was written*, and a string that is some alias's model id gets that alias —
 * whether it was written as a raw id or, by mistake, as `{alias: "claude-fable-5"}`.
 *
 * **Only then is it a misspelling**, and a misspelling is measured by edit distance against the
 * alias names, within a third of the alias's length (at least one edit): `coder-maxx` →
 * `coder-max`. Anything further is not suggested at all — a suggestion that is wrong teaches the
 * author a name they did not mean, which is worse than the plain refusal.
 *
 * Pure, and deterministic for a given alias list: ties go to the alias that sorts first, which
 * is the order the repository reads them in.
 */

/** One alias as the suggestion reads it — its name, and the raw model id it resolves to. */
export interface RegistryAlias {
  /** The name — `coder-max`. */
  readonly alias: string;
  /** The raw provider model id the alias means — `claude-fable-5`. */
  readonly modelId: string;
}

/**
 * Levenshtein distance — single-character insertions, deletions and substitutions.
 *
 * @param from - One string.
 * @param to - The other.
 * @returns How many edits turn one into the other.
 */
export function editDistance(from: string, to: string): number {
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);

  for (let row = 1; row <= from.length; row += 1) {
    const current = [row];

    for (let column = 1; column <= to.length; column += 1) {
      const substitution = from[row - 1] === to[column - 1] ? 0 : 1;

      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitution,
      );
    }

    previous = current;
  }

  return previous[to.length];
}

/**
 * The alias an author most plausibly meant by what they wrote.
 *
 * @param written - The raw model id or the unknown alias name, as the document holds it.
 * @param aliases - The workspace's aliases, in name order.
 * @returns The alias bound to `written` as its model id; failing that, the nearest alias name
 *   within a third of its length; failing that, null.
 */
export function suggestAlias(written: string, aliases: readonly RegistryAlias[]): string | null {
  const bound = aliases.find((candidate) => candidate.modelId === written);

  if (bound !== undefined) {
    return bound.alias;
  }

  let nearest: { alias: string; distance: number } | null = null;

  for (const candidate of aliases) {
    const distance = editDistance(written, candidate.alias);
    const allowed = Math.max(1, Math.floor(candidate.alias.length / 3));

    if (distance <= allowed && (nearest === null || distance < nearest.distance)) {
      nearest = { alias: candidate.alias, distance };
    }
  }

  return nearest?.alias ?? null;
}

/**
 * The closing clause every governance refusal shares.
 *
 * @param suggestion - The alias to offer, or null.
 * @returns ` (did you mean coder-max?)`, or nothing.
 */
function didYouMean(suggestion: string | null): string {
  return suggestion === null ? "" : ` (did you mean ${suggestion}?)`;
}

/**
 * The refusal for a raw model id pinned where an alias belongs.
 *
 * @param node - The stage's id.
 * @param modelId - What it pinned.
 * @param suggestion - The alias to offer, or null.
 * @returns `Stage \`plan\` pins the raw model id \`claude-fable-5\` — raw model ids are not
 *   allowed; reference a registry alias (did you mean coder-max?).`
 */
export function rawModelMessage(node: string, modelId: string, suggestion: string | null): string {
  return (
    `Stage \`${node}\` pins the raw model id \`${modelId}\` — raw model ids are not allowed; ` +
    `reference a registry alias${didYouMean(suggestion)}.`
  );
}

/**
 * The refusal for an alias the workspace's registry does not hold.
 *
 * @param node - The stage's id.
 * @param alias - The name it pinned.
 * @param suggestion - The alias to offer, or null.
 * @returns `Stage \`plan\` pins \`coder-maxx\`, which is not in this workspace's model registry —
 *   reference a registry alias (did you mean coder-max?).`
 */
export function unknownAliasMessage(
  node: string,
  alias: string,
  suggestion: string | null,
): string {
  return (
    `Stage \`${node}\` pins \`${alias}\`, which is not in this workspace's model registry — ` +
    `reference a registry alias${didYouMean(suggestion)}.`
  );
}

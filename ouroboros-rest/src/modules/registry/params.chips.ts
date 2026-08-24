/**
 * Mockup 21's `Params` column, derived — `(max thinking)(400k budget)`, `(temp 0)(8k out)`,
 * `(ctx 32k)`, `(review vote only)`, `(batch ok)`, `—`.
 *
 * CH.2 ([#585](https://github.com/NobuData/ouroboros/issues/585)). One pure function from the
 * two stored documents to the chips that render them, and the reason it exists is the second
 * half of that ticket's problem statement:
 *
 * > *"Or the chip can be written by hand. A display string stored next to the params drifts
 * > from the params on the very first edit that misses it."*
 *
 * So there is no display column, there is this. The table (CH.5,
 * [#588](https://github.com/NobuData/ouroboros/issues/588)), the inspector (CI.3,
 * [#593](https://github.com/NobuData/ouroboros/issues/593)) and anything after them read one
 * derivation, which is the same discipline Y.3's ([#191](https://github.com/NobuData/ouroboros/issues/191))
 * `escalation_rules.display` keeps and the same one `pricing/price.ts` keeps for the money
 * cell.
 *
 * ---------------------------------------------------------------------------
 * **It is deterministic, and that is a testable property rather than an aspiration.** Same
 * documents in, same chips out, in the same order, on every call — `params.chips.spec.ts`
 * calls it twice on all eight of the mockup's rows and compares. Nothing here reads a clock, a
 * locale or a workspace: `toLocaleString` would make a chip depend on the machine that rendered
 * it, and `400k budget` in one deployment and `400 k budget` in another is a difference nobody
 * would think to look for.
 *
 * ---------------------------------------------------------------------------
 * **Order is the inspector's field order, then the restrictions** — and it is deliberately
 * *not* {@link MODEL_ALIAS_PARAM_KEYS}, which is V019's declaration order. Mockup 21 draws
 * `(max thinking)(400k budget)` on one row and `(temp 0)(8k out)` on another; the second puts
 * the temperature *before* the output ceiling, and the reason is on the page beside it — the
 * inspector's field stack is **Thinking**, **Token budget**, **Temperature**, so a cell read
 * top to bottom matches the form somebody edits it in. {@link PARAM_CHIP_ORDER} is that order
 * written down, and `params.chips.spec.ts` checks it still covers every key the column can
 * hold.
 *
 * Restrictions come after every param, because a policy about the alias is a different kind of
 * claim from a setting on the model and grouping them keeps the two readable at a glance.
 *
 * ---------------------------------------------------------------------------
 * **A key nothing derives does not exist.** V019 closed the `params` vocabulary precisely so
 * that this function is total over what the column can hold — decision **R3**. The `switch`
 * below is therefore exhaustive by construction, and a sixth key added to the column without a
 * chip written for it is a compile error here rather than a param that renders nowhere.
 */

import {
  MODEL_ALIAS_RESTRICTION_KEYS,
  THINKING_LEVELS,
  type ModelAliasParamKey,
  type ModelAliasRestrictionKey,
  type ThinkingLevel,
} from "../db/schema";

/**
 * What the cell draws when there are no chips at all.
 *
 * An em dash, and mockup 21 draws it in two of its eight rows: `coder-fallback`, a fixed-catalog
 * model with nothing to tune, and `gpt5-experiments`, which has no provider yet. It is the same
 * `—` the price column uses for *we have no price*, and it means the same thing — *there is
 * nothing here* — rather than a value.
 */
export const NO_PARAM_CHIPS = "—";

/**
 * The order params are drawn in — mockup 21's inspector field stack, not V019's declaration
 * order.
 *
 * The two differ in one place and the mockup is what settles it: `sizer`'s cell reads
 * `(temp 0)(8k out)`, so a temperature is drawn before an output ceiling. See this file's
 * header.
 *
 * `satisfies` makes a key that is not V019's a compile error. That the list is *complete* is
 * the other direction, which a type cannot check here and which `params.chips.spec.ts` does —
 * along with the exhaustive `switch` in {@link paramChip}, which is what makes a sixth key
 * added to the column a compile error rather than a param that renders nowhere.
 */
export const PARAM_CHIP_ORDER = [
  "thinking",
  "token_budget",
  "temperature",
  "max_output",
  "context_clamp",
] as const satisfies readonly ModelAliasParamKey[];

/**
 * The chips for one alias, in the order they are drawn.
 *
 * @param params - `model_aliases.params`, as stored. Read defensively: the column's CHECK is
 *   what keeps it inside the vocabulary, and this function is handed the document rather than
 *   the constraint — a value of the wrong shape produces no chip rather than a crash, because
 *   a registry table that failed to render because one row was odd is worse than a row with a
 *   chip missing.
 * @param restrictions - `model_aliases.restrictions`, as stored. Same reading.
 * @returns The chips. Empty when nothing is set, which is {@link NO_PARAM_CHIPS}'s case —
 *   returned as an empty list rather than as a one-element list holding the dash, because the
 *   mockup draws that cell with different markup and a client should not have to recognise a
 *   sentinel string to know it.
 */
export function paramChips(
  params: Readonly<Record<string, unknown>>,
  restrictions: Readonly<Record<string, unknown>>,
): string[] {
  const chips: string[] = [];

  for (const key of PARAM_CHIP_ORDER) {
    const chip = paramChip(key, params[key]);

    if (chip !== null) {
      chips.push(chip);
    }
  }

  for (const flag of MODEL_ALIAS_RESTRICTION_KEYS) {
    if (restrictions[flag] === true) {
      chips.push(restrictionChip(flag));
    }
  }

  return chips;
}

/**
 * The cell mockup 21 draws, as one string.
 *
 * The convenience over {@link paramChips} for a caller rendering text rather than tags — a
 * CLI listing, a `/ouro` reply, a log line. The separator is the interpunct the mockups use
 * between chips elsewhere.
 *
 * @param params - `model_aliases.params`, as stored.
 * @param restrictions - `model_aliases.restrictions`, as stored.
 * @returns The chips joined, or {@link NO_PARAM_CHIPS} when there are none.
 */
export function paramChipsCell(
  params: Readonly<Record<string, unknown>>,
  restrictions: Readonly<Record<string, unknown>>,
): string {
  const chips = paramChips(params, restrictions);

  return chips.length === 0 ? NO_PARAM_CHIPS : chips.join(" · ");
}

/**
 * One param's chip, or null when the key is unset or holds something the column would refuse.
 *
 * @param key - Which param.
 * @param value - What the document holds for it.
 * @returns The chip's text, or null.
 */
function paramChip(key: ModelAliasParamKey, value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  switch (key) {
    case "thinking":
      if (!isThinkingLevel(value)) {
        return null;
      }

      // `off` is a real instruction and reads as one — *thinking off* rather than the absence
      // of a chip, which is what an alias that says nothing about thinking draws.
      return value === "off" ? "thinking off" : `${value} thinking`;
    case "token_budget":
      return isTokenCount(value) ? `${tokens(value)} budget` : null;
    case "max_output":
      return isTokenCount(value) ? `${tokens(value)} out` : null;
    case "context_clamp":
      return isTokenCount(value) ? `ctx ${tokens(value)}` : null;
    case "temperature":
      return typeof value === "number" && Number.isFinite(value) ? `temp ${value}` : null;
  }
}

/**
 * One restriction's chip.
 *
 * A `switch` rather than a lookup table for {@link paramChip}'s reason: a third flag added to
 * V019 without a chip written for it should not compile.
 *
 * @param flag - Which restriction, known to be set.
 * @returns The chip's text — mockup 21's *review vote only* and *batch ok*, verbatim.
 */
function restrictionChip(flag: ModelAliasRestrictionKey): string {
  switch (flag) {
    case "review_vote_only":
      return "review vote only";
    case "batch_ok":
      return "batch ok";
  }
}

/**
 * A token count in the unit that states it **exactly** — `400k`, `8k`, `32k`, `1M`.
 *
 * Three of the mockup's chips pin the rule and they do not agree about a divisor: `400k budget`
 * is 400 000 tokens, `8k out` is 8192 and `ctx 32k` is 32 768. A single divisor reproduces at
 * most one of them — 8192 is `8.2k` in thousands and 400 000 is `390.6k` in binary K — so the
 * rule is to print the unit the number is a whole multiple of, largest first:
 *
 * | Value | Whole multiple of | Chip |
 * |---|---|---|
 * | 1 000 000 | a million | `1M` |
 * | 400 000 | a thousand | `400k` |
 * | 32 768 | 1024 | `32k` |
 * | 12 345 | neither | `12.3k` |
 * | 512 | — | `512` |
 *
 * The last row is the honest fallback and the reason there is one at all: a value that is a
 * round number in nobody's unit is printed to one decimal place rather than rounded into a lie
 * — `12k` for 12 345 is a chip that claims a budget somebody did not set.
 *
 * @param value - A whole, positive token count.
 * @returns The chip's number and unit, with no space — the mockup's spelling.
 */
function tokens(value: number): string {
  if (value % 1_000_000 === 0) {
    return `${value / 1_000_000}M`;
  }

  if (value % 1_000 === 0) {
    return `${value / 1_000}k`;
  }

  if (value % 1_024 === 0) {
    return `${value / 1_024}k`;
  }

  if (value < 1_000) {
    return `${value}`;
  }

  // One decimal place, computed on the tenths and divided back, so what is rendered is a
  // number rather than a formatted string — `12.3k`, and `13k` where the tenth is zero,
  // because JavaScript prints `13` and not `13.0`.
  return `${Math.round(value / 100) / 10}k`;
}

/**
 * Whether a value is one of V019's three thinking levels.
 *
 * @param value - What the document held.
 * @returns Whether it is a level this product knows.
 */
function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel);
}

/**
 * Whether a value is a token count worth drawing — a whole number above zero.
 *
 * Zero and negatives are refused by V019's own domain, so a document carrying one has been
 * written past the constraint; drawing `0k out` for it would put a number on the page that no
 * request will ever carry.
 *
 * @param value - What the document held.
 * @returns Whether it is a count.
 */
function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Mockup 21's *ALLOWED MODELS · 8 ALIASES* table, row for row — the structure behind each
 * `Params` cell and the chips that cell draws.
 *
 * The fixture behind CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)) fifth
 * acceptance criterion:
 *
 * > *"All eight mockup rows' chips reproduce exactly from the seeded structure, and regenerate
 * > identically on a second call."*
 *
 * Every `chips` list below was read off `docs/mockups/21-model-registry.html`, and every
 * `params` and `restrictions` document beside it is what `model_aliases` would hold for that
 * row. `params.chips.spec.ts` runs the second through `paramChips` and compares against the
 * first — so the chips in this file are the *mockup's*, not the derivation's own output
 * recorded back at itself, which is the only version of this proof that means anything.
 *
 * ```
 * coder-max        {thinking: max, token_budget: 400000}   (max thinking)(400k budget)
 * coder-std        {thinking: std}                         (std thinking)
 * sizer            {temperature: 0, max_output: 8192}      (temp 0)(8k out)
 * coder-fallback   {}                                      —
 * second-opinion   {review_vote_only: true}                (review vote only)
 * local-docs       {context_clamp: 32768}                  (ctx 32k)
 * local-free       {batch_ok: true}                        (batch ok)
 * gpt5-experiments {}                                      —
 * ```
 *
 * Two rows draw `—` and they are the two the mockup dims or leaves plain: a fixed-catalog model
 * with nothing to tune, and an alias with no provider yet. Neither is a failure to render, which
 * is why the derivation answers an empty list and the *cell* is where the dash appears.
 *
 * ---------------------------------------------------------------------------
 * **It records the whole row, not only the chips.** The binding and the model are here because
 * CH.5 ([#588](https://github.com/NobuData/ouroboros/issues/588)) builds the same table's read
 * model and CH.1 ([#584](https://github.com/NobuData/ouroboros/issues/584)) creates these rows;
 * both need a fixture of what mockup 21 actually shows, and two copies of it would be two
 * mockups. `card.shapes.fixture.ts` plays the same part for mockup 07.
 *
 * It is a `.fixture.ts`: type-checked with the code it exercises, left out of the image by
 * `tsconfig.build.json`, and not counted as application code by `jest.config.mjs`'s coverage.
 */

import type { ProviderConnectionKind } from "../db/schema";

/** One row of mockup 21's allowed-models table. */
export interface RegistryRow {
  /** The `Alias` cell — the pill. */
  readonly alias: string;
  /**
   * The provider kind the row resolves on, or null for the unbound row.
   *
   * Null is `gpt5-experiments`, which mockup 21 draws with *no provider* where the others draw
   * a monogram and a name.
   */
  readonly kind: ProviderConnectionKind | null;
  /** The `Model` cell, in the vendor's own spelling. */
  readonly modelId: string;
  /** What `model_aliases.params` holds for this row. */
  readonly params: Readonly<Record<string, unknown>>;
  /** What `model_aliases.restrictions` holds for this row. */
  readonly restrictions: Readonly<Record<string, unknown>>;
  /**
   * The `Params` cell's chips, exactly as the mockup draws them.
   *
   * Empty for the two rows that draw `—`, which the mockup renders as faint text rather than
   * as a tag — so the absence is structural here too.
   */
  readonly chips: readonly string[];
}

/** The eight rows, in the order the table draws them. */
export const REGISTRY_ROWS: readonly RegistryRow[] = Object.freeze([
  {
    alias: "coder-max",
    kind: "anthropic",
    modelId: "claude-fable-5",
    params: { thinking: "max", token_budget: 400_000 },
    restrictions: {},
    chips: ["max thinking", "400k budget"],
  },
  {
    alias: "coder-std",
    kind: "anthropic",
    modelId: "claude-sonnet-5",
    params: { thinking: "std" },
    restrictions: {},
    chips: ["std thinking"],
  },
  {
    alias: "sizer",
    kind: "anthropic",
    modelId: "claude-haiku-4-5",
    params: { temperature: 0, max_output: 8192 },
    restrictions: {},
    chips: ["temp 0", "8k out"],
  },
  {
    alias: "coder-fallback",
    kind: "copilot",
    modelId: "gpt-5-codex",
    params: {},
    restrictions: {},
    chips: [],
  },
  {
    alias: "second-opinion",
    kind: "cursor",
    modelId: "composer-2",
    params: {},
    restrictions: { review_vote_only: true },
    chips: ["review vote only"],
  },
  {
    alias: "local-docs",
    kind: "ollama",
    modelId: "qwen3-coder:32b",
    params: { context_clamp: 32_768 },
    restrictions: {},
    chips: ["ctx 32k"],
  },
  {
    alias: "local-free",
    kind: "openai_compatible",
    modelId: "llama-4-maverick",
    params: {},
    restrictions: { batch_ok: true },
    chips: ["batch ok"],
  },
  {
    alias: "gpt5-experiments",
    kind: null,
    modelId: "gpt-5.2-preview",
    params: {},
    restrictions: {},
    chips: [],
  },
]);

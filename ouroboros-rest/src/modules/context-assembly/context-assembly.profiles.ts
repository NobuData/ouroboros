/**
 * What each consumer injects, and how much of it (BF.5,
 * [#414](https://github.com/NobuData/ouroboros/issues/414)).
 *
 * A consumer's **profile** is the one place its budget lives. The token estimate is deliberately
 * crude — a quarter of the character count, rounded up — because its job is to make a trim
 * *deterministic and visible*, not to predict a tokenizer: the same text always costs the same, so
 * the same scope always trims the same way.
 *
 * | consumer    | injects          | budget  | fact cap |
 * |-------------|------------------|---------|----------|
 * | `estimator` | facts            | 8 000   | 64       |
 * | `run_stage` | skills and facts | 32 000  | —        |
 * | `playbook`  | skills and facts | 32 000  | —        |
 *
 * The estimator injects facts only because that is all `POST /v0/estimate` carries
 * (`EstimationContext.facts`, engine 0.7.6); its fact cap is the engine's `MAX_CONTEXT_FACTS`, so
 * a longer list is trimmed — and the trim recorded — here rather than refused there.
 */

import { MAX_CONTEXT_FACTS } from "../engine/engine.contract";
import type { ContextConsumer } from "./context-assembly.resources";

/** One consumer's profile. */
export interface ConsumerProfile {
  /** Whether skills are part of this consumer's manifest. */
  readonly skills: boolean;
  /** Whether facts are. */
  readonly facts: boolean;
  /** The token budget. A caller may ask for less, never for more. */
  readonly budgetTokens: number;
  /** The most facts one manifest may carry; `null` is no cap beyond the budget. */
  readonly maxFacts: number | null;
}

/** Every consumer's profile. */
export const CONSUMER_PROFILES: Readonly<Record<ContextConsumer, ConsumerProfile>> = Object.freeze({
  estimator: { skills: false, facts: true, budgetTokens: 8_000, maxFacts: MAX_CONTEXT_FACTS },
  run_stage: { skills: true, facts: true, budgetTokens: 32_000, maxFacts: null },
  playbook: { skills: true, facts: true, budgetTokens: 32_000, maxFacts: null },
});

/** The largest budget any caller may ask for — the ceiling the request DTO validates against. */
export const MAX_BUDGET_TOKENS = 200_000;

/** Characters per estimated token. */
const CHARS_PER_TOKEN = 4;

/**
 * A text's token estimate.
 *
 * @param text - What would be injected.
 * @returns `ceil(length / 4)` — at least 1 for any non-empty text, 0 for an empty one.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * The budget a manifest is held to.
 *
 * @param consumer - Who it is for.
 * @param requested - A lower budget the caller asked for, if any.
 * @returns The consumer's budget, or the requested one when it is lower. A request can only
 *   tighten a budget: a larger one is not an error, it is simply not granted.
 */
export function budgetFor(consumer: ContextConsumer, requested?: number): number {
  const ceiling = CONSUMER_PROFILES[consumer].budgetTokens;

  return requested === undefined ? ceiling : Math.min(ceiling, requested);
}

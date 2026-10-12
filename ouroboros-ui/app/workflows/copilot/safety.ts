/**
 * Every decision the copilot's safety strip makes, as functions with inputs and outputs (CE.5,
 * [#569](https://github.com/NobuData/ouroboros/issues/569)) — mockup 20's *WHY DRY RUNS ARE
 * SAFE* card.
 *
 * ### The strip is derived, not written
 *
 * Its three sentences are the strongest safety claims in the product, and a page that printed
 * them as copy would keep printing them after they stopped being true. So the strip is composed
 * from CD.4's payload (`GET /api/v1/workflows/{id}/dry-runs/safety`, #562), which the service
 * derives from the harness's own configuration:
 *
 * - a column is drawn **only** while the payload asserts it — it is in `columns` and it `holds`;
 * - a column the payload does not assert is **absent**: not greyed, not struck through, and
 *   never replaced by a sentence kept here. {@link withheldNote} says only that the strip is
 *   incomplete, without repeating the claim;
 * - the wording of a claim is fixed ({@link SAFETY_CLAIMS}, the issue's verbatim copy), but it
 *   is looked up by the id **the payload sent** — nothing in this file can make a claim appear.
 *
 * ### Each claim traces to its mechanism
 *
 * {@link safetyColumns} gives every column the trace its popover prints: what the mechanism is,
 * the service's own sentence for it, the harness tools that carry it, the control-plane path it
 * goes through, and — for the estimator — the registered formulas with their sample basis.
 *
 * **Framework-free and pure**, the way `copilot-view.ts` is: type-only API imports, no React.
 */

import type { DryRunSafety, DryRunSafetyColumn } from "@/app/api/workflow-dry-runs";

/* ------------------------------------------------------------------ the card */

/** What stands in the read's place when the strip could not be read. */
export const SAFETY_FAILED_HEADLINE = "The dry run's safety claims could not be read.";

/** Which harness the claims are about — the head's quiet tag. */
export const HARNESS_TERM = "harness";

/* ------------------------------------------------------------------ the claims */

/** A column the strip knows how to word. */
export type SafetyColumnId = DryRunSafetyColumn["id"];

/** What backs a column. */
export type SafetyMechanismKind = DryRunSafetyColumn["mechanism"]["kind"];

/** A claim's words: the mockup's key, and the issue's sentence under it. */
export interface SafetyClaim {
  readonly key: string;
  readonly sentence: string;
}

/**
 * The three claims, verbatim. **A lookup, not a list to render**: {@link safetyColumns} reads an
 * entry only for a column the payload asserts.
 */
export const SAFETY_CLAIMS: Readonly<Record<SafetyColumnId, SafetyClaim>> = {
  simulated_writes: {
    key: "Simulated writes",
    sentence: "Diffs are drafted in memory — the repo is untouched.",
  },
  replayed_infra: {
    key: "Replayed infra",
    sentence: "Build & test are estimated from your history; the farm stays idle.",
  },
  real_models: {
    key: "Real models",
    sentence: "Prompts & routing are exercised for real — that's what you're testing.",
  },
};

/** What each mechanism is called in its popover. */
export const MECHANISM_WORDS: Readonly<Record<SafetyMechanismKind, string>> = {
  overlay: "In-memory overlay",
  estimator_service: "Replay estimator service",
  gateway_routing: "Invocation gateway routing",
};

/** The popover's terms. */
export const MECHANISM_TERM = "Mechanism";
export const TOOLS_TERM = "Harness tools";
export const PATH_TERM = "Goes through";
export const WRITES_TERM = "Writes land in";
export const READS_TERM = "Reads come from";
export const FORMULAS_TERM = "Sample basis";

/**
 * The accessible name of a column's ⓘ.
 *
 * @param key The claim's key, *Simulated writes*.
 * @returns *How "Simulated writes" is enforced*.
 */
export function mechanismButtonName(key: string): string {
  return `How “${key}” is enforced`;
}

/* ------------------------------------------------------------------ the trace */

/** One fact of a mechanism's trace: a term and what it is, set in mono when it is an identifier. */
export interface SafetyFact {
  readonly term: string;
  readonly value: string;
  readonly mono: boolean;
}

/** One column as the strip draws it: the claim, and the trace its popover prints. */
export interface SafetyColumnView {
  readonly id: SafetyColumnId;
  readonly key: string;
  readonly sentence: string;
  /** What the mechanism is, in words. */
  readonly mechanism: string;
  /** The service's own sentence for what the mechanism does. */
  readonly detail: string;
  /** The rest of the trace, in the order the popover lists it. */
  readonly facts: readonly SafetyFact[];
}

/**
 * A string out of a payload's free-form facts.
 *
 * @param value The fact, as served.
 * @returns It when it is a non-empty string, else `null`.
 */
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * One registered formula, as the estimator's popover names it.
 *
 * @param formula The fact's entry, as served.
 * @returns *build_duration_replay v1 — median ± mad*, or `null` for an entry without an id.
 */
function formulaLine(formula: unknown): string | null {
  if (typeof formula !== "object" || formula === null) return null;

  const entry = formula as Readonly<Record<string, unknown>>;
  const id = text(entry.id);
  if (id === null) return null;

  const version = typeof entry.version === "number" || typeof entry.version === "string" ? ` v${entry.version}` : "";
  const dispersion = text(entry.dispersion);

  return `${id}${version}${dispersion === null ? "" : ` — median ± ${dispersion}`}`;
}

/**
 * The trace of one column: its tools, its path, and whatever its facts carry that the strip
 * knows how to say.
 *
 * @param column The column, as served.
 * @returns The facts, in the order the popover lists them. A fact the payload does not carry is
 *   left out rather than filled in.
 */
function traceFacts(column: DryRunSafetyColumn): SafetyFact[] {
  const facts: SafetyFact[] = [];

  if (column.mechanism.tools.length > 0) {
    facts.push({ term: TOOLS_TERM, value: column.mechanism.tools.join(" · "), mono: true });
  }
  if (column.mechanism.path !== null) {
    facts.push({ term: PATH_TERM, value: column.mechanism.path, mono: true });
  }

  const writes = text(column.facts.writes);
  if (writes !== null) facts.push({ term: WRITES_TERM, value: writes, mono: true });

  const reads = text(column.facts.reads);
  if (reads !== null) facts.push({ term: READS_TERM, value: reads, mono: true });

  const formulas = Array.isArray(column.facts.formulas)
    ? column.facts.formulas.map(formulaLine).filter((line): line is string => line !== null)
    : [];
  if (formulas.length > 0) facts.push({ term: FORMULAS_TERM, value: formulas.join(" · "), mono: true });

  return facts;
}

/**
 * The columns the strip draws: the ones the payload asserts, in the payload's order.
 *
 * @param safety The strip, as served.
 * @returns One view per column that is served, `holds`, and is a claim this strip can word. A
 *   column that is missing, does not hold, or is of a kind this build does not know is not in
 *   the answer — there is no fallback.
 */
export function safetyColumns(safety: DryRunSafety): SafetyColumnView[] {
  const seen = new Set<string>();

  return safety.columns.flatMap((column) => {
    // `Object.hasOwn`, so an id like `constructor` cannot find a claim on the prototype.
    if (!column.holds || !Object.hasOwn(SAFETY_CLAIMS, column.id) || seen.has(column.id)) return [];
    seen.add(column.id);

    const claim = SAFETY_CLAIMS[column.id];

    return [
      {
        id: column.id,
        key: claim.key,
        sentence: claim.sentence,
        mechanism: MECHANISM_WORDS[column.mechanism.kind] ?? column.mechanism.kind,
        detail: column.mechanism.detail,
        facts: traceFacts(column),
      },
    ];
  });
}

/* ------------------------------------------------------------------ what is withheld */

/** How many claims a whole strip makes. */
export const SAFETY_CLAIM_COUNT = Object.keys(SAFETY_CLAIMS).length;

/** What the strip says when the harness backs none of its claims. */
export const NOTHING_HELD_NOTE =
  "The installed dry-run harness backs none of the claims this strip makes, so none is made here. Do not rely on a dry run being safe until this is resolved.";

/**
 * What the strip says about the claims it is not making.
 *
 * It never repeats a withheld claim — the point of deriving the strip is that a sentence the
 * harness stopped backing is no longer on the page.
 *
 * @param shown How many columns are drawn.
 * @returns `null` for a whole strip; otherwise the sentence saying it is incomplete, and why.
 */
export function withheldNote(shown: number): string | null {
  if (shown >= SAFETY_CLAIM_COUNT) return null;
  if (shown === 0) return NOTHING_HELD_NOTE;

  const missing = SAFETY_CLAIM_COUNT - shown;

  return `${missing} of this strip's ${SAFETY_CLAIM_COUNT} claims ${missing === 1 ? "is" : "are"} not shown: the installed dry-run harness does not back ${missing === 1 ? "it" : "them"}, so the page does not make ${missing === 1 ? "it" : "them"}.`;
}

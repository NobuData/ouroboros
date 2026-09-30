/**
 * The safe-first-issue score — *"We picked a safe one"* as arithmetic that can be printed
 * ([#387](https://github.com/NobuData/ouroboros/issues/387), BB.4, decision **O5**).
 *
 * The pick is a claim about somebody's codebase, so it is never a model's opinion: it is a sum of
 * four documented terms, and the card's reasoning line is those terms rendered. `no code paths
 * touched` is not a description written about the pick — it is the **path-risk component's**
 * fragment, so a person who disagrees with the pick can see which term drove it.
 *
 * ```
 * component   signal                                  points (safety-v1, 100 in all)
 * effort      the estimate's size                     XS 35 · S 20 · M 5 · L / XL excluded
 * workflow    the estimate's suggested workflow       docs-loop 30 · standard-fix 15 · other 0
 * paths       breakdown files vs protected + docs     no code 25 · code 5 · protected → disqualified
 * freshness   the issue's last activity               10, halved every 14 days of quiet
 * ```
 *
 * **Disqualification is not a low score.** A file matching a protected glob, or an effort of `l`
 * or above, removes the candidate before anything is added up, so no weighting can bring it back.
 * **The safety bar is a floor, not a curve**: when nothing reaches it, the answer says so rather
 * than handing back the least-bad candidate.
 *
 * Everything here is pure — the clock is a parameter — so the same backlog and the same weights
 * give the same order on any machine, and a weight change reorders it predictably.
 */

import type { BillingMode, EstimateEffort } from "../db/schema";
import { GlobSet } from "../guardrails/guardrails.glob";
import { formatDollars, rateOf, TOKENS_PER_RATE } from "../planning/planning.summary";

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** What separates the fragments of the reasoning line — the mockup's ` · `. */
export const FRAGMENT_SEPARATOR = " · ";

/**
 * Paths that are documentation rather than code, in the guardrails' glob grammar. A breakdown
 * whose every file matches one touches no code path.
 */
export const DOCS_GLOBS: readonly string[] = [
  "docs/**",
  "doc/**",
  "**/*.md",
  "**/*.mdx",
  "**/*.rst",
  "**/*.adoc",
  "**/*.txt",
  "**/README*",
  "**/CHANGELOG*",
  "**/CONTRIBUTING*",
  "**/LICENSE*",
];

/** The weights one version of the score adds up. */
export interface SafetyWeights {
  /** Named in every answer, so a pick says which rules produced it. */
  readonly version: string;
  /** Points per size. A size absent here is excluded from first picks. */
  readonly effort: Readonly<Partial<Record<EstimateEffort, number>>>;
  /** Points per suggested workflow; {@link otherWorkflow} for anything not listed. */
  readonly workflow: Readonly<Record<string, number>>;
  /** Points for a workflow not in {@link workflow} — feature-shaped work. */
  readonly otherWorkflow: number;
  /** Points by what the breakdown's files touch. */
  readonly paths: { readonly noCode: number; readonly code: number };
  /** The freshness term: its full value, and the days of quiet that halve it. */
  readonly freshness: { readonly max: number; readonly halfLifeDays: number };
  /** The least total a candidate needs to be offered as safe. */
  readonly safetyBar: number;
}

/** The weights in force — version `safety-v1`. */
export const SAFETY_WEIGHTS: SafetyWeights = {
  version: "safety-v1",
  effort: { xs: 35, s: 20, m: 5 },
  workflow: { "docs-loop": 30, "standard-fix": 15 },
  otherWorkflow: 0,
  paths: { noCode: 25, code: 5 },
  freshness: { max: 10, halfLifeDays: 14 },
  safetyBar: 45,
};

/** What a candidate needs from the backlog to be scored. */
export interface ScoringInput {
  /** The latest estimate's size. */
  readonly effort: EstimateEffort;
  /** The latest estimate's suggested workflow. */
  readonly suggestedWorkflow: string;
  /** The latest estimate's `breakdown.files`. `[]` is the estimator's real answer. */
  readonly files: readonly string[];
  /** The issue's last activity. */
  readonly updatedAt: Date;
  /** The latest estimate's cycle range, in minutes. */
  readonly cycleMin: number;
  readonly cycleMax: number;
  /** The latest estimate's `breakdown.est_tokens`. */
  readonly estTokens: number;
  /** The rate the routed model resolved to, or null when nothing prices it. */
  readonly price: {
    readonly billingMode: BillingMode;
    readonly inputCentsPer1m: string | null;
  } | null;
}

/** Why a candidate cannot be a first pick, whatever it scores. */
export type Disqualification = "protected_path" | "too_large";

/** The component keys, in the order the breakdown lists them. */
export type ComponentKey = "effort" | "workflow" | "paths" | "freshness";

/** One term of the score. */
export interface ScoreComponent {
  readonly key: ComponentKey;
  /** The value the term read — `xs`, `docs-loop`, `no_code`, a day count. */
  readonly signal: string;
  /** What it added. */
  readonly points: number;
  /** The most it could have added under these weights. */
  readonly maxPoints: number;
  /** The term, as the detail affordance prints it. */
  readonly label: string;
}

/** One piece of the reasoning line, and what produced it. */
export interface ReasoningFragment {
  /** A score component, or the estimate the minutes and cost come from. */
  readonly source: ComponentKey | "estimate" | "cost";
  readonly text: string;
}

/** The score's answer for one candidate. */
export type ScoreResult =
  | {
      readonly disqualified: false;
      readonly score: number;
      readonly clearsBar: boolean;
      readonly components: readonly ScoreComponent[];
      /** The estimate's minutes — the cycle range's midpoint, rounded down. */
      readonly loopMinutes: number;
      /** Present only when the routed model is priced. Never zero for "unknown". */
      readonly cost?: { readonly cents: number; readonly display: string };
      readonly fragments: readonly ReasoningFragment[];
      /** The fragments joined — the card's line. */
      readonly line: string;
    }
  | {
      readonly disqualified: true;
      readonly reason: Disqualification;
      /** The protected globs a breakdown file matched, when that is the reason. */
      readonly protectedGlobs: readonly string[];
    };

/** The components whose fragment the one-line reasoning prints (the chips carry the rest). */
export const LINE_COMPONENTS: readonly ComponentKey[] = ["paths"];

/**
 * Score one candidate.
 *
 * @param input - The candidate's estimate, activity and price.
 * @param protectedGlobs - The repository's protected paths (`protected_path_policies`).
 * @param now - The instant freshness is measured from.
 * @param weights - The weights; {@link SAFETY_WEIGHTS} unless a fixture changes them.
 * @returns The total with its components and reasoning, or why it was disqualified.
 */
export function scoreCandidate(
  input: ScoringInput,
  protectedGlobs: readonly string[],
  now: Date,
  weights: SafetyWeights = SAFETY_WEIGHTS,
): ScoreResult {
  const guarded = matchedGlobs(input.files, protectedGlobs);

  if (guarded.length > 0) {
    return { disqualified: true, reason: "protected_path", protectedGlobs: guarded };
  }

  const effortPoints = weights.effort[input.effort];

  if (effortPoints === undefined) {
    return { disqualified: true, reason: "too_large", protectedGlobs: [] };
  }

  const components = [
    effortComponent(input.effort, effortPoints, weights),
    workflowComponent(input.suggestedWorkflow, weights),
    pathsComponent(input.files, weights),
    freshnessComponent(input.updatedAt, now, weights),
  ];
  const score = round1(components.reduce((sum, component) => sum + component.points, 0));
  const loopMinutes = Math.floor((input.cycleMin + input.cycleMax) / 2);
  const cost = costOf(input.estTokens, input.price);
  const fragments: ReasoningFragment[] = [
    ...components
      .filter((component) => LINE_COMPONENTS.includes(component.key))
      .map((component) => ({ source: component.key, text: component.label })),
    { source: "estimate", text: `est. ${String(loopMinutes)} min` },
    ...(cost === undefined ? [] : [{ source: "cost" as const, text: `est. ${cost.display}` }]),
  ];

  return {
    disqualified: false,
    score,
    clearsBar: score >= weights.safetyBar,
    components,
    loopMinutes,
    ...(cost === undefined ? {} : { cost }),
    fragments,
    line: fragments.map((fragment) => fragment.text).join(FRAGMENT_SEPARATOR),
  };
}

/**
 * Order scored candidates: highest score first, then the lower issue number, so two machines
 * never break a tie differently.
 *
 * @param a - One candidate.
 * @param b - The other.
 * @returns A comparator result.
 */
export function bySafety(
  a: { readonly score: number; readonly number: number },
  b: { readonly score: number; readonly number: number },
): number {
  return b.score - a.score || a.number - b.number;
}

/**
 * The protected globs any of these files matches.
 *
 * @param files - The breakdown's files.
 * @param globs - The protected globs.
 * @returns The globs matched, each once, in the order given.
 */
function matchedGlobs(files: readonly string[], globs: readonly string[]): string[] {
  if (globs.length === 0) {
    return [];
  }

  const set = new GlobSet(globs);
  const hit = new Set(files.flatMap((file) => set.match(file) ?? []));

  return globs.filter((glob) => hit.has(glob));
}

/**
 * The effort term.
 *
 * @param effort - The size.
 * @param points - Its points under the weights.
 * @param weights - The weights.
 * @returns The component.
 */
function effortComponent(
  effort: EstimateEffort,
  points: number,
  weights: SafetyWeights,
): ScoreComponent {
  return {
    key: "effort",
    signal: effort,
    points,
    maxPoints: Math.max(...Object.values(weights.effort)),
    label: `${effort.toUpperCase()} effort`,
  };
}

/**
 * The workflow-safety term.
 *
 * @param workflow - The suggested workflow.
 * @param weights - The weights.
 * @returns The component.
 */
function workflowComponent(workflow: string, weights: SafetyWeights): ScoreComponent {
  return {
    key: "workflow",
    signal: workflow,
    points: weights.workflow[workflow] ?? weights.otherWorkflow,
    maxPoints: Math.max(weights.otherWorkflow, ...Object.values(weights.workflow)),
    label: `${workflow} workflow`,
  };
}

/**
 * The path-risk term, for a candidate already cleared of protected paths.
 *
 * A breakdown naming no files, or only documentation, touches no code path — the estimator's own
 * answer, and the one the line prints as `no code paths touched`.
 *
 * @param files - The breakdown's files.
 * @param weights - The weights.
 * @returns The component.
 */
function pathsComponent(files: readonly string[], weights: SafetyWeights): ScoreComponent {
  const docs = new GlobSet(DOCS_GLOBS);
  const code = files.filter((file) => !docs.matches(file));
  const maxPoints = Math.max(weights.paths.noCode, weights.paths.code);

  if (code.length === 0) {
    return {
      key: "paths",
      signal: "no_code",
      points: weights.paths.noCode,
      maxPoints,
      label: "no code paths touched",
    };
  }

  return {
    key: "paths",
    signal: "code",
    points: weights.paths.code,
    maxPoints,
    label: `${String(code.length)} code ${code.length === 1 ? "path" : "paths"} touched`,
  };
}

/**
 * The freshness term: full value on a just-touched issue, halving every half-life of quiet.
 *
 * @param updatedAt - The issue's last activity.
 * @param now - The instant it is measured from.
 * @param weights - The weights.
 * @returns The component; its signal is the whole days since the last activity.
 */
function freshnessComponent(updatedAt: Date, now: Date, weights: SafetyWeights): ScoreComponent {
  const ageDays = Math.max(0, (now.getTime() - updatedAt.getTime()) / DAY_MS);
  const days = Math.floor(ageDays);

  return {
    key: "freshness",
    signal: String(days),
    points: round1(weights.freshness.max * 0.5 ** (ageDays / weights.freshness.halfLifeDays)),
    maxPoints: weights.freshness.max,
    label: days === 0 ? "active today" : `active ${String(days)}d ago`,
  };
}

/**
 * The estimated cost of the work, only when its routed model is priced (decision N10).
 *
 * Costed at the **input** rate — a lower bound, because `est_tokens` has no input/output split —
 * through the planning footer's own {@link rateOf}. A `free` model is a real zero; no rate at all
 * is absent, never `$0`.
 *
 * @param estTokens - The estimate's tokens.
 * @param price - The resolved rate, or null.
 * @returns The cost, or undefined when unpriced.
 */
function costOf(
  estTokens: number,
  price: ScoringInput["price"],
): { cents: number; display: string } | undefined {
  const rate = rateOf(price);

  if (rate === undefined) {
    return undefined;
  }

  const exact = (estTokens * rate) / TOKENS_PER_RATE;
  const cents = Math.round(exact);

  return { cents, display: cents === 0 && exact > 0 ? "< $0.01" : formatDollars(cents) };
}

/**
 * Round to one decimal place, so a score reads the same in a log as in a response.
 *
 * @param value - The number.
 * @returns It, to one decimal.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

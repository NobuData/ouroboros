/**
 * The org policy document, as the Autonomy policies card reads, edits and states it
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * The document (`schemas/org-policy/v1.json`, BQ.1 #480) is a map of rule id to
 * `{enabled, conditions}`. This module is the three translations the card needs, and nothing that
 * renders:
 *
 * ```
 * document ──parse──▶ drafts ──edit──▶ drafts ──compose──▶ document      (what is published)
 * document ──────────────────────────────────────chips──▶ ["effort ≤ M", "non-refactor"]
 * ```
 *
 * ### A draft holds only what the document admits
 *
 * Each rule's **terms** are a small typed value — an effort from the five sizes, labels, globs,
 * integer cents, a loop count — and every function that changes one keeps the rule's own
 * invariant (a predicate rule keeps at least one term; a spend guard keeps at least one cap). So
 * the controls cannot produce a document the evaluator cannot read: an invalid state is not
 * rejected on save, it is never reached. {@link validatePolicy} still checks the whole draft
 * before anything is sent, as the last line rather than the first.
 *
 * ### A rule this editor cannot represent is never rewritten
 *
 * The grammar is recursive (`all`/`any`/`not`), and a document published through the API may nest
 * further than a chip editor can show. Such a rule parses to `terms: null`: its chips are still
 * drawn from its conditions, its switch still works, and {@link composeDocument} carries its
 * conditions through **verbatim**. The same holds for every `custom:*` rule and for every rule
 * nobody touched — only a rule whose draft differs from the saved one is recomposed.
 *
 * ### Chips are drawn from the document
 *
 * {@link ruleChips} reads a rule's `conditions` and nothing else — the same function draws the
 * saved card, the draft being edited and both sides of a history diff, so a chip can never state
 * a condition the document does not hold.
 *
 * Framework-free and pure.
 */

import type { components } from "@/app/api/schema";
import { globChip } from "@/app/globs/glob";
import { sameValue } from "@/app/settings/save-model";

import { chipAmount } from "./money";

/** The whole document. */
export type PolicyDocument = components["schemas"]["OrgPolicyDocument"];
/** One rule of it. */
export type PolicyRule = components["schemas"]["OrgPolicyRule"];

/** The five core rules, in the order mockup 17 draws them. */
export const CORE_RULES = [
  "auto_merge",
  "human_review",
  "protected_paths",
  "spend_guard",
  "dry_run_new_repos",
] as const;

/** A core rule's id. */
export type CoreRuleId = (typeof CORE_RULES)[number];

/** The shirt sizes, smallest first — `issue_estimates.effort`'s vocabulary. */
export const EFFORTS = ["xs", "s", "m", "l", "xl"] as const;

/** One shirt size. */
export type Effort = (typeof EFFORTS)[number];

/** The longest label the grammar admits. */
export const LABEL_MAX_LENGTH = 64;

/** The most terms one `all`/`any` may hold (`predicates.maxItems`). */
export const TERMS_MAX = 32;

/** The largest loop count the grammar admits. */
export const LOOPS_MAX = 100_000;

/* ------------------------------------------------------------------ the drafts */

/** `auto_merge`'s terms: every one must hold. Invariant: an effort, or at least one label. */
export interface AutoMergeTerms {
  /** The largest effort that merges on its own, or `null` for no effort condition. */
  readonly maxEffort: Effort | null;
  /** Labels whose tickets never merge on their own. */
  readonly excludedLabels: readonly string[];
}

/** `human_review`'s terms: any one suffices. Invariant: an effort, or at least one label. */
export interface HumanReviewTerms {
  /** Labels whose tickets always wait for a person. */
  readonly labels: readonly string[];
  /** The smallest effort that always waits for a person, or `null` for no effort condition. */
  readonly minEffort: Effort | null;
}

/** `protected_paths`' terms. */
export interface ProtectedPathsTerms {
  /** The globs, in the document's order. */
  readonly globs: readonly string[];
}

/** `spend_guard`'s terms, in integer cents. Invariant: at least one cap. */
export interface SpendGuardTerms {
  /** What one run may cost before its loop pauses, or `null` for no per-run cap. */
  readonly perRunCents: number | null;
  /** What one provider may cost in a month, or `null` for no monthly cap. */
  readonly monthlyCents: number | null;
}

/** `dry_run_new_repos`' terms. */
export interface DryRunTerms {
  /** How many of a new repository's first loops open draft PRs. */
  readonly firstLoops: number;
}

/** A rule as the card edits it. */
export interface RuleDraft<Terms> {
  /** Whether the rule is on. */
  readonly enabled: boolean;
  /**
   * Its conditions, or `null` when the document's are of a shape this editor cannot represent —
   * such a rule's conditions are published exactly as they were read.
   */
  readonly terms: Terms | null;
}

/** The card's fields — one per core rule, which is what **Save changes** counts. */
export interface PolicyDrafts {
  readonly auto_merge: RuleDraft<AutoMergeTerms>;
  readonly human_review: RuleDraft<HumanReviewTerms>;
  readonly protected_paths: RuleDraft<ProtectedPathsTerms>;
  readonly spend_guard: RuleDraft<SpendGuardTerms>;
  readonly dry_run_new_repos: RuleDraft<DryRunTerms>;
}

/** The terms type of each rule. */
export type TermsOf<Id extends CoreRuleId> = NonNullable<PolicyDrafts[Id]["terms"]>;

/**
 * What the card edits from when a workspace has published nothing: every rule **off**, with
 * mockup 17's conditions ready beside the switch. Nothing binds until a version is published, and
 * the first publish is this document with whatever the reader changed.
 */
export const UNPUBLISHED_DOCUMENT: PolicyDocument = {
  auto_merge: {
    enabled: false,
    conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] },
  },
  human_review: {
    enabled: false,
    conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
  },
  protected_paths: { enabled: false, conditions: { path_globs: [] } },
  spend_guard: { enabled: false, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60_000 } },
  dry_run_new_repos: { enabled: false, conditions: { first_n_loops: 10 } },
};

/* ------------------------------------------------------------------ reading values */

/** A plain object, or `null`. */
function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/** The one key and value of a predicate, or `null` when it is not a one-key object. */
function onlyEntry(value: unknown): readonly [string, unknown] | null {
  const object = record(value);
  if (object === null) return null;

  const entries = Object.entries(object);

  return entries.length === 1 ? entries[0] : null;
}

/**
 * Whether a value is one of the five efforts.
 *
 * @param value Anything.
 * @returns `true` for an effort, narrowing the type.
 */
export function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value);
}

/** A label the grammar admits, or `null`. */
function labelOf(value: unknown): string | null {
  return typeof value === "string" && value.length >= 1 && value.length <= LABEL_MAX_LENGTH
    ? value
    : null;
}

/** A whole number within bounds, or `null`. */
function integerOf(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

/**
 * The terms of a flat `all`/`any`, or `null` when the predicate is anything else. A predicate
 * that is itself one comparison is read as a list of one, so `{effort_lte: "m"}` and
 * `{all: [{effort_lte: "m"}]}` edit alike.
 *
 * @param conditions The rule's conditions.
 * @param composition Which composition the rule's editor speaks.
 * @returns The terms.
 */
function flatTerms(conditions: unknown, composition: "all" | "any"): readonly unknown[] | null {
  const entry = onlyEntry(conditions);
  if (entry === null) return null;

  const [key, value] = entry;
  if (key === composition) return Array.isArray(value) ? (value as readonly unknown[]) : null;

  return key === "all" || key === "any" ? null : [conditions];
}

/* ------------------------------------------------------------------ document → drafts */

/**
 * `auto_merge`'s conditions as terms: one optional `effort_lte` and any number of `not label`.
 *
 * @param conditions The rule's conditions.
 * @returns The terms, or `null` for any other shape.
 */
export function parseAutoMerge(conditions: unknown): AutoMergeTerms | null {
  const terms = flatTerms(conditions, "all");
  if (terms === null) return null;

  let maxEffort: Effort | null = null;
  const excludedLabels: string[] = [];

  for (const term of terms) {
    const entry = onlyEntry(term);
    if (entry === null) return null;

    const [key, value] = entry;

    if (key === "effort_lte" && isEffort(value) && maxEffort === null) {
      maxEffort = value;
    } else if (key === "not") {
      const inner = onlyEntry(value);
      const label = inner?.[0] === "label" ? labelOf(inner[1]) : null;
      if (label === null || excludedLabels.includes(label)) return null;

      excludedLabels.push(label);
    } else {
      return null;
    }
  }

  return maxEffort === null && excludedLabels.length === 0 ? null : { maxEffort, excludedLabels };
}

/**
 * `human_review`'s conditions as terms: any number of `label` and one optional `effort_gte`.
 *
 * @param conditions The rule's conditions.
 * @returns The terms, or `null` for any other shape.
 */
export function parseHumanReview(conditions: unknown): HumanReviewTerms | null {
  const terms = flatTerms(conditions, "any");
  if (terms === null) return null;

  let minEffort: Effort | null = null;
  const labels: string[] = [];

  for (const term of terms) {
    const entry = onlyEntry(term);
    if (entry === null) return null;

    const [key, value] = entry;

    if (key === "effort_gte" && isEffort(value) && minEffort === null) {
      minEffort = value;
    } else if (key === "label") {
      const label = labelOf(value);
      if (label === null || labels.includes(label)) return null;

      labels.push(label);
    } else {
      return null;
    }
  }

  return minEffort === null && labels.length === 0 ? null : { labels, minEffort };
}

/**
 * `protected_paths`' conditions as terms.
 *
 * @param conditions The rule's conditions.
 * @returns The globs, or `null` when the conditions are not exactly a list of strings.
 */
export function parseProtectedPaths(conditions: unknown): ProtectedPathsTerms | null {
  const object = record(conditions);
  const globs = object?.path_globs;

  if (object === null || Object.keys(object).length !== 1 || !Array.isArray(globs)) return null;
  if (!globs.every((glob): glob is string => typeof glob === "string")) return null;

  return { globs };
}

/**
 * `spend_guard`'s conditions as terms.
 *
 * @param conditions The rule's conditions.
 * @returns The caps, or `null` when a cap is not integer cents or neither is set.
 */
export function parseSpendGuard(conditions: unknown): SpendGuardTerms | null {
  const object = record(conditions);
  if (object === null) return null;

  const { per_run_cap_cents: perRun, monthly_cap_cents: monthly, ...rest } = object;
  if (Object.keys(rest).length > 0) return null;

  const perRunCents = perRun === undefined ? null : integerOf(perRun, 1, Number.MAX_SAFE_INTEGER);
  const monthlyCents = monthly === undefined ? null : integerOf(monthly, 1, Number.MAX_SAFE_INTEGER);

  if ((perRun !== undefined && perRunCents === null) || (monthly !== undefined && monthlyCents === null)) {
    return null;
  }

  return perRunCents === null && monthlyCents === null ? null : { perRunCents, monthlyCents };
}

/**
 * `dry_run_new_repos`' conditions as terms.
 *
 * @param conditions The rule's conditions.
 * @returns The loop count, or `null` when it is not a whole number in bounds.
 */
export function parseDryRun(conditions: unknown): DryRunTerms | null {
  const object = record(conditions);
  if (object === null || Object.keys(object).length !== 1) return null;

  const firstLoops = integerOf(object.first_n_loops, 0, LOOPS_MAX);

  return firstLoops === null ? null : { firstLoops };
}

/** Each rule's parser. */
const PARSERS: { readonly [Id in CoreRuleId]: (conditions: unknown) => TermsOf<Id> | null } = {
  auto_merge: parseAutoMerge,
  human_review: parseHumanReview,
  protected_paths: parseProtectedPaths,
  spend_guard: parseSpendGuard,
  dry_run_new_repos: parseDryRun,
};

/**
 * The document the card works from — the published one, or {@link UNPUBLISHED_DOCUMENT} with any
 * rule a partial document lacks filled from it, so the card always has five rows to draw.
 *
 * @param document The published document, or `null` when nothing is published.
 * @returns A document carrying every core rule.
 */
export function workingDocument(document: PolicyDocument | null): PolicyDocument {
  return { ...UNPUBLISHED_DOCUMENT, ...(document ?? {}) };
}

/**
 * The card's fields for a document.
 *
 * @param document The document — see {@link workingDocument}.
 * @returns One draft per core rule.
 */
export function draftsOf(document: PolicyDocument): PolicyDrafts {
  const draft = <Id extends CoreRuleId>(id: Id): RuleDraft<TermsOf<Id>> => ({
    enabled: document[id].enabled,
    terms: PARSERS[id](document[id].conditions),
  });

  return {
    auto_merge: draft("auto_merge"),
    human_review: draft("human_review"),
    protected_paths: draft("protected_paths"),
    spend_guard: draft("spend_guard"),
    dry_run_new_repos: draft("dry_run_new_repos"),
  };
}

/* ------------------------------------------------------------------ drafts → document */

/** Each rule's conditions from its terms — the canonical form this editor writes. */
const COMPOSERS: { readonly [Id in CoreRuleId]: (terms: TermsOf<Id>) => PolicyRule["conditions"] } = {
  auto_merge: (terms) => ({
    all: [
      ...(terms.maxEffort === null ? [] : [{ effort_lte: terms.maxEffort }]),
      ...terms.excludedLabels.map((label) => ({ not: { label } })),
    ],
  }),
  human_review: (terms) => ({
    any: [
      ...terms.labels.map((label) => ({ label })),
      ...(terms.minEffort === null ? [] : [{ effort_gte: terms.minEffort }]),
    ],
  }),
  protected_paths: (terms) => ({ path_globs: [...terms.globs] }),
  spend_guard: (terms) => ({
    ...(terms.perRunCents === null ? {} : { per_run_cap_cents: terms.perRunCents }),
    ...(terms.monthlyCents === null ? {} : { monthly_cap_cents: terms.monthlyCents }),
  }),
  dry_run_new_repos: (terms) => ({ first_n_loops: terms.firstLoops }),
};

/**
 * One rule as the document would hold it for a draft.
 *
 * @param id The rule.
 * @param draft Its draft.
 * @param saved The rule as the working document holds it — whose conditions are kept verbatim
 *   when the draft has no terms, or terms equal to the saved rule's own.
 * @returns The rule.
 */
export function composeRule<Id extends CoreRuleId>(
  id: Id,
  draft: PolicyDrafts[Id],
  saved: PolicyRule,
): PolicyRule {
  const terms = draft.terms as TermsOf<Id> | null;
  const savedTerms = PARSERS[id](saved.conditions);

  // Unrepresentable, or untouched: the conditions travel exactly as they were read, so a
  // differently-spelled but equal predicate is never rewritten into a change.
  if (terms === null || sameValue(terms, savedTerms)) {
    return { enabled: draft.enabled, conditions: saved.conditions };
  }

  return { enabled: draft.enabled, conditions: COMPOSERS[id](terms) };
}

/**
 * The document a save would publish: the working document with each core rule recomposed from
 * its draft. `custom:*` rules and untouched rules are carried through unchanged.
 *
 * @param working The document the drafts were made from.
 * @param drafts The card's fields as they stand.
 * @returns The document to preview and publish.
 */
export function composeDocument(working: PolicyDocument, drafts: PolicyDrafts): PolicyDocument {
  const document: Record<string, PolicyRule> = { ...working };

  for (const id of CORE_RULES) {
    document[id] = composeRule(id, drafts[id], working[id]);
  }

  return document;
}

/* ------------------------------------------------------------------ edits that keep invariants */

/**
 * Whether an `auto_merge` or `human_review` term may be removed: a predicate rule keeps at least
 * one, so the last one standing has no remove control at all.
 *
 * @param terms The rule's terms.
 * @returns How many terms it holds.
 */
export function termCount(terms: AutoMergeTerms | HumanReviewTerms): number {
  const labels = "excludedLabels" in terms ? terms.excludedLabels : terms.labels;
  const effort = "excludedLabels" in terms ? terms.maxEffort : terms.minEffort;

  return labels.length + (effort === null ? 0 : 1);
}

/** Why a typed label cannot join a list. */
export type LabelProblem = "empty" | "too_long" | "duplicate" | "full";

/** Each problem, as the sentence the editor shows under the input. */
export const LABEL_PROBLEMS: Readonly<Record<LabelProblem, string>> = {
  empty: "Type a label, like refactor.",
  too_long: `A label is at most ${String(LABEL_MAX_LENGTH)} characters.`,
  duplicate: "That label is already in the list.",
  full: `A rule holds at most ${String(TERMS_MAX)} conditions.`,
};

/**
 * What is wrong with a typed label.
 *
 * @param text The label as typed, already trimmed.
 * @param existing The labels already in the list.
 * @param terms How many terms the rule already holds, for the capacity check.
 * @returns The problem, or `null` when the label may join the list.
 */
export function labelProblem(
  text: string,
  existing: readonly string[],
  terms: number,
): LabelProblem | null {
  if (text === "") return "empty";
  if (text.length > LABEL_MAX_LENGTH) return "too_long";
  if (existing.includes(text)) return "duplicate";
  if (terms >= TERMS_MAX) return "full";

  return null;
}

/**
 * Clamp a typed loop count into the grammar's bounds.
 *
 * @param value Any number.
 * @returns A whole number from `0` to {@link LOOPS_MAX}.
 */
export function clampLoops(value: number): number {
  if (!Number.isFinite(value)) return 0;

  return Math.min(LOOPS_MAX, Math.max(0, Math.trunc(value)));
}

/* ------------------------------------------------------------------ validation */

/** The card's rule names — mockup 17's, verbatim. */
export const RULE_NAMES: Readonly<Record<CoreRuleId, string>> = {
  auto_merge: "Auto-merge when all gates green",
  human_review: "Human review required",
  protected_paths: "Protected paths need allow-once",
  spend_guard: "Spend guard",
  dry_run_new_repos: "Dry-run mode for new repos",
};

/** What each rule is for — mockup 17's, verbatim. */
export const RULE_REASONS: Readonly<Record<CoreRuleId, string>> = {
  auto_merge: "If every check, review gate, and spend guard passes, the PR merges itself.",
  human_review: "Bigger or riskier work always waits for a person before merging.",
  protected_paths:
    "Touching these directories pauses the loop until someone grants a one-time pass.",
  spend_guard: "Runaway loops stop before they get expensive.",
  dry_run_new_repos: "New repos prove themselves before anything merges on its own.",
};

/** What a predicate rule with no term left is told. Unreachable through the controls. */
export const NEEDS_A_CONDITION = "This rule needs at least one condition.";

/** What a spend guard with no cap left is told. Unreachable through the controls. */
export const NEEDS_A_CAP = "A spend guard needs at least one cap.";

/**
 * Check every rule's invariant before anything is sent.
 *
 * The controls already keep each one, so this finds something only if a draft was built some
 * other way — it is the last line, and it costs nothing.
 *
 * @param drafts The card's fields as they stand.
 * @returns An error per rule whose terms the document would refuse; empty when it may be sent.
 */
export function validatePolicy(drafts: PolicyDrafts): Partial<Record<CoreRuleId, string>> {
  const errors: Partial<Record<CoreRuleId, string>> = {};

  for (const id of ["auto_merge", "human_review"] as const) {
    const { terms } = drafts[id];
    if (terms !== null && termCount(terms) === 0) errors[id] = NEEDS_A_CONDITION;
  }

  const spend = drafts.spend_guard.terms;
  if (spend !== null && spend.perRunCents === null && spend.monthlyCents === null) {
    errors.spend_guard = NEEDS_A_CAP;
  }

  return errors;
}

/* ------------------------------------------------------------------ chips */

/**
 * An effort as a chip states it.
 *
 * @param effort The effort.
 * @returns `M`, `XL`.
 */
export function effortLabel(effort: Effort): string {
  return effort.toUpperCase();
}

/**
 * One predicate, as text. A comparison is its chip; a nested composition is written out in
 * parentheses, so a condition this editor cannot change is still one a reader can read.
 *
 * @param predicate The predicate.
 * @returns The text — `effort ≤ M`, `non-refactor`, `label:refactor`, `(label:a OR effort ≥ L)`.
 */
export function predicateText(predicate: unknown): string {
  const entry = onlyEntry(predicate);
  if (entry === null) return JSON.stringify(predicate);

  const [key, value] = entry;

  if (key === "effort_lte" && isEffort(value)) return `effort ≤ ${effortLabel(value)}`;
  if (key === "effort_gte" && isEffort(value)) return `effort ≥ ${effortLabel(value)}`;
  if (key === "label" && typeof value === "string") return `label:${value}`;

  if (key === "not") {
    const inner = onlyEntry(value);

    return inner?.[0] === "label" && typeof inner[1] === "string"
      ? `non-${inner[1]}`
      : `NOT ${predicateText(value)}`;
  }

  if ((key === "all" || key === "any") && Array.isArray(value)) {
    const joined = value.map(predicateText).join(key === "all" ? " AND " : " OR ");

    return value.length === 1 ? joined : `(${joined})`;
  }

  return JSON.stringify(predicate);
}

/**
 * A predicate rule's chips. A top-level `all` reads as mockup 17 draws it — one chip per term,
 * every one of which must hold. A top-level `any` says so on the chip: every term after the
 * first is prefixed `OR`, because two chips side by side would otherwise read as *both*.
 *
 * @param conditions The rule's conditions.
 * @returns The chips.
 */
function predicateChips(conditions: unknown): readonly string[] {
  const entry = onlyEntry(conditions);
  if (entry === null) return [];

  const [key, value] = entry;

  if (key === "all" && Array.isArray(value)) return value.map(predicateText);
  if (key === "any" && Array.isArray(value)) {
    return value.map((term, index) => (index === 0 ? "" : "OR ") + predicateText(term));
  }

  return [predicateText(conditions)];
}

/**
 * The per-run cap, as its chip.
 *
 * @param cents The cap.
 * @returns Mockup 17's `pause loop at $2.50/run`.
 */
export function perRunChip(cents: number): string {
  return `pause loop at ${chipAmount(cents)}/run`;
}

/**
 * The monthly cap, as its chip.
 *
 * @param cents The cap.
 * @returns Mockup 17's `monthly cap $600/provider`.
 */
export function monthlyChip(cents: number): string {
  return `monthly cap ${chipAmount(cents)}/provider`;
}

/**
 * The first-N rule, as its chip.
 *
 * @param loops How many loops.
 * @returns Mockup 17's `first 10 loops open draft PRs` — and for zero, that the rule holds
 *   nothing back, which is what a count of zero means.
 */
export function firstLoopsChip(loops: number): string {
  if (loops === 0) return "no loops held as drafts";

  return loops === 1 ? "first loop opens a draft PR" : `first ${String(loops)} loops open draft PRs`;
}

/**
 * A rule's terms chips, read from its conditions.
 *
 * @param id The rule — a core rule, or a `custom:*` one, whose chips are every term it carries.
 * @param rule The rule as the document holds it.
 * @returns The chips, in the document's order. Empty for a rule with no conditions.
 */
export function ruleChips(id: string, rule: PolicyRule): readonly string[] {
  const { conditions } = rule;

  if (id === "auto_merge" || id === "human_review") return predicateChips(conditions);

  const chips: string[] = [];
  const { path_globs: globs, per_run_cap_cents: perRun, monthly_cap_cents: monthly } = conditions;
  const { first_n_loops: loops, ...predicate } = conditions;

  if (id.startsWith("custom:")) {
    for (const key of ["effort_lte", "effort_gte", "label", "not", "any", "all"]) {
      if (key in predicate) chips.push(predicateText({ [key]: predicate[key] }));
    }
  }

  if (Array.isArray(globs)) {
    chips.push(...globs.filter((glob): glob is string => typeof glob === "string").map(globChip));
  }
  if (typeof perRun === "number") chips.push(perRunChip(perRun));
  if (typeof monthly === "number") chips.push(monthlyChip(monthly));
  if (typeof loops === "number") chips.push(firstLoopsChip(loops));

  return chips;
}

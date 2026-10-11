/**
 * The edge-case issue picker — decision **W8**, as pure functions (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * *"#489 — no CVE, a useful edge case"*: a security workflow is best tested against an issue
 * that does **not** match its assumptions, because that is the ticket that exercises the
 * conditional path nobody otherwise sees. That is computable.
 *
 * ## The dimensions
 *
 * Everything in a draft that tests the *ticket* is one dimension:
 *
 *   * each trigger condition — one per required label, one for `effort_lte`, one for `source`;
 *   * each `labels`, `effort` or `source` predicate on a flow node or a branch edge. (`checks`
 *     and `paths` read what only a run produces, so no ticket can be ranked by them; `always`
 *     tests nothing.)
 *
 * ## The score
 *
 * A candidate's score is **how many dimensions it mismatches** — conditions it does not meet,
 * predicates that come out false for it. The highest score first; ties go to the ticket most
 * recently updated in its tracker, then to the lower key, so the order never depends on how the
 * rows arrived. Every candidate carries the reason for its rank in words, and a ticket that
 * meets everything says so too: it is the one that exercises the main path.
 *
 * Nothing here knows a tracker. The candidates are canonical tickets (#138), reduced to the
 * three facts a predicate can test.
 */

import {
  EffortSchema,
  PREDICATE_SCHEMAS,
  TriggerSchema,
  type Effort,
  type SourceKind,
} from "../workflows/dsl.schema";

/** Every effort, smallest first — a position in this list is a rank. */
const EFFORT_ORDER: readonly Effort[] = EffortSchema.options;

/** One canonical ticket, as the picker reads it. */
export interface PickerTicket {
  /** `tickets.id`. */
  readonly id: string;
  /** The display key — `#489`. */
  readonly key: string;
  readonly title: string;
  /** The ticket in its own tracker. */
  readonly url: string;
  /** The tracker it came from. */
  readonly source: SourceKind;
  /** The tracker's label names. */
  readonly labels: readonly string[];
  /** The effort of the estimate in force, or `null`. */
  readonly effort: Effort | null;
  /** The tracker's last-updated time — the tie-break. */
  readonly updatedAt: Date;
}

/** One thing in the draft that tests the ticket. */
export interface PickerDimension {
  /** Stable within a draft — `trigger.label:security`, `predicate:gate-1`. */
  readonly id: string;
  /** Where it sits: the trigger, or a stage's fork. */
  readonly where: string;
  /**
   * Test a ticket.
   *
   * @param ticket - The candidate.
   * @returns `null` when the ticket meets it, otherwise why it does not, as a clause.
   */
  miss(ticket: PickerTicket): string | null;
}

/** One dimension a candidate mismatches. */
export interface PickerMismatch {
  readonly dimension: string;
  readonly where: string;
  /** Why, as a clause — `no \`security\` label`. */
  readonly detail: string;
}

/** One ranked candidate. */
export interface PickerCandidate {
  /** Position, from 1. */
  readonly rank: number;
  readonly ticket: PickerTicket;
  /** How many dimensions it mismatches. */
  readonly score: number;
  /** How many dimensions the draft has. */
  readonly dimensions: number;
  /** Whether the ticket would trigger the workflow as drafted. */
  readonly matchesTrigger: boolean;
  readonly mismatches: readonly PickerMismatch[];
  /** Why it ranks where it does, as one sentence. */
  readonly reason: string;
}

/**
 * How a ticket compares with an effort under an operator.
 *
 * @param effort - The ticket's effort.
 * @param op - The comparison.
 * @param value - The effort compared against.
 * @returns Whether the comparison holds.
 */
function effortHolds(effort: Effort, op: string, value: Effort): boolean {
  const left = EFFORT_ORDER.indexOf(effort);
  const right = EFFORT_ORDER.indexOf(value);

  switch (op) {
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    case "eq":
      return left === right;
    case "gte":
      return left >= right;
    default:
      return left > right;
  }
}

/** The operator words a mismatch is described with. */
const EFFORT_WORDS: Readonly<Record<string, string>> = {
  lt: "below",
  lte: "at most",
  eq: "exactly",
  gte: "at least",
  gt: "above",
};

/**
 * The trigger's dimensions.
 *
 * @param trigger - The document's `trigger`, unvalidated.
 * @returns One dimension per condition; none when the trigger does not parse.
 */
function triggerDimensions(trigger: unknown): PickerDimension[] {
  const parsed = TriggerSchema.safeParse(trigger);
  if (!parsed.success) return [];

  const { labels, effort_lte: effortLte, source } = parsed.data.conditions;
  const dimensions: PickerDimension[] = [...new Set(labels ?? [])].map((label) => ({
    id: `trigger.label:${label}`,
    where: "trigger",
    miss: (ticket) => (ticket.labels.includes(label) ? null : `no \`${label}\` label`),
  }));

  if (effortLte !== undefined) {
    dimensions.push({
      id: "trigger.effort_lte",
      where: "trigger",
      miss: (ticket) => {
        if (ticket.effort === null) return "not sized";
        return effortHolds(ticket.effort, "lte", effortLte)
          ? null
          : `effort ${ticket.effort.toUpperCase()} is over ${effortLte.toUpperCase()}`;
      },
    });
  }

  if (source !== undefined) {
    dimensions.push({
      id: "trigger.source",
      where: "trigger",
      miss: (ticket) => (ticket.source === source ? null : `from ${ticket.source}, not ${source}`),
    });
  }

  return dimensions;
}

/**
 * The dimension one predicate makes, when it tests the ticket.
 *
 * @param id - The dimension's id.
 * @param where - The stage or edge it sits on.
 * @param predicate - The predicate, unvalidated.
 * @returns The dimension, or `undefined` for a predicate that does not test the ticket.
 */
function predicateDimension(
  id: string,
  where: string,
  predicate: unknown,
): PickerDimension | undefined {
  const labels = PREDICATE_SCHEMAS.labels.safeParse(predicate);
  if (labels.success) {
    const { op, values } = labels.data;
    const listed = values.map((value) => `\`${value}\``).join(", ");

    return {
      id,
      where,
      miss: (ticket) => {
        const carried = values.filter((value) => ticket.labels.includes(value));
        if (op === "all") return carried.length === values.length ? null : `not all of ${listed}`;
        if (op === "any") return carried.length > 0 ? null : `none of ${listed}`;
        return carried.length === 0 ? null : `carries ${listed}`;
      },
    };
  }

  const effort = PREDICATE_SCHEMAS.effort.safeParse(predicate);
  if (effort.success) {
    const { op, value } = effort.data;

    return {
      id,
      where,
      miss: (ticket) => {
        if (ticket.effort === null) return "not sized";
        return effortHolds(ticket.effort, op, value)
          ? null
          : `effort ${ticket.effort.toUpperCase()} is not ${EFFORT_WORDS[op] ?? op} ${value.toUpperCase()}`;
      },
    };
  }

  const source = PREDICATE_SCHEMAS.source.safeParse(predicate);
  if (source.success) {
    const { op, values } = source.data;

    return {
      id,
      where,
      miss: (ticket) =>
        values.includes(ticket.source) === (op === "in") ? null : `from ${ticket.source}`,
    };
  }

  return undefined;
}

/**
 * Read a property of something that may not be an object.
 *
 * @param value - Anything.
 * @param key - The property.
 * @returns The property, or `undefined`.
 */
function prop(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Everything in a draft that tests the ticket.
 *
 * Read leniently — a draft is allowed to be half-built, and a part that does not parse simply
 * contributes no dimension.
 *
 * @param definition - The draft's document, as stored.
 * @returns The dimensions, the trigger's first, then the forks' in document order.
 */
export function pickerDimensions(definition: unknown): PickerDimension[] {
  const dimensions = triggerDimensions(prop(definition, "trigger"));
  const nodes = prop(definition, "nodes");
  const edges = prop(definition, "edges");

  for (const node of Array.isArray(nodes) ? nodes : []) {
    const id = prop(node, "id");
    if (prop(node, "type") !== "flow" || typeof id !== "string") continue;

    const dimension = predicateDimension(
      `predicate:${id}`,
      `stage ${id}`,
      prop(prop(node, "config"), "predicate"),
    );
    if (dimension !== undefined) dimensions.push(dimension);
  }

  for (const edge of Array.isArray(edges) ? edges : []) {
    const from = prop(edge, "from");
    const to = prop(edge, "to");
    if (typeof from !== "string" || typeof to !== "string") continue;

    const dimension = predicateDimension(
      `condition:${from}>${to}`,
      `branch ${from} → ${to}`,
      prop(edge, "condition"),
    );
    if (dimension !== undefined) dimensions.push(dimension);
  }

  return dimensions;
}

/**
 * The sentence a candidate's rank is explained with.
 *
 * @param mismatches - What it mismatches.
 * @param dimensions - How many dimensions the draft has.
 * @param matchesTrigger - Whether it would trigger the workflow.
 * @returns One sentence.
 */
function reasonFor(
  mismatches: readonly PickerMismatch[],
  dimensions: number,
  matchesTrigger: boolean,
): string {
  if (dimensions === 0) {
    return "The draft tests nothing about the ticket — every issue takes the same path.";
  }
  if (mismatches.length === 0) {
    return "Meets every condition — exercises the main path.";
  }

  const details = mismatches.map((mismatch) => `${mismatch.detail} (${mismatch.where})`).join("; ");
  const path = matchesTrigger
    ? "exercises a conditional path"
    : "outside the trigger, so it exercises the path a matching issue would not";

  return `${details} — ${path}.`;
}

/**
 * Rank candidate tickets for a dry run of one draft.
 *
 * @param definition - The draft's document, as stored.
 * @param tickets - The candidates — open, sized canonical tickets.
 * @returns The candidates, the most mismatched first, each with its reason.
 */
export function rankCandidates(
  definition: unknown,
  tickets: readonly PickerTicket[],
): PickerCandidate[] {
  const dimensions = pickerDimensions(definition);

  return tickets
    .map((ticket) => {
      const mismatches: PickerMismatch[] = [];
      for (const dimension of dimensions) {
        const detail = dimension.miss(ticket);
        if (detail !== null) {
          mismatches.push({ dimension: dimension.id, where: dimension.where, detail });
        }
      }

      return { ticket, mismatches };
    })
    .sort(
      (a, b) =>
        b.mismatches.length - a.mismatches.length ||
        b.ticket.updatedAt.getTime() - a.ticket.updatedAt.getTime() ||
        (a.ticket.key < b.ticket.key ? -1 : a.ticket.key > b.ticket.key ? 1 : 0),
    )
    .map(({ ticket, mismatches }, index) => {
      const matchesTrigger = !mismatches.some((mismatch) => mismatch.where === "trigger");

      return {
        rank: index + 1,
        ticket,
        score: mismatches.length,
        dimensions: dimensions.length,
        matchesTrigger,
        mismatches,
        reason: reasonFor(mismatches, dimensions.length, matchesTrigger),
      };
    });
}

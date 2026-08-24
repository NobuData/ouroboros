/**
 * The pure half of the alias lifecycle
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)): what a write changes, what to
 * call it, and what to name a copy.
 *
 * Three questions the service asks before it opens a transaction, answered here without one:
 *
 *   * **What moved?** {@link aliasDiff} compares the row before and after as
 *     {@link AliasState}s and answers V025's diff — one `{from, to}` per column that changed,
 *     or `null` when nothing did. Null is what makes a no-op `PATCH` write nothing and record
 *     nothing: V025 refuses an empty diff, and a revision saying *somebody pressed Save and
 *     nothing moved* is one nobody reads to the end (V021's argument).
 *   * **What was it?** {@link revisionAction} ranks the things one write can be. A `PATCH` may
 *     rename, rebind and edit in one request and still leaves one revision; the action names
 *     the most consequential change, in the order a reader of the History tab wants to be told.
 *   * **What is the copy called?** {@link copyName} is `<alias>-copy`, then `-copy-2`, `-copy-3`
 *     … — the ticket's *uniqueness-suffixed* — against the names the workspace already has.
 *
 * All of it is deterministic and reads no clock, no database and no workspace, which is what
 * lets `aliases.changes.spec.ts` assert every branch with a literal.
 */

import type { AliasRevisionAction, AliasRevisionDiff } from "../db/schema";
import type { AliasRow } from "./aliases.rows";

/**
 * A `model_aliases` row's editable columns, in the service's spelling.
 *
 * The shape both the *before* (read from the row) and the *after* (composed from the row and
 * the body) take, so the diff is a comparison of two of the same thing.
 */
export interface AliasState {
  /** `model_aliases.alias`. */
  readonly alias: string;
  /** `model_aliases.provider_connection_id`, or null for an unbound alias. */
  readonly connectionId: string | null;
  /** `model_aliases.model_id`. */
  readonly modelId: string;
  /** `model_aliases.enabled`. */
  readonly enabled: boolean;
  /** `model_aliases.params`. */
  readonly params: Readonly<Record<string, unknown>>;
  /** `model_aliases.restrictions`. */
  readonly restrictions: Readonly<Record<string, unknown>>;
  /** `model_aliases.notes`. */
  readonly notes: string | null;
}

/**
 * The column each field of {@link AliasState} is stored in — the keys V025's diff uses.
 *
 * Column names rather than the service's camelCase, because the diff is read by CJ.2's
 * promotion into `audit_events` and by a person reading the table, both of which know the
 * schema and neither of which knows this service's spellings.
 */
export const ALIAS_COLUMNS: Readonly<Record<keyof AliasState, string>> = Object.freeze({
  alias: "alias",
  connectionId: "provider_connection_id",
  modelId: "model_id",
  enabled: "enabled",
  params: "params",
  restrictions: "restrictions",
  notes: "notes",
});

/** The key a duplicate's diff records its source under. Not a column — see V025. */
export const DUPLICATE_OF_KEY = "duplicate_of";

/** What a duplicate's name is suffixed with. */
export const COPY_SUFFIX = "-copy";

/**
 * A row's editable columns, as a state.
 *
 * @param row - The row, as the repository selects it.
 * @returns Its state.
 */
export function stateOf(row: AliasRow): AliasState {
  return {
    alias: row.alias,
    connectionId: row.provider_connection_id,
    modelId: row.model_id,
    enabled: row.enabled,
    params: row.params,
    restrictions: row.restrictions,
    notes: row.notes,
  };
}

/**
 * Whether two jsonb documents are the same document.
 *
 * Key order is not part of a jsonb value — PostgreSQL stores objects with keys sorted — so a
 * comparison that saw `{a, b}` and `{b, a}` as different would record a revision for a save
 * that changed nothing. Canonicalised by sorting keys at every depth before comparing.
 *
 * @param left - One document.
 * @param right - The other.
 * @returns Whether they are equal as jsonb would judge it.
 */
export function sameDocument(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

/**
 * The columns that differ between two states, as V025's diff.
 *
 * @param before - The row's state before the write, or `null` for a create.
 * @param after - The row's state after it, or `null` for a delete.
 * @returns One `{from, to}` per column that changed, keyed by column name; every column when
 *   either side is null; `null` when nothing changed.
 * @throws {RangeError} When both sides are null — there is no such write.
 */
export function aliasDiff(
  before: AliasState | null,
  after: AliasState | null,
): AliasRevisionDiff | null {
  if (before === null && after === null) {
    throw new RangeError("aliasDiff needs a state on at least one side");
  }

  const diff: AliasRevisionDiff = {};

  for (const field of Object.keys(ALIAS_COLUMNS) as (keyof AliasState)[]) {
    const from = before === null ? null : before[field];
    const to = after === null ? null : after[field];

    if (before !== null && after !== null && sameDocument(from, to)) {
      continue;
    }

    diff[ALIAS_COLUMNS[field]] = { from, to };
  }

  return Object.keys(diff).length === 0 ? null : diff;
}

/**
 * Whether a write changed where the alias resolves — its connection or its model.
 *
 * @param before - The state before.
 * @param after - The state after.
 * @returns Whether the binding moved.
 */
export function bindingChanged(before: AliasState, after: AliasState): boolean {
  return before.connectionId !== after.connectionId || before.modelId !== after.modelId;
}

/**
 * What to call one write, given what it changed.
 *
 * Ranked, because a `PATCH` may do several of these at once and V025 records one action per
 * write: a rename is the most consequential thing that can happen to a name, a rebind the
 * most consequential thing that can happen to what it means, the switch next, and everything
 * else is an edit. The diff carries whatever the ranking left out.
 *
 * @param before - The state before.
 * @param after - The state after. Assumed to differ somewhere — call {@link aliasDiff} first.
 * @returns The action.
 */
export function revisionAction(before: AliasState, after: AliasState): AliasRevisionAction {
  if (before.alias !== after.alias) {
    return "renamed";
  }

  if (bindingChanged(before, after)) {
    return "rebound";
  }

  if (before.enabled !== after.enabled) {
    return after.enabled ? "enabled" : "disabled";
  }

  return "edited";
}

/**
 * The name a duplicate gets: `<alias>-copy`, or the first `<alias>-copy-N` (from 2) that is
 * free.
 *
 * `-copy-2` rather than `-copy-1`, because the plain `-copy` *is* the first copy and a second
 * one numbered `1` would read as though it came before it. Length is the caller's to check —
 * this answers the name the rule gives, and the service refuses one V015 would not store.
 *
 * @param alias - The alias being duplicated.
 * @param taken - Every name in the workspace that starts with `<alias>-copy`.
 * @returns The name.
 */
export function copyName(alias: string, taken: ReadonlySet<string>): string {
  const base = `${alias}${COPY_SUFFIX}`;

  if (!taken.has(base)) {
    return base;
  }

  for (let ordinal = 2; ; ordinal += 1) {
    const candidate = `${base}-${ordinal.toString()}`;

    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * A value as a canonical string — keys sorted at every depth, so two documents that jsonb
 * would call equal serialise identically.
 *
 * @param value - Any JSON value.
 * @returns Its canonical text.
 */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * A JSON value with every object's keys sorted, recursively.
 *
 * @param value - Any JSON value.
 * @returns The same value with sorted keys; arrays keep their order, which *is* part of a
 *   jsonb array's identity.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }

    return sorted;
  }

  return value;
}

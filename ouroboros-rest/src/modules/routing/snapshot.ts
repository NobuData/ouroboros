/**
 * The resolution snapshot contract — what an executor persists about a resolution it acted on.
 *
 * CH.6 ([#589](https://github.com/NobuData/ouroboros/issues/589)), decision **R9**. Mockup 21's
 * chain card promises that *every hop is inspectable in the run console transcript*, and a promise
 * about inspection is a promise about **stored truth**: a card that re-ran `resolve()` whenever it
 * rendered would print today's health beside last week's run number. V024 landed the table and
 * the grammar its CHECKs hold a document to; this file is that grammar's writer, so the executor
 * that acts on a resolution (AF.2, [#235](https://github.com/NobuData/ouroboros/issues/235); the
 * workflow bridge, [#160](https://github.com/NobuData/ouroboros/issues/160)) has one function to
 * call rather than a column list to rediscover.
 *
 * ---------------------------------------------------------------------------
 * **The document is V024's spelling, not `resolution.ts`'s.** A snapshot is read by a person
 * reconstructing a decision long after the alias was repointed, so it carries **names** — the
 * alias, the route tag, the task kind, the provider's kind and display name — and never an id; and
 * it is a stored document, so its keys are the database's snake_case. The mapping from the
 * resolution's camelCase happens once, here.
 *
 * **Two facts arrive from outside the resolution, because only execution has them.** The masked
 * key suffix of the credential a hop was invoked with, and how long each tried hop took. Both are
 * optional per hop and both are refused here in exactly the shapes V024 refuses them — a suffix
 * that is not one to sixteen alphanumerics (which is what a whole key would look like), or a
 * timing on a hop that was dropped and so never tried — so a writer learns of the mistake from a
 * `RangeError` naming the hop rather than from a constraint violation at the insert.
 *
 * **The version is a promise about this file.** {@link RESOLUTION_SNAPSHOT_SHAPE_VERSION} follows
 * `resolution.ts`'s rule for `r1`: adding a hop code, a rule code or an optional key is not a
 * bump; renaming, removing or changing the meaning of a field is, and needs a migration that
 * widens V024's `resolution_snapshots_shape_version_known` together with its validators.
 *
 * Pure: no clock, no pool. The run id and `resolved_at` are the writer's to supply at insert.
 */

import type {
  ResolutionSnapshotHopDocument,
  ResolutionSnapshotProviderDocument,
  ResolutionSnapshotRuleDocument,
} from "../db/schema";
import type { Resolution, ResolutionHop, ResolutionOutcome } from "./resolution";

/** The shape version this module writes and `GET /registry/resolutions/latest` reads. */
export const RESOLUTION_SNAPSHOT_SHAPE_VERSION = 1;

/** The shape of a masked key suffix — V024's CHECK, restated so a writer is refused here first. */
export const KEY_SUFFIX_PATTERN = /^[A-Za-z0-9]{1,16}$/;

/** What execution measured about one hop, by the hop's resolved index. */
export interface HopMeasurement {
  /**
   * The masked tail of the credential the hop was invoked with — `Xq4A`. Never the key: at most
   * sixteen alphanumerics, which no credential fits. Omit, or null, where none was involved.
   */
  readonly keySuffix?: string | null;
  /** How long the hop took, in whole milliseconds. Only a kept hop is tried, so only one has one. */
  readonly durationMs?: number | null;
}

/** What execution measured about the whole resolution. */
export interface SnapshotMeasurements {
  /** How long the resolution took, in whole ms, or null when nobody timed it — never 0 instead. */
  readonly durationMs: number | null;
  /** Per-hop measurements, keyed by {@link ResolutionHop.index}. Hops not named measured nothing. */
  readonly hops?: ReadonlyMap<number, HopMeasurement>;
}

/** The columns of one `resolution_snapshots` row this contract decides. */
export interface ResolutionSnapshotDocument {
  /** Always {@link RESOLUTION_SNAPSHOT_SHAPE_VERSION}. */
  readonly shape_version: typeof RESOLUTION_SNAPSHOT_SHAPE_VERSION;
  /** The kind resolved for. */
  readonly task_kind: string;
  /** The route that answered. */
  readonly route_tag: string;
  /** The resolution's outcome — V024 holds it to the chain. */
  readonly outcome: ResolutionOutcome;
  /** The whole resolution's duration, or null. */
  readonly duration_ms: number | null;
  /** Every hop, dropped ones included, in resolved order. */
  readonly chain: readonly ResolutionSnapshotHopDocument[];
  /** Every matched rule, applied or not. */
  readonly rules: readonly ResolutionSnapshotRuleDocument[];
}

/**
 * A duration, held to V024's rule: a whole number of milliseconds, never negative.
 *
 * @param what - What the number measures, for the error.
 * @param value - The duration, or null.
 * @returns The duration, unchanged.
 * @throws {RangeError} When it is not a non-negative integer.
 */
function duration(what: string, value: number | null): number | null {
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new RangeError(`${what} must be a whole, non-negative number of milliseconds`);
  }

  return value;
}

/**
 * One hop's provider, in the stored spelling.
 *
 * @param hop - The resolved hop.
 * @param keySuffix - The masked suffix execution used, or null.
 * @returns The provider document, or null for an unbound alias.
 * @throws {RangeError} When the suffix is not a suffix, or is given for an unbound hop.
 */
function providerOf(
  hop: ResolutionHop,
  keySuffix: string | null,
): ResolutionSnapshotProviderDocument | null {
  if (keySuffix !== null && !KEY_SUFFIX_PATTERN.test(keySuffix)) {
    throw new RangeError(
      `hop ${hop.index.toString()}'s key suffix must be 1-16 letters and digits — a masked tail, never a key`,
    );
  }

  if (hop.provider === null) {
    if (keySuffix !== null) {
      throw new RangeError(`hop ${hop.index.toString()} is unbound and cannot carry a key suffix`);
    }

    return null;
  }

  return {
    kind: hop.provider.kind,
    display_name: hop.provider.displayName,
    key_suffix: keySuffix,
    status: hop.provider.status,
    latency_ms: hop.provider.latencyMs,
    detail: hop.provider.detail,
  };
}

/**
 * The snapshot a resolution, once acted on, is stored as.
 *
 * @param resolution - What `resolve()` answered and the executor acted on.
 * @param measured - What execution measured: the whole duration, and per hop the key suffix and
 *   the time taken.
 * @returns The document's columns, ready for an insert beside the run id.
 * @throws {RangeError} When a measurement breaks V024's rules — a suffix that is not a masked
 *   tail, a suffix on an unbound hop, a timing on a dropped hop, a negative or fractional
 *   duration, or a measurement for a hop the chain does not have.
 */
export function snapshotOf(
  resolution: Resolution,
  measured: SnapshotMeasurements,
): ResolutionSnapshotDocument {
  const hops = measured.hops ?? new Map<number, HopMeasurement>();

  for (const index of hops.keys()) {
    if (!resolution.chain.some((hop) => hop.index === index)) {
      throw new RangeError(`there is no hop ${index.toString()} in this resolution's chain`);
    }
  }

  const chain = resolution.chain.map((hop): ResolutionSnapshotHopDocument => {
    const measurement = hops.get(hop.index) ?? {};
    const hopDuration = duration(
      `hop ${hop.index.toString()}'s duration`,
      measurement.durationMs ?? null,
    );

    if (hopDuration !== null && hop.decision !== "kept") {
      throw new RangeError(
        `hop ${hop.index.toString()} was dropped, so it was never tried or timed`,
      );
    }

    return {
      index: hop.index,
      position: hop.position,
      alias: hop.alias,
      model_id: hop.modelId,
      params: hop.params,
      provider: providerOf(hop, measurement.keySuffix ?? null),
      note: hop.note,
      decision: hop.decision,
      code: hop.code,
      explanation: hop.explanation,
      duration_ms: hopDuration,
    };
  });

  return {
    shape_version: RESOLUTION_SNAPSHOT_SHAPE_VERSION,
    task_kind: resolution.taskKind,
    route_tag: resolution.routeTag,
    outcome: resolution.outcome,
    duration_ms: duration("the resolution's duration", measured.durationMs),
    chain,
    rules: resolution.rules.map((rule) => ({
      id: rule.id,
      sort_order: rule.sortOrder,
      display: rule.display,
      applied: rule.applied,
      code: rule.code,
      explanation: rule.explanation,
    })),
  };
}

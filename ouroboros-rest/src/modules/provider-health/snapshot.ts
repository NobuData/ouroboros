/**
 * What a check measured, as the column stores it and as everything downstream reads it.
 *
 * Two shapes live here and the file is the boundary between them: `health` is a jsonb column
 * written in the database's vocabulary (snake_case, exactly the keys V015's CHECKs are
 * written against), and {@link ProviderHealthSnapshot} is the pure value Z.1
 * ([#194](https://github.com/NobuData/ouroboros/issues/194)) resolves against and AA.1
 * ([#200](https://github.com/NobuData/ouroboros/issues/200)) renders. `resolution.ts` keeps
 * the same seam for the same reason: a mapper whose input type lives somewhere else is a
 * mapper that can drift from what it maps.
 *
 * ---------------------------------------------------------------------------
 * **Absence is the default, and every optional field here means the same thing.**
 *
 * `latency_ms` is present only when a check *measured* one. There is no default, no zero and
 * no interpolation — decision **M8**, and V015 says the same thing from the other side by
 * constraining the key to a non-negative number when it is there and by refusing any content
 * at all without a `last_checked_at`. On a strip somebody reads reliability from, `0ms` is
 * not "we do not know", it is an excellent latency; the whole point of this module is not to
 * say that.
 *
 * The same rule covers `models`: a count is the length of a list a provider actually
 * returned. A reachability check whose body could not be parsed is still a *reachable*
 * provider, and it reports no count rather than reporting zero — an Ollama daemon serving
 * nothing and an Ollama daemon whose answer we could not read are different facts.
 *
 * ---------------------------------------------------------------------------
 * **The shape accommodates AB.2 without a migration, and that is enforced by the writer
 * rather than promised by a comment.**
 *
 * AB.2 ([#208](https://github.com/NobuData/ouroboros/issues/208)) derives error rates and p95
 * windows from real invocation traffic and has to put them somewhere. {@link TRAFFIC_KEY} is
 * that somewhere: a reserved sub-object beside the probe's own keys, inside the same jsonb,
 * needing no `alter table` because jsonb has no columns to add. What makes it real today is
 * {@link mergeHealth} — this service **replaces only the keys it owns** and copies everything
 * else through untouched, so a `traffic` block written by AB.2 survives every subsequent
 * probe rather than being flattened by the next sweep sixty seconds later. A writer that did
 * `set health = <probe result>` would make the reserved key a lie the first time both
 * services ran together, and `snapshot.spec.ts` is what keeps that from being discovered by
 * AB.2's author.
 */

import type { ProviderConnectionKind, ProviderConnectionStatus } from "../db/schema";
import type { ProviderCheckKind } from "./checks";

/**
 * The keys inside `health` that this service owns and rewrites on every check.
 *
 * Everything not named here is somebody else's and is preserved — see {@link mergeHealth}.
 * A list rather than a `delete` of known-foreign keys, because the set this service owns is
 * knowable and the set it does not is, by construction, not.
 */
export const PROBE_KEYS = ["check", "latency_ms", "models", "detail"] as const;

/**
 * The sub-object AB.2's traffic-derived fields land in.
 *
 * Reserved rather than used: nothing in this module writes it, and the one guarantee made
 * about it today is that nothing in this module destroys it either.
 */
export const TRAFFIC_KEY = "traffic";

/**
 * What one performed check has to say, in the column's own vocabulary.
 *
 * Every field but `check` is optional and every one of them is omitted rather than nulled
 * when there is nothing to report: V015 constrains `health -> 'latency_ms'` to be a number
 * *or absent*, so a JSON `null` would be a constraint violation dressed up as honesty.
 */
export interface ProbeHealth {
  /** Which question the check answered. Always present — a measurement with no method is not one. */
  readonly check: ProviderCheckKind;
  /** Milliseconds the check took, when one was measured. Non-negative, per V015. */
  readonly latency_ms?: number;
  /** How many models the provider listed, when the check enumerates them. */
  readonly models?: number;
  /** Why a check failed, in a phrase — `unreachable (ECONNREFUSED)`, `key rejected (401)`. */
  readonly detail?: string;
}

/**
 * `health`, read back — the same facts with the service's names and an explicit absence.
 *
 * Nulls here where {@link ProbeHealth} omits, because this is the read side: a consumer
 * asking *what is the latency* wants an answer, and `null` is one. The asymmetry is
 * deliberate and is the same one `resolution.ts` draws between a row and a resolution.
 */
export interface MeasuredHealth {
  /** Which question produced this state, or null when the column holds nothing this service wrote. */
  readonly check: ProviderCheckKind | null;
  /** The measured latency, or null. Never a default — see this file's header. */
  readonly latencyMs: number | null;
  /** The model count, or null. */
  readonly models: number | null;
  /** The phrase explaining a state, or null. */
  readonly detail: string | null;
}

/**
 * One provider connection with whatever is known about its health — the pure input Z.1
 * resolves against and the strip renders.
 *
 * It carries no credential and has nowhere to put one, for the reason `resolution.ts` argues
 * at length: a consumer choosing between hops needs to know a provider is usable, and needs
 * nothing at all to authenticate as it.
 */
export interface ProviderHealthSnapshot {
  /** The connection's id — how mockup 07's surfaces and a route hop's resolution address it. */
  readonly connectionId: string;
  /** Which adapter reaches it. */
  readonly kind: ProviderConnectionKind;
  /** What the strip prints as the chip's name — `Anthropic`, `Ollama`. */
  readonly displayName: string;
  /** Where it is, or null for a kind reached at its vendor's own endpoint. */
  readonly baseUrl: string | null;
  /** Whether it is usable, as far as anything knows. `unknown` until something checked. */
  readonly status: ProviderConnectionStatus;
  /** When the last check finished, or null when none has. */
  readonly checkedAt: Date | null;
  /** What that check measured. */
  readonly measured: MeasuredHealth;
}

/**
 * One row of the health read, exactly as the repository selects it.
 *
 * The database's column names, per `db/schema.ts`'s rule for anything mirroring a row.
 */
export interface ProviderHealthRow {
  id: string;
  kind: ProviderConnectionKind;
  display_name: string;
  base_url: string | null;
  status: ProviderConnectionStatus;
  last_checked_at: Date | null;
  health: Record<string, unknown>;
}

/**
 * A number from jsonb, if it really is one.
 *
 * `typeof` rather than `Number(...)`: the column is jsonb and a string that parses is a value
 * something wrote in the wrong shape, not a latency. Reading it as one would let a bad writer
 * put `"42"` on a chip that promises to show only measurements.
 *
 * @param value - Whatever the key held.
 * @returns The number, or null when the key was absent, null, or not a finite number.
 */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A non-empty string from jsonb, if it really is one.
 *
 * Empty is treated as absent: a `detail` of `""` renders as a chip with a separator and
 * nothing after it, which reads as a bug in the page rather than as an empty explanation.
 *
 * @param value - Whatever the key held.
 * @returns The string, or null.
 */
function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read a `health` column into the facts this service publishes.
 *
 * Tolerant by design. The column is jsonb, V015 constrains only its outermost shape and its
 * `latency_ms`, and three other things may legitimately have written it: Y.4's seeds, mockup
 * 07's management UI, and eventually AB.2. So this reads the keys it understands, ignores
 * everything else, and never fails — a row carrying something unexpected renders as a
 * provider with less known about it, which is exactly what it is.
 *
 * @param health - The column's value.
 * @returns The measured facts, each null when the column does not carry it.
 */
export function readHealth(health: Record<string, unknown>): MeasuredHealth {
  const check = textOrNull(health.check);

  return {
    check: check === "reachability" || check === "key_validation" ? check : null,
    latencyMs: numberOrNull(health.latency_ms),
    models: numberOrNull(health.models),
    detail: textOrNull(health.detail),
  };
}

/**
 * The `health` value to store, given what the column already held and what a check just found.
 *
 * **Everything this service does not own is copied through.** See this file's header: the
 * reserved {@link TRAFFIC_KEY} is only reserved if the writer respects it, and the writer is
 * this function. The probe's own keys are cleared first and then set from `probe`, so a check
 * that measured no latency this time removes the one from last time rather than leaving a
 * stale number beside a fresh `last_checked_at` — a measurement that is not current is worse
 * than no measurement, because the timestamp beside it vouches for it.
 *
 * @param existing - The column's current value. `{}` for a connection nothing has checked.
 * @param probe - What the check found.
 * @returns The value to write. Always a non-empty object, so the caller must also stamp
 *   `last_checked_at` — which V015's `provider_connections_health_measured` insists on.
 */
export function mergeHealth(
  existing: Record<string, unknown>,
  probe: ProbeHealth,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };

  for (const key of PROBE_KEYS) {
    delete merged[key];
  }

  // Spread rather than assigned key by key: `ProbeHealth` omits what it has nothing to say
  // about, and a spread carries exactly the present keys — so "absent means not measured"
  // survives the crossing into jsonb without a second list of which fields are optional.
  return { ...merged, ...probe };
}

/**
 * One row as the snapshot everything downstream reads.
 *
 * @param row - The row, as the repository selected it.
 * @returns The snapshot.
 */
export function toSnapshot(row: ProviderHealthRow): ProviderHealthSnapshot {
  return {
    connectionId: row.id,
    kind: row.kind,
    displayName: row.display_name,
    baseUrl: row.base_url,
    status: row.status,
    checkedAt: row.last_checked_at,
    measured: readHealth(row.health),
  };
}

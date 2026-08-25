/**
 * Mockup 21's `Health` column — **derived, never probed**.
 *
 * CH.5 ([#588](https://github.com/NobuData/ouroboros/issues/588)), decision **R8**. One pure
 * function from facts the system already holds to the cell the table draws, and the reason it
 * is a pure function is the whole of that decision:
 *
 * > *"The obvious implementation of a Health column is a probe per alias. That would spend
 * > tokens against every provider on every page load to learn something the system already
 * > knows."*
 *
 * Three of the five answers below could not come from a probe at all. `no_key` is a *binding*
 * fact — there is nothing to probe, which is exactly what the orphan row says. `provider_disabled`
 * is an operator's intent. `model_missing` is a comparison against AC.6's
 * ([#221](https://github.com/NobuData/ouroboros/issues/221)) catalog. The remaining two are
 * Z.3's ([#196](https://github.com/NobuData/ouroboros/issues/196)) already-measured provider
 * health, read rather than re-measured — the sweep runs on its own cadence and this reads what
 * it last wrote, which is the same discipline `provider-health/provider-health.service.ts`
 * documents for Z.1's resolution inputs.
 *
 * ---------------------------------------------------------------------------
 * **The order is the ticket's, and each step answers a different question.**
 *
 * ```
 * unbound?                     ─▶ no_key            "no key — connect a provider"  [+ fix]
 * connection switched off?     ─▶ provider_disabled "<name> is switched off"       [+ fix]
 * connection paused?           ─▶ provider_disabled "<name> is paused"             [+ fix]
 * last check failed?           ─▶ degraded          the check's own note
 * nothing has checked it?      ─▶ unknown           "nothing has checked <name> yet"
 * model gone from discovery?   ─▶ model_missing     "<model> is no longer listed on <name>"
 * otherwise                    ─▶ ok
 * ```
 *
 * The order matters where two things are wrong at once, and the rule is *the nearest cause
 * first*: an alias on a failing provider reads `degraded` whether or not its model is still in
 * that provider's catalog, because a catalog read from a provider that is not answering says
 * nothing. Only a provider that is `active` gets its discovery membership checked.
 *
 * ---------------------------------------------------------------------------
 * **`error` is published as `degraded`, and that is the mockup's word for V015's state.**
 *
 * V015 defines `error` as *the last check failed, and `health` says how*. Mockup 21 draws the
 * seeded Copilot row — a connection AC.6 seeds in `error` with `elevated latency` — as
 * `⚠ degraded`, and mockup 06's strip draws the same row amber. So the alias-level word for
 * *this alias's provider is not answering* is `degraded`, and the note beside it is the
 * check's own detail rather than a sentence invented here. Nothing stores the word; this
 * derives it, which is what the roadmap's seed section says it must
 * (`docs/ROADMAP_MOCKUP_21_MODEL_REGISTRY.md`, CG.4's *Health* paragraph).
 *
 * This is a claim about **an alias**, not about a provider. `provider-health/resources.ts`
 * publishes `provider_connections.status` verbatim and refuses to rename it, because a chip on
 * the health strip is a statement about a connection. The registry's cell answers a different
 * question — *can this name be routed through right now, and if not, why* — and the two
 * vocabularies are deliberately different sizes: four statuses in, six alias states out.
 *
 * ---------------------------------------------------------------------------
 * **`unknown` is a state and is never `ok`** — decision **M8**, inherited from Z.3 unchanged.
 * A connection nothing has checked has not been found healthy; it has not been looked at. The
 * dot for it is the strip's ring rather than a green disc, and the word is served so hue is
 * never the only signal.
 *
 * **A connection discovery has never visited never reads `model_missing`.** The difference
 * between *the catalog lists other models and not this one* and *there is no catalog* is
 * V017's, and `AliasesRepository.discovery` already answers both halves. Flagging every alias
 * on a connection discovery has not reached would be a warning about this deployment's sweep
 * dressed up as a warning about somebody's registry.
 */

import type { ProviderConnectionStatus } from "../db/schema";
import { PROVIDERS_FIX_PATH } from "../registry/aliases.errors";

/**
 * The six answers the cell can carry.
 *
 * Codes rather than sentences, for `aliases.resources.ts`'s reason: the sentence is for a
 * person and the code is what a client branches on. The dot's colour is deliberately **not**
 * here — `provider-health/resources.ts` argues why a severity invented in a payload becomes a
 * fifth vocabulary for the same fact, and mapping six states to CSS classes is CI.2's
 * ([#592](https://github.com/NobuData/ouroboros/issues/592)) work in the surface that owns the
 * classes.
 */
export const ALIAS_HEALTH_STATES = {
  /** Bound, enabled, checked, and its model is still listed. The mockup's `● ok`. */
  ok: "ok",
  /** The provider's last check failed. The mockup's `⚠ degraded`, with the check's note. */
  degraded: "degraded",
  /** The bound model is no longer in AC.6's catalog for the connection. */
  modelMissing: "model_missing",
  /** Nothing has checked the provider yet. Never drawn as healthy — decision **M8**. */
  unknown: "unknown",
  /** The connection is switched off or paused: an operator's intent, not a measurement. */
  providerDisabled: "provider_disabled",
  /** The alias has no connection at all. The mockup's `✗ no key — connect a provider`. */
  noKey: "no_key",
} as const;

/** One of {@link ALIAS_HEALTH_STATES}. */
export type AliasHealthState = (typeof ALIAS_HEALTH_STATES)[keyof typeof ALIAS_HEALTH_STATES];

/**
 * The note the orphan row carries, verbatim from mockup 21.
 *
 * Exported because two surfaces assert on it — this module's suite and the registry parity
 * fixture — and a sentence written twice is a sentence that drifts.
 */
export const NO_KEY_NOTE = "no key — connect a provider";

/**
 * What the derivation needs to know about the connection an alias is bound to.
 *
 * Deliberately not `ProviderHealthSnapshot`: that shape is Z.3's and carries a base URL, a
 * check kind and a latency this decision does not read, and it does **not** carry `enabled`,
 * which is AD.2's lifecycle column rather than a health measurement. What is here is the four
 * facts the cell turns on, so a reader can see there is no fifth.
 */
export interface AliasHealthConnection {
  /** What mockup 07's card calls it — the name every note below names. */
  readonly displayName: string;
  /** `provider_connections.enabled` — the card's switch. False is an operator's decision. */
  readonly enabled: boolean;
  /** What Z.3's last sweep concluded, or `unknown` when none has run. */
  readonly status: ProviderConnectionStatus;
  /** The `health.detail` Z.3 recorded — `elevated latency` — or null when it recorded none. */
  readonly detail: string | null;
  /** When that check finished, or null when none has. */
  readonly checkedAt: Date | null;
}

/** Everything one alias's health cell is derived from. */
export interface AliasHealthInput {
  /** The model the alias names, for the `model_missing` note. */
  readonly modelId: string;
  /** Where it is bound, or null for the unbound row. */
  readonly connection: AliasHealthConnection | null;
  /** Whether AC.6's catalog lists this model on this connection. */
  readonly discovered: boolean;
  /** Whether that catalog lists *anything* on this connection — a gap and a mismatch differ. */
  readonly catalogued: boolean;
}

/** The cell, decided. */
export interface AliasHealth {
  /** Which of the six. Stable; what a client branches on. */
  readonly state: AliasHealthState;
  /** The line under the dot, or null for `ok` — where there is nothing to explain. */
  readonly note: string | null;
  /** Where a person goes to resolve it — mockup 21's *Fix in Providers →* — or null. */
  readonly fix: string | null;
  /** When the provider was last checked, or null. Z.3's stamp, carried rather than re-read. */
  readonly checkedAt: Date | null;
}

/**
 * The health of one alias, composed from what is already known about it.
 *
 * Pure and total: same facts in, same cell out, and every combination of the inputs reaches
 * exactly one of the six states. Nothing here reads a clock, a network or a workspace.
 *
 * @param input - The binding, the provider's last known state, and discovery's verdict.
 * @returns The state, the note beside it, the fix pointer when there is somewhere to go, and
 *   when the provider was last checked.
 */
export function aliasHealth(input: AliasHealthInput): AliasHealth {
  const connection = input.connection;

  // A fact, not a network question — and the one answer a probe could never produce, because
  // there is nothing to probe.
  if (connection === null) {
    return {
      state: ALIAS_HEALTH_STATES.noKey,
      note: NO_KEY_NOTE,
      fix: PROVIDERS_FIX_PATH,
      checkedAt: null,
    };
  }

  const checkedAt = connection.checkedAt;

  if (!connection.enabled) {
    return {
      state: ALIAS_HEALTH_STATES.providerDisabled,
      note: `${connection.displayName} is switched off`,
      fix: PROVIDERS_FIX_PATH,
      checkedAt,
    };
  }

  switch (connection.status) {
    case "paused":
      // Intent rather than a measurement, which is why it reads with the switched-off row
      // rather than with the failing one: nothing is wrong with the provider.
      return {
        state: ALIAS_HEALTH_STATES.providerDisabled,
        note: `${connection.displayName} is paused`,
        fix: PROVIDERS_FIX_PATH,
        checkedAt,
      };
    case "error":
      // The mockup's `⚠ degraded`. The note is the check's own — `elevated latency` — and the
      // fallback names the connection rather than inventing a reason nobody measured.
      return {
        state: ALIAS_HEALTH_STATES.degraded,
        note: connection.detail ?? `the last check of ${connection.displayName} failed`,
        fix: null,
        checkedAt,
      };
    case "unknown":
      return {
        state: ALIAS_HEALTH_STATES.unknown,
        note: `nothing has checked ${connection.displayName} yet`,
        fix: null,
        checkedAt,
      };
    case "active":
      break;
  }

  // Asked only of a provider that answered: a catalog read from one that did not is not
  // evidence that a model went away. `catalogued` is what keeps a connection discovery has
  // never visited out of this branch — see this file's header.
  if (input.catalogued && !input.discovered) {
    return {
      state: ALIAS_HEALTH_STATES.modelMissing,
      note: `${input.modelId} is no longer listed on ${connection.displayName}`,
      fix: null,
      checkedAt,
    };
  }

  return { state: ALIAS_HEALTH_STATES.ok, note: null, fix: null, checkedAt };
}

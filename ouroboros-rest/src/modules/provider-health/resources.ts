/**
 * Snapshot → resource, for the health strip — the same seam `pricing/resources.ts` keeps, and
 * for the same two reasons.
 *
 * The snapshots are the service's (camelCase, `Date`s, `null` for absence); the resources are
 * the contract's (ISO 8601, and exactly what `openapi.yaml` promises). Two decisions are made
 * here rather than at every future call site:
 *
 * **1. Absence is `null` everywhere, and it never becomes a number.** `latencyMs` is null
 * exactly when no check measured one, `models` is null exactly when no check counted them, and
 * neither has a fallback. Decision **M8**: `0ms` on a chip is not "unknown", it is an
 * excellent latency for a provider nothing has ever called. The one thing a client must not
 * have to invent is the value for *we did not measure this*, and the way to guarantee it does
 * not is to make it structurally unavailable.
 *
 * **2. The chip's text is served, not re-derived.** {@link ProviderHealthResource.meta} is the
 * `workstation · 3 models`, `42ms`, `degraded · elevated latency` line the mockup's
 * `.phealth .prov .meta` draws, already assembled from the facts beside it. This is the same
 * trade `pricing/resources.ts`'s `display` makes: a client is free to render from the fields
 * — a localised page would want to — but the composition rule is one rule and it lives in one
 * place, so a second surface cannot render a subtly different sentence from the same row.
 *
 * ---------------------------------------------------------------------------
 * **What is deliberately not here: a colour, a severity, or a fourth word.** The chip is amber
 * or green because of `status`, which V015 constrains to four values, and mapping those four
 * to CSS classes is AA.1's ([#200](https://github.com/NobuData/ouroboros/issues/200)) work in
 * the surface that owns the classes. A `severity: "warning"` invented here would be a fifth
 * vocabulary for the same fact, and the first thing to disagree with the column.
 */

import type { ProviderConnectionKind, ProviderConnectionStatus } from "../db/schema";
import type { ProviderCheckKind } from "./checks";
import type { ProviderHealthSnapshot } from "./snapshot";

/** What separates the parts of a chip's meta line — the mockup's own separator. */
export const META_SEPARATOR = " · ";

/** One chip on mockup 06's `.phealth` strip. */
export interface ProviderHealthResource {
  /** The connection's id — what mockup 07's surfaces and a route hop's resolution address it by. */
  readonly id: string;
  /** Which adapter reaches it. */
  readonly kind: ProviderConnectionKind;
  /** The chip's name — `Anthropic`, `GitHub Copilot`, `Ollama`. */
  readonly displayName: string;
  /**
   * `active`, `paused`, `error` or `unknown`.
   *
   * **`unknown` is a state and is never rendered as healthy** — decision **M8**. It is what a
   * connection is until something checked it, and what Copilot and Cursor stay until AB.2
   * ([#208](https://github.com/NobuData/ouroboros/issues/208)) can derive a state from real
   * traffic. A client that treated it as green would be making the product's one claim about
   * the outside world on no evidence at all.
   */
  readonly status: ProviderConnectionStatus;
  /**
   * Which question produced this state — `reachability` or `key_validation` — or null when
   * nothing this service performed did.
   *
   * Published because the two are different claims: *the socket answered* says nothing about
   * a credential, and *the key is valid* says almost nothing about whether a completion would
   * succeed. A hover that wants to say which one it was needs to be told which one it was.
   */
  readonly check: ProviderCheckKind | null;
  /** When the last check finished, ISO 8601, or null when none has. */
  readonly checkedAt: string | null;
  /**
   * The host this connection points at, or null when it names no address.
   *
   * The hostname alone — no scheme, no port, no path. It is the mockup's `workstation`, and it
   * is what makes two Ollama daemons distinguishable on a strip where both chips are named
   * `Ollama`. Trimming the port and scheme is a rendering decision rather than a security one:
   * `base_url` is already published on every alias resolution (`registry/resolution.ts`), and
   * this endpoint answers a member of the workspace that configured it.
   */
  readonly host: string | null;
  /** Milliseconds the last check measured, or **null** when none measured one. Never 0 as a stand-in. */
  readonly latencyMs: number | null;
  /** How many models the provider listed, or null when nothing counted them. */
  readonly models: number | null;
  /** Why the provider is in this state, when there is something to say. */
  readonly detail: string | null;
  /**
   * The chip's meta line, already composed — or null when there is nothing measured to say,
   * which is what the mockup's bare `Cursor ●` chip is.
   *
   * Null rather than an empty string, so a client renders *no element* rather than an empty
   * one: the mockup's `.meta` span has its own colour and spacing, and an empty one is a gap
   * that reads as a bug.
   */
  readonly meta: string | null;
}

/** The strip, as one payload. */
export interface ProviderHealthStripResource {
  /** Every connection in the workspace, ordered by name. Empty for a workspace with none. */
  readonly providers: readonly ProviderHealthResource[];
}

/**
 * The host part of a base URL, for the chip.
 *
 * @param baseUrl - The connection's address, or null.
 * @returns The hostname, or null when there is no address or it does not parse. A `base_url`
 *   that fails to parse cannot happen through V015's CHECK, and returning null rather than
 *   throwing is still right: a strip that 500s because one row is malformed tells a person
 *   nothing about the four providers that are fine.
 */
export function hostOf(baseUrl: string | null): string | null {
  if (baseUrl === null) {
    return null;
  }

  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
}

/**
 * The chip's meta line — the mockup's `workstation · 3 models`, `42ms`, `vLLM local`.
 *
 * Composed from the parts that exist, in the order the mockup draws them: *where it is*, then
 * *what it serves*, then *how fast it answered*, then *what is wrong with it*. A part that was
 * not measured contributes nothing — which is how `Anthropic ● 42ms` and `Cursor ●` come out
 * of one rule rather than out of a branch per provider.
 *
 * @param snapshot - The connection and what is known about it.
 * @returns The line, or null when nothing is known worth printing.
 */
export function chipMeta(snapshot: ProviderHealthSnapshot): string | null {
  const parts = [
    hostOf(snapshot.baseUrl),
    snapshot.measured.models === null ? null : `${snapshot.measured.models.toString()} models`,
    snapshot.measured.latencyMs === null ? null : `${snapshot.measured.latencyMs.toString()}ms`,
    snapshot.measured.detail,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? null : parts.join(META_SEPARATOR);
}

/**
 * One snapshot as the contract publishes it.
 *
 * @param snapshot - The connection and what is known about it.
 * @returns The chip.
 */
export function providerHealthResource(snapshot: ProviderHealthSnapshot): ProviderHealthResource {
  return {
    id: snapshot.connectionId,
    kind: snapshot.kind,
    displayName: snapshot.displayName,
    status: snapshot.status,
    check: snapshot.measured.check,
    checkedAt: snapshot.checkedAt === null ? null : snapshot.checkedAt.toISOString(),
    host: hostOf(snapshot.baseUrl),
    latencyMs: snapshot.measured.latencyMs,
    models: snapshot.measured.models,
    detail: snapshot.measured.detail,
    meta: chipMeta(snapshot),
  };
}

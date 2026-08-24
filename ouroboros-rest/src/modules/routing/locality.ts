/**
 * Which provider kinds count as **local** — the one question mockup 06's *Allow fallback to
 * local models* switch and its `route_local` escalation rule both ask.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)).
 *
 * ---------------------------------------------------------------------------
 * **The list is borrowed rather than restated, and that is the whole point of this file.**
 *
 * `internal/providers.ts` already draws this line for AD.3
 * ([#224](https://github.com/NobuData/ouroboros/issues/224)): `ollama` and
 * `openai_compatible` are the kinds reachable **without a credential**, which is why a worker
 * may be handed their address and why nothing else may be. That is the same property routing
 * needs — a local hop is one that costs nothing and keeps working with the network down —
 * and a second list here would be a second answer to *is this local* the first time somebody
 * edited one of them. So this module imports the constant and adds only what routing needs
 * on top of it: a predicate over {@link ProviderConnectionKind}, which is six values wide
 * where the lease policy's `ProviderKind` is five.
 *
 * **`custom` is the sixth, and it is not local.** V015 admits it as a kind, the lease policy
 * has never had to classify it, and this module must: a connection whose adapter is
 * unspecified cannot be assumed to be reachable offline, and the honest default for *we do
 * not know what this is* is the one that does not promise the network is unnecessary.
 * `locality.spec.ts` asserts that every kind V015 accepts gets an answer here, so a seventh
 * kind added to the column fails this suite rather than quietly defaulting.
 *
 * ---------------------------------------------------------------------------
 * **What this cannot see, stated where somebody will look for it.** The same
 * `openai_compatible` adapter fronts a vLLM on somebody's own GPU *and* a hosted endpoint, so
 * no rule at the level of a *kind* can tell those apart — `internal/providers.ts` makes the
 * same admission and closes it with a deployment-level declaration. Routing does not have
 * that lever, and inventing one here would be this module deciding a question mockup 07 owns.
 * A workspace that points an `openai_compatible` connection at a paid endpoint and switches
 * *Allow fallback to local models* off is telling routing something this file cannot check;
 * the fix belongs on the connection, not in a second locality list.
 */

import type { ProviderConnectionKind } from "../db/schema";
import { LOCAL_PROVIDER_KINDS } from "../internal/providers";

/**
 * Is a hop on this kind of connection a **local** hop?
 *
 * @param kind - The connection's kind, from V015's column.
 * @returns `true` for a kind reachable without a credential — `ollama` and
 *   `openai_compatible`. `false` for the cloud kinds and for `custom`, which this file's
 *   header explains.
 */
export function isLocalProvider(kind: ProviderConnectionKind): boolean {
  return (LOCAL_PROVIDER_KINDS as readonly string[]).includes(kind);
}

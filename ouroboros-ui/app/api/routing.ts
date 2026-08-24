/**
 * Model routing — what mockup 06's `/models` surface reads from `ouroboros-rest`.
 *
 * One operation today: the provider health strip
 * ([#196](https://github.com/NobuData/ouroboros/issues/196)), which is the only part of the
 * page AA.1 ([#200](https://github.com/NobuData/ouroboros/issues/200)) draws from data. The
 * matrix, the inspector, the rules card and the spend card are AA.2–AA.5's, over the
 * management API ([#195](https://github.com/NobuData/ouroboros/issues/195)) and the stats
 * service ([#198](https://github.com/NobuData/ouroboros/issues/198)); they belong in this
 * module beside this one when they arrive, because they are one page's calls to one tag.
 *
 * What this adds over a raw call is what every resource file in this directory adds: a
 * name, the path written down once so a rename in the contract is a failed typecheck rather
 * than a `404` behind a chip, and the body rather than the body-or-nothing.
 *
 * ### Nothing here triggers a check
 *
 * `GET /api/v1/routing/providers` is a **read of stored snapshots**, and the contract is
 * emphatic about why: the cadence belongs to the service's own scheduler, and a *check now*
 * button would let anybody holding a session make `ouroboros-rest` issue outbound requests
 * at whatever rate they can click — against a vendor's rate limit, signed with the
 * workspace's own credential. So there is no refresh function in this module, and the page
 * has no control that would call one.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in this path and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why), so the strip is scoped to the session's active
 * organization. Any member may read it, viewers included: *is Ollama up* is the kind of
 * thing a viewer exists to be able to look at.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * One chip on the provider health strip: a provider connection, and what the last check
 * honestly found.
 *
 * **Every optional fact is `null` rather than a stand-in value**, and the page is built on
 * that: `latencyMs` is present only where a check measured one, `models` only where a check
 * counted them, and neither has a fallback. `0ms` is an excellent latency for a provider
 * nothing has ever called, which is why the contract refuses to invent it and why nothing
 * in `app/models/` supplies a default for it either.
 */
export type ProviderHealth = components["schemas"]["ProviderHealth"];

/** The whole strip: every connection in the workspace, ordered by display name. */
export type ProviderHealthStrip = components["schemas"]["ProviderHealthStrip"];

/**
 * Whether a provider is usable, as far as anything knows — the four the schema publishes.
 *
 * Named separately because the strip maps every one of them to a treatment
 * (`app/models/view.ts`), so a fifth status added to the service is a build error in the
 * screen rather than a chip that silently draws as healthy. That is the whole of decision
 * **M8** on this side of the wire: `unknown` is a state, and it is never rendered as green.
 */
export type ProviderStatus = ProviderHealth["status"];

/**
 * Which question produced a provider's state — or `null` when no check this service
 * performs did, which is a seeded state or a provider it has nothing cheap to ask.
 *
 * Published by the contract because the two are different claims: *the socket answered*
 * says nothing about a credential, and *the key is valid* says almost nothing about whether
 * a completion would succeed. The strip's hover is what says which one it was.
 */
export type ProviderCheck = ProviderHealth["check"];

/** Model routing, as `ouroboros-rest` serves it. */
export const routing = {
  /**
   * Every provider connection in the workspace, and what is known about each.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass
   *   one over a stub `fetch`.
   * @returns The strip. A workspace that has configured no providers answers an empty
   *   array — the page's empty state, not a failure.
   * @throws {ApiError} What the service answered. A `401` redirects to login before this
   *   rejects.
   */
  async providers(client: ApiClient = api()): Promise<ProviderHealthStrip> {
    return unwrap(await client.GET("/api/v1/routing/providers", {}));
  },
};

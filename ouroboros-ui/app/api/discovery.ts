import "server-only";

/**
 * Domain discovery — what a company domain resolves to before anybody has signed in
 * ([#712](https://github.com/NobuData/ouroboros/issues/712)).
 *
 * One line over the generated client, in the shape `app/api/orgs.ts` established. What earns
 * it a module of its own rather than a line in one of those is that it is the **one public
 * operation** this UI calls, and that is a property with consequences at both ends:
 *
 *   * It is called through {@link anonymousApi} rather than {@link api}. `api()`'s `401`
 *     handler redirects to the login screen, and the only caller of this is *on* the login
 *     screen — a redirect to itself, once per submission. `app/api/server.ts` names this
 *     issue as the reason that second client is kept.
 *   * It is still called **from the server**, even though nothing about it needs a session.
 *     `proxy.ts` forwards `/api/auth/*` and deliberately not `/api/v1/*`: an address the
 *     browser can compose calls to is the property `OURO_REST_URL` is unprefixed to prevent.
 *     So the browser reaches this through a Server Action (`app/login/actions.ts`), which is
 *     also the architecture the login screen already writes in.
 *
 * ### The answer is uniform, and that is the contract rather than this release
 *
 * `openapi.yaml` § `discoverDomain` builds the endpoint not to be a tenant-enumeration
 * oracle: the same body for a domain a workspace holds and one nothing does, and a fixed
 * timing floor so the difference is not readable off a stopwatch. Nothing here may undo that
 * by inferring more than was said — there is no "we know this domain" to derive, because
 * there is no field that differs. What comes back is exactly {@link Discovery}, unreshaped.
 *
 * `ssoAvailable` is the discriminator and both of its branches are live code today even
 * though only one of them happens: `false` means render `message`, `true` means follow
 * `redirectUrl`. Enterprise SSO is
 * [#722](https://github.com/NobuData/ouroboros/issues/722), and writing the second branch now
 * is what
 * [#723](https://github.com/NobuData/ouroboros/issues/723) needs in order to change nothing
 * here.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { anonymousApi } from "@/app/api/server";

/** What a company domain resolves to — `openapi.yaml` § `DiscoverResponse`. */
export type Discovery = components["schemas"]["DiscoverResponse"];

/**
 * Ask what a company domain signs in with.
 *
 * @param domain The domain as a person typed it. **Not normalised here**: the service trims,
 *   lower-cases and strips the scheme, path, query, fragment and trailing dot before it
 *   validates — the one request body in this API that is normalised rather than refused
 *   (`openapi.yaml` § `DiscoverRequest`) — and a second normaliser in the browser would be a
 *   second set of rules to keep in step with the one that decides.
 * @param client The client to call through. Defaults to the anonymous server-side one; tests
 *   pass one over a stub `fetch`.
 * @returns Whether the domain signs in through an identity provider, the sentence to render
 *   either way, and where to send the browser when it does.
 * @throws {ApiError} What the service answered — `422 validation_failed` for a value that is
 *   not a domain once it has been normalised, with `details.domain` naming the field.
 */
export async function discover(
  domain: string,
  client: ApiClient = anonymousApi(),
): Promise<Discovery> {
  return unwrap(await client.POST("/api/v1/auth/discover", { body: { domain } }));
}

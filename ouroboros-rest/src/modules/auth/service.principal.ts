/**
 * The service principal — a request authenticated by a service account's token rather than a
 * person's session ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1).
 *
 * Automation such as `devops-bot` used to borrow somebody's session, which put that person's
 * name on every bot line of the audit trail. A service account is its own principal instead:
 * it has an identity (`service:<name>`), a workspace, a list of scopes, and a token that can be
 * rotated without touching anyone's session.
 *
 * ```
 * Authorization: Bearer orb_svc_…   ──▶ ServiceTokenMiddleware  (hash lookup, one live token)
 *                                        │ sets SERVICE_PRINCIPAL_PROPERTY, or the rejected flag
 *                                        ▼
 *                                    SessionOrServiceGuard     (a principal stands in for a session)
 *                                        ▼
 *                                    TenantContextGuard        (scope check, tenant = the account's)
 *                                        ▼
 *                                    RolesGuard / CapabilityGuard (skipped / refused for services)
 * ```
 *
 * This file holds only the shape and the request plumbing, so the guards in `src/auth` and
 * `tenancy` can read a principal without importing the module that authenticates one.
 */

import type { Organization } from "../db/schema";

/** The token prefix every service token carries — what tells this guard the bearer is ours. */
export const SERVICE_TOKEN_PREFIX = "orb_svc_";

/** Where the middleware puts an accepted principal on the request. */
export const SERVICE_PRINCIPAL_PROPERTY = "ouroServicePrincipal";

/** Where the middleware records that a service token was presented and refused. */
export const SERVICE_TOKEN_REJECTED_PROPERTY = "ouroServiceTokenRejected";

/** A request authenticated as a service account. */
export interface ServicePrincipal {
  /** `service_accounts.id`. */
  readonly accountId: string;
  /** `service_tokens.id` — the token that authenticated this request. */
  readonly tokenId: string;
  /** `devops-bot` — the audit trail's `service:<name>`. */
  readonly name: string;
  /** The workspace the account belongs to. A service request never acts anywhere else. */
  readonly organization: Organization;
  /** The account's scopes, from the registered allow-list (`service.scopes.ts`). */
  readonly scopes: readonly string[];
}

/** The parts of a request the service plumbing reads and writes. */
export interface ServiceRequest {
  headers?: Record<string, string | string[] | undefined>;
  [SERVICE_PRINCIPAL_PROPERTY]?: ServicePrincipal;
  [SERVICE_TOKEN_REJECTED_PROPERTY]?: boolean;
}

/**
 * The service principal a request authenticated as.
 *
 * @param request - The incoming request.
 * @returns The principal, or `undefined` on every session-authenticated or anonymous request.
 */
export function servicePrincipalOf(request: ServiceRequest): ServicePrincipal | undefined {
  return request[SERVICE_PRINCIPAL_PROPERTY];
}

/**
 * Whether the request presented a service token that was refused (unknown, rotated, revoked or
 * its account disabled).
 *
 * @param request - The incoming request.
 * @returns `true` only when a token with the service prefix was presented and did not authenticate.
 */
export function serviceTokenRejected(request: ServiceRequest): boolean {
  return request[SERVICE_TOKEN_REJECTED_PROPERTY] === true;
}

/**
 * The service token a request presents, if any.
 *
 * Only `Authorization: Bearer orb_svc_…` counts. Any other bearer is not ours to judge and is
 * left for whatever else reads the header, so a service-token check can never refuse a request
 * it was not addressed by.
 *
 * @param request - The incoming request.
 * @returns The token, or `undefined` when the request presents none.
 */
export function bearerServiceToken(request: ServiceRequest): string | undefined {
  const header = request.headers?.["authorization"];
  const value = Array.isArray(header) ? header[0] : header;

  if (value === undefined) return undefined;

  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  const token = match?.[1];

  return token?.startsWith(SERVICE_TOKEN_PREFIX) ? token : undefined;
}

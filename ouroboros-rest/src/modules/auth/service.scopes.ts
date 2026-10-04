/**
 * Service account scopes — the registered allow-list of API surfaces, and the rule that decides
 * which one a route needs ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1).
 *
 * **Scopes are checked at the route, not merely stored.** The tenant guard asks
 * {@link serviceAccess} on every service-authenticated request, before any role check, and a
 * token outside its scopes is a `403` that names the scope it lacked.
 *
 * The rule, in order:
 *
 *   1. A route marked {@link HumanOnly} — or one that runs without a workspace — refuses every
 *      service principal. These are the routes that read *the person* (their session, their
 *      preferences) and would have nobody to read.
 *   2. A route that declares {@link ServiceScope} needs that scope. This is how a write opts in:
 *      `POST /farm/jobs` declares `farm.submit`.
 *   3. Any other `GET`/`HEAD` needs `api.read` — unless its roles exclude `viewer`, in which case
 *      it is a person's read (an administrator's or a contributor's) and refuses services.
 *   4. Any other write refuses services: no scope grants a route that did not opt in.
 *
 * **Adding a scope is a migration and a route, never one without the other.** The list below is
 * also V091's `service_accounts_scopes_registered` CHECK, so a scope nothing enforces cannot be
 * stored, and a route cannot declare a scope nobody can hold.
 */

import { SetMetadata, type CustomDecorator } from "@nestjs/common";

import { ForbiddenError, UnauthenticatedError } from "../errors/error.envelope";

/** Every scope a service account may hold. Kept in step with V091's CHECK by `service.scopes.spec.ts`. */
export const SERVICE_SCOPES = ["api.read", "farm.submit"] as const;

/** One of {@link SERVICE_SCOPES}. */
export type ServiceScopeName = (typeof SERVICE_SCOPES)[number];

/** What each scope grants, for the OpenAPI prose and the settings card. */
export const SERVICE_SCOPE_DESCRIPTIONS: Readonly<Record<ServiceScopeName, string>> = {
  "api.read": "Read any workspace resource a viewer may read (GET requests).",
  "farm.submit": "Submit and cancel build-farm jobs (POST /farm/jobs).",
};

/** Metadata key for {@link ServiceScope}. */
export const SERVICE_SCOPE = "ouroboros:service:scope";

/** Metadata key for {@link HumanOnly}. */
export const HUMAN_ONLY = "ouroboros:service:human-only";

/**
 * Let service accounts holding `scope` call this route.
 *
 * @param scope - The scope the route requires.
 * @returns The decorator.
 */
export const ServiceScope = (scope: ServiceScopeName): CustomDecorator =>
  SetMetadata(SERVICE_SCOPE, scope);

/**
 * Refuse service accounts on this route, whatever their scopes — for reads that need a person.
 *
 * @returns The decorator.
 */
export const HumanOnly = (): CustomDecorator => SetMetadata(HUMAN_ONLY, true);

/**
 * Whether a string is a registered scope.
 *
 * @param value - Anything.
 * @returns `true` for a member of {@link SERVICE_SCOPES}.
 */
export function isServiceScope(value: unknown): value is ServiceScopeName {
  return typeof value === "string" && (SERVICE_SCOPES as readonly string[]).includes(value);
}

/** What the rule needs to know about a route. */
export interface ServiceRouteFacts {
  /** The HTTP method. */
  readonly method: string;
  /** The scope the route declared with {@link ServiceScope}, if any. */
  readonly declaredScope?: ServiceScopeName;
  /** Whether the route is {@link HumanOnly}. */
  readonly humanOnly: boolean;
  /** Whether the route runs without a workspace (`@TenantOptional()`). */
  readonly tenantOptional: boolean;
  /** The roles `@Roles()` named, if any. */
  readonly roles?: readonly string[];
}

/** The rule's answer. */
export type ServiceAccess =
  | { readonly allowed: true; readonly scope: ServiceScopeName }
  | { readonly allowed: false; readonly reason: "scope_missing"; readonly scope: ServiceScopeName }
  | { readonly allowed: false; readonly reason: "human_only" };

/**
 * Decide whether a service principal holding `scopes` may call a route.
 *
 * @param route - The route's method and metadata.
 * @param scopes - The scopes the account holds.
 * @returns Allowed with the scope that granted it, or refused with the scope it lacked — or
 *   `human_only` when no scope could grant it.
 */
export function serviceAccess(route: ServiceRouteFacts, scopes: readonly string[]): ServiceAccess {
  const required = requiredScope(route);

  if (required === null) return { allowed: false, reason: "human_only" };

  return scopes.includes(required)
    ? { allowed: true, scope: required }
    : { allowed: false, reason: "scope_missing", scope: required };
}

/**
 * The scope a route needs — rules 1 to 4 of this file's header.
 *
 * @param route - The route's method and metadata.
 * @returns The scope, or `null` when the route is for people only.
 */
export function requiredScope(route: ServiceRouteFacts): ServiceScopeName | null {
  if (route.humanOnly || route.tenantOptional) return null;
  if (route.declaredScope !== undefined) return route.declaredScope;

  const method = route.method.toUpperCase();

  if (method === "GET" || method === "HEAD") {
    const viewerMayRead =
      route.roles === undefined || route.roles.length === 0 || route.roles.includes("viewer");

    return viewerMayRead ? "api.read" : null;
  }

  return null;
}

/** The error codes this file raises. */
export const SERVICE_ERRORS = {
  tokenInvalid: "service_token_invalid",
  scopeMissing: "service_scope_missing",
  principalRefused: "service_principal_refused",
} as const;

/**
 * A service token was presented and did not authenticate: unknown, rotated, revoked, or its
 * account disabled. One answer for all four, so the response says nothing about which.
 *
 * @returns A `401`.
 */
export function serviceTokenInvalid(): UnauthenticatedError {
  return new UnauthenticatedError(
    SERVICE_ERRORS.tokenInvalid,
    "This service token is not valid. It may have been rotated or revoked.",
  );
}

/**
 * The service account lacks the scope this route needs.
 *
 * @param scope - The missing scope — named, so the operator knows what to grant.
 * @returns A `403`.
 */
export function serviceScopeMissing(scope: ServiceScopeName): ForbiddenError {
  return new ForbiddenError(
    SERVICE_ERRORS.scopeMissing,
    `This service account lacks the ${scope} scope.`,
    { scope },
  );
}

/**
 * The route is for people only; no scope grants it.
 *
 * @returns A `403`.
 */
export function servicePrincipalRefused(): ForbiddenError {
  return new ForbiddenError(
    SERVICE_ERRORS.principalRefused,
    "Service accounts cannot call this route; it needs a person's session.",
  );
}

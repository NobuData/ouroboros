/**
 * Every code the tenancy API can answer with, and the errors that carry them.
 *
 * Codes live here rather than in a service-wide registry because a code is only meaningful
 * beside the operation that produces it, and `openapi.yaml` is where the two are published
 * together — the document is the registry a client reads. What this file guarantees is the
 * other half: that the string in the specification and the string in the answer come from
 * one constant, so renaming one renames both.
 *
 * The messages are written for a person looking at a settings screen. None of them names a
 * table, a column, a constraint or an identifier the caller did not already send.
 */

import { ConflictError, NotFoundError, type ErrorDetails } from "../errors/error.envelope";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type: a helper below that returns
 * `TENANCY_ERRORS.tenantNotFound` cannot be handed `"tenant_not_fuond"` by a caller writing
 * a string, and the specification's copy is checked against these in `tenancy.errors.spec.ts`.
 */
export const TENANCY_ERRORS = {
  /** No tenant with that id — or, once #32 lands, none this caller may know about. */
  tenantNotFound: "tenant_not_found",
  /** The slug is already another tenant's. `tenants_slug_key`. */
  slugTaken: "slug_taken",
  /** No such domain on this tenant. */
  domainNotFound: "domain_not_found",
  /** The domain belongs to another tenant. `tenant_domains_domain_key`. */
  domainTaken: "domain_taken",
  /** No such member of this tenant. */
  memberNotFound: "member_not_found",
  /** That person is already a member. `tenant_members_pkey`. */
  memberExists: "member_exists",
  /** The tenant would be left with no owner. Enforced here; see `members.service.ts`. */
  lastOwner: "last_owner",
  /** No such organisation on this tenant. */
  orgNotFound: "org_not_found",
  /** The tenant has already enabled that organisation. `github_orgs_tenant_login_key`. */
  orgTaken: "org_taken",
  /** A uniqueness rule this API has no more specific name for. See `details.constraint`. */
  conflict: "conflict",
  /** A `check` the migrations declare and a DTO does not restate. See `details.constraint`. */
  constraintViolated: "constraint_violated",
} as const;

/** One of {@link TENANCY_ERRORS}' values. */
export type TenancyErrorCode = (typeof TENANCY_ERRORS)[keyof typeof TENANCY_ERRORS];

/**
 * `404` — no tenant with this id.
 *
 * @param tenantId - The id that was asked for. Echoed into `details` because a UI holding
 *   several tenants open needs to know *which* request failed, and the caller sent it.
 * @returns The error to throw.
 */
export function tenantNotFound(tenantId: string): NotFoundError {
  return new NotFoundError(TENANCY_ERRORS.tenantNotFound, "No such tenant.", { tenantId });
}

/**
 * `404` — this tenant has no such domain.
 *
 * A domain that exists but belongs to *another* tenant answers with this too, and that is
 * deliberate: the alternative tells whoever asked that the id is real, which is the same
 * existence leak [#32](https://github.com/NobuData/ouroboros/issues/32) answers `404` to
 * avoid at the tenant level.
 *
 * @param domainId - The domain id that was addressed.
 * @returns The error to throw.
 */
export function domainNotFound(domainId: string): NotFoundError {
  return new NotFoundError(TENANCY_ERRORS.domainNotFound, "No such domain on this tenant.", {
    domainId,
  });
}

/**
 * `404` — this person is not a member of this tenant.
 *
 * @param userId - The user that was addressed.
 * @returns The error to throw.
 */
export function memberNotFound(userId: string): NotFoundError {
  return new NotFoundError(TENANCY_ERRORS.memberNotFound, "No such member of this tenant.", {
    userId,
  });
}

/**
 * `404` — this tenant has not enabled that organisation.
 *
 * @param login - The GitHub login that was addressed.
 * @returns The error to throw.
 */
export function orgNotFound(login: string): NotFoundError {
  return new NotFoundError(TENANCY_ERRORS.orgNotFound, "No such organisation on this tenant.", {
    login,
  });
}

/**
 * `409` — the tenant would be left without an owner.
 *
 * The issue's second acceptance criterion, and the one rule in the tenancy schema that
 * `ouroboros-db` deliberately does *not* enforce: V002's header records that it spans rows,
 * has to survive both a role change and a delete, and therefore belongs to the API that is
 * the only thing allowed to write the table.
 *
 * @param userId - The owner whose demotion or removal was refused.
 * @returns The error to throw.
 */
export function lastOwner(userId: string): ConflictError {
  return new ConflictError(
    TENANCY_ERRORS.lastOwner,
    "A tenant must keep at least one owner. Promote another member first.",
    { userId },
  );
}

/**
 * `409` — a uniqueness rule refused the write.
 *
 * @param code - Which rule, as a code the specification documents.
 * @param message - What a human is told.
 * @param details - The value that collided, when there is one worth echoing.
 * @returns The error to throw.
 */
export function conflict(code: string, message: string, details: ErrorDetails = {}): ConflictError {
  return new ConflictError(code, message, details);
}

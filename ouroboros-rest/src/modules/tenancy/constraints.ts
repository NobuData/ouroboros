/**
 * Constraint violations, mapped into the envelope instead of leaking through.
 *
 * The issue's first acceptance criterion names the exemplar: *duplicate domain → 409 with
 * `code:"domain_taken"`*. What makes that worth a file of its own is that the rule being
 * violated lives in `ouroboros-db`, not here — V001 declares `tenant_domains_domain_key`,
 * and the only thing this service ever learns about it is a `pg` error carrying an SQLSTATE
 * and the constraint's name. Mapping that pair is how a database rule becomes an HTTP
 * answer, and doing it in one table rather than in a `catch` at each call site is what stops
 * the mapping drifting between the four resources that share these tables.
 *
 * **Checking first is not a substitute for this.** A service that asks whether a domain is
 * taken and then inserts it has a window between the two, and the loser of that race gets a
 * `500` with PostgreSQL's own text in it. The unique index is the thing that is actually
 * true, so the answer is derived from what it says rather than from what a preceding
 * `select` said a moment earlier.
 *
 * Applied by {@link ConstraintViolationInterceptor}, which every tenancy controller carries,
 * so a write that trips a constraint nobody anticipated still answers with a code and a
 * status rather than a stack trace.
 */

import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { throwError, type Observable } from "rxjs";
import { catchError } from "rxjs/operators";

import { InvalidRequestError, NotFoundError, type DomainError } from "../errors/error.envelope";
import { TENANCY_ERRORS, conflict } from "./tenancy.errors";

/**
 * The part of a `pg` error this file reads.
 *
 * Structural, because the driver's own `DatabaseError` class is not what arrives: Kysely
 * passes the rejection through untouched, a pool can reject with something the connection
 * layer built, and a test should be able to state the two fields that matter without
 * constructing a driver internal.
 */
export interface DatabaseFailure {
  /** The SQLSTATE — `23505` for a unique violation, `23514` for a check. */
  code: string;
  /** The constraint that refused, as the migration named it. */
  constraint?: string;
}

/** SQLSTATE class 23 — the integrity constraint violations this file maps. */
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";
export const CHECK_VIOLATION = "23514";
export const NOT_NULL_VIOLATION = "23502";

/**
 * Whether a thrown thing is a database failure carrying an SQLSTATE.
 *
 * @param error - Whatever was thrown.
 * @returns `true` when it has a string `code`, which is what every `pg` error has and what
 *   nothing else in this module throws.
 */
export function isDatabaseFailure(error: unknown): error is DatabaseFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

/**
 * The unique constraints these tables declare, and what each one means to a client.
 *
 * Keyed by the name the migration gives the constraint, so the key is greppable from the SQL
 * and a renamed constraint fails this lookup rather than silently changing an answer. A name
 * that is not here still answers `409` — see {@link constraintError} — because a uniqueness
 * rule refusing a write is a conflict whether or not this table has a word for it.
 */
const UNIQUE_CONSTRAINTS: Readonly<Record<string, () => DomainError>> = Object.freeze({
  tenants_slug_key: () =>
    conflict(TENANCY_ERRORS.slugTaken, "That slug is already in use by another tenant."),

  tenant_domains_domain_key: () =>
    conflict(TENANCY_ERRORS.domainTaken, "That domain belongs to another tenant."),

  // The service clears the previous primary inside the same transaction, so reaching this is
  // two requests racing rather than a mistake in a query — and the honest answer to that is
  // "try again", which is what a 409 says.
  tenant_domains_one_primary_per_tenant: () =>
    conflict(TENANCY_ERRORS.conflict, "This tenant's primary domain was changed concurrently."),

  tenant_members_pkey: () =>
    conflict(TENANCY_ERRORS.memberExists, "That person is already a member of this tenant."),

  users_email_key: () =>
    conflict(TENANCY_ERRORS.conflict, "That email address was registered concurrently."),

  github_orgs_tenant_login_key: () =>
    conflict(TENANCY_ERRORS.orgTaken, "This tenant has already added that organisation."),

  github_repos_org_name_key: () =>
    conflict(
      TENANCY_ERRORS.conflict,
      "That repository was added to this organisation concurrently.",
    ),
});

/**
 * The foreign keys these tables declare, and what a violation of each one means.
 *
 * Every one of them means the *parent* went away between the check and the write — a tenant
 * deleted while its settings screen was open, an organisation removed mid-request — so they
 * map to the same `404` the check itself would have produced, rather than to a `409`. The
 * names are PostgreSQL's own for an inline `references`: `<table>_<column>_fkey`.
 */
const FOREIGN_KEYS: Readonly<Record<string, () => DomainError>> = Object.freeze({
  // No `details` on any of them: the parent's identifier is not in the driver's report, and
  // inventing one would put a value in the envelope that the caller never sent.
  tenant_domains_tenant_id_fkey: () => goneTenant(),
  tenant_members_tenant_id_fkey: () => goneTenant(),
  github_orgs_tenant_id_fkey: () => goneTenant(),
  github_repos_org_id_fkey: () =>
    new NotFoundError(TENANCY_ERRORS.orgNotFound, "No such organisation on this tenant."),
});

/**
 * The tenant a write named is gone.
 *
 * @returns The same `404` a check for the tenant would have produced, so the answer does not
 *   depend on whether the row disappeared before the check or after it.
 */
function goneTenant(): DomainError {
  return new NotFoundError(TENANCY_ERRORS.tenantNotFound, "No such tenant.");
}

/**
 * Map a database failure onto the error a client should see.
 *
 * @param error - Whatever a repository's promise rejected with.
 * @returns The domain error to answer with, or `undefined` when this was not a constraint
 *   violation at all — a dropped connection, a syntax error, a timeout. Those are the
 *   service's problem rather than the caller's, and returning `undefined` is what lets them
 *   stay the `500` they are instead of being dressed up as a `4xx`.
 */
export function constraintError(error: unknown): DomainError | undefined {
  if (!isDatabaseFailure(error)) {
    return undefined;
  }

  const constraint = error.constraint;

  switch (error.code) {
    case UNIQUE_VIOLATION:
      return (
        (constraint !== undefined ? UNIQUE_CONSTRAINTS[constraint] : undefined)?.() ??
        conflict(TENANCY_ERRORS.conflict, "That value is already in use.", details(constraint))
      );

    case FOREIGN_KEY_VIOLATION:
      return (
        (constraint !== undefined ? FOREIGN_KEYS[constraint] : undefined)?.() ??
        conflict(
          TENANCY_ERRORS.conflict,
          "Something this request refers to no longer exists.",
          details(constraint),
        )
      );

    case CHECK_VIOLATION:
    case NOT_NULL_VIOLATION:
      // A `check` the DTOs do not restate — or restate less strictly than the migration
      // does. The value was unacceptable, which is a 422 and not a 409: unlike a conflict,
      // a client that changes the value can succeed.
      return new InvalidRequestError(
        TENANCY_ERRORS.constraintViolated,
        "The database refused this value.",
        details(constraint),
      );

    default:
      return undefined;
  }
}

/**
 * The constraint's name, as a detail — when there is one.
 *
 * Naming it is deliberate. The migrations are committed in a public repository, so the name
 * reveals nothing a reader could not already look up, and it is the only thing that makes a
 * generic `409` actionable: it says *which* rule refused, which is what a bug report needs
 * and what a `500` would have buried in a log the reporter cannot read.
 *
 * @param constraint - The constraint's name, if the driver reported one.
 * @returns Details for the error, empty when it did not.
 */
function details(constraint: string | undefined): Record<string, string> {
  return constraint === undefined ? {} : { constraint };
}

/**
 * Turn a constraint violation raised under any tenancy route into its envelope.
 *
 * Declared on the controllers rather than wrapped around each repository call, for two
 * reasons: a `try`/`catch` per write is four lines of noise around every statement, and — the
 * one that matters — an interceptor covers the writes nobody thought about. A constraint
 * added by a future migration answers `409` with its name the day it lands, instead of
 * `500` until someone notices.
 */
@Injectable()
export class ConstraintViolationInterceptor implements NestInterceptor {
  /**
   * @param _context - Unused: the mapping depends on the failure, never on the route.
   * @param next - The handler being wrapped.
   * @returns Its result, with constraint violations replaced by domain errors. Anything else
   *   is re-thrown exactly as it was, so a genuine failure still reaches the filter as one.
   */
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(catchError((error: unknown) => throwError(() => constraintError(error) ?? error)));
  }
}

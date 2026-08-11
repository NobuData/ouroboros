import { HttpStatus, type CallHandler, type ExecutionContext } from "@nestjs/common";
import { firstValueFrom, of, throwError } from "rxjs";

import { DomainError } from "../errors/error.envelope";
import {
  CHECK_VIOLATION,
  ConstraintViolationInterceptor,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  UNIQUE_VIOLATION,
  constraintError,
  isDatabaseFailure,
} from "./constraints";
import { TENANCY_ERRORS } from "./tenancy.errors";

/**
 * The issue's first acceptance criterion, as a table.
 *
 * > *constraint-violation mapping (duplicate domain → 409 with `code:"domain_taken"`)*
 *
 * Every row below is a rule `ouroboros-db` declares and this service has to answer for. The
 * constraint names are the migrations' own, so a rename there fails a case here rather than
 * quietly turning a `409` into a `500`.
 */

/**
 * A `pg` error, as the driver reports one.
 *
 * @param code - The SQLSTATE.
 * @param constraint - The constraint that refused, when there is one.
 * @returns The rejection a repository's promise would carry.
 */
function failure(code: string, constraint?: string): unknown {
  return Object.assign(new Error("database said no"), { code, constraint });
}

describe("recognising a database failure", () => {
  it("recognises anything carrying an SQLSTATE", () => {
    expect(isDatabaseFailure(failure(UNIQUE_VIOLATION))).toBe(true);
  });

  it.each([
    ["an ordinary error", new Error("nope")],
    ["a string", "nope"],
    ["null", null],
    ["undefined", undefined],
    ["an error whose code is not a string", Object.assign(new Error("nope"), { code: 23505 })],
  ])("does not mistake %s for one", (_case, thrown) => {
    expect(isDatabaseFailure(thrown)).toBe(false);
  });
});

describe("a unique violation", () => {
  it.each([
    ["tenants_slug_key", TENANCY_ERRORS.slugTaken],
    ["tenant_domains_domain_key", TENANCY_ERRORS.domainTaken],
    ["tenant_members_pkey", TENANCY_ERRORS.memberExists],
    ["github_orgs_tenant_login_key", TENANCY_ERRORS.orgTaken],
    ["tenant_domains_one_primary_per_tenant", TENANCY_ERRORS.conflict],
    ["users_email_key", TENANCY_ERRORS.conflict],
    ["github_repos_org_name_key", TENANCY_ERRORS.conflict],
  ])("maps %s to a 409 with code %s", (constraint, code) => {
    const error = constraintError(failure(UNIQUE_VIOLATION, constraint));

    expect(error?.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error?.envelope().code).toBe(code);
  });

  it("is the issue's worked example", () => {
    // "duplicate domain → 409 with code:"domain_taken"", from the acceptance criteria.
    const error = constraintError(failure(UNIQUE_VIOLATION, "tenant_domains_domain_key"));

    expect(error?.envelope()).toEqual({
      code: "domain_taken",
      message: "That domain belongs to another tenant.",
      details: {},
    });
  });

  it("still answers 409 for a constraint nobody has named", () => {
    // A uniqueness rule refusing a write is a conflict whether or not this file has a word
    // for it — including one a future migration adds, which is the case that would otherwise
    // be a 500 until somebody noticed.
    const error = constraintError(failure(UNIQUE_VIOLATION, "something_added_later_key"));

    expect(error?.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error?.envelope().details).toEqual({ constraint: "something_added_later_key" });
  });

  it("copes with a violation the driver did not name", () => {
    const error = constraintError(failure(UNIQUE_VIOLATION));

    expect(error?.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error?.envelope().details).toEqual({});
  });
});

describe("a foreign key violation", () => {
  it.each([
    ["tenant_domains_tenant_id_fkey", TENANCY_ERRORS.tenantNotFound],
    ["tenant_members_tenant_id_fkey", TENANCY_ERRORS.tenantNotFound],
    ["github_orgs_tenant_id_fkey", TENANCY_ERRORS.tenantNotFound],
    ["github_repos_org_id_fkey", TENANCY_ERRORS.orgNotFound],
  ])("maps %s to the 404 the check itself would have given", (constraint, code) => {
    // The parent went away between the check and the write. Answering 404 rather than 409
    // means the answer does not depend on *when* the row disappeared.
    const error = constraintError(failure(FOREIGN_KEY_VIOLATION, constraint));

    expect(error?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error?.envelope().code).toBe(code);
    expect(error?.envelope().details).toEqual({});
  });

  it("answers 409 for a key nobody has named", () => {
    expect(constraintError(failure(FOREIGN_KEY_VIOLATION, "later_fkey"))?.getStatus()).toBe(
      HttpStatus.CONFLICT,
    );
  });
});

describe("a value the database refused", () => {
  it.each([
    ["a check violation", CHECK_VIOLATION],
    ["a not-null violation", NOT_NULL_VIOLATION],
  ])("maps %s to 422 rather than 409", (_case, code) => {
    // Unlike a conflict, a client that changes the value can succeed — which is the whole
    // difference between the two statuses.
    const error = constraintError(failure(code, "tenants_slug_format"));

    expect(error?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error?.envelope()).toEqual({
      code: TENANCY_ERRORS.constraintViolated,
      message: "The database refused this value.",
      details: { constraint: "tenants_slug_format" },
    });
  });
});

describe("a failure that is not a constraint violation", () => {
  it.each([
    ["a dropped connection", failure("08006")],
    ["a syntax error", failure("42601")],
    ["an ordinary error", new Error("connect ECONNREFUSED")],
    ["a string", "nope"],
  ])("leaves %s alone", (_case, thrown) => {
    // Returning `undefined` is what lets these stay the 500 they are, instead of being
    // dressed up as a 4xx the caller could have avoided.
    expect(constraintError(thrown)).toBeUndefined();
  });
});

describe("the interceptor every tenancy controller carries", () => {
  const interceptor = new ConstraintViolationInterceptor();
  const context = {} as ExecutionContext;

  /**
   * A handler that produces one thing.
   *
   * @param outcome - What it does: resolve with a value, or reject.
   * @returns The `CallHandler` Nest would pass.
   */
  function handler(outcome: { value: unknown } | { thrown: unknown }): CallHandler {
    return {
      handle: () => ("value" in outcome ? of(outcome.value) : throwError(() => outcome.thrown)),
    };
  }

  it("passes a successful answer straight through", async () => {
    const answer = await firstValueFrom(
      interceptor.intercept(context, handler({ value: { id: "x" } })),
    );

    expect(answer).toEqual({ id: "x" });
  });

  it("turns a constraint violation into its envelope", async () => {
    const thrown = failure(UNIQUE_VIOLATION, "tenant_domains_domain_key");

    const caught = await firstValueFrom(interceptor.intercept(context, handler({ thrown }))).catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).envelope().code).toBe(TENANCY_ERRORS.domainTaken);
  });

  it("re-throws anything else exactly as it was", async () => {
    // A genuine failure has to reach the filter as one, or a bug in this service becomes a
    // 409 the caller is told to fix.
    const thrown = new Error("connect ECONNREFUSED");

    const caught = await firstValueFrom(interceptor.intercept(context, handler({ thrown }))).catch(
      (error: unknown) => error,
    );

    expect(caught).toBe(thrown);
  });
});

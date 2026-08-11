/**
 * Which tenant a request is operating in, and whether the caller may.
 *
 * The rules, in one place, which is the whole of what the issue asks for: *resolution and
 * authorization of that context must be centralized, not re-implemented per controller*.
 * The guard beside this file is the plumbing; this is the decision.
 *
 * ## Where the tenant comes from
 *
 * Three sources, most specific first:
 *
 *   1. **The `{tenantId}` path parameter**, on the routes that have one. It is more
 *      specific than a header by construction — the caller wrote it into the URL — and it
 *      is what closes the leak the issue is really about: without this, a signed-in person
 *      could read `/api/v1/tenants/{anybody-elses-id}` and the `404` rule would apply to
 *      nothing.
 *   2. **The `X-Ouro-Tenant` header**, a slug or a uuid. This is how a workspace switcher
 *      names the active tenant on a route with no tenant in its path — which is every route
 *      the epic adds after this one.
 *   3. **A sole membership.** Somebody who belongs to exactly one tenant is unambiguously
 *      operating in it, and making them repeat that on every request would be ceremony.
 *      Somebody who belongs to several is asked to say which.
 *
 * A path and a header that name *different* tenants are refused rather than resolved by
 * precedence — see `tenancy.errors.ts`.
 *
 * ## What the answer may say
 *
 * A tenant that does not exist and a tenant the caller is not a member of are the **same
 * `404`**. That is the issue's *no existence leaks*, and it is why membership is checked
 * here rather than in each service: a `403` would confirm that an identifier names
 * something real, which is exactly what somebody enumerating identifiers wants to know.
 * The only `403` this module answers is for a caller who has *already* proved membership
 * and whose role is too low — see `roles.guard.ts`.
 */

import { Injectable } from "@nestjs/common";

import type { Tenant, User } from "../db/schema";
import { MembersRepository } from "./members.repository";
import type { ActiveMembership } from "./tenant.context";
import { tenantMismatch, tenantNotFound, tenantRequired } from "./tenancy.errors";
import { TenantsRepository } from "./tenants.repository";

/** The header a client names the active tenant in. Lower-case, as Node parses headers. */
export const TENANT_HEADER = "x-ouro-tenant";

/** The path parameter the tenancy routes address a tenant with. */
export const TENANT_PARAMETER = "tenantId";

/**
 * How a tenant was named.
 *
 * A uuid and a slug are different lookups against different indexes, and deciding which
 * from the *shape* of the value is what lets one header accept both without a second
 * parameter saying which it is.
 */
export type TenantReference =
  | { readonly kind: "id"; readonly value: string }
  | { readonly kind: "slug"; readonly value: string };

/** The canonical shape of a uuid, as `gen_random_uuid()` renders one. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a value as a reference to a tenant.
 *
 * @param value - What the caller wrote, already trimmed.
 * @returns A reference, or `undefined` when the value is empty. Anything that is not a uuid
 *   is treated as a slug — including a value that is neither, which then simply matches no
 *   row and becomes a `404`. Validating the slug's shape here would be a second, weaker
 *   copy of `tenants_slug_format` whose only effect would be to answer `422` where the
 *   answer is already `404`.
 */
export function referenceFrom(value: string): TenantReference | undefined {
  const trimmed = value.trim();

  if (trimmed === "") {
    return undefined;
  }

  return UUID_PATTERN.test(trimmed)
    ? { kind: "id", value: trimmed }
    : { kind: "slug", value: trimmed };
}

/**
 * The reference a request carries in its `X-Ouro-Tenant` header, if any.
 *
 * @param headers - The request's headers, as the adapter parsed them — lower-cased keys.
 * @returns The reference, or `undefined` when the header is absent or blank. An array —
 *   which is what a repeated header parses to — is refused rather than having one of its
 *   values picked: two different tenants in two headers is not a request with an obvious
 *   meaning.
 */
export function headerReference(headers: TenantHeaders | undefined): TenantReference | undefined {
  const value = headers?.[TENANT_HEADER];

  return typeof value === "string" ? referenceFrom(value) : undefined;
}

/** The part of a request's headers this module reads. */
export type TenantHeaders = Record<string, string | string[] | undefined>;

/** The part of a request's route parameters this module reads. */
export type TenantParameters = Record<string, string | undefined>;

/**
 * The reference a request carries in its path, if any.
 *
 * **Only a uuid.** The path parameter is documented as one and every DTO validates it as
 * one, so a value that is not a uuid is not a tenant this route could have addressed — it is
 * a malformed request, and the validation pipe is what says so. Reading it as a slug here
 * would answer `404` a guard's-worth earlier than that, turning "your uuid is malformed"
 * into "no such workspace" and losing the `details.tenantId` a form needs to render the
 * complaint.
 *
 * The header is the opposite case and reads both, because a slug is what a person types.
 *
 * @param params - The route parameters, populated by the router before any guard runs.
 * @returns The reference, or `undefined` on a route with no `{tenantId}` — and on one whose
 *   `{tenantId}` is not a uuid, which then falls through to the header or the caller's sole
 *   membership and is refused by the pipe a moment later.
 */
export function pathReference(params: TenantParameters | undefined): TenantReference | undefined {
  const value = params?.[TENANT_PARAMETER];
  const reference = typeof value === "string" ? referenceFrom(value) : undefined;

  return reference?.kind === "id" ? reference : undefined;
}

/**
 * Does this request address a tenant in its path with something that is not a uuid?
 *
 * The guard skips resolution entirely when it does, and lets the validation pipe answer —
 * see `tenant.guard.ts`. Without that, `GET /api/v1/tenants/not-a-uuid` would be answered by
 * whichever check happened to run first, and *which* check that is would depend on how many
 * workspaces the caller belongs to: `tenant_required` for somebody in none, and
 * `validation_failed` for somebody in exactly one. One malformed request, two answers.
 *
 * @param params - The route parameters.
 * @returns `true` when there is a `{tenantId}` and it is not a uuid.
 */
export function pathTenantIsMalformed(params: TenantParameters | undefined): boolean {
  const value = params?.[TENANT_PARAMETER];

  return typeof value === "string" && pathReference(params) === undefined;
}

@Injectable()
export class TenantResolver {
  /**
   * @param tenants - For looking a tenant up by id or by slug.
   * @param members - For the membership that authorizes the request, and the role in it.
   */
  constructor(
    private readonly tenants: TenantsRepository,
    private readonly members: MembersRepository,
  ) {}

  /**
   * Resolve the tenant this request operates in, and the membership that permits it.
   *
   * @param user - The signed-in person, from the session guard.
   * @param headers - The request's headers.
   * @param params - The request's route parameters.
   * @returns The tenant and the caller's role in it.
   * @throws {InvalidRequestError} `422 tenant_mismatch` when the path and the header
   *   disagree, or `422 tenant_required` when neither names one and the caller does not
   *   belong to exactly one tenant.
   * @throws {NotFoundError} `404 tenant_not_found` when the tenant does not exist **or** the
   *   caller is not a member of it. One answer for both, deliberately.
   */
  async resolve(
    user: User,
    headers: TenantHeaders | undefined,
    params: TenantParameters | undefined,
  ): Promise<ActiveMembership> {
    const reference = await this.referenceFor(user, headers, params);
    const tenant = await this.find(reference);

    // Both branches answer the same way: a tenant that does not exist and one this caller
    // may not know about are indistinguishable from outside, which is the point.
    if (tenant === undefined) {
      throw tenantNotFound(reference.value);
    }

    const membership = await this.members.find(tenant.id, user.id);

    if (membership === undefined) {
      throw tenantNotFound(reference.value);
    }

    return { tenant, role: membership.role };
  }

  /**
   * Which tenant this request named, from whichever source named one.
   *
   * @param user - The signed-in person, for the sole-membership fallback.
   * @param headers - The request's headers.
   * @param params - The request's route parameters.
   * @returns The reference to resolve.
   * @throws {InvalidRequestError} When the two explicit sources disagree, or when neither
   *   spoke and the caller's memberships do not answer on their own.
   */
  private async referenceFor(
    user: User,
    headers: TenantHeaders | undefined,
    params: TenantParameters | undefined,
  ): Promise<TenantReference> {
    const path = pathReference(params);
    const header = headerReference(headers);

    if (path !== undefined && header !== undefined && !(await this.sameTenant(path, header))) {
      throw tenantMismatch(path.value, header.value);
    }

    const named = path ?? header;

    if (named !== undefined) {
      return named;
    }

    const sole = await this.soleMembership(user);

    if (sole === undefined) {
      throw tenantRequired();
    }

    return { kind: "id", value: sole };
  }

  /**
   * Do two references name the same tenant?
   *
   * Compared by *resolution* rather than by string, because one may be a uuid and the other
   * the slug of the same row — a workspace switcher sending a slug on a path built from an
   * id is the ordinary case, not a mistake.
   *
   * @param path - What the path named.
   * @param header - What the header named.
   * @returns Whether they resolve to one tenant. Two references that both resolve to nothing
   *   are *not* the same tenant unless they are the same string: answering `404` for one of
   *   them is more useful than `422` about both.
   */
  private async sameTenant(path: TenantReference, header: TenantReference): Promise<boolean> {
    if (path.kind === header.kind && path.value === header.value) {
      return true;
    }

    const [left, right] = await Promise.all([this.find(path), this.find(header)]);

    return left !== undefined && left.id === right?.id;
  }

  /**
   * Look a reference up.
   *
   * @param reference - What the caller named.
   * @returns The tenant, or `undefined`.
   */
  private async find(reference: TenantReference): Promise<Tenant | undefined> {
    return reference.kind === "id"
      ? this.tenants.find(reference.value)
      : this.tenants.findBySlug(reference.value);
  }

  /**
   * The tenant a person belongs to, when they belong to exactly one.
   *
   * @param user - The signed-in person.
   * @returns Its id, or `undefined` when they belong to none or to several. Reads two rows
   *   rather than counting: the count and the id are wanted together, and `limit 2` answers
   *   "exactly one?" with the id in the same statement.
   */
  private async soleMembership(user: User): Promise<string | undefined> {
    const tenantIds = await this.members.tenantIdsFor(user.id, SOLE_MEMBERSHIP_LIMIT);

    return tenantIds.length === 1 ? tenantIds[0] : undefined;
  }
}

/**
 * How many memberships the sole-membership fallback reads.
 *
 * Two, which is the smallest number that can tell "exactly one" from "more than one".
 * Reading them all would make a person in fifty workspaces pay for a question whose answer
 * is decided by the second row.
 */
export const SOLE_MEMBERSHIP_LIMIT = 2;

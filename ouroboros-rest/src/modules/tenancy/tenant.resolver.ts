/**
 * Which workspace a request is operating in, and whether the caller may.
 *
 * The rules, in one place, which is what
 * [#32](https://github.com/NobuData/ouroboros/issues/32) asked for and what
 * [#713](https://github.com/NobuData/ouroboros/issues/713) has now changed the answer of:
 * *resolution and authorization of that context must be centralized, not re-implemented per
 * controller*. The guard beside this file is the plumbing; this is the decision.
 *
 * ## What #713 changed, and why
 *
 * #32 let the **client assert** the workspace: an `X-Ouro-Tenant` header, checked against
 * `tenant_members`, falling back to a sole membership. Two things then moved underneath it.
 * [#704](https://github.com/NobuData/ouroboros/issues/704) put `activeOrganizationId` on the
 * session row, which is *server* state — the plugin's `setActiveOrganization` is the only
 * thing that writes it — and [#708](https://github.com/NobuData/ouroboros/issues/708) dropped
 * `tenant_members` outright. So the session became both the better source of truth and the
 * only surviving one, and the header became an override rather than the answer.
 *
 * The sole-membership fallback went with it, and lost nothing: `active.organization.ts` picks
 * a person's earliest membership when their session is created, so somebody who belongs to
 * exactly one workspace has that workspace on their session already. What used to be inferred
 * per request is now decided once, at sign-in, where the person can also change it.
 *
 * ## Where the workspace comes from
 *
 * Three sources, most specific first:
 *
 *   1. **The `{tenantId}` path parameter**, on the routes that have one. It is more specific
 *      than anything else by construction — the caller wrote it into the URL — and it is what
 *      closes the leak the original issue was about: without it, a signed-in person could
 *      read `/api/v1/tenants/{anybody-elses-id}` and the `404` rule would apply to nothing.
 *   2. **The `X-Ouro-Tenant` header**, a slug or a uuid: an explicit, per-request override of
 *      where the session says the caller is acting. It is how one request steps outside the
 *      active workspace without the session being changed for every other request in flight.
 *   3. **The session's `activeOrganizationId`.** The ordinary case, and the one that carries
 *      every request a browser makes.
 *
 * A path and a header that name *different* workspaces are refused rather than resolved by
 * precedence — see `tenancy.errors.ts`. A header and a *session* that disagree are not: that
 * is what an override is.
 *
 * ## What the answer may say
 *
 * A workspace that does not exist and a workspace the caller is not a member of are the
 * **same `404`**. That is the *no existence leaks* rule, and it is why membership is checked
 * here rather than in each service: a `403` would confirm that an identifier names something
 * real, which is exactly what somebody enumerating identifiers wants to know. The only `403`
 * this module answers is for a caller who has *already* proved membership and whose role is
 * too low — see `roles.guard.ts`.
 *
 * A **session** that resolves to nothing is the one case that is not a `404`, and the
 * difference is who asserted the identifier. Nobody enumerating anything reaches it: the
 * caller named nothing, and the pointer they are being refused on is one this service wrote
 * onto their own session. What they need is to choose a workspace, so they are told to —
 * `400 organization_required`, which is the code mockup 01 Step 2 acts on. Answering `404`
 * there would leave somebody whose workspace was deleted, or who was removed from it, with
 * every request failing and nothing to say what to do about it.
 */

import { Injectable } from "@nestjs/common";

import type { Organization, OrganizationRole } from "../db/schema";
import { OrganizationRepository, type OrganizationReference } from "./organization.repository";
import type { ActiveMembership } from "./tenant.context";
import { organizationRequired, tenantMismatch, tenantNotFound } from "./tenancy.errors";

/** The header a client names the active workspace in. Lower-case, as Node parses headers. */
export const TENANT_HEADER = "x-ouro-tenant";

/** The path parameter the tenancy routes address a workspace with. */
export const TENANT_PARAMETER = "tenantId";

/** The canonical shape of a uuid, as `gen_random_uuid()` renders one. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a value as a reference to a workspace.
 *
 * @param value - What the caller wrote, already trimmed.
 * @returns A reference, or `undefined` when the value is empty. Anything that is not a uuid
 *   is treated as a slug — including a value that is neither, which then simply matches no
 *   row and becomes a `404`. Validating the slug's shape here would be a second, weaker copy
 *   of a rule the organization plugin already applies to what it writes, and its only effect
 *   would be to answer `422` where the answer is already `404`.
 */
export function referenceFrom(value: string): OrganizationReference | undefined {
  const trimmed = value.trim();

  if (trimmed === "") {
    return undefined;
  }

  return UUID_PATTERN.test(trimmed)
    ? { kind: "id", value: trimmed }
    : { kind: "slug", value: trimmed };
}

/** The part of a request's headers this module reads. */
export type TenantHeaders = Record<string, string | string[] | undefined>;

/** The part of a request's route parameters this module reads. */
export type TenantParameters = Record<string, string | undefined>;

/**
 * The reference a request carries in its `X-Ouro-Tenant` header, if any.
 *
 * @param headers - The request's headers, as the adapter parsed them — lower-cased keys.
 * @returns The reference, or `undefined` when the header is absent or blank. An array —
 *   which is what a repeated header parses to — is refused rather than having one of its
 *   values picked: two different workspaces in two headers is not a request with an obvious
 *   meaning.
 */
export function headerReference(
  headers: TenantHeaders | undefined,
): OrganizationReference | undefined {
  const value = headers?.[TENANT_HEADER];

  return typeof value === "string" ? referenceFrom(value) : undefined;
}

/**
 * The reference a request carries in its path, if any.
 *
 * **Only a uuid.** The path parameter is documented as one and every DTO validates it as one,
 * so a value that is not a uuid is not a workspace this route could have addressed — it is a
 * malformed request, and the validation pipe is what says so. Reading it as a slug here would
 * answer `404` a guard's-worth earlier than that, turning "your uuid is malformed" into "no
 * such workspace" and losing the `details.tenantId` a form needs to render the complaint.
 *
 * The header is the opposite case and reads both, because a slug is what a person types.
 *
 * @param params - The route parameters, populated by the router before any guard runs.
 * @returns The reference, or `undefined` on a route with no `{tenantId}` — and on one whose
 *   `{tenantId}` is not a uuid, which then falls through to the header or the session and is
 *   refused by the pipe a moment later.
 */
export function pathReference(
  params: TenantParameters | undefined,
): OrganizationReference | undefined {
  const value = params?.[TENANT_PARAMETER];
  const reference = typeof value === "string" ? referenceFrom(value) : undefined;

  return reference?.kind === "id" ? reference : undefined;
}

/**
 * Does this request address a workspace in its path with something that is not a uuid?
 *
 * The guard skips resolution entirely when it does, and lets the validation pipe answer — see
 * `tenant.guard.ts`. Without that, `GET /api/v1/tenants/not-a-uuid` would be answered by
 * whichever check happened to run first: `organization_required` for a session acting nowhere,
 * and `validation_failed` for one acting somewhere. One malformed request, two answers.
 *
 * @param params - The route parameters.
 * @returns `true` when there is a `{tenantId}` and it is not a uuid.
 */
export function pathTenantIsMalformed(params: TenantParameters | undefined): boolean {
  const value = params?.[TENANT_PARAMETER];

  return typeof value === "string" && pathReference(params) === undefined;
}

/**
 * Everything about one request that decides which workspace it is in.
 *
 * An object rather than three positional parameters, because the session pointer made it four
 * and because two of them are strings that would otherwise be interchangeable at a call site.
 * The caller is `tenant.guard.ts`, which is the one thing that can see all four.
 */
export interface TenantRequestFacts {
  /**
   * Who is asking — `"user".id`, from the session the authentication guard resolved.
   *
   * The id alone, deliberately. Resolution needs nothing else about the person, and taking a
   * whole row here would tie this file to whichever table that row came from — which is
   * precisely the coupling #708 has just spent a migration undoing.
   */
  readonly userId: string;
  /**
   * Where the session says this person is acting — `session.activeOrganizationId` (V005).
   *
   * `null` or absent for a session that is signed in and acting nowhere, which is a valid
   * state the column is nullable to hold: a person who belongs to nothing yet, or whose
   * workspace was deleted out from under them (V005 nulls the pointer rather than leaving it
   * dangling).
   */
  readonly activeOrganizationId?: string | null;
  /** The request's headers, for the `X-Ouro-Tenant` override. */
  readonly headers?: TenantHeaders;
  /** The request's route parameters, for a `{tenantId}` in the path. */
  readonly params?: TenantParameters;
}

@Injectable()
export class TenantResolver {
  /**
   * @param organizations - Where workspaces and memberships are read from. One repository
   *   because a membership is only ever wanted beside the workspace it is in.
   */
  constructor(private readonly organizations: OrganizationRepository) {}

  /**
   * Resolve the workspace this request operates in, and the membership that permits it.
   *
   * @param facts - The request, as {@link TenantRequestFacts} describes it.
   * @returns The workspace and the roles the caller holds in it.
   * @throws {InvalidRequestError} `422 tenant_mismatch` when the path and the header name
   *   different workspaces.
   * @throws {NotFoundError} `404 tenant_not_found` when a workspace the *request* named does
   *   not exist **or** the caller is not a member of it. One answer for both, deliberately.
   * @throws {BadRequestError} `400 organization_required` when the request named none and the
   *   session's active workspace is absent, deleted, or one the caller no longer belongs to.
   */
  async resolve(facts: TenantRequestFacts): Promise<ActiveMembership> {
    const named = await this.namedReference(facts);

    return named === undefined ? this.fromSession(facts) : this.fromReference(named, facts.userId);
  }

  /**
   * The workspace this request named, from whichever of the two explicit sources named one.
   *
   * @param facts - The request.
   * @returns The reference, or `undefined` when neither the path nor the header named
   *   anything — which is the ordinary case and the one the session answers.
   * @throws {InvalidRequestError} When the two explicit sources disagree.
   */
  private async namedReference(
    facts: TenantRequestFacts,
  ): Promise<OrganizationReference | undefined> {
    const path = pathReference(facts.params);
    const header = headerReference(facts.headers);

    if (
      path !== undefined &&
      header !== undefined &&
      !(await this.sameOrganization(path, header))
    ) {
      throw tenantMismatch(path.value, header.value);
    }

    return path ?? header;
  }

  /**
   * Resolve a workspace the request named itself.
   *
   * @param reference - What the path or the header named.
   * @param userId - The caller.
   * @returns The workspace and the caller's roles in it.
   * @throws {NotFoundError} When it does not exist, or the caller is not a member. Both
   *   branches answer the same way: a workspace that does not exist and one this caller may
   *   not know about are indistinguishable from outside, which is the point.
   */
  private async fromReference(
    reference: OrganizationReference,
    userId: string,
  ): Promise<ActiveMembership> {
    const organization = await this.organizations.find(reference);

    if (organization === undefined) {
      throw tenantNotFound(reference.value);
    }

    const roles = await this.rolesIn(organization, userId);

    if (roles === undefined) {
      throw tenantNotFound(reference.value);
    }

    return { tenant: organization, roles };
  }

  /**
   * Resolve the workspace the session says the caller is acting in.
   *
   * Every failure here is the same `400`, and the sameness is the design: the caller named
   * nothing, so there is no identifier of theirs to confirm or deny, and the three ways this
   * can fail — no pointer, a pointer to a workspace that is gone, a pointer to one they have
   * been removed from — all have the same remedy. Choose a workspace.
   *
   * @param facts - The request.
   * @returns The workspace and the caller's roles in it.
   * @throws {BadRequestError} `400 organization_required` in every other case.
   */
  private async fromSession(facts: TenantRequestFacts): Promise<ActiveMembership> {
    const activeOrganizationId = facts.activeOrganizationId;

    if (activeOrganizationId === undefined || activeOrganizationId === null) {
      throw organizationRequired();
    }

    const organization = await this.organizations.find({
      kind: "id",
      value: activeOrganizationId,
    });

    if (organization === undefined) {
      throw organizationRequired();
    }

    const roles = await this.rolesIn(organization, facts.userId);

    if (roles === undefined) {
      throw organizationRequired();
    }

    return { tenant: organization, roles };
  }

  /**
   * What this person may do in this workspace.
   *
   * @param organization - The workspace, already found.
   * @param userId - The caller.
   * @returns Their roles, or `undefined` when they are not a member — which is the answer
   *   both callers above turn into a refusal, at different statuses and for the reasons each
   *   gives.
   */
  private async rolesIn(
    organization: Organization,
    userId: string,
  ): Promise<OrganizationRole[] | undefined> {
    return this.organizations.rolesFor(organization.id, userId);
  }

  /**
   * Do two references name the same workspace?
   *
   * Compared by *resolution* rather than by string, because one may be a uuid and the other
   * the slug of the same row — a workspace switcher sending a slug on a path built from an id
   * is the ordinary case, not a mistake.
   *
   * @param path - What the path named.
   * @param header - What the header named.
   * @returns Whether they resolve to one workspace. Two references that both resolve to
   *   nothing are *not* the same workspace unless they are the same string: answering `404`
   *   for one of them is more useful than `422` about both.
   */
  private async sameOrganization(
    path: OrganizationReference,
    header: OrganizationReference,
  ): Promise<boolean> {
    if (path.kind === header.kind && path.value === header.value) {
      return true;
    }

    const [left, right] = await Promise.all([
      this.organizations.find(path),
      this.organizations.find(header),
    ]);

    return left !== undefined && left.id === right?.id;
  }
}

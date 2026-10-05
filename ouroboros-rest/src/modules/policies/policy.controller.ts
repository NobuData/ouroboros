/**
 * `/api/v1/policies` — the org policy document: its read, a draft's classification and the
 * publish (BQ.2, [#481](https://github.com/NobuData/ouroboros/issues/481)).
 *
 * ```
 * GET  /policies           every member — the version in force, verbatim (the card's `policy v7`)
 * GET  /policies/versions  every member — the history, newest first, each with its diff (BS.4, #494)
 * POST /policies/preview   owner/admin  — what a draft changes, per rule, and whether this caller may publish it
 * POST /policies           owner/admin  — publish vN+1; a loosening is the owner's alone
 * ```
 *
 * **The reads are every member's**, like the dry-run read: the inbox's *What Needs A Human* card and
 * the settings card both state the policy, and a viewer is shown what governs their loops.
 *
 * **Publishing is `owner`/`admin`** (`@Roles(...ADMINISTRATORS)`), and among them a **loosening**
 * edit — one that lets more run without a person — is the owner's: the service refuses an admin
 * with `403 policy_loosening_requires_owner`, naming the loosening rules. The preview says so before
 * anybody presses publish. Every publish is audited as `policy.published`.
 *
 * **The workspace is the session's, never the request's** — no `{orgId}` in the path.
 */

import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";

import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { currentUser, type ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember } from "../tenancy/tenant.decorators";
import { PolicyVersionsQuery, PreviewPolicyDto, PublishPolicyDto } from "./org-policy.dto";
import { PolicyHistoryService, type PolicyVersionListResource } from "./policy-history.service";
import {
  PolicyPublishService,
  type PolicyActor,
  type PolicyPreviewResource,
  type PolicyResource,
  type PublishedPolicyResource,
} from "./policy-publish.service";

@Controller("policies")
export class PolicyController {
  /**
   * @param publisher - The publish flow.
   * @param history - The version history.
   */
  constructor(
    private readonly publisher: PolicyPublishService,
    private readonly history: PolicyHistoryService,
  ) {}

  /**
   * The version in force.
   *
   * @param member - The membership.
   * @returns The document verbatim, or `version: null` when nothing is published.
   */
  @Get()
  read(@CurrentMember() member: ActiveMembership): Promise<PolicyResource> {
    return this.publisher.read(member.tenant.id);
  }

  /**
   * The published versions, newest first — the `policy vN` tag's history popover.
   *
   * @param member - The membership.
   * @param query - The page: `limit`, and `before` to continue.
   * @returns Each version with its note, publisher and the rules it changed.
   */
  @Get("versions")
  versions(
    @CurrentMember() member: ActiveMembership,
    @Query() query: PolicyVersionsQuery,
  ): Promise<PolicyVersionListResource> {
    return this.history.list(member.tenant.id, query.limit, query.before ?? null);
  }

  /**
   * What publishing a draft would do — writes nothing.
   *
   * @param member - The membership.
   * @param body - The draft.
   * @returns Each changed rule's class, and whether this caller may publish it.
   */
  @Post("preview")
  @HttpCode(200)
  @Roles(...ADMINISTRATORS)
  preview(
    @CurrentMember() member: ActiveMembership,
    @Body() body: PreviewPolicyDto,
  ): Promise<PolicyPreviewResource> {
    return this.publisher.preview(member.tenant.id, actorOf(member), body.document);
  }

  /**
   * Publish the next version.
   *
   * @param member - The membership.
   * @param body - The document, the version it was edited from, and why.
   * @returns The version published and what it changed.
   */
  @Post()
  @HttpCode(201)
  @Roles(...ADMINISTRATORS)
  publish(
    @CurrentMember() member: ActiveMembership,
    @Body() body: PublishPolicyDto,
  ): Promise<PublishedPolicyResource> {
    return this.publisher.publish(member.tenant.id, actorOf(member), {
      document: body.document,
      baseVersion: body.baseVersion,
      changeNote: body.changeNote ?? null,
    });
  }
}

/**
 * The signed-in person, with their roles here.
 *
 * @param member - The membership.
 * @returns Who is acting.
 * @throws {Error} When there is no signed-in person, which the session guard makes unreachable —
 *   a publish nobody can be named for would be an audit row that lied.
 */
function actorOf(member: ActiveMembership): PolicyActor {
  const user = currentUser();

  if (user === undefined) {
    throw new Error(
      "/api/v1/policies was reached with no signed-in person. The route is neither " +
        "@AllowAnonymous() nor @TenantOptional(), and a policy publish belongs to somebody.",
    );
  }

  return { id: user.id, roles: member.roles };
}

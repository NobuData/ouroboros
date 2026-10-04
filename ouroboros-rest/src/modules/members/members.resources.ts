/**
 * What `GET /settings/members` publishes — the Members & Roles card's rows
 * ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 *
 * Every column is data the API enforces: `role` is the plugin's, `displayRole` is S3's mapping of
 * it, `canApproveLoops` is what the capability guard checks, `lastActiveAt` is the session table's
 * own timestamp (`null` — rendered `—` — when there is none, never a guess).
 */

import type { OrganizationRole } from "../db/schema";
import { effectiveCanApproveLoops } from "../tenancy/capabilities";
import { rolesFrom } from "../tenancy/organization.repository";
import type { InvitationRow, MemberRow, ServiceMemberRow } from "./members.repository";
import { displayRoleOf, type DisplayRole } from "./members.roles";
import type { DirectorySyncResource } from "./members.sync";

/** One person in the workspace. */
export interface MemberResource {
  /** `member.id` — what `PATCH`/`DELETE` address. */
  id: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  /** The plugin's roles — the enforcement. */
  roles: OrganizationRole[];
  /** S3's label for them. */
  displayRole: DisplayRole;
  /** Whether this is the caller — the card's `you` tag. */
  you: boolean;
  /** What the capability guard will decide. */
  canApproveLoops: boolean;
  /** `explicit` when an administrator set it, `role` when it is the role's default. */
  canApproveLoopsSource: "explicit" | "role";
  /** The newest session activity, or `null` when there is none. */
  lastActiveAt: string | null;
  joinedAt: string;
}

/** A pending invitation — the card's dimmed row. */
export interface InvitationResource {
  id: string;
  email: string;
  roles: OrganizationRole[];
  displayRole: DisplayRole;
  /** When it was sent — the card's *invited 2h ago*. A resend does not move it. */
  invitedAt: string;
  expiresAt: string;
  /** Past its expiry: it can be resent, but not accepted. */
  expired: boolean;
}

/** A service account, as the card's `Service` row. */
export interface ServiceMemberResource {
  id: string;
  name: string;
  /** `service:devops-bot`, as the audit trail names it. */
  actor: string;
  displayRole: "Service";
  scopes: string[];
  canApproveLoops: false;
  /** When its live token last authenticated a request, or `null`. */
  lastActiveAt: string | null;
}

/** The card's footer. */
export interface MembersFooterResource {
  /** `Owner > Maintainer (approve/merge) > Viewer (read-only)`, from the enforced mapping. */
  hierarchy: string;
  /** The IdP sync line — `null` until SCIM (BT.1) exists and syncs. */
  directorySync: DirectorySyncResource | null;
}

/** `GET /settings/members`. */
export interface MembersPageResource {
  members: MemberResource[];
  invitations: InvitationResource[];
  serviceAccounts: ServiceMemberResource[];
  /** Whether the caller may invite, change roles and set capabilities (owner or admin). */
  canManage: boolean;
  footer: MembersFooterResource;
}

/**
 * Render one member.
 *
 * @param row - The stored member.
 * @param callerId - The caller's user id, for `you`.
 * @returns The resource.
 */
export function memberResource(row: MemberRow, callerId: string): MemberResource {
  const roles = rolesFrom(row.role);

  return {
    id: row.member_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    image: row.image,
    roles,
    displayRole: displayRoleOf(roles),
    you: row.user_id === callerId,
    canApproveLoops: effectiveCanApproveLoops(roles, row.can_approve_loops),
    canApproveLoopsSource: row.can_approve_loops === null ? "role" : "explicit",
    lastActiveAt: row.last_active_at?.toISOString() ?? null,
    joinedAt: row.joined_at.toISOString(),
  };
}

/**
 * Render one pending invitation.
 *
 * @param row - The stored invitation.
 * @param now - The current instant, for `expired`.
 * @returns The resource.
 */
export function invitationResource(row: InvitationRow, now: Date): InvitationResource {
  const roles = rolesFrom(row.role ?? "member");

  return {
    id: row.id,
    email: row.email,
    roles,
    displayRole: displayRoleOf(roles),
    invitedAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    expired: row.expires_at.getTime() <= now.getTime(),
  };
}

/**
 * Render one service account as a member row.
 *
 * @param row - The stored account.
 * @returns The resource.
 */
export function serviceMemberResource(row: ServiceMemberRow): ServiceMemberResource {
  return {
    id: row.id,
    name: row.name,
    actor: `service:${row.name}`,
    displayRole: "Service",
    scopes: [...row.scopes],
    canApproveLoops: false,
    lastActiveAt: row.last_used_at?.toISOString() ?? null,
  };
}

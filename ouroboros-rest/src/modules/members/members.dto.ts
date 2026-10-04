/**
 * The Members card's request bodies ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 *
 * Roles are the plugin's names (`owner | admin | member | viewer`), never the display labels:
 * the API speaks the vocabulary it enforces, and the card maps it (`members.roles.ts`).
 */

import { IsBoolean, IsEmail, IsIn, IsOptional } from "class-validator";

import type { OrganizationRole } from "../db/schema";
import { KNOWN_ROLES } from "../tenancy/organization.repository";

/** `POST /settings/members/invitations`. */
export class InviteMemberDto {
  /** Who to invite. */
  @IsEmail({}, { message: "email must be an email address" })
  email!: string;

  /** The role they will hold on accepting. */
  @IsIn(KNOWN_ROLES, { message: `role must be one of ${KNOWN_ROLES.join(", ")}` })
  role!: OrganizationRole;
}

/** `PATCH /settings/members/:memberId` — either field, or both. */
export class UpdateMemberDto {
  /** The new role. */
  @IsOptional()
  @IsIn(KNOWN_ROLES, { message: `role must be one of ${KNOWN_ROLES.join(", ")}` })
  role?: OrganizationRole;

  /** An explicit `can_approve_loops` setting, which then survives role changes. */
  @IsOptional()
  @IsBoolean({ message: "canApproveLoops must be true or false" })
  canApproveLoops?: boolean;
}

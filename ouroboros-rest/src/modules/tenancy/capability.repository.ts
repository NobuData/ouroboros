/**
 * The `member_capabilities` read the capability guard makes on every approval
 * ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 *
 * One statement, kept apart from the members module's writes so the guard — which runs on
 * every request to an approval route — depends on nothing but this.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";

@Injectable()
export class CapabilityRepository {
  /**
   * @param database - The pool owner.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A member's explicit `can_approve_loops` setting.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @returns The stored value, or `null` when nobody has set it (the role default applies) or
   *   the person is not a member.
   */
  async explicitFor(organizationId: string, userId: string): Promise<boolean | null> {
    const row = await this.database.db
      .selectFrom("member_capabilities")
      .innerJoin("member", "member.id", "member_capabilities.member_id")
      .select("member_capabilities.can_approve_loops")
      .where("member.organizationId", "=", organizationId)
      .where("member.userId", "=", userId)
      .executeTakeFirst();

    return row?.can_approve_loops ?? null;
  }
}

/**
 * Every statement the on-call designee issues (CA.3,
 * [#543](https://github.com/NobuData/ouroboros/issues/543)), over V132's `on_call_assignments`
 * and `chat_identity_links`. Statements only: who may be named, and the audit, are the service's.
 *
 * **Nothing here deletes.** An assignment that ends is switched to `active = false` and kept, as
 * V132 keeps every earlier one.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { ON_CALL_SCOPE } from "../chat/chat.outbox";
import { DatabaseService } from "../db/db.service";
import type { Database } from "../db/schema";

/** A member of the workspace, by the name the page prints. */
export interface OnCallMember {
  /** The `member` row's id. */
  readonly memberId: string;
  /** The person's name. */
  readonly name: string;
}

/** The workspace's active assignment. */
export interface OnCallDesignee extends OnCallMember {
  readonly assignedAt: Date;
}

@Injectable()
export class SlackOnCallRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The person on call for decisions — the workspace's one active assignment of the scope.
   *
   * @param organizationId - The workspace.
   * @returns The designee, or `undefined` when nobody is on call.
   */
  async designee(organizationId: string): Promise<OnCallDesignee | undefined> {
    const row = await this.database.db
      .selectFrom("on_call_assignments as a")
      .innerJoin("member as m", "m.id", "a.member_id")
      .innerJoin("user as u", "u.id", "m.userId")
      .select(["m.id", "u.name", "a.assigned_at"])
      .where("a.organization_id", "=", organizationId)
      .where("a.scope", "=", ON_CALL_SCOPE)
      .where("a.active", "=", true)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { memberId: row.id, name: row.name, assignedAt: row.assigned_at };
  }

  /**
   * The members an on-call DM could reach: those with a linked identity on the workspace's
   * active Slack connection — the rule V132's `on_call_assignments_designee_linked` enforces.
   *
   * @param organizationId - The workspace.
   * @returns The members, in no particular order.
   */
  async linkedMembers(organizationId: string): Promise<OnCallMember[]> {
    const rows = await this.database.db
      .selectFrom("chat_identity_links as l")
      .innerJoin("chat_connections_public as c", "c.id", "l.connection_id")
      .innerJoin("member as m", "m.id", "l.member_id")
      .innerJoin("user as u", "u.id", "m.userId")
      .select(["m.id", "u.name"])
      .where("c.organization_id", "=", organizationId)
      .where("c.platform", "=", "slack")
      .where("c.status", "=", "active")
      .where("l.state", "=", "linked")
      .execute();

    return rows.map((row) => ({ memberId: row.id, name: row.name }));
  }

  /**
   * One member of the workspace, by their member row.
   *
   * @param organizationId - The workspace.
   * @param memberId - The `member` row's id.
   * @returns The member, or `undefined` for another workspace's or nobody's.
   */
  async member(organizationId: string, memberId: string): Promise<OnCallMember | undefined> {
    const row = await this.database.db
      .selectFrom("member as m")
      .innerJoin("user as u", "u.id", "m.userId")
      .select(["m.id", "u.name"])
      .where("m.organizationId", "=", organizationId)
      .where("m.id", "=", memberId)
      .executeTakeFirst();

    return row === undefined ? undefined : { memberId: row.id, name: row.name };
  }

  /**
   * Run work in one transaction.
   *
   * @param work - The statements.
   * @returns What the work returned.
   */
  transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * Who is on call now, with the assignment locked for the change that read it.
   *
   * @param trx - The change's transaction.
   * @param organizationId - The workspace.
   * @returns The active assignment's member id, or `null` when nobody is on call.
   */
  async lockActive(trx: Transaction<Database>, organizationId: string): Promise<string | null> {
    const row = await trx
      .selectFrom("on_call_assignments")
      .select("member_id")
      .where("organization_id", "=", organizationId)
      .where("scope", "=", ON_CALL_SCOPE)
      .where("active", "=", true)
      .forUpdate()
      .executeTakeFirst();

    return row?.member_id ?? null;
  }

  /**
   * Stand the current designee down: the active assignment is kept, inactive.
   *
   * @param trx - The change's transaction.
   * @param organizationId - The workspace.
   */
  async standDown(trx: Transaction<Database>, organizationId: string): Promise<void> {
    await trx
      .updateTable("on_call_assignments")
      .set({ active: false })
      .where("organization_id", "=", organizationId)
      .where("scope", "=", ON_CALL_SCOPE)
      .where("active", "=", true)
      .execute();
  }

  /**
   * Put a member on call — a new active assignment. The caller has stood the previous one down
   * in the same transaction (`on_call_assignments_one_active`).
   *
   * @param trx - The change's transaction.
   * @param organizationId - The workspace.
   * @param memberId - The member, who has a linked Slack identity.
   * @param assignedBy - The person who chose them.
   */
  async assign(
    trx: Transaction<Database>,
    organizationId: string,
    memberId: string,
    assignedBy: string,
  ): Promise<void> {
    await trx
      .insertInto("on_call_assignments")
      .values({
        organization_id: organizationId,
        member_id: memberId,
        scope: ON_CALL_SCOPE,
        active: true,
        assigned_by: assignedBy,
      })
      .execute();
  }
}

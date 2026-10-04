/**
 * Every statement the decision mails issue (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463))
 * — who may be mailed, V100's `decision_mail_sends` claims, and the last day's resolutions. Raw
 * SQL: none of these tables is part of REST's schema mirror.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { DecisionChannel, OrganizationRole } from "../../db/schema";
import { rolesFrom } from "../../tenancy/organization.repository";
import type { InstantSeverity, StoredPreferences } from "../notifications/preferences.repository";

/** A member who may be mailed, with what decides which actions and mails they get. */
export interface MailRecipient {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly roles: readonly OrganizationRole[];
  /** The stored `can_approve_loops`, or null for the role default. */
  readonly explicitCanApproveLoops: boolean | null;
  /** Their stored preferences, or undefined for the defaults. */
  readonly preferences: StoredPreferences | undefined;
}

/** A person whose digest may be due. */
export interface DigestSubscriber {
  readonly organizationId: string;
  readonly userId: string;
  /** `HH:MM`, UTC. */
  readonly digestTime: string;
}

/** One claim to insert. */
export interface MailClaim {
  readonly organizationId: string;
  readonly userId: string;
  readonly recipient: string;
  readonly attempt: number;
  readonly messageId: string;
}

/** An instant mail that failed (or whose sender died) and may be tried again. */
export interface InstantRetry {
  readonly organizationId: string;
  readonly userId: string;
  readonly itemId: string;
  /** The attempt the retry is. */
  readonly attempt: number;
}

/** A slot's attempts so far. */
export interface SlotAttempts {
  readonly attempts: number;
  readonly sent: boolean;
  /** An attempt still claimed and unsettled within the lease. */
  readonly inFlight: boolean;
}

/** One resolution of the last day, with what its summary is composed from. */
export interface RecentResolution {
  readonly itemId: string;
  readonly kindId: string;
  readonly kindVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly refs: unknown;
  readonly actionId: string;
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly channel: DecisionChannel;
  readonly resolvedAt: Date;
}

/** The longest failure reason a send keeps. */
const MAX_ERROR = 500;

/** The columns a recipient is read from. */
interface RecipientRecord {
  user_id: string;
  email: string;
  name: string;
  role: string;
  can_approve_loops: boolean | null;
  digest_enabled: boolean | null;
  digest_time: string | null;
  instant_severity: InstantSeverity | null;
  muted_kinds: string[] | null;
  updated_at: Date | null;
}

/**
 * A row as a {@link MailRecipient}.
 *
 * @param row - The selected columns.
 * @returns The recipient.
 */
function recipientOf(row: RecipientRecord): MailRecipient {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    roles: rolesFrom(row.role),
    explicitCanApproveLoops: row.can_approve_loops,
    preferences:
      row.updated_at === null
        ? undefined
        : {
            digestEnabled: row.digest_enabled ?? false,
            digestTime: row.digest_time ?? "09:00",
            instantSeverity: row.instant_severity ?? "err",
            mutedKinds: row.muted_kinds ?? [],
            updatedAt: row.updated_at,
          },
  };
}

@Injectable()
export class DecisionMailRepository {
  /** @param database - The service's connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A workspace's members who have an address, with roles, capability and preferences.
   *
   * @param organizationId - The workspace.
   * @param userId - One person only, or undefined for everyone.
   * @returns The recipients, by address.
   */
  async recipients(organizationId: string, userId?: string): Promise<MailRecipient[]> {
    const { rows } = await sql<RecipientRecord>`
      select u."id" as user_id, u."email", u."name", m."role", c.can_approve_loops,
             p.digest_enabled, to_char(p.digest_time, 'HH24:MI') as digest_time,
             p.instant_severity, p.muted_kinds, p.updated_at
        from ouroboros.member m
        join ouroboros."user" u on u."id" = m."userId"
        left join ouroboros.member_capabilities c on c.member_id = m."id"
        left join ouroboros.notification_preferences p
          on p.organization_id = m."organizationId" and p.user_id = m."userId"
       where m."organizationId" = ${organizationId}
         and btrim(coalesce(u."email", '')) <> ''
         and (${userId ?? null}::text is null or u."id" = ${userId ?? null}::text)
       order by u."email", u."id"`.execute(this.database.db);

    return rows.map(recipientOf);
  }

  /**
   * Everyone with the digest on, in every workspace they are still a member of.
   *
   * @returns The subscribers.
   */
  async digestSubscribers(): Promise<DigestSubscriber[]> {
    const { rows } = await sql<{ organization_id: string; user_id: string; digest_time: string }>`
      select p.organization_id, p.user_id, to_char(p.digest_time, 'HH24:MI') as digest_time
        from ouroboros.notification_preferences p
        join ouroboros.member m
          on m."organizationId" = p.organization_id and m."userId" = p.user_id
       where p.digest_enabled
       order by p.organization_id, p.user_id`.execute(this.database.db);

    return rows.map((row) => ({
      organizationId: row.organization_id,
      userId: row.user_id,
      digestTime: row.digest_time,
    }));
  }

  /**
   * Claim an instant mail's attempt.
   *
   * @param claim - The send.
   * @param itemId - The item.
   * @returns The claim's id, or undefined when this attempt was already claimed.
   */
  async claimInstant(claim: MailClaim, itemId: string): Promise<string | undefined> {
    const { rows } = await sql<{ id: string }>`
      insert into ouroboros.decision_mail_sends
             (organization_id, user_id, recipient, kind, item_id, attempt, message_id)
      values (${claim.organizationId}, ${claim.userId}, ${claim.recipient}, 'instant',
              ${itemId}::uuid, ${claim.attempt}::integer, ${claim.messageId})
      on conflict (organization_id, user_id, item_id, attempt) where kind = 'instant' do nothing
      returning id`.execute(this.database.db);

    return rows[0]?.id;
  }

  /**
   * Claim a digest's attempt.
   *
   * @param claim - The send.
   * @param slotAt - The slot.
   * @returns The claim's id, or undefined when this attempt was already claimed.
   */
  async claimDigest(claim: MailClaim, slotAt: Date): Promise<string | undefined> {
    const { rows } = await sql<{ id: string }>`
      insert into ouroboros.decision_mail_sends
             (organization_id, user_id, recipient, kind, slot_at, attempt, message_id)
      values (${claim.organizationId}, ${claim.userId}, ${claim.recipient}, 'digest',
              ${slotAt}, ${claim.attempt}::integer, ${claim.messageId})
      on conflict (organization_id, user_id, slot_at, attempt) where kind = 'digest' do nothing
      returning id`.execute(this.database.db);

    return rows[0]?.id;
  }

  /**
   * Settle a claim once: sent, or failed and why.
   *
   * @param sendId - The claim.
   * @param error - Why it failed; undefined when it was sent.
   */
  async settle(sendId: string, error?: string): Promise<void> {
    const reason = error === undefined ? null : error.trim().slice(0, MAX_ERROR) || "send failed";

    await sql`
      update ouroboros.decision_mail_sends
         set status = ${reason === null ? "sent" : "failed"}, settled_at = now(), error = ${reason}
       where id = ${sendId}::uuid and status = 'claimed'`.execute(this.database.db);
  }

  /**
   * Fail every claim older than the lease that was never settled — its sender died.
   *
   * @param leaseMs - How long a claim may stay unsettled.
   * @returns How many were failed.
   */
  async failAbandoned(leaseMs: number): Promise<number> {
    const result = await sql`
      update ouroboros.decision_mail_sends
         set status = 'failed', settled_at = now(), error = 'the sender stopped before settling'
       where status = 'claimed'
         and claimed_at < now() - make_interval(secs => ${leaseMs / 1000}::double precision)`.execute(
      this.database.db,
    );

    return Number(result.numAffectedRows ?? 0);
  }

  /**
   * Instant mails worth retrying: never sent, last attempt failed, below the limit, and the item
   * still asking.
   *
   * @param maxAttempts - Attempts per person and item.
   * @returns What to retry, with the attempt number each retry is.
   */
  async instantRetries(maxAttempts: number): Promise<InstantRetry[]> {
    const { rows } = await sql<{
      organization_id: string;
      user_id: string;
      item_id: string;
      attempts: number;
    }>`
      select s.organization_id, s.user_id, s.item_id, max(s.attempt)::integer as attempts
        from ouroboros.decision_mail_sends s
        join ouroboros.decision_items i on i.id = s.item_id
       where s.kind = 'instant' and s.user_id is not null
         and i.status in ('open', 'snoozed')
       group by s.organization_id, s.user_id, s.item_id
      having bool_and(s.status = 'failed') and max(s.attempt) < ${maxAttempts}::integer
       order by s.organization_id, s.item_id, s.user_id`.execute(this.database.db);

    return rows.map((row) => ({
      organizationId: row.organization_id,
      userId: row.user_id,
      itemId: row.item_id,
      attempt: row.attempts + 1,
    }));
  }

  /**
   * One person's attempts at one digest slot.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @param slotAt - The slot.
   * @returns How many, whether one was sent, and whether one is still in flight.
   */
  async slotAttempts(organizationId: string, userId: string, slotAt: Date): Promise<SlotAttempts> {
    const { rows } = await sql<{ attempts: number; sent: boolean; in_flight: boolean }>`
      select coalesce(max(attempt), 0)::integer as attempts,
             coalesce(bool_or(status = 'sent'), false) as sent,
             coalesce(bool_or(status = 'claimed'), false) as in_flight
        from ouroboros.decision_mail_sends
       where organization_id = ${organizationId} and user_id = ${userId}
         and kind = 'digest' and slot_at = ${slotAt}`.execute(this.database.db);
    const [row] = rows;

    return {
      attempts: row?.attempts ?? 0,
      sent: row?.sent ?? false,
      inFlight: row?.in_flight ?? false,
    };
  }

  /**
   * The resolutions of the day before an instant.
   *
   * @param organizationId - The workspace.
   * @param until - The end of the window (the digest's slot).
   * @returns The resolutions, newest first.
   */
  async resolvedBefore(organizationId: string, until: Date): Promise<RecentResolution[]> {
    const { rows } = await sql<{
      item_id: string;
      kind_id: string;
      kind_version: number;
      payload: Record<string, unknown>;
      refs: unknown;
      action_id: string;
      resolver: "human" | "policy";
      resolved_by_policy: string | null;
      channel: DecisionChannel;
      resolved_at: Date;
    }>`
      select r.item_id, i.kind_id, i.kind_version, i.payload, i.refs, r.action_id, r.resolver,
             r.resolved_by_policy, r.channel, r.resolved_at
        from ouroboros.decision_resolutions r
        join ouroboros.decision_items i on i.id = r.item_id
       where r.organization_id = ${organizationId}
         and r.resolved_at > ${until}::timestamptz - interval '1 day'
         and r.resolved_at <= ${until}
       order by r.resolved_at desc, r.item_id desc`.execute(this.database.db);

    return rows.map((row) => ({
      itemId: row.item_id,
      kindId: row.kind_id,
      kindVersion: row.kind_version,
      payload: row.payload,
      refs: row.refs,
      actionId: row.action_id,
      resolver: row.resolver,
      policy: row.resolved_by_policy,
      channel: row.channel,
      resolvedAt: row.resolved_at,
    }));
  }

  /**
   * A workspace's name, for a subject line.
   *
   * @param organizationId - The workspace.
   * @returns The name, or the id when the workspace is gone.
   */
  async workspaceName(organizationId: string): Promise<string> {
    const { rows } = await sql<{ name: string }>`
      select "name" from ouroboros.organization where "id" = ${organizationId}`.execute(
      this.database.db,
    );

    return rows[0]?.name ?? organizationId;
  }
}

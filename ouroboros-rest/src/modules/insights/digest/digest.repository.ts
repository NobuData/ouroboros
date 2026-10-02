/**
 * The weekly digest's statements (BJ.4, [#440](https://github.com/NobuData/ouroboros/issues/440))
 * over V084's four tables: who subscribed, when a workspace's digest goes out, which slot a run
 * claimed, and what was sent to whom.
 *
 * **No statement here reads a metric.** The digest's figures come from the Insights page's
 * payload; this file reads consent, a schedule, and its own audit — and `member`, `user` and
 * `organization` to know who a recipient is. `digest.sources.spec.ts` holds it to that.
 *
 * **Two claims keep a mail from going twice.** A run is claimed by `(organization_id, slot_at)`
 * under a short advisory-locked transaction; a recipient is claimed by
 * `(run_id, user_id, attempt)` *before* the mail is sent. Both are `insert … on conflict do
 * nothing`: whichever replica's insert lands owns the work, and the other finds nothing to do.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { InsightsDigestSendStatus } from "../../db/schema";
import type { Day } from "../rollup/rollup.types";

/** A workspace's weekly slot, as the service reads it. */
export interface DigestScheduleRow {
  /** ISO day of week, 1 = Monday … 7 = Sunday. */
  readonly weeklyDay: number;
  /** `HH:MM`, UTC. */
  readonly weeklyTime: string;
}

/** A workspace somebody subscribed to, with its stored schedule if it has one. */
export interface SubscribedWorkspace {
  readonly organizationId: string;
  readonly name: string;
  /** Undefined when nobody has saved a schedule: the default applies. */
  readonly schedule: DigestScheduleRow | undefined;
}

/** A digest run. */
export interface DigestRunRow {
  readonly id: string;
  readonly organizationId: string;
  readonly slotAt: Date;
  /** The assembly, or null until the run has assembled. */
  readonly content: unknown;
  readonly completedAt: Date | null;
}

/** Somebody a run may mail. */
export interface DigestRecipient {
  readonly userId: string;
  readonly email: string;
}

/** One attempt at one recipient, as the runner reads it back. */
export interface DigestSendRow {
  readonly userId: string | null;
  readonly attempt: number;
  readonly status: InsightsDigestSendStatus;
}

/** What a claim on a recipient records before the mail leaves. */
export interface SendClaim {
  readonly organizationId: string;
  readonly runId: string;
  readonly userId: string;
  readonly recipient: string;
  readonly attempt: number;
  readonly messageId: string;
  readonly unsubscribeTokenHash: string;
}

/** Who an unsubscribe token belongs to. */
export interface UnsubscribeTarget {
  readonly organizationId: string;
  readonly workspaceName: string;
  /** Null once the person has been removed: there is nothing left to unsubscribe. */
  readonly userId: string | null;
}

/** What a run-claim decision is given: the state read under the lock. */
export interface RunClaimState {
  readonly schedule: DigestScheduleRow | undefined;
  /** The workspace's most recent run's slot, if it has ever had one. */
  readonly latestSlotAt: Date | undefined;
}

/** A run, as `pg` hands it back. */
interface RunRecord {
  id: string;
  organization_id: string;
  slot_at: Date;
  content: unknown;
  completed_at: Date | null;
}

/**
 * A run row, in the service's names.
 *
 * @param row - The record.
 * @returns The run.
 */
function runOf(row: RunRecord): DigestRunRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    slotAt: row.slot_at,
    content: row.content,
    completedAt: row.completed_at,
  };
}

@Injectable()
export class DigestRepository {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Whether a person receives a workspace's digest.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @returns True when their subscription row exists.
   */
  async subscribed(organizationId: string, userId: string): Promise<boolean> {
    const { rows } = await sql`
      select 1 from ouroboros.insights_digest_subscriptions
       where organization_id = ${organizationId} and user_id = ${userId}`.execute(this.database.db);

    return rows.length > 0;
  }

  /**
   * Opt a person in. Asking twice is asking once.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   */
  async subscribe(organizationId: string, userId: string): Promise<void> {
    await sql`
      insert into ouroboros.insights_digest_subscriptions (organization_id, user_id)
      values (${organizationId}, ${userId})
      on conflict on constraint insights_digest_subscriptions_member_key do nothing`.execute(
      this.database.db,
    );
  }

  /**
   * Opt a person out. Asking twice is asking once.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   */
  async unsubscribe(organizationId: string, userId: string): Promise<void> {
    await sql`
      delete from ouroboros.insights_digest_subscriptions
       where organization_id = ${organizationId} and user_id = ${userId}`.execute(this.database.db);
  }

  /**
   * A workspace's stored schedule.
   *
   * @param organizationId - The workspace.
   * @returns The schedule, or undefined when none was ever saved.
   */
  async schedule(organizationId: string): Promise<DigestScheduleRow | undefined> {
    const { rows } = await sql<{ weekly_day: number; weekly_time: string }>`
      select weekly_day, to_char(weekly_time, 'HH24:MI') as weekly_time
        from ouroboros.insights_digest_schedules
       where organization_id = ${organizationId}`.execute(this.database.db);
    const [row] = rows;

    return row === undefined
      ? undefined
      : { weeklyDay: row.weekly_day, weeklyTime: row.weekly_time };
  }

  /**
   * Save a workspace's schedule.
   *
   * @param organizationId - The workspace.
   * @param schedule - The whole slot.
   * @param updatedBy - Who saved it.
   */
  async saveSchedule(
    organizationId: string,
    schedule: DigestScheduleRow,
    updatedBy: string,
  ): Promise<void> {
    await sql`
      insert into ouroboros.insights_digest_schedules
             (organization_id, weekly_day, weekly_time, updated_by)
      values (${organizationId}, ${schedule.weeklyDay}, ${schedule.weeklyTime}::time, ${updatedBy})
      on conflict (organization_id) do update
         set weekly_day = excluded.weekly_day,
             weekly_time = excluded.weekly_time,
             updated_by = excluded.updated_by`.execute(this.database.db);
  }

  /**
   * Every workspace with a subscriber who is still a member — the only workspaces a tick has
   * anything to do for.
   *
   * @returns Them, with each one's stored schedule, ordered by id.
   */
  async subscribedWorkspaces(): Promise<SubscribedWorkspace[]> {
    const { rows } = await sql<{
      id: string;
      name: string;
      weekly_day: number | null;
      weekly_time: string | null;
    }>`
      select o."id", o."name", s.weekly_day, to_char(s.weekly_time, 'HH24:MI') as weekly_time
        from ouroboros.organization o
        left join ouroboros.insights_digest_schedules s on s.organization_id = o."id"
       where exists (select 1
                       from ouroboros.insights_digest_subscriptions d
                       join ouroboros.member m
                         on m."organizationId" = d.organization_id and m."userId" = d.user_id
                      where d.organization_id = o."id")
       order by o."id"`.execute(this.database.db);

    return rows.map((row) => ({
      organizationId: row.id,
      name: row.name,
      schedule:
        row.weekly_day === null || row.weekly_time === null
          ? undefined
          : { weeklyDay: row.weekly_day, weeklyTime: row.weekly_time },
    }));
  }

  /**
   * Who a run for a slot may mail: people subscribed at or before the slot who are still members
   * of the workspace.
   *
   * The membership join is the isolation rule: a person removed from a workspace stops receiving
   * its numbers on the next run, whatever their subscription row says. The cut-off is what keeps
   * subscribing from triggering a late copy of a digest that already went out.
   *
   * @param organizationId - The workspace.
   * @param slotAt - The run's slot.
   * @returns The recipients, by address.
   */
  async recipients(organizationId: string, slotAt: Date): Promise<DigestRecipient[]> {
    const { rows } = await sql<{ user_id: string; email: string }>`
      select u."id" as user_id, u."email"
        from ouroboros.insights_digest_subscriptions d
        join ouroboros.member m
          on m."organizationId" = d.organization_id and m."userId" = d.user_id
        join ouroboros."user" u on u."id" = d.user_id
       where d.organization_id = ${organizationId}
         and d.created_at <= ${slotAt}
       order by u."email", u."id"`.execute(this.database.db);

    return rows.map((row) => ({ userId: row.user_id, email: row.email }));
  }

  /**
   * Claim a workspace's slot as a run — or find the run that already claimed it.
   *
   * One short transaction under a per-workspace advisory lock: the schedule and the latest run
   * are read *under the lock*, `decide` says which slot (if any) is due given exactly that state,
   * and the run row is inserted. Two replicas ticking together, or a schedule saved between
   * their ticks, therefore agree — the second sees what the first wrote. Nothing is sent inside
   * the transaction; it holds a connection for a handful of indexed statements.
   *
   * @param organizationId - The workspace.
   * @param decide - Given the state under the lock, the slot to run, or undefined for none.
   * @returns The slot's run — new, or the existing one — or undefined when no slot is due.
   */
  async claimRun(
    organizationId: string,
    decide: (state: RunClaimState) => Date | undefined,
  ): Promise<DigestRunRow | undefined> {
    return this.database.db.transaction().execute(async (trx) => {
      await sql`
        select pg_advisory_xact_lock(hashtext('insights_digest'), hashtext(${organizationId}))`.execute(
        trx,
      );

      const schedules = await sql<{ weekly_day: number; weekly_time: string }>`
        select weekly_day, to_char(weekly_time, 'HH24:MI') as weekly_time
          from ouroboros.insights_digest_schedules
         where organization_id = ${organizationId}`.execute(trx);
      const latest = await sql<{ slot_at: Date | null }>`
        select max(slot_at) as slot_at from ouroboros.insights_digest_runs
         where organization_id = ${organizationId}`.execute(trx);
      const [stored] = schedules.rows;

      const slotAt = decide({
        schedule:
          stored === undefined
            ? undefined
            : { weeklyDay: stored.weekly_day, weeklyTime: stored.weekly_time },
        latestSlotAt: latest.rows[0]?.slot_at ?? undefined,
      });

      if (slotAt === undefined) {
        return undefined;
      }

      await sql`
        insert into ouroboros.insights_digest_runs (organization_id, slot_at)
        values (${organizationId}, ${slotAt})
        on conflict on constraint insights_digest_runs_slot_key do nothing`.execute(trx);

      const { rows } = await sql<RunRecord>`
        select id, organization_id, slot_at, content, completed_at
          from ouroboros.insights_digest_runs
         where organization_id = ${organizationId} and slot_at = ${slotAt}`.execute(trx);

      return runOf(rows[0]);
    });
  }

  /**
   * Store a run's content — once. A run that already has content keeps it.
   *
   * @param runId - The run.
   * @param content - The assembly.
   * @param window - The window it covers.
   * @param contentVersion - The content rules it was assembled under.
   * @returns The run as it now stands, with whichever content was stored first.
   */
  async storeContent(
    runId: string,
    content: unknown,
    window: { readonly from: Day; readonly to: Day },
    contentVersion: number,
  ): Promise<DigestRunRow> {
    await sql`
      update ouroboros.insights_digest_runs
         set content = ${JSON.stringify(content)}::jsonb,
             window_from = ${window.from}::date,
             window_to = ${window.to}::date,
             content_version = ${contentVersion}
       where id = ${runId} and content is null`.execute(this.database.db);

    const { rows } = await sql<RunRecord>`
      select id, organization_id, slot_at, content, completed_at
        from ouroboros.insights_digest_runs where id = ${runId}`.execute(this.database.db);

    return runOf(rows[0]);
  }

  /**
   * Mark a run complete: nobody is left to mail or retry.
   *
   * @param runId - The run.
   */
  async completeRun(runId: string): Promise<void> {
    await sql`
      update ouroboros.insights_digest_runs set completed_at = now()
       where id = ${runId} and completed_at is null`.execute(this.database.db);
  }

  /**
   * Fail the claims of a run that were never settled — a sender that died mid-send.
   *
   * The age is measured on the database's clock, the one `claimed_at` was stamped by, so two
   * replicas whose own clocks disagree still agree about which claims are dead.
   *
   * @param runId - The run.
   * @param olderThanMs - A claim older than this has outlived any send's timeouts.
   */
  async expireClaims(runId: string, olderThanMs: number): Promise<void> {
    await sql`
      update ouroboros.insights_digest_sends
         set status = 'failed', settled_at = now(),
             error = 'The send was claimed and never confirmed.'
       where run_id = ${runId} and status = 'claimed'
         and claimed_at < now() - make_interval(secs => ${olderThanMs / 1000})`.execute(
      this.database.db,
    );
  }

  /**
   * Every attempt a run has made.
   *
   * @param runId - The run.
   * @returns The attempts.
   */
  async sends(runId: string): Promise<DigestSendRow[]> {
    const { rows } = await sql<{
      user_id: string | null;
      attempt: number;
      status: InsightsDigestSendStatus;
    }>`
      select user_id, attempt, status from ouroboros.insights_digest_sends
       where run_id = ${runId}`.execute(this.database.db);

    return rows.map((row) => ({ userId: row.user_id, attempt: row.attempt, status: row.status }));
  }

  /**
   * Claim one attempt at one recipient, before the mail is sent.
   *
   * @param claim - The attempt, with the hash of the token its mail will carry.
   * @returns The send's id — or undefined when another sender claimed this attempt first, in
   *   which case the caller must not send.
   */
  async claimSend(claim: SendClaim): Promise<string | undefined> {
    const { rows } = await sql<{ id: string }>`
      insert into ouroboros.insights_digest_sends
             (organization_id, run_id, user_id, recipient, attempt, message_id,
              unsubscribe_token_hash)
      values (${claim.organizationId}, ${claim.runId}, ${claim.userId}, ${claim.recipient},
              ${claim.attempt}, ${claim.messageId}, ${claim.unsubscribeTokenHash})
      on conflict on constraint insights_digest_sends_attempt_key do nothing
      returning id`.execute(this.database.db);

    return rows[0]?.id;
  }

  /**
   * Settle a claim: the mail was accepted, or it was not and why.
   *
   * @param sendId - The claim.
   * @param error - Why it failed; undefined when it was sent.
   */
  async settleSend(sendId: string, error?: string): Promise<void> {
    await sql`
      update ouroboros.insights_digest_sends
         set status = ${error === undefined ? "sent" : "failed"},
             settled_at = now(),
             error = ${error ?? null}
       where id = ${sendId} and status = 'claimed'`.execute(this.database.db);
  }

  /**
   * Who an unsubscribe token belongs to.
   *
   * @param tokenHash - The presented token's SHA-256.
   * @returns The workspace and person of the send that carried it, or undefined for a token no
   *   send ever carried.
   */
  async unsubscribeTarget(tokenHash: string): Promise<UnsubscribeTarget | undefined> {
    const { rows } = await sql<{ organization_id: string; name: string; user_id: string | null }>`
      select s.organization_id, o."name", s.user_id
        from ouroboros.insights_digest_sends s
        join ouroboros.organization o on o."id" = s.organization_id
       where s.unsubscribe_token_hash = ${tokenHash}`.execute(this.database.db);
    const [row] = rows;

    return row === undefined
      ? undefined
      : { organizationId: row.organization_id, workspaceName: row.name, userId: row.user_id };
  }
}

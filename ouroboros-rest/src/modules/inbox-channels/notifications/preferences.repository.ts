/**
 * Every statement the notification preferences issue (BN.3,
 * [#463](https://github.com/NobuData/ouroboros/issues/463)) — V100's `notification_preferences`,
 * one row per person per workspace. Raw SQL: the table is not part of REST's schema mirror.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";

/** `notification_preferences.instant_severity` (V100). */
export type InstantSeverity = "err" | "off";

/** A person's stored preferences in one workspace. */
export interface StoredPreferences {
  readonly digestEnabled: boolean;
  /** `HH:MM`, UTC. */
  readonly digestTime: string;
  readonly instantSeverity: InstantSeverity;
  readonly mutedKinds: readonly string[];
  readonly updatedAt: Date;
}

/** A change: the fields present are written, the rest kept. */
export interface PreferencesChange {
  readonly digestEnabled?: boolean;
  readonly digestTime?: string;
  readonly instantSeverity?: InstantSeverity;
  readonly mutedKinds?: readonly string[];
}

@Injectable()
export class PreferencesRepository {
  /** @param database - The service's connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A person's stored preferences.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @returns The row, or undefined when they never set any (the defaults apply).
   */
  async get(organizationId: string, userId: string): Promise<StoredPreferences | undefined> {
    const { rows } = await sql<{
      digest_enabled: boolean;
      digest_time: string;
      instant_severity: InstantSeverity;
      muted_kinds: string[];
      updated_at: Date;
    }>`
      select digest_enabled, to_char(digest_time, 'HH24:MI') as digest_time, instant_severity,
             muted_kinds, updated_at
        from ouroboros.notification_preferences
       where organization_id = ${organizationId} and user_id = ${userId}`.execute(this.database.db);
    const [row] = rows;

    return row === undefined
      ? undefined
      : {
          digestEnabled: row.digest_enabled,
          digestTime: row.digest_time,
          instantSeverity: row.instant_severity,
          mutedKinds: row.muted_kinds,
          updatedAt: row.updated_at,
        };
  }

  /**
   * Write a change over what is stored (or over the defaults).
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @param change - The fields to write.
   */
  async upsert(organizationId: string, userId: string, change: PreferencesChange): Promise<void> {
    const muted = change.mutedKinds === undefined ? null : [...change.mutedKinds];

    await sql`
      insert into ouroboros.notification_preferences
             (organization_id, user_id, digest_enabled, digest_time, instant_severity, muted_kinds)
      values (${organizationId}, ${userId},
              coalesce(${change.digestEnabled ?? null}::boolean, false),
              coalesce(${change.digestTime ?? null}::time, '09:00'),
              coalesce(${change.instantSeverity ?? null}::text, 'err'),
              coalesce(${muted}::text[], '{}'))
      on conflict (organization_id, user_id) do update
         set digest_enabled   = coalesce(${change.digestEnabled ?? null}::boolean,
                                         notification_preferences.digest_enabled),
             digest_time      = coalesce(${change.digestTime ?? null}::time,
                                         notification_preferences.digest_time),
             instant_severity = coalesce(${change.instantSeverity ?? null}::text,
                                         notification_preferences.instant_severity),
             muted_kinds      = coalesce(${muted}::text[], notification_preferences.muted_kinds),
             updated_at       = now()`.execute(this.database.db);
  }

  /**
   * The last slot a digest was sent to a person for, in one workspace.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @returns The slot, or undefined when none was ever sent.
   */
  async lastDigestSlot(organizationId: string, userId: string): Promise<Date | undefined> {
    const { rows } = await sql<{ slot_at: Date | null }>`
      select max(slot_at) as slot_at from ouroboros.decision_mail_sends
       where organization_id = ${organizationId} and user_id = ${userId}
         and kind = 'digest' and status = 'sent'`.execute(this.database.db);

    return rows[0]?.slot_at ?? undefined;
  }
}

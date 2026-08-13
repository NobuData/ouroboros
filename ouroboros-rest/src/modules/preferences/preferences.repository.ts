/**
 * Every statement this module issues against `ouroboros.user_preferences` (V007,
 * [#649](https://github.com/NobuData/ouroboros/issues/649)).
 *
 * Two statements, and the shape of the table is why there is no third: one row per person,
 * holding choices only. The read returns `undefined` for a person who has never chosen —
 * the service reads that as the defaults — and the write is an upsert, because "set my font
 * scale" is the same request whether or not a row already exists and a caller has no
 * business knowing which it was.
 *
 * The upsert is the one place the row is created, which is what keeps the table honest: a
 * row exists exactly when somebody expressed a choice, so `count(*)` over this table is
 * "how many people changed a setting" rather than "how many people exist".
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { FontScale, UserPreferences } from "../db/schema";

@Injectable()
export class PreferencesRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's
   *   lifecycle belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One person's stored preferences.
   *
   * @param userId - Whose — `"user".id`, the primary key.
   * @returns Their row, or `undefined` when they have never stored a choice. The caller
   *   decides what that means; `resources.ts` is where it becomes the defaults.
   */
  async findFor(userId: string): Promise<UserPreferences | undefined> {
    return this.database.db
      .selectFrom("user_preferences")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirst();
  }

  /**
   * Store a font-scale choice, creating the row if this is the person's first.
   *
   * `onConflict … doUpdateSet` rather than a read-then-write: the primary key makes the
   * conflict target exact, the database arbitrates two racing writes instead of this code
   * pretending to, and `updated_at` moves by trigger either way.
   *
   * @param userId - Whose choice.
   * @param fontScale - The step — already validated by the DTO, and CHECK-constrained
   *   behind that, so a value outside the five cannot reach a row from here.
   * @returns The row as stored.
   */
  async upsertFontScale(userId: string, fontScale: FontScale): Promise<UserPreferences> {
    return this.database.db
      .insertInto("user_preferences")
      .values({ user_id: userId, font_scale: fontScale })
      .onConflict((conflict) => conflict.column("user_id").doUpdateSet({ font_scale: fontScale }))
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

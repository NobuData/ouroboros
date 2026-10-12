/**
 * A decision item by its short number — one read, and no writes (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * A card prints `q-231`; `/ouro answer q-231 allow_once` has to find that item. V133 gives every
 * item a `short_seq`, unique per workspace, and this is the exact read from the number to the row
 * — with the item's status, so an answered or expired question can be told apart from one that
 * never existed, and the kind it pinned, which is where its answers are declared.
 *
 * `short_seq` is typed here rather than read off `db/schema.ts`'s table type, so this statement
 * does not wait on the column being named there.
 *
 * **It is exported, and it can only read** — see `runs/loop.lookup.repository.ts` for the argument;
 * answering stays the action executor's (`InboxActionsService`).
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { DecisionItemStatus } from "../db/schema";

/** An item, as a short id resolves to it. */
export interface QuestionRow {
  /** `decision_items.id` — what an answer is addressed to. */
  readonly itemId: string;
  /** `decision_items.short_seq`. */
  readonly shortSeq: number;
  readonly status: DecisionItemStatus;
  /** The kind, and the version of it the item pinned — where its actions are declared. */
  readonly kindId: string;
  readonly kindVersion: number;
}

@Injectable()
export class QuestionLookupRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace's item carrying this short number, whatever its status.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param shortSeq - The number after `q-`.
   * @returns The item, or `undefined` — "no such question" and "another workspace's" alike.
   */
  async byShortSeq(organizationId: string, shortSeq: number): Promise<QuestionRow | undefined> {
    return this.database.db
      .selectFrom("decision_items")
      .select([
        "id as itemId",
        sql<number>`short_seq`.as("shortSeq"),
        "status",
        "kind_id as kindId",
        "kind_version as kindVersion",
      ])
      .where("organization_id", "=", organizationId)
      .where(sql<boolean>`short_seq = ${shortSeq}`)
      .executeTakeFirst();
  }
}

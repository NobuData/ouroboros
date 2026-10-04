/**
 * The one statement the policy card needs beyond the planes' own readers (BN.4,
 * [#464](https://github.com/NobuData/ouroboros/issues/464)): BA.1's protected globs across the
 * workspace's repositories — the same `protected_path_policies` rows AP.3's guardrails read per run.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";

@Injectable()
export class InboxPoliciesRepository {
  /**
   * @param database - The pool owner.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every protected glob of the workspace, with how many repositories protect it.
   *
   * @param organizationId - The workspace.
   * @returns The globs, alphabetical.
   */
  async protectedPaths(organizationId: string): Promise<{ glob: string; repos: number }[]> {
    const rows = await this.database.db
      .selectFrom("protected_path_policies")
      .select((eb) => ["path_glob", eb.fn.count<string>("repo_ref").distinct().as("repos")])
      .where("organization_id", "=", organizationId)
      .groupBy("path_glob")
      .orderBy("path_glob")
      .execute();

    return rows.map((row) => ({ glob: row.path_glob, repos: Number(row.repos) }));
  }
}

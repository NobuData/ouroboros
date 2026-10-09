/**
 * The internal tool surface's statements: which investigation a call is for, and archiving the
 * sources it read into the citation ledger.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)). The workspace a call is scoped
 * to is **resolved from the investigation**, never taken from the request — the lease's argument
 * (`internal/lease.ts`): a caller naming its own workspace would be choosing whose settings and
 * whose ledger it reaches.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../db/db.service";
import type { InvestigationStatus, SourceSkipReason } from "../../db/schema";
import type { SourceRecord } from "./research-tool.adapter";

/** What a tool call needs to know about its investigation. */
export interface ToolInvestigation {
  readonly id: string;
  /** The workspace — every setting and credential is resolved against this. */
  readonly organizationId: string;
  /** `RS-127`. */
  readonly displayId: string;
  readonly status: InvestigationStatus;
  /** The tool slugs the investigation enabled. */
  readonly tools: readonly string[];
}

/** One archived source, as the ledger numbered it. */
export interface ArchivedSource {
  /** `source_records.id`. */
  readonly id: string;
  /** The `[07]`. */
  readonly citeNo: number;
  /** Whether an identical record (same locator and content hash) was already in the ledger. */
  readonly deduplicated: boolean;
}

/** A page an investigation declined to read, as the invoker records it (V116, #615). */
export interface SourceSkip {
  /** The page as it was asked for. */
  readonly locator: string;
  readonly reason: SourceSkipReason;
  /** What the sources panel shows — the adapter's classified detail. */
  readonly note: string;
}

@Injectable()
export class ResearchToolRepository {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The investigation a tool call names.
   *
   * @param investigationId - Its id.
   * @returns It, or undefined when there is no such investigation.
   */
  async findInvestigation(investigationId: string): Promise<ToolInvestigation | undefined> {
    const row = await this.database.db
      .selectFrom("investigations")
      .select(["id", "organization_id", "display_id", "status", "tools_enabled"])
      .where("id", "=", investigationId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          organizationId: row.organization_id,
          displayId: row.display_id,
          status: row.status,
          tools: row.tools_enabled,
        };
  }

  /**
   * Archive an operation's sources in the investigation's ledger, in order.
   *
   * A record identical to one already archived — the same locator read to the same content
   * hash — is not written twice: re-reading a page that has not changed is the same evidence,
   * and a second number for it would split its citations. Its existing number is returned.
   *
   * One transaction, so a call's sources are numbered consecutively and either all land or none
   * do. The cite numbers are V108's allocator's.
   *
   * @param investigationId - The investigation.
   * @param toolSlug - The tool that read them.
   * @param sources - The sources, already held to the citation contract.
   * @returns One entry per source, in order.
   */
  async archiveSources(
    investigationId: string,
    toolSlug: string,
    sources: readonly SourceRecord[],
  ): Promise<ArchivedSource[]> {
    return this.database.db.transaction().execute(async (transaction) => {
      const archived: ArchivedSource[] = [];

      for (const source of sources) {
        const existing = await transaction
          .selectFrom("source_records")
          .select(["id", "cite_no"])
          .where("investigation_id", "=", investigationId)
          .where("content_hash", "=", source.contentHash)
          .where("locator", "=", source.locator)
          .executeTakeFirst();

        if (existing !== undefined) {
          archived.push({ id: existing.id, citeNo: existing.cite_no, deduplicated: true });
          continue;
        }

        const row = await transaction
          .insertInto("source_records")
          .values({
            investigation_id: investigationId,
            tool_slug: toolSlug,
            kind: source.kind,
            title: source.title,
            locator: source.locator,
            retrieved_at: source.retrievedAt,
            content_hash: source.contentHash,
            excerpt: source.excerpt,
            meta: JSON.stringify(source.meta),
            snapshot_id: source.snapshotId ?? null,
          })
          .returning(["id", "cite_no"])
          .executeTakeFirstOrThrow();

        archived.push({ id: row.id, citeNo: row.cite_no, deduplicated: false });
      }

      return archived;
    });
  }

  /**
   * Record a page the investigation declined to read — once per investigation, tool, page and
   * reason (`source_skips`, V116). A second refusal of the same page says nothing new, so it
   * writes nothing.
   *
   * @param investigationId - The investigation.
   * @param toolSlug - The tool that declined it.
   * @param skip - The page, the reason and the note.
   * @returns `true` when this call recorded it, `false` when it was already recorded.
   */
  async recordSkip(investigationId: string, toolSlug: string, skip: SourceSkip): Promise<boolean> {
    const rows = await this.database.db
      .insertInto("source_skips")
      .values({
        investigation_id: investigationId,
        tool_slug: toolSlug,
        locator: skip.locator,
        reason: skip.reason,
        note: skip.note.slice(0, 500),
      })
      .onConflict((conflict) =>
        conflict.columns(["investigation_id", "tool_slug", "locator", "reason"]).doNothing(),
      )
      .returning("id")
      .execute();

    return rows.length > 0;
  }
}

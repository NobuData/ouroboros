/**
 * What a brief is read from, and what a matrix is written to (CM.2,
 * [#621](https://github.com/NobuData/ouroboros/issues/621)): V106's investigation, V108's ledger,
 * brief and claims, V112's matrix tables and V120's deliverable inputs.
 *
 * Every read is scoped to one workspace by the investigation it starts from — an investigation of
 * another workspace is not found, the same answer as one that does not exist — and the reads
 * below it go by that investigation's id.
 *
 * **A matrix is written in one transaction**, holding the investigation row: the rivals it names
 * are found or added to the registry, then the matrix, its rows, cells and citation links are
 * inserted together. V112's deferred triggers (`matrix_cells_cited`, `matrix_rows_complete`) run
 * at that commit, so a matrix that breaks decision V7 is not stored in part — it is not stored.
 * An investigation has one matrix; building again answers with the one it has.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type {
  BriefBodyDocument,
  InvestigationDepth,
  InvestigationProvenanceDocument,
  InvestigationStatus,
  MatrixCellStatus,
  MatrixGapSeverity,
} from "../../db/schema";
import type { BriefClaim } from "./brief.read-model";
import type { LedgerRow, MatrixRow } from "./brief.resources";
import { key } from "./matrix.input";

/** An investigation, as a brief's head needs it. */
export interface BriefInvestigation {
  readonly id: string;
  readonly organizationId: string;
  /** `RS-127`. */
  readonly displayId: string;
  readonly question: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly tintKey: string;
  readonly depth: InvestigationDepth;
  readonly status: InvestigationStatus;
  readonly provenance: InvestigationProvenanceDocument | null;
}

/** A brief version, as stored. */
export interface StoredBrief {
  readonly id: string;
  readonly version: number;
  readonly body: BriefBodyDocument;
  readonly createdAt: Date;
}

/** One cell of a matrix to write. */
export interface MatrixPlanCell {
  /** Null for us, otherwise the rival's index in {@link MatrixPlan.rivals}. */
  readonly rival: number | null;
  readonly status: MatrixCellStatus;
  readonly note: string | null;
  readonly sources: readonly string[];
}

/** One row of a matrix to write. */
export interface MatrixPlanRow {
  readonly capability: string;
  readonly severity: MatrixGapSeverity;
  readonly derivation: string;
  readonly cells: readonly MatrixPlanCell[];
}

/** A matrix to write. */
export interface MatrixPlan {
  readonly title: string;
  readonly usLabel: string;
  /** The rival columns' names, left to right. */
  readonly rivals: readonly string[];
  /** Top to bottom. */
  readonly rows: readonly MatrixPlanRow[];
}

/** What a build did. */
export type MatrixWriteOutcome =
  | { readonly outcome: "not_found" }
  | { readonly outcome: "exists"; readonly matrixId: string }
  | { readonly outcome: "built"; readonly matrixId: string };

/** The storage the brief services run on — the repository, or a test's in-memory stand-in. */
export interface BriefStore {
  /** @returns The workspace's investigation, or undefined. */
  findInvestigation(
    organizationId: string,
    investigationId: string,
  ): Promise<BriefInvestigation | undefined>;
  /** @returns The investigation's current brief — its highest version — or undefined. */
  latestBrief(investigationId: string): Promise<StoredBrief | undefined>;
  /** @returns The brief's claims with the sources that back each. */
  claims(briefId: string): Promise<BriefClaim[]>;
  /** @returns The investigation's whole ledger, in cite-number order. */
  ledger(investigationId: string): Promise<LedgerRow[]>;
  /** @returns The investigation's matrix, or undefined when it has none. */
  matrix(investigationId: string): Promise<MatrixRow | undefined>;
  /** @returns The `matrix` deliverable input of the latest brief that has one, or undefined. */
  matrixInput(investigationId: string): Promise<Record<string, unknown> | undefined>;
  /** @returns Every `owner/name` the workspace has mirrored. */
  repositories(organizationId: string): Promise<string[]>;
  /** Write a matrix, unless the investigation has one. */
  createMatrix(
    organizationId: string,
    investigationId: string,
    plan: MatrixPlan,
  ): Promise<MatrixWriteOutcome>;
}

@Injectable()
export class BriefsRepository implements BriefStore {
  /** @param database - The connection pool. */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async findInvestigation(
    organizationId: string,
    investigationId: string,
  ): Promise<BriefInvestigation | undefined> {
    const row = await this.database.db
      .selectFrom("investigations as i")
      .innerJoin("investigation_kinds as k", "k.id", "i.kind_id")
      .select([
        "i.id",
        "i.organization_id",
        "i.display_id",
        "i.question",
        "i.depth",
        "i.status",
        "i.provenance",
        "k.slug",
        "k.display_name",
        "k.tint_key",
      ])
      .where("i.organization_id", "=", organizationId)
      .where("i.id", "=", investigationId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          organizationId: row.organization_id,
          displayId: row.display_id,
          question: row.question,
          kind: row.slug,
          kindLabel: row.display_name,
          tintKey: row.tint_key,
          depth: row.depth,
          status: row.status,
          provenance: row.provenance,
        };
  }

  /** @inheritdoc */
  async latestBrief(investigationId: string): Promise<StoredBrief | undefined> {
    const row = await this.database.db
      .selectFrom("briefs")
      .select(["id", "version", "body", "created_at"])
      .where("investigation_id", "=", investigationId)
      .orderBy("version", "desc")
      .limit(1)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { id: row.id, version: row.version, body: row.body, createdAt: row.created_at };
  }

  /** @inheritdoc */
  async claims(briefId: string): Promise<BriefClaim[]> {
    const [claims, links] = await Promise.all([
      this.database.db
        .selectFrom("brief_claims")
        .select(["id", "span_ref", "claim_type", "text", "demoted"])
        .where("brief_id", "=", briefId)
        .orderBy("created_at")
        .orderBy("id")
        .execute(),
      this.database.db
        .selectFrom("brief_claim_sources as l")
        .innerJoin("brief_claims as c", "c.id", "l.claim_id")
        .select(["l.claim_id", "l.source_id"])
        .where("c.brief_id", "=", briefId)
        .execute(),
    ]);

    return claims.map((claim) => ({
      ref: claim.span_ref,
      type: claim.claim_type,
      text: claim.text,
      demoted: claim.demoted,
      sources: links.filter((link) => link.claim_id === claim.id).map((link) => link.source_id),
    }));
  }

  /** @inheritdoc */
  async ledger(investigationId: string): Promise<LedgerRow[]> {
    const rows = await this.database.db
      .selectFrom("source_records")
      .select([
        "id",
        "cite_no",
        "cite_key",
        "tool_slug",
        "kind",
        "title",
        "locator",
        "retrieved_at",
        "content_hash",
        "excerpt",
      ])
      .where("investigation_id", "=", investigationId)
      .orderBy("cite_no")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      citeNo: row.cite_no,
      citeKey: row.cite_key,
      tool: row.tool_slug,
      kind: row.kind,
      title: row.title,
      locator: row.locator,
      retrievedAt: row.retrieved_at,
      contentHash: row.content_hash,
      excerpt: row.excerpt,
    }));
  }

  /** @inheritdoc */
  async matrix(investigationId: string): Promise<MatrixRow | undefined> {
    const matrix = await this.database.db
      .selectFrom("capability_matrices")
      .select(["id", "title", "us_label", "rivals"])
      .where("investigation_id", "=", investigationId)
      .executeTakeFirst();
    if (matrix === undefined) return undefined;

    const [rivals, rows, cells, links] = await Promise.all([
      matrix.rivals.length === 0
        ? Promise.resolve([])
        : this.database.db
            .selectFrom("competitors")
            .select(["id", "name"])
            .where("id", "in", matrix.rivals)
            .execute(),
      this.database.db
        .selectFrom("matrix_rows")
        .select(["id", "capability", "gap_severity", "severity_derivation"])
        .where("matrix_id", "=", matrix.id)
        .orderBy("sort_order")
        .execute(),
      this.database.db
        .selectFrom("matrix_cells")
        .select(["id", "row_id", "competitor_id", "status", "note"])
        .where("matrix_id", "=", matrix.id)
        .execute(),
      this.database.db
        .selectFrom("matrix_cell_sources as l")
        .innerJoin("matrix_cells as c", "c.id", "l.cell_id")
        .select(["l.cell_id", "l.source_id"])
        .where("c.matrix_id", "=", matrix.id)
        .execute(),
    ]);

    const names = new Map(rivals.map((rival) => [rival.id, rival.name]));

    return {
      id: matrix.id,
      title: matrix.title,
      usLabel: matrix.us_label,
      // The stored order is the column order; a rival always resolves (deferred FK, V112).
      rivals: matrix.rivals.map((id) => ({ id, name: names.get(id) ?? id })),
      rows: rows.map((row) => ({
        id: row.id,
        capability: row.capability,
        severity: row.gap_severity,
        derivation: row.severity_derivation,
        cells: cells
          .filter((cell) => cell.row_id === row.id)
          .map((cell) => ({
            competitorId: cell.competitor_id,
            status: cell.status,
            note: cell.note,
            sources: links.filter((link) => link.cell_id === cell.id).map((link) => link.source_id),
          })),
      })),
    };
  }

  /** @inheritdoc */
  async matrixInput(investigationId: string): Promise<Record<string, unknown> | undefined> {
    const row = await this.database.db
      .selectFrom("investigation_deliverable_inputs as d")
      .innerJoin("briefs as b", "b.id", "d.brief_id")
      .select("d.payload")
      .where("d.investigation_id", "=", investigationId)
      .where("d.deliverable", "=", "matrix")
      .orderBy("b.version", "desc")
      .limit(1)
      .executeTakeFirst();

    return row?.payload;
  }

  /** @inheritdoc */
  async repositories(organizationId: string): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("github_repos as r")
      .innerJoin("github_orgs as o", "o.id", "r.org_id")
      .select(["o.login", "r.name"])
      .where("o.organization_id", "=", organizationId)
      .orderBy("o.login")
      .orderBy("r.name")
      .execute();

    return rows.map((row) => `${row.login}/${row.name}`);
  }

  /** @inheritdoc */
  async createMatrix(
    organizationId: string,
    investigationId: string,
    plan: MatrixPlan,
  ): Promise<MatrixWriteOutcome> {
    return this.database.db.transaction().execute(async (trx) => {
      // Held for the transaction: two builds of one investigation run one after the other.
      const held = await trx
        .selectFrom("investigations")
        .select("id")
        .where("organization_id", "=", organizationId)
        .where("id", "=", investigationId)
        .forUpdate()
        .executeTakeFirst();
      if (held === undefined) return { outcome: "not_found" };

      const existing = await trx
        .selectFrom("capability_matrices")
        .select("id")
        .where("investigation_id", "=", investigationId)
        .executeTakeFirst();
      if (existing !== undefined) return { outcome: "exists", matrixId: existing.id };

      // The rival columns are registry rows: found by name or alias, added when new.
      const registry = await trx
        .selectFrom("competitors")
        .select(["id", "name", "meta"])
        .where("organization_id", "=", organizationId)
        .execute();
      const rivals: string[] = [];
      for (const name of plan.rivals) {
        const known = registry.find(
          (rival) => key(rival.name) === key(name) || aliasesOf(rival.meta).includes(key(name)),
        );
        if (known !== undefined) {
          rivals.push(known.id);
          continue;
        }
        const added = await trx
          .insertInto("competitors")
          .values({ organization_id: organizationId, name })
          .returning("id")
          .executeTakeFirstOrThrow();
        rivals.push(added.id);
      }

      const matrix = await trx
        .insertInto("capability_matrices")
        .values({
          investigation_id: investigationId,
          title: plan.title,
          us_label: plan.usLabel,
          rivals: sql<string[]>`${rivals}::uuid[]`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      for (const [order, row] of plan.rows.entries()) {
        const stored = await trx
          .insertInto("matrix_rows")
          .values({
            matrix_id: matrix.id,
            capability: row.capability,
            sort_order: order,
            gap_severity: row.severity,
            severity_derivation: row.derivation,
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        for (const cell of row.cells) {
          const written = await trx
            .insertInto("matrix_cells")
            .values({
              investigation_id: investigationId,
              matrix_id: matrix.id,
              row_id: stored.id,
              competitor_id: cell.rival === null ? null : rivals[cell.rival],
              status: cell.status,
              note: cell.note,
            })
            .returning("id")
            .executeTakeFirstOrThrow();

          if (cell.sources.length > 0) {
            await trx
              .insertInto("matrix_cell_sources")
              .values(
                cell.sources.map((source) => ({
                  investigation_id: investigationId,
                  cell_id: written.id,
                  source_id: source,
                })),
              )
              .execute();
          }
        }
      }

      return { outcome: "built", matrixId: matrix.id };
    });
  }
}

/**
 * @param meta - A competitor's `meta`.
 * @returns Its aliases, as column keys; empty when it has none.
 */
function aliasesOf(meta: Record<string, unknown>): string[] {
  const aliases = meta["aliases"];
  return Array.isArray(aliases)
    ? aliases.filter((alias): alias is string => typeof alias === "string").map(key)
    : [];
}

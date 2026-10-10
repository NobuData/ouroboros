/**
 * The matrix builder — a gap analysis's deliverable input turned into V112's rows and cells, with
 * their citation links and derived severities (CM.2,
 * [#621](https://github.com/NobuData/ouroboros/issues/621); decision V7).
 *
 *   investigation_deliverable_inputs.matrix
 *     ─ parseMatrixInput ─▶ complete rows, every non-`unknown` cell cited      (or a `422`)
 *     ─ the ledger       ─▶ every cited id is one of this investigation's     (or a `422`)
 *     ─ deriveSeverity   ─▶ each row's severity, with its derivation
 *     ─ createMatrix     ─▶ matrix + rows + cells + links, in one transaction
 *
 * The investigation loop calls {@link MatrixBuilderService.build} once a gap analysis has
 * delivered its brief. Building is idempotent: an investigation has one matrix, and a second
 * build answers with it. An investigation whose playbook produced no matrix input has nothing to
 * build, which is an answer and not an error.
 */

import { Injectable, Logger } from "@nestjs/common";

import { investigationNotFound } from "../research.errors";
import { matrixSourceUnknown } from "./briefs.errors";
import { BriefsRepository, type BriefStore, type MatrixPlan } from "./briefs.repository";
import { parseMatrixInput, type MatrixInput } from "./matrix.input";
import { deriveSeverity } from "./matrix.severity";

/** What a build did. */
export interface MatrixBuildResource {
  /** `built` now, `exists` already, or `no_input` — the playbook produced no matrix. */
  readonly outcome: "built" | "exists" | "no_input";
  /** The matrix; null for `no_input`. */
  readonly matrixId: string | null;
}

@Injectable()
export class MatrixBuilderService {
  private readonly logger = new Logger(MatrixBuilderService.name);
  private readonly store: BriefStore;

  /** @param repository - The ledger, the deliverable inputs and the matrix tables. */
  constructor(repository: BriefsRepository) {
    this.store = repository;
  }

  /**
   * Build an investigation's capability matrix from its stored matrix input.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns What was done, and the matrix.
   * @throws {NotFoundError} `investigation_not_found`.
   * @throws {InvalidRequestError} `matrix_input_invalid`, `matrix_row_incomplete`,
   *   `matrix_cell_uncited` or `matrix_source_unknown`.
   */
  async build(organizationId: string, investigationId: string): Promise<MatrixBuildResource> {
    const investigation = await this.store.findInvestigation(organizationId, investigationId);
    if (investigation === undefined) throw investigationNotFound(investigationId);

    const payload = await this.store.matrixInput(investigationId);
    if (payload === undefined) return { outcome: "no_input", matrixId: null };

    const input = parseMatrixInput(payload);

    const ledger = new Set((await this.store.ledger(investigationId)).map((source) => source.id));
    const unknown = [
      ...new Set(input.rows.flatMap((row) => row.cells.flatMap((cell) => cell.sources))),
    ].filter((source) => !ledger.has(source));
    if (unknown.length > 0) throw matrixSourceUnknown(unknown);

    const written = await this.store.createMatrix(
      organizationId,
      investigationId,
      planMatrix(input),
    );
    if (written.outcome === "not_found") throw investigationNotFound(investigationId);

    if (written.outcome === "built") {
      this.logger.log(
        `${investigation.displayId} matrix built: ${input.rows.length.toString()} capabilities × ` +
          `${(input.rivals.length + 1).toString()} subjects`,
      );
    }
    return written;
  }
}

/**
 * Turn a read matrix input into the rows to store — each with the severity the rule derives.
 *
 * @param input - The matrix a gap analysis described.
 * @returns The matrix to write.
 */
export function planMatrix(input: MatrixInput): MatrixPlan {
  return {
    title: input.title,
    usLabel: input.us,
    rivals: input.rivals,
    rows: input.rows.map((row) => {
      const [ours, ...theirs] = row.cells;
      const derived = deriveSeverity({
        usLabel: input.us,
        ours: ours.status,
        rivals: theirs.map((cell, column) => ({ name: input.rivals[column], status: cell.status })),
        proposed: row.proposed,
      });

      return {
        capability: row.capability,
        severity: derived.severity,
        derivation: derived.derivation,
        cells: row.cells,
      };
    }),
  };
}

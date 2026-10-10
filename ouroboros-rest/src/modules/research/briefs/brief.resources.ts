/**
 * The brief's response shapes (CM.2, [#621](https://github.com/NobuData/ouroboros/issues/621)) —
 * `openapi.yaml`'s `InvestigationBrief`, `BriefSource`, `BriefLedger` and `CapabilityMatrix` —
 * and the two builders that turn stored rows into them.
 *
 * {@link BriefDocument} is the one composed view of a brief. The JSON routes answer with it and
 * the Markdown export is rendered from it, so a label, a cell or a severity cannot read one way
 * on the card and another in the file.
 */

import type {
  InvestigationDepth,
  InvestigationStatus,
  MatrixCellStatus,
  MatrixGapSeverity,
  SourceRecordKindColumn,
} from "../../db/schema";
import { citeLabel, locatorLabel, sourceHref, type RepositoryResolver } from "./brief.citations";
import { citesOf, type CiteResource, type ParagraphResource } from "./brief.read-model";
import type { GapProposals } from "./gap-proposals";

/** A ledger record, as stored. */
export interface LedgerRow {
  readonly id: string;
  readonly citeNo: number;
  readonly citeKey: string | null;
  readonly tool: string;
  readonly kind: SourceRecordKindColumn;
  readonly title: string;
  readonly locator: string;
  readonly retrievedAt: Date;
  readonly contentHash: string;
  readonly excerpt: string;
}

/** A matrix cell, as stored. */
export interface MatrixCellRow {
  /** Null is us. */
  readonly competitorId: string | null;
  readonly status: MatrixCellStatus;
  readonly note: string | null;
  /** `source_records` ids. */
  readonly sources: readonly string[];
}

/** A matrix row, as stored. */
export interface MatrixRowRow {
  readonly id: string;
  readonly capability: string;
  readonly severity: MatrixGapSeverity;
  readonly derivation: string;
  readonly cells: readonly MatrixCellRow[];
}

/** A matrix, as stored. */
export interface MatrixRow {
  readonly id: string;
  readonly title: string;
  readonly usLabel: string;
  /** The rival columns, left to right. */
  readonly rivals: readonly { readonly id: string; readonly name: string }[];
  /** Top to bottom. */
  readonly rows: readonly MatrixRowRow[];
}

/** The investigation a brief belongs to. */
export interface InvestigationHeadResource {
  readonly id: string;
  /** `RS-127`. */
  readonly displayId: string;
  readonly question: string;
  /** The kind's slug — `gap_analysis`. */
  readonly kind: string;
  /** `Gap analysis`. */
  readonly kindLabel: string;
  /** The kind chip's hue key — `gap`. */
  readonly tintKey: string;
  readonly depth: InvestigationDepth;
  readonly status: InvestigationStatus;
}

/** A source, as the panel lists it. */
export interface SourceResource extends CiteResource {
  readonly kind: SourceRecordKindColumn;
  /** The research tool that archived it. */
  readonly tool: string;
  readonly title: string;
  readonly locator: string;
  /** The locator as the panel prints it. */
  readonly locatorLabel: string;
  /** Where it can be opened; null for an internal locator with nowhere to go. */
  readonly href: string | null;
}

/** A source, as the full ledger lists it. */
export interface LedgerSourceResource extends SourceResource {
  /** The archived extract — what was read, kept while the page moves on. */
  readonly excerpt: string;
  readonly retrievedAt: string;
  readonly contentHash: string;
}

/** A matrix column. */
export interface MatrixColumnResource {
  readonly label: string;
  /** Whether it is our own column. */
  readonly us: boolean;
  /** The rival; null for us. */
  readonly competitorId: string | null;
}

/** A matrix cell. */
export interface MatrixCellResource {
  readonly status: MatrixCellStatus;
  /** `●`, `◐`, `○` or `?`. */
  readonly glyph: string;
  /** The word beside the glyph — the note when there is one, otherwise the status. */
  readonly label: string;
  readonly note: string | null;
  /** The citations behind it; empty only for `unknown`. */
  readonly cites: readonly CiteResource[];
}

/** A matrix row. */
export interface MatrixRowResource {
  readonly id: string;
  readonly capability: string;
  /** One per column, in column order. */
  readonly cells: readonly MatrixCellResource[];
  readonly gap: {
    readonly severity: MatrixGapSeverity;
    /** `HIGH`. */
    readonly label: string;
    /** The inputs that produced the severity. */
    readonly derivation: string;
  };
}

/** `openapi.yaml`'s `CapabilityMatrix`. */
export interface MatrixResource {
  readonly id: string;
  readonly title: string;
  readonly columns: readonly MatrixColumnResource[];
  readonly rows: readonly MatrixRowResource[];
}

/** Who wrote the brief. */
export interface BriefProvenanceResource {
  /** `loop-v1`; null when the investigation records none. */
  readonly researcher: string | null;
  readonly alias: string | null;
}

/** `GET /research/investigations/{investigationId}/brief`. */
export interface BriefResource {
  readonly investigation: InvestigationHeadResource;
  readonly brief: {
    readonly id: string;
    readonly version: number;
    readonly createdAt: string;
    readonly paragraphs: readonly ParagraphResource[];
  };
  readonly sources: {
    /** How many records the ledger holds — the panel's `44 cited`. */
    readonly cited: number;
    /** The records the brief's own claims cite, in ledger order. */
    readonly panel: readonly SourceResource[];
  };
  /** Null for a kind with no matrix, or before one is built. */
  readonly matrix: MatrixResource | null;
  /** Null when the investigation proposes nothing from its gaps. */
  readonly proposed: GapProposals | null;
  readonly provenance: BriefProvenanceResource;
  /** The Markdown export's file name — `RS-127-brief.md`. */
  readonly exportFilename: string;
}

/** `GET /research/investigations/{investigationId}/sources`. */
export interface BriefLedgerResource {
  /** `RS-127`. */
  readonly investigation: string;
  readonly total: number;
  readonly items: readonly LedgerSourceResource[];
}

/** A brief and its whole ledger — what the export is rendered from. */
export interface BriefDocument {
  readonly brief: BriefResource;
  readonly ledger: readonly LedgerSourceResource[];
}

const GLYPHS: Readonly<Record<MatrixCellStatus, string>> = {
  shipping: "●",
  partial: "◐",
  wip: "◐",
  none: "○",
  unknown: "?",
};

const STATUS_LABELS: Readonly<Record<MatrixCellStatus, string>> = {
  shipping: "shipping",
  partial: "partial",
  wip: "in flight",
  none: "none",
  unknown: "unknown",
};

/**
 * @param row - A ledger record.
 * @param resolve - The workspace's repositories.
 * @returns The record as the full ledger lists it.
 */
export function ledgerSourceResource(
  row: LedgerRow,
  resolve: RepositoryResolver,
): LedgerSourceResource {
  return {
    label: citeLabel(row),
    citeNo: row.citeNo,
    citeKey: row.citeKey,
    sourceId: row.id,
    kind: row.kind,
    tool: row.tool,
    title: row.title,
    locator: row.locator,
    locatorLabel: locatorLabel(row.kind, row.locator),
    href: sourceHref(row.kind, row.locator, resolve),
    excerpt: row.excerpt,
    retrievedAt: row.retrievedAt.toISOString(),
    contentHash: row.contentHash,
  };
}

/**
 * @param source - A record as the full ledger lists it.
 * @returns The same record as the panel lists it — without the archive columns.
 */
export function sourceResource(source: LedgerSourceResource): SourceResource {
  const {
    excerpt: _excerpt,
    retrievedAt: _retrievedAt,
    contentHash: _contentHash,
    ...row
  } = source;
  return row;
}

/**
 * @param matrix - A stored matrix.
 * @param sources - The investigation's ledger, by id.
 * @returns The matrix as a page draws it: columns, then each row's cells in column order.
 */
export function matrixResource(
  matrix: MatrixRow,
  sources: ReadonlyMap<string, LedgerRow>,
): MatrixResource {
  const columns: MatrixColumnResource[] = [
    { label: matrix.usLabel, us: true, competitorId: null },
    ...matrix.rivals.map((rival) => ({ label: rival.name, us: false, competitorId: rival.id })),
  ];

  return {
    id: matrix.id,
    title: matrix.title,
    columns,
    rows: matrix.rows.map((row) => ({
      id: row.id,
      capability: row.capability,
      cells: columns.map((column): MatrixCellResource => {
        // V112's `matrix_rows_complete` guarantees the cell; `unknown` is the honest stand-in.
        const cell = row.cells.find((stored) => stored.competitorId === column.competitorId) ?? {
          status: "unknown" as const,
          note: null,
          sources: [],
        };
        return {
          status: cell.status,
          glyph: GLYPHS[cell.status],
          label: cell.note ?? STATUS_LABELS[cell.status],
          note: cell.note,
          cites: citesOf(cell.sources, sources),
        };
      }),
      gap: {
        severity: row.severity,
        label: row.severity.toUpperCase(),
        derivation: row.derivation,
      },
    })),
  };
}

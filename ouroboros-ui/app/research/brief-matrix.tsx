"use client";

import type { BriefCite, CapabilityMatrix, MatrixCell, MatrixRow } from "@/app/api/research";
import { type Column, Table, cx } from "@/app/ui";

import {
  CAPABILITY_HEADER,
  GAP_HEADER,
  UNKNOWN_CELL_NOTE,
  cellCitesWords,
  cellName,
  usHeader,
} from "./brief";

/** What the matrix takes. */
export interface MatrixTableProps {
  /** The matrix. */
  readonly matrix: CapabilityMatrix;
  /** Told a cite pressed — in a cell's tooltip. */
  readonly onCite: (cite: BriefCite) => void;
}

/**
 * Each cell status's hue — the mockup's `.cap.have`, `.part`, `.none`, `.unk`. Literal class
 * names in a component, so the style suite sees every one rendered.
 */
export const CAP_CLASS: Readonly<Record<MatrixCell["status"], string>> = {
  shipping: "research__cap--have",
  partial: "research__cap--part",
  wip: "research__cap--part",
  none: "research__cap--none",
  unknown: "research__cap--unk",
};

/** Each gap severity's hue — the mockup's `.gap-sev.hi`, `.med`, `.low`, `.par`. */
export const GAP_CLASS: Readonly<Record<MatrixRow["gap"]["severity"], string>> = {
  high: "research__gap--hi",
  med: "research__gap--med",
  low: "research__gap--low",
  lead: "research__gap--low",
  wip: "research__gap--par",
};

/**
 * One cell: its face — the glyph and the word — and, revealed on hover or focus, the citations
 * behind it. A cited cell's face is a button whose press follows its first citation; an
 * `unknown` cell's face is inert and its note says what unknown means.
 *
 * @param props.cell The cell.
 * @param props.column The column's label, for the face's accessible name.
 * @param props.tipId The tooltip's element id.
 * @param props.onCite Told a cite pressed.
 * @returns The cell's content.
 */
function CellFace({
  cell,
  column,
  tipId,
  onCite,
}: Readonly<{
  cell: MatrixCell;
  column: string;
  tipId: string;
  onCite: (cite: BriefCite) => void;
}>) {
  const unknown = cell.status === "unknown";
  const face = (
    <>
      <span aria-hidden="true" className="research__cap-glyph">
        {cell.glyph}
      </span>
      {cell.label}
    </>
  );

  return (
    <span className={cx("research__cap", CAP_CLASS[cell.status])}>
      {unknown ? (
        <span aria-describedby={tipId} aria-label={cellName(column, cell.label)} className="research__cap-face" tabIndex={0}>
          {face}
        </span>
      ) : (
        <button
          aria-describedby={tipId}
          aria-label={cellName(column, cell.label)}
          className="research__cap-face"
          onClick={() => {
            const first = cell.cites[0];
            if (first !== undefined) onCite(first);
          }}
          type="button"
        >
          {face}
        </button>
      )}
      <span className="research__cap-cites" id={tipId} role="tooltip">
        {unknown ? (
          <span className="research__cap-cites-head">{UNKNOWN_CELL_NOTE}</span>
        ) : (
          <>
            <span className="research__cap-cites-head">{cellCitesWords(cell.cites.length)}</span>
            {cell.cites.map((cite) => (
              <button
                className="research__cap-cite"
                key={cite.sourceId}
                onClick={() => onCite(cite)}
                type="button"
              >
                {cite.label}
              </button>
            ))}
          </>
        )}
      </span>
    </span>
  );
}

/**
 * Mockup 22's capability matrix (CN.4, [#630](https://github.com/NobuData/ouroboros/issues/630))
 * on the #46 Table: one row per capability, our column first and accented, one column per
 * rival, and the gap chip last. The table scrolls in the primitive's own wrapper.
 *
 * **Every cell shows its evidence one interaction away.** Hovering or focusing a cell reveals
 * the citations behind it (`CellFace`), each a press that lands on the source. `? unknown` is
 * drawn as the honest state it is — a dimmed face whose note says the investigation did not
 * find out — never as a blank.
 *
 * @param props See {@link MatrixTableProps}.
 * @returns The table.
 */
export function MatrixTable({ matrix, onCite }: MatrixTableProps) {
  const columns: Column<MatrixRow>[] = [
    {
      key: "capability",
      header: CAPABILITY_HEADER,
      cell: (row) => row.capability,
    },
    ...matrix.columns.map(
      (column, index): Column<MatrixRow> => ({
        key: column.competitorId ?? "us",
        header: column.us ? usHeader(column.label) : column.label,
        className: column.us ? "research__matrix-us" : undefined,
        cell: (row) => {
          const cell = row.cells[index];
          if (cell === undefined) return null;

          return (
            <CellFace
              cell={cell}
              column={column.label}
              onCite={onCite}
              tipId={`research-cell-${row.id}-${String(index)}`}
            />
          );
        },
      }),
    ),
    {
      key: "gap",
      header: GAP_HEADER,
      cell: (row) => (
        <span className={cx("research__gap", GAP_CLASS[row.gap.severity])} title={row.gap.derivation}>
          {row.gap.label}
        </span>
      ),
    },
  ];

  return (
    <Table
      caption={matrix.title}
      captionHidden
      className="research__matrix"
      columns={columns}
      rowKey={(row) => row.id}
      rows={matrix.rows}
    />
  );
}

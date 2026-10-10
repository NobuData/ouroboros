"use client";

import { useId } from "react";

import type { Investigation } from "@/app/api/research";
import { Chip, SelectField, cx } from "@/app/ui";

import { TINT_CLASS } from "./composer-kinds";
import {
  ANY_KIND,
  ANY_QUARTER,
  ANY_STATUS,
  CURRENT_QUARTER,
  KIND_FACET_LABEL,
  type KindChoice,
  PILL_TONES,
  QUARTER_FACET_LABEL,
  type RowLinkTarget,
  STATUS_CHOICES,
  STATUS_FACET_LABEL,
  STATUS_WORDS,
  openRowName,
  quarterChoices,
  quarterWords,
  rowLinkTarget,
  subLine,
} from "./investigations";
import { type LibraryFilters, STATUS_FILTERS, type StatusFilter } from "./view";

/** What a row takes. */
export interface InvestigationRowProps {
  /** The row. */
  readonly row: Investigation;
  /** The investigation the Featured brief seat shows, or null. */
  readonly featuredId: string | null;
  /** Open the row — press on its question, or its `brief ↑`. */
  readonly onOpen: (row: Investigation) => void;
  /** Land on a seat of this page — `brief ↑` for the featured one, `to roadmap →`. */
  readonly onLand: (seat: "brief" | "pipeline") => void;
}

/**
 * One row of the investigations card (CN.6,
 * [#632](https://github.com/NobuData/ouroboros/issues/632)) — mockup 22's `inv-row`: the number,
 * the kind chip in its hue, the question over its sub-line, the source count, the status pill
 * (pulsing while something runs now) and **the one link that matters for it**, which the service
 * derived from what the investigation led to.
 *
 * The question is the row's open control: pressing it opens the investigation full-width.
 *
 * @param props See {@link InvestigationRowProps}.
 * @returns The row.
 */
export function InvestigationRow({ row, featuredId, onOpen, onLand }: InvestigationRowProps) {
  const target = rowLinkTarget(row, featuredId);

  return (
    <li className="research__inv-row">
      <span className="research__inv-id">{row.displayId}</span>
      <span className={cx("research__kind-chip", TINT_CLASS[row.kind.tint])}>{row.kind.name}</span>
      <span className="research__inv-q">
        <button
          aria-label={openRowName(row)}
          className="research__inv-open"
          onClick={() => onOpen(row)}
          type="button"
        >
          {row.question}
        </button>
        <span className="research__inv-sub">{subLine(row)}</span>
      </span>
      <Chip dot={row.pill.live ? "pulse" : undefined} tone={PILL_TONES[row.pill.tone]}>
        {row.pill.label}
      </Chip>
      {row.link !== null && target !== null && <RowLink label={row.link.label} onLand={onLand} onOpen={() => onOpen(row)} target={target} />}
    </li>
  );
}

/**
 * A row's contextual link, drawn as what it is: a link to a page, a press that lands on a seat,
 * or a press that opens the row.
 *
 * @param props.label The service's words — `open run →`.
 * @param props.target Where it leads.
 * @param props.onLand Land on a seat.
 * @param props.onOpen Open the row.
 * @returns The control.
 */
function RowLink({
  label,
  target,
  onLand,
  onOpen,
}: Readonly<{
  label: string;
  target: RowLinkTarget;
  onLand: (seat: "brief" | "pipeline") => void;
  onOpen: () => void;
}>) {
  if (target.kind === "href") {
    return (
      <a className="research__inv-link" href={target.href}>
        {label}
      </a>
    );
  }

  return (
    <button
      className="research__inv-link"
      onClick={() => (target.kind === "seat" ? onLand(target.seat) : onOpen())}
      type="button"
    >
      {label}
    </button>
  );
}

/** What the facets take. */
export interface LibraryFacetsProps {
  /** The facets as set. */
  readonly filters: LibraryFilters;
  /** The kinds the workspace has, for the kind facet. */
  readonly kinds: readonly KindChoice[];
  /** The service's current quarter — the first choice of the quarter facet. */
  readonly currentQuarter: string;
  /** Told the facets changed. */
  readonly onChange: (filters: LibraryFilters) => void;
}

/**
 * The library's three facets — kind, status and quarter — which compose, and which the card
 * writes into the address so a filtered view is shareable (decision V11).
 *
 * @param props See {@link LibraryFacetsProps}.
 * @returns The three selects.
 */
export function LibraryFacets({ filters, kinds, currentQuarter, onChange }: LibraryFacetsProps) {
  const id = useId();

  return (
    <div className="research__facets">
      <SelectField
        id={`${id}-kind`}
        label={KIND_FACET_LABEL}
        onChange={(event) => onChange({ ...filters, kind: event.target.value === "" ? null : event.target.value })}
        value={filters.kind ?? ""}
      >
        <option value="">{ANY_KIND}</option>
        {kinds.map((kind) => (
          <option key={kind.slug} value={kind.slug}>
            {kind.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        id={`${id}-status`}
        label={STATUS_FACET_LABEL}
        onChange={(event) =>
          onChange({
            ...filters,
            status: (STATUS_FILTERS as readonly string[]).includes(event.target.value)
              ? (event.target.value as StatusFilter)
              : null,
          })
        }
        value={filters.status ?? ""}
      >
        <option value="">{ANY_STATUS}</option>
        {STATUS_CHOICES.map((status) => (
          <option key={status} value={status}>
            {STATUS_WORDS[status]}
          </option>
        ))}
      </SelectField>
      <SelectField
        id={`${id}-quarter`}
        label={QUARTER_FACET_LABEL}
        onChange={(event) => onChange({ ...filters, quarter: event.target.value === "" ? null : event.target.value })}
        value={filters.quarter ?? ""}
      >
        <option value="">{ANY_QUARTER}</option>
        <option value={CURRENT_QUARTER}>This quarter</option>
        {quarterChoices(currentQuarter).map((key) => (
          <option key={key} value={key}>
            {quarterWords(key)}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

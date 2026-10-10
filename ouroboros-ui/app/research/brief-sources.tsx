"use client";

import { useEffect } from "react";

import type { BriefSource } from "@/app/api/research";
import { ShellOverlay } from "@/app/shell/overlay";
import { cx } from "@/app/ui";

import {
  ALL_SOURCES_LABEL,
  EXCERPT_LABEL,
  LEDGER_LOADING,
  LEDGER_UNAVAILABLE,
  type LedgerOutcome,
  RETRIEVED_LABEL,
  isCited,
  ledgerTitle,
  retrievedWords,
  sourceRowId,
  sourcesTitle,
} from "./brief";

/** What the panel takes. */
export interface SourcesPanelProps {
  /** How many records the ledger holds — the heading's `44 cited`. */
  readonly cited: number;
  /** The records the brief's claims cite. */
  readonly panel: readonly BriefSource[];
  /** The record a marker just landed on, lit; null for none. */
  readonly lit: string | null;
  /** Open the whole ledger. */
  readonly onAll: () => void;
}

/**
 * A source's locator — a link where it opens, the address alone where it does not.
 *
 * @param props.source The source.
 * @param props.className The class the locator wears.
 * @returns The locator.
 */
function Locator({ source, className }: Readonly<{ source: Pick<BriefSource, "href" | "locatorLabel">; className: string }>) {
  return source.href === null ? (
    <span className={className}>{source.locatorLabel}</span>
  ) : (
    <a className={className} href={source.href} rel="noreferrer" target="_blank">
      {source.locatorLabel}
    </a>
  );
}

/**
 * Mockup 22's **SOURCES — 44 CITED** panel (CN.4,
 * [#630](https://github.com/NobuData/ouroboros/issues/630)): the records the brief's own claims
 * cite, each under its marker with its title and locator — a link where the record opens, an
 * address alone where it is internal — and `all ↗`, which opens the whole ledger.
 *
 * Each row carries the element id a marker scrolls to (`sourceRowId`), and the row a marker just
 * landed on is lit.
 *
 * @param props See {@link SourcesPanelProps}.
 * @returns The panel.
 */
export function SourcesPanel({ cited, panel, lit, onAll }: SourcesPanelProps) {
  return (
    <div aria-label={sourcesTitle(cited)} className="research__sources" role="group">
      <div className="research__sources-head">
        <h3 className="research__sources-title">{sourcesTitle(cited)}</h3>
        <button className="research__cite-all" onClick={onAll} type="button">
          {ALL_SOURCES_LABEL}
        </button>
      </div>
      <ul className="research__cites">
        {panel.map((source) => (
          <li
            className={cx("research__cite", lit === source.sourceId && "research__cite--lit")}
            id={sourceRowId(source)}
            key={source.sourceId}
          >
            <span className="research__cite-n">{source.label}</span>
            <span className="research__cite-body">
              <span className="research__cite-t">{source.title}</span>
              <Locator className="research__cite-u" source={source} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the ledger sheet takes. */
export interface LedgerSheetProps {
  /** Whether it is open. */
  readonly open: boolean;
  /** Close it. */
  readonly onClose: () => void;
  /** `RS-127`. */
  readonly displayId: string;
  /** The panel, so a record the claims cite is drawn apart from one only read. */
  readonly panel: readonly BriefSource[];
  /** The ledger as read: null while being read. */
  readonly ledger: LedgerOutcome | null;
  /** The record the sheet opens scrolled to, lit; null for the top. */
  readonly focus: string | null;
}

/**
 * The element id a ledger row carries.
 *
 * @param source The record.
 * @returns `research-ledger-07`.
 */
export function ledgerRowId(source: Pick<BriefSource, "citeNo" | "citeKey">): string {
  return `research-ledger-${source.citeKey ?? String(source.citeNo)}`;
}

/**
 * The whole ledger, as a sheet (CN.4, [#630](https://github.com/NobuData/ouroboros/issues/630)):
 * every record the investigation read, in cite-number order, with the archived excerpt and when
 * it was retrieved — including the records no claim cites, drawn without the cited mark. A
 * matrix cite the panel does not list opens the sheet on its record.
 *
 * @param props See {@link LedgerSheetProps}.
 * @returns The sheet while open.
 */
export function LedgerSheet({ open, onClose, displayId, panel, ledger, focus }: LedgerSheetProps) {
  const total = ledger?.ok === true ? ledger.total : panel.length;

  // The record a cite asked for, once the rows are in the document.
  useEffect(() => {
    if (!open || focus === null || ledger?.ok !== true) return;

    const record = ledger.items.find((item) => item.sourceId === focus);
    if (record === undefined) return;

    document.getElementById(ledgerRowId(record))?.scrollIntoView({ block: "center" });
  }, [open, focus, ledger]);

  return (
    <ShellOverlay label={ledgerTitle(displayId, total)} onClose={onClose} open={open} wide>
      <h2 className="shell-overlay__title">{ledgerTitle(displayId, total)}</h2>
      {ledger === null && <p className="research__ledger-note">{LEDGER_LOADING}</p>}
      {ledger?.ok === false && (
        <p className="research__ledger-note" role="alert">
          {LEDGER_UNAVAILABLE} {ledger.refusal.message}
        </p>
      )}
      {ledger?.ok === true && (
        <ol className="research__ledger">
          {ledger.items.map((item) => (
            <li
              className={cx(
                "research__ledger-row",
                isCited(item, panel) && "research__ledger-row--cited",
                focus === item.sourceId && "research__ledger-row--lit",
              )}
              id={ledgerRowId(item)}
              key={item.sourceId}
            >
              <span className="research__ledger-n">{item.label}</span>
              <span className="research__ledger-body">
                <span className="research__ledger-title">{item.title}</span>
                <Locator className="research__ledger-u" source={item} />
                <span className="research__ledger-excerpt">
                  <span className="research__ledger-meta">{EXCERPT_LABEL}</span> {item.excerpt}
                </span>
                <span className="research__ledger-meta">
                  {RETRIEVED_LABEL} {retrievedWords(item.retrievedAt)} · {item.tool}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </ShellOverlay>
  );
}

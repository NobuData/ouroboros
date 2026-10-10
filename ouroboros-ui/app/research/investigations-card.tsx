"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Reading } from "@/app/api/reading";
import type { Investigation, InvestigationList } from "@/app/api/research";
import { Button, Card, CardHead, Chip, EmptyState, Tag, cx } from "@/app/ui";

import { BriefCard } from "./brief-card";
import { RELOAD_LABEL, progressWords } from "./composer";
import { TINT_CLASS } from "./composer-kinds";
import {
  ACTIVE_LABEL,
  BACK_LABEL,
  CLOSING_CAPTION,
  HISTORY_LABEL,
  INVESTIGATIONS_TITLE,
  type KindChoice,
  LIBRARY_TITLE,
  LIST_LABEL,
  LIST_UNAVAILABLE_TITLE,
  NO_BRIEF_YET,
  NO_INVESTIGATIONS,
  NO_MATCHES,
  OPENING,
  type OpenOutcome,
  type OpenedInvestigation,
  PILL_TONES,
  countsTag,
  isLive,
  listQuery,
  moreLabel,
  rowFromProgress,
  subLine,
} from "./investigations";
import { openInvestigation, readInvestigations } from "./investigations-actions";
import { InvestigationRow, LibraryFacets } from "./investigations-row";
import { type ProgressSourceFactory, watchInvestigation } from "./progress";
import {
  BRIEF_REGION,
  type LibraryFilters,
  NO_FILTERS,
  PIPELINE_REGION,
  type ResearchView,
  regionTitleId,
  researchAddress,
} from "./view";

/** What the card takes. */
export interface InvestigationsCardProps {
  /** The rows the address asked for, read on the server. */
  readonly initial: Reading<InvestigationList>;
  /** Which view the address opened. */
  readonly view: ResearchView;
  /** The library's facets, from the address. */
  readonly filters: LibraryFilters;
  /** The investigation the address opened, read on the server; null for none. */
  readonly opened: { readonly id: string; readonly reading: Reading<OpenedInvestigation> } | null;
  /** The kinds the workspace has, for the kind facet. */
  readonly kinds: readonly KindChoice[];
  /** The investigation the Featured brief seat shows, or null. */
  readonly featuredId: string | null;
  /** Whether this reader may draft work from a brief. */
  readonly mayDraft: boolean;
  /** Land on a seat of this page. */
  readonly onLand: (seat: typeof BRIEF_REGION | typeof PIPELINE_REGION) => void;
  /** How a live row's stream is opened. A test hands in a fake. */
  readonly openSource?: ProgressSourceFactory;
}

/** An investigation being opened, or open. */
type Open =
  | { readonly id: string; readonly state: "loading" }
  | { readonly id: string; readonly state: "ready"; readonly opened: OpenedInvestigation }
  | { readonly id: string; readonly state: "failed"; readonly reason: string };

/**
 * Write the view, its facets and the open investigation into the address — replaced rather than
 * pushed, so Back leaves the page instead of stepping through every facet. Next.js keeps its
 * router in step with the native History API.
 *
 * @param library Whether the library is showing.
 * @param filters The facets.
 * @param open The open investigation, or null.
 */
function syncAddress(library: boolean, filters: LibraryFilters, open: string | null): void {
  const address = researchAddress(library ? "library" : "page", library ? filters : NO_FILTERS, open);
  window.history.replaceState(window.history.state, "", `${address}${window.location.hash}`);
}

/**
 * An investigation opened from the address, as the card's state.
 *
 * @param opened What the server read.
 * @returns The open state.
 */
function openFromReading(opened: InvestigationsCardProps["opened"]): Open | null {
  if (opened === null) return null;
  return opened.reading.ok
    ? { id: opened.id, state: "ready", opened: opened.reading.value }
    : { id: opened.id, state: "failed", reason: opened.reading.reason };
}

/**
 * Mockup 22's **INVESTIGATIONS** card (CN.6,
 * [#632](https://github.com/NobuData/ouroboros/issues/632)) — the list that closes the page:
 * every investigation with its kind, its evidence count, its live status and the one link that
 * matters for it; the **History** toggle and the head's **Research library** opening the same
 * list with its three facets (decision V11); and a row opening the investigation full-width —
 * #630's brief card for one that delivered a brief, its progress for one that has not.
 *
 * **Live rows are live.** A queued or running row's progress stream ticks its source count and
 * pill without a reload; when the run ends the list is re-read, so the pill and the link are the
 * service's derived ones. `fix loop live` pulses on the service's word.
 *
 * **The facets are the address.** A facet change, the toggle and a row press each rewrite
 * `?view=library&kind=…&status=…&quarter=…&open=…`, so a filtered view — and an open investigation
 * — is shareable, and the page reads the same address back on load.
 *
 * @param props See {@link InvestigationsCardProps}.
 * @returns The card.
 */
export function InvestigationsCard({
  initial,
  view,
  filters: initialFilters,
  opened,
  kinds,
  featuredId,
  mayDraft,
  onLand,
  openSource,
}: InvestigationsCardProps) {
  const router = useRouter();
  const titleId = regionTitleId("investigations");
  const [library, setLibrary] = useState(view === "library");
  const [filters, setFilters] = useState<LibraryFilters>(initialFilters);
  const [list, setList] = useState<InvestigationList | null>(initial.ok ? initial.value : null);
  const [refusal, setRefusal] = useState<string | null>(initial.ok ? null : initial.reason);
  const [reading, setReading] = useState(false);
  const [open, setOpen] = useState<Open | null>(() => openFromReading(opened));
  const asked = useRef(0);

  /**
   * Read a page of rows for a view and facets, keeping only the newest ask's answer.
   *
   * @param nextLibrary Whether the library is showing.
   * @param nextFilters The facets.
   * @param offset Where the page starts; past 0 the rows are appended.
   */
  const read = useCallback(async (nextLibrary: boolean, nextFilters: LibraryFilters, offset = 0) => {
    const ask = (asked.current += 1);
    setReading(true);
    const outcome = await readInvestigations(listQuery(nextLibrary ? "library" : "page", nextFilters), offset);
    if (ask !== asked.current) return;

    setReading(false);
    if (!outcome.ok) {
      setRefusal(outcome.refusal.message);
      return;
    }
    setRefusal(null);
    setList((current) =>
      offset > 0 && current !== null
        ? { ...outcome.list, items: [...current.items, ...outcome.list.items] }
        : outcome.list,
    );
  }, []);

  /** Toggle between the active list and the library. */
  function toggleLibrary(): void {
    const next = !library;
    setLibrary(next);
    setOpen(null);
    syncAddress(next, filters, null);
    void read(next, filters);
  }

  /**
   * Change the facets.
   *
   * @param next The facets.
   */
  function changeFilters(next: LibraryFilters): void {
    setFilters(next);
    syncAddress(true, next, open?.id ?? null);
    void read(true, next);
  }

  /**
   * Open a row full-width.
   *
   * @param row The row.
   */
  function openRow(row: Investigation): void {
    setOpen({ id: row.id, state: "loading" });
    syncAddress(library, filters, row.id);
    void openInvestigation(row.id).then((outcome: OpenOutcome) => {
      setOpen((current) => {
        if (current === null || current.id !== row.id) return current;
        return outcome.ok
          ? { id: row.id, state: "ready", opened: outcome.opened }
          : { id: row.id, state: "failed", reason: outcome.refusal.message };
      });
    });
  }

  /** Back from an open investigation to the rows. */
  function closeRow(): void {
    setOpen(null);
    syncAddress(library, filters, null);
  }

  // The rows whose run can still change follow their stream; a run that ends re-reads the list.
  const liveIds = (list?.items ?? []).filter(isLive).map((row) => row.id).join(",");
  useEffect(() => {
    if (liveIds === "") return undefined;

    const stops = liveIds.split(",").map((id) =>
      watchInvestigation(
        id,
        {
          onProgress: (progress) =>
            setList((current) =>
              current === null
                ? current
                : {
                    ...current,
                    items: current.items.map((row) => (row.id === id ? rowFromProgress(row, progress) : row)),
                  },
            ),
          onDone: () => void read(library, filters),
          onError: () => {},
        },
        openSource,
      ),
    );

    return () => {
      for (const stop of stops) stop();
    };
    // The stream follows the set of live rows, not every row change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveIds, openSource]);

  const rows = list?.items ?? [];
  const title = library ? LIBRARY_TITLE : INVESTIGATIONS_TITLE;

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        beside={list === null ? undefined : <Tag>{countsTag(list.counts)}</Tag>}
        title={title}
        titleId={titleId}
        trailing={
          <Button onClick={toggleLibrary} size="sm" tone="ghost">
            {library ? ACTIVE_LABEL : HISTORY_LABEL}
          </Button>
        }
      />

      {open !== null ? (
        <OpenedView
          featuredId={featuredId}
          mayDraft={mayDraft}
          onBack={closeRow}
          onLand={onLand}
          open={open}
          row={rows.find((row) => row.id === open.id) ?? null}
        />
      ) : (
        <>
          {library && list !== null && (
            <LibraryFacets currentQuarter={list.quarter.key} filters={filters} kinds={kinds} onChange={changeFilters} />
          )}

          {refusal !== null && list === null && (
            <EmptyState note={refusal} title={LIST_UNAVAILABLE_TITLE} variant="flush">
              <Button onClick={() => router.refresh()} tone="ghost">
                {RELOAD_LABEL}
              </Button>
            </EmptyState>
          )}
          {refusal !== null && list !== null && (
            <p className="research__refusal" role="alert">
              {refusal}
            </p>
          )}

          {list !== null && rows.length === 0 && (
            <EmptyState note={library ? NO_MATCHES : NO_INVESTIGATIONS} variant="flush" />
          )}
          {rows.length > 0 && (
            <ol aria-busy={reading} aria-label={LIST_LABEL} className="research__inv">
              {rows.map((row) => (
                <InvestigationRow featuredId={featuredId} key={row.id} onLand={onLand} onOpen={openRow} row={row} />
              ))}
            </ol>
          )}
          {list !== null && rows.length < list.total && (
            <Button
              onClick={() => void read(library, filters, rows.length)}
              reason={reading ? OPENING : undefined}
              size="sm"
              tone="ghost"
            >
              {moreLabel(rows.length, list.total)}
            </Button>
          )}

          <p className="research__inv-caption">{CLOSING_CAPTION}</p>
        </>
      )}
    </Card>
  );
}

/**
 * An investigation, opened full-width in the card: the brief card for one that delivered a
 * brief, its progress for one that has not, and the way back to the rows.
 *
 * @param props.open The open state.
 * @param props.row The row, for what the detail is not yet read from.
 * @param props.featuredId The featured investigation, for the brief's landing.
 * @param props.mayDraft Whether this reader may draft.
 * @param props.onBack Back to the rows.
 * @param props.onLand Land on a seat.
 * @returns The view.
 */
function OpenedView({
  open,
  row,
  mayDraft,
  onBack,
  onLand,
}: Readonly<{
  open: Open;
  row: Investigation | null;
  featuredId: string | null;
  mayDraft: boolean;
  onBack: () => void;
  onLand: (seat: typeof BRIEF_REGION | typeof PIPELINE_REGION) => void;
}>) {
  return (
    <div className="research__inv-open-view">
      <Button className="research__inv-back" onClick={onBack} size="sm" tone="ghost">
        {BACK_LABEL}
      </Button>

      {open.state === "loading" && <p className="research__inv-note">{OPENING}</p>}
      {open.state === "failed" && (
        <p className="research__refusal" role="alert">
          {open.reason}
        </p>
      )}
      {open.state === "ready" && open.opened.brief !== null && (
        <BriefCard
          featured={{ brief: open.opened.brief, detail: open.opened.detail }}
          mayDraft={mayDraft}
          onLandPipeline={() => onLand(PIPELINE_REGION)}
        />
      )}
      {open.state === "ready" && open.opened.brief === null && (
        <div className="research__inv-detail">
          <p className="research__question-echo">
            <span className={cx("research__kind-chip", TINT_CLASS[open.opened.detail.kind.tint])}>
              {open.opened.detail.kind.name}
            </span>
            <span className="research__progress-id">{open.opened.detail.displayId}</span>
            {open.opened.detail.question}
          </p>
          <p className="research__progress-line">
            <Chip dot={open.opened.detail.pill.live ? "pulse" : "filled"} tone={PILL_TONES[open.opened.detail.pill.tone]}>
              {open.opened.detail.pill.label}
            </Chip>
            <span className="research__progress-figures">{progressWords(open.opened.detail.progress)}</span>
          </p>
          <p className="research__inv-note">
            {NO_BRIEF_YET}
            {row !== null && ` ${subLine(row)}.`}
          </p>
        </div>
      )}
    </div>
  );
}

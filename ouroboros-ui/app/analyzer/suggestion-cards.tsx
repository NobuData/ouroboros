"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import type { AnalysisSuggestion } from "@/app/api/analyzer";
import { WORKFLOWS_PATH } from "@/app/paths";
import { Button, Card, CardHead, Chip, EmptyState, Tag, cx } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import { ApplyDialog } from "./apply-dialog";
import { DismissDialog } from "./dismiss-dialog";
import { SpikeDialog } from "./spike-dialog";
import { StripPopover } from "./strip-popover";
import { SuggestionSheet } from "./suggestion-sheet";
import {
  CARD_TITLES,
  CONFIDENCE_HEADING,
  type CardKind,
  DETAILS_LABEL,
  DISMISS_LABEL,
  DISMISS_ROLE_REASON,
  EVIDENCE_LABEL,
  GO_GLYPH,
  IMPACT_HEADING,
  SIMULATE_LABEL,
  SIMULATE_SOON,
  SOON_MARK,
  SPIKE_PILL,
  STUDIO_LINK,
  cardEmpty,
  cardRows,
  confidenceLines,
  confidenceText,
  impactLines,
  impactText,
  impactTone,
  openTag,
  primaryAction,
  resolved,
} from "./suggestions-view";

/** What a row's control opened: which surface, about which suggestion. */
interface Opened {
  readonly mode: "primary" | "dismiss" | "details";
  readonly id: string;
}

/** The impact pill's classes by tint — the design system's chip, as a button. */
const IMPACT_CLASS: Record<"ok" | "warn", string> = {
  ok: cx("ou-chip ou-chip--ok", "analyzer-sugg__impact"),
  warn: cx("ou-chip ou-chip--warn", "analyzer-sugg__impact"),
};

/**
 * The id a row's article answers to — where focus goes when the control that had it is gone.
 *
 * @param id The suggestion.
 * @returns The element id.
 */
function rowId(id: string): string {
  return `suggestion-${id}`;
}

/**
 * Mockup 18's **Suggested build-process changes** (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518)) — the `N open` card.
 *
 * @returns The card.
 */
export function ProcessSuggestionsCard() {
  return <SuggestionsCard kind="build_process" />;
}

/**
 * Mockup 18's **Suggested workflow changes** (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518)) — the card that links to the studio.
 *
 * @returns The card.
 */
export function WorkflowSuggestionsCard() {
  return <SuggestionsCard kind="workflow" />;
}

/**
 * One suggestion card: the rows of its kind, and the four surfaces a row's controls open — the
 * consequence preview, the spike draft, the dismissal and the Details sheet.
 *
 * The rows are the suggestions the service holds current, under the page's own resolutions
 * (`cardRows`), so a row resolves the moment its action is taken and stays resolved when the poll
 * confirms it. Every surface is handed the **live** row by id: a sheet left open over a poll shows
 * what the page shows, and closes by itself if an analysis no longer finds that suggestion.
 *
 * When a row resolves, the control that opened the dialog is gone with the row's open form, so
 * focus is moved to the row itself rather than left to fall to the page.
 *
 * @param props.kind Which card.
 * @returns The card.
 */
function SuggestionsCard({ kind }: Readonly<{ kind: CardKind }>) {
  const { page, local, refusals } = useAnalyzer();
  const titleId = useId();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [refocus, setRefocus] = useState<string | null>(null);
  const suggestions = page?.suggestions ?? null;
  const rows = suggestions === null ? [] : cardRows(suggestions, kind, local);
  const empty = suggestions === null ? null : cardEmpty(suggestions, kind);
  const target = opened === null ? null : (rows.find((row) => row.id === opened.id) ?? null);
  const primary = target === null ? null : primaryAction(target).kind;

  // A row resolves once, so the same id is never asked for twice and nothing has to be reset.
  useEffect(() => {
    if (refocus !== null) document.getElementById(rowId(refocus))?.focus();
  }, [refocus]);

  /** Close whatever is open. */
  const close = () => setOpened(null);

  /**
   * Close the surface whose action resolved its row, and put focus on that row.
   *
   * @param id The suggestion that was resolved.
   */
  const resolvedRow = (id: string) => {
    setOpened(null);
    setRefocus(id);
  };

  return (
    <Card
      aria-busy={suggestions === null || undefined}
      aria-labelledby={titleId}
      as="section"
      className="analyzer-sugg"
    >
      <CardHead
        title={CARD_TITLES[kind]}
        titleId={titleId}
        trailing={
          kind === "workflow" ? (
            <Link className="analyzer-sugg__studio" href={WORKFLOWS_PATH}>
              {STUDIO_LINK} <span aria-hidden="true">{GO_GLYPH}</span>
            </Link>
          ) : suggestions === null || empty !== null ? undefined : (
            <Tag>{openTag(rows)}</Tag>
          )
        }
      />
      {suggestions === null ? (
        <div aria-hidden="true" className="analyzer-sugg__skeleton" />
      ) : empty !== null ? (
        <EmptyState note={empty.note} title={empty.title} />
      ) : (
        <SuggestionList onOpen={(mode, id) => setOpened({ mode, id })} refusals={refusals} rows={rows} />
      )}
      <ApplyDialog
        onClose={close}
        onResolved={resolvedRow}
        suggestion={opened?.mode === "primary" && primary !== "draft_spike" ? target : null}
      />
      <SpikeDialog
        onClose={close}
        onResolved={resolvedRow}
        suggestion={opened?.mode === "primary" && primary === "draft_spike" ? target : null}
      />
      <DismissDialog
        onClose={close}
        onResolved={resolvedRow}
        suggestion={opened?.mode === "dismiss" ? target : null}
      />
      <SuggestionSheet onClose={close} suggestion={opened?.mode === "details" ? target : null} />
    </Card>
  );
}

/**
 * A card's rows. Exported so they can be drawn from a value — the cards read theirs from the
 * page's store.
 *
 * @param props.rows The suggestions, each under the page's own resolution of it.
 * @param props.refusals Why a dismissal was rolled back, by suggestion.
 * @param props.onOpen Called with the surface a row's control opens, and the suggestion.
 * @returns The list.
 */
export function SuggestionList({
  rows,
  refusals,
  onOpen,
}: Readonly<{
  rows: readonly AnalysisSuggestion[];
  refusals: ReadonlyMap<string, string>;
  onOpen: (mode: Opened["mode"], id: string) => void;
}>) {
  return (
    <ul className="analyzer-sugg__rows">
      {rows.map((row) => (
        <SuggestionRow
          key={row.id}
          onOpen={(mode) => onOpen(mode, row.id)}
          refusal={refusals.get(row.id) ?? null}
          row={row}
        />
      ))}
    </ul>
  );
}

/**
 * One row of a card — the mockup's `.sugg`.
 *
 * An **open** row: the title, the mono evidence line, the impact pill and the `conf NN%` affix —
 * each a button opening what produced it — the `needs a spike` pill where flagged, and the
 * controls. A **resolved** row: the title, how it was resolved and what follows from that, with
 * its links, and Details.
 *
 * @param props.row The suggestion, under the page's own resolution of it.
 * @param props.refusal Why its dismissal was rolled back, or `null`.
 * @param props.onOpen Called with the surface a control opens.
 * @returns The row.
 */
function SuggestionRow({
  row,
  refusal,
  onOpen,
}: Readonly<{
  row: AnalysisSuggestion;
  refusal: string | null;
  onOpen: (mode: Opened["mode"]) => void;
}>) {
  const titleId = useId();
  const state = resolved(row);

  return (
    <li className="analyzer-sugg__row">
      <article aria-labelledby={titleId} className="analyzer-sugg__body" id={rowId(row.id)} tabIndex={-1}>
        {state === null ? (
          <OpenRow onOpen={onOpen} row={row} titleId={titleId} />
        ) : (
          <>
            <h3 className="analyzer-sugg__title analyzer-sugg__title--resolved" id={titleId}>
              {row.title}
            </h3>
            <p className="analyzer-sugg__state">
              <span className="analyzer-sugg__headline">{state.headline}</span> — {state.note}
            </p>
            {state.reason !== null && <p className="analyzer-sugg__reason">“{state.reason}”</p>}
            <div className="analyzer-sugg__foot">
              {state.links.map((link) =>
                link.anchor ? (
                  <a className="analyzer-sugg__link" href={link.href} key={link.href}>
                    {link.label} <span aria-hidden="true">↓</span>
                  </a>
                ) : (
                  <Link className="analyzer-sugg__link" href={link.href} key={link.href}>
                    {link.label} <span aria-hidden="true">{GO_GLYPH}</span>
                  </Link>
                ),
              )}
              <span className="analyzer-sugg__actions">
                <Button aria-describedby={titleId} onClick={() => onOpen("details")} size="sm" tone="ghost">
                  {DETAILS_LABEL}
                </Button>
              </span>
            </div>
          </>
        )}
        {refusal !== null && (
          <p className="analyzer-sugg__refusal" role="alert">
            {refusal}
          </p>
        )}
      </article>
    </li>
  );
}

/**
 * An open row's content.
 *
 * Every control is named by its own label and described by the row's title, so a list of rows is
 * not a list of identical *Apply* buttons to a screen reader. An inert one is described by its
 * reason instead — the one thing about it a reader most needs to hear.
 *
 * @param props.row The open suggestion.
 * @param props.titleId The id its title answers to.
 * @param props.onOpen Called with the surface a control opens.
 * @returns The title, the evidence line and the foot.
 */
function OpenRow({
  row,
  titleId,
  onOpen,
}: Readonly<{ row: AnalysisSuggestion; titleId: string; onOpen: (mode: Opened["mode"]) => void }>) {
  const { mayDismiss } = useAnalyzer();
  const impact = impactText(row.impact);
  const primary = primaryAction(row);

  return (
    <>
      <h3 className="analyzer-sugg__title" id={titleId}>
        {row.title}
      </h3>
      <p className="analyzer-sugg__evidence">
        <span className="analyzer-sugg__label">{EVIDENCE_LABEL}</span>
        {row.evidenceLine}
      </p>
      <div className="analyzer-sugg__foot">
        {impact !== null && row.impact !== null && (
          <StripPopover
            title={IMPACT_HEADING}
            trigger={
              <span>
                {impact} <span aria-hidden="true">ⓘ</span>
              </span>
            }
            triggerClassName={IMPACT_CLASS[impactTone(row.impact)]}
          >
            {impactLines(row).map((line) => (
              <span className="analyzer-pop__text" key={line}>
                {line}
              </span>
            ))}
          </StripPopover>
        )}
        <StripPopover
          title={CONFIDENCE_HEADING}
          trigger={
            <span>
              {confidenceText(row.confidence)} <span aria-hidden="true">ⓘ</span>
            </span>
          }
          triggerClassName="analyzer-sugg__conf"
        >
          {confidenceLines(row).map((line) => (
            <span className="analyzer-pop__text" key={line}>
              {line}
            </span>
          ))}
        </StripPopover>
        {row.needsSpike && <Chip tone="warn">{SPIKE_PILL}</Chip>}
        <span className="analyzer-sugg__actions">
          <Button
            aria-describedby={primary.reason === undefined ? titleId : undefined}
            aria-haspopup="dialog"
            onClick={() => onOpen("primary")}
            reason={primary.reason}
            size="sm"
            tone="primary"
          >
            {primary.label}
            {primary.leads && (
              <>
                {" "}
                <span aria-hidden="true">{GO_GLYPH}</span>
              </>
            )}
          </Button>
          {row.kind === "workflow" && (
            <Button reason={SIMULATE_SOON} size="sm" tone="ghost">
              {/* The space keeps the accessible name's words apart — "… loops soon". */}
              {SIMULATE_LABEL} <span className="analyzer-sugg__soon">{SOON_MARK}</span>
            </Button>
          )}
          <Button
            aria-describedby={titleId}
            aria-haspopup="dialog"
            onClick={() => onOpen("details")}
            size="sm"
            tone="ghost"
          >
            {DETAILS_LABEL}
          </Button>
          <Button
            aria-describedby={mayDismiss ? titleId : undefined}
            aria-haspopup="dialog"
            onClick={() => onOpen("dismiss")}
            reason={mayDismiss ? undefined : DISMISS_ROLE_REASON}
            size="sm"
            tone="ghost"
          >
            {DISMISS_LABEL}
          </Button>
        </span>
      </div>
    </>
  );
}

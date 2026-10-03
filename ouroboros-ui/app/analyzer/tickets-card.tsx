"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import type { AnalysisTicketBatch, AnalysisUndraftedTicket } from "@/app/api/analyzer";
import type { PlanningBatch } from "@/app/api/planning";
import { PLANNING_PATH } from "@/app/paths";
import {
  PUSHING,
  PUSHING_MARK,
  RESUME_LABEL,
  type RowPush,
  type RowSizing,
  SIZING_MARK,
  type TrackerOption,
  UNSIZED_MARK,
  allSized,
  batchHref,
  isSelected,
  loopTimeText,
  pushMode,
  rowPush,
  rowSizing,
  selectReason,
  selectedCount,
  sizingProgress,
} from "@/app/planning/generator";
import { Button, Card, CardHead, Chip, EffortChip, EmptyState } from "@/app/ui";

import { pushTickets, selectTicket } from "./analyzer-actions";
import { useAnalyzer } from "./analyzer-store";
import { AnalyzerToastSeat } from "./analyzer-toast";
import { DraftTicketsDialog } from "./draft-tickets-dialog";
import { DRAFT_ROLE_REASON, GO_GLYPH, confidenceText } from "./suggestions-view";
import { TicketEvidenceSheet } from "./ticket-evidence-sheet";
import {
  EDIT_DRAFTS_LABEL,
  NO_EVIDENCE_LINE,
  OPENS_GLYPH,
  OPEN_BATCH_LABEL,
  type OpenedEvidence,
  RETRY_LABEL,
  RETRY_NOTE,
  SELECT_ALL_LABEL,
  type SelectAll,
  TICKETS_TITLE,
  type TicketRow,
  UNDRAFTED_HEADING,
  UNDRAFTED_NOTE,
  batchCaption,
  closedSummary,
  draftLabel,
  evidenceName,
  isClosed,
  manyGroups,
  openedEvidence,
  pushBlock,
  pushLabel,
  pushTitle,
  pushToast,
  selectAll,
  tickReason,
  ticketRows,
  ticketsEmpty,
} from "./tickets-view";

/**
 * Mockup 18's **Drafted tickets — from patterns, not people** (BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519)) — the analyzer's most concrete output:
 * work in the team's tracker.
 *
 * **It is a view onto ordinary planning batches, not a second drafting system.** A row is a
 * planning draft: its checkbox is the draft's stored `selected`, its effort chip the estimator's
 * sizing, its `est. total` the service's sum in the planning footer's own words, and **Edit
 * drafts** opens the planning page's own editor on the batch. What the card adds is the evidence — the mono line under each title, read
 * from the draft's body, opening the references behind it.
 *
 * The card holds, in order: the ticket suggestions nobody has drafted yet (with **Draft N
 * tickets**), then each batch still current, newest first — every draft a batch holds, because a
 * push files every selected one. With one batch and nothing un-drafted, it is the mockup.
 *
 * @returns The card.
 */
export function TicketsCard() {
  const { page } = useAnalyzer();
  const titleId = useId();
  const [opened, setOpened] = useState<OpenedEvidence | null>(null);
  const [drafting, setDrafting] = useState(false);
  const tickets = page?.tickets ?? null;
  const empty = tickets === null || page === null ? null : ticketsEmpty(tickets, page.suggestions.runId !== null);
  const captioned = tickets !== null && manyGroups(tickets);

  return (
    <Card aria-busy={tickets === null || undefined} aria-labelledby={titleId} as="section" className="analyzer-tix">
      <CardHead title={TICKETS_TITLE} titleId={titleId} />
      <AnalyzerToastSeat />
      {tickets === null ? (
        <div aria-hidden="true" className="analyzer-tix__skeleton" />
      ) : empty !== null ? (
        <EmptyState note={empty.note} title={empty.title} />
      ) : (
        <>
          {tickets.undrafted.length > 0 && (
            <UndraftedGroup
              onDraft={() => setDrafting(true)}
              onEvidence={(id) => setOpened({ group: "undrafted", id })}
              suggestions={tickets.undrafted}
            />
          )}
          {tickets.batches.map((entry) => (
            <BatchGroup
              captioned={captioned}
              entry={entry}
              key={entry.batch.id}
              onEvidence={(localKey) => setOpened({ group: "batch", batchId: entry.batch.id, localKey })}
            />
          ))}
        </>
      )}
      <TicketEvidenceSheet
        evidence={tickets === null ? null : openedEvidence(tickets, opened)}
        onClose={() => setOpened(null)}
      />
      <DraftTicketsDialog
        onClose={() => setDrafting(false)}
        suggestions={drafting && tickets !== null ? tickets.undrafted : null}
      />
    </Card>
  );
}

/** A batch an action answered with, and the page's batch it was heard over. */
interface Heard {
  readonly batch: PlanningBatch;
  readonly over: PlanningBatch;
}

/**
 * One planning batch on the card: its drafts, its total, and its push.
 *
 * ### Selection
 *
 * A tick is drawn at once and sent to planning's own route; the service answers with the batch,
 * whose footer has moved with the selection. A refused tick is put back, with why.
 * The select-all checkbox ticks — or unticks — every draft not yet pushed, one request per draft
 * that changes.
 *
 * ### Which batch is drawn
 *
 * The page's poll carries the batch, and a write answers with it sooner. So the answer is drawn
 * **until the poll delivers a newer page** — held against the very payload it was heard over, not
 * against a clock — and each write asks for that newer page at once, which also drops a read that
 * left before the write.
 *
 * ### Pushing
 *
 * **Push N tickets to backlog →** files the ticked drafts in the batch's tracker — the service's
 * idempotent push, so pressing again after a failure files only what did not land. While it runs
 * the page is read every two seconds, so each row's state appears as it lands; a failed row says
 * why and offers **Retry**, which is the same push. The outcome is announced in the page's toast.
 *
 * Once the service closes the batch its rows give way to a summary, and focus moves to it — the
 * button that was pressed is gone with the rows.
 *
 * Each group is a named `group` — which batch it is — so two batches that both hold a `BA-1` are
 * two things to a screen reader as well.
 *
 * @param props.entry The batch, and what each draft's body says its evidence is.
 * @param props.captioned Whether to say which batch this is — the card holds more than one group.
 * @param props.onEvidence Called with a draft's key when its evidence line is pressed.
 * @returns The group.
 */
function BatchGroup({
  entry,
  captioned,
  onEvidence,
}: Readonly<{ entry: AnalysisTicketBatch; captioned: boolean; onEvidence: (localKey: string) => void }>) {
  const { mayAdminister, mayContribute, trackers, trackersFailure, refresh, announce } = useAnalyzer();
  const [heard, setHeard] = useState<Heard | null>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const polled = useRef(entry.batch);

  // What an answer is heard over is the page's batch when the answer lands, not when the press
  // was made — a poll may have come in between.
  useEffect(() => {
    polled.current = entry.batch;
  }, [entry.batch]);

  const batch = heard !== null && heard.over === entry.batch ? heard.batch : entry.batch;
  const pushing = busy === PUSHING;
  const tracker = trackers.find((option) => option.sourceId === batch.targetSourceId);
  const closed = isClosed(batch);
  const group = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(!closed);

  // The push that closes a batch takes its own button with it, so focus moves to what replaced
  // the rows rather than being left to fall to the page.
  useEffect(() => {
    if (closed && wasOpen.current) group.current?.focus();
    wasOpen.current = !closed;
  }, [closed]);

  // While a push runs its drafts land one by one; ask closely so each row's state appears as it does.
  useEffect(() => {
    if (!pushing) return;

    const timer = setInterval(refresh, 2000);

    return () => {
      clearInterval(timer);
    };
  }, [pushing, refresh]);

  /**
   * Take a batch an action answered with, and ask for the page again.
   *
   * @param next The batch.
   */
  function hear(next: PlanningBatch): void {
    setHeard({ batch: next, over: polled.current });
    refresh();
  }

  /**
   * Forget ticks that were drawn and are now settled — or never sent.
   *
   * @param settled Each key with the value that was drawn for it.
   */
  function settle(settled: ReadonlyMap<string, boolean>): void {
    setPending((current) => {
      const next = new Map(current);

      // Dropped only if no later click on the same row replaced it — that click's answer settles it.
      for (const [key, selected] of settled) if (next.get(key) === selected) next.delete(key);

      return next;
    });
  }

  /**
   * Tick or untick drafts — drawn at once, then sent one at a time. The first refusal stops the
   * walk and puts back everything not yet saved.
   *
   * @param keys The drafts, by key.
   * @param selected The new state.
   */
  async function select(keys: readonly string[], selected: boolean): Promise<void> {
    const drawn = new Map(keys.map((key) => [key, selected]));

    setFailure(null);
    setPending((current) => new Map([...current, ...drawn]));

    for (const key of keys) {
      const answer = await selectTicket(batch.id, key, selected);

      if (!answer.ok) {
        setFailure(answer.reason);
        break;
      }

      hear(answer.batch);
    }

    settle(drawn);
  }

  /**
   * **Push N tickets to backlog →**, **Resume push** and a failed row's **Retry** — one push. Each
   * of those controls is inert while one runs (`pushBlock`), so it is never started twice.
   */
  async function push(): Promise<void> {
    setBusy(PUSHING);
    setFailure(null);

    const answer = await pushTickets(batch.id);

    setBusy(null);

    if (!answer.ok) {
      setFailure(answer.reason);
      refresh();
      return;
    }

    if (answer.batch === null) refresh();
    else hear(answer.batch);

    announce(pushToast(answer.report, tracker));
  }

  const caption = batchCaption(batch, tracker);

  if (closed) {
    return (
      <div aria-label={caption} className="analyzer-tix__group" ref={group} role="group" tabIndex={-1}>
        <ClosedBatch batch={batch} caption={captioned ? caption : null} tracker={tracker} />
      </div>
    );
  }

  const { drafts } = batch;
  const all = selectAll(drafts, pending);
  const count = selectedCount(drafts, pending);
  const mode = pushMode(drafts, pending);
  const blockedPush = pushBlock({ mode, count, tracker, mayAdminister, busy, trackersFailure });
  const blockedAll = selectReason(batch, mayContribute, pushing);

  return (
    <div aria-label={caption} className="analyzer-tix__group" ref={group} role="group" tabIndex={-1}>
      <div className="analyzer-tix__head">
        <SelectAllBox
          onChange={() => void select(all.keys, all.next)}
          reason={blockedAll}
          state={all}
        />
        {captioned && <span className="analyzer-tix__caption">{caption}</span>}
        {!allSized(drafts) && <Chip dot="ring">{sizingProgress(drafts)}</Chip>}
      </div>

      <ul className="analyzer-tix__rows">
        {ticketRows(batch, entry.drafts).map((row) => {
          const selected = isSelected(row.draft, pending);

          return (
            <TicketItem
              key={row.draft.id}
              onEvidence={() => onEvidence(row.draft.localKey)}
              onRetry={() => void push()}
              onSelect={(next) => void select([row.draft.localKey], next)}
              push={rowPush(row.draft, selected, pushing)}
              retryReason={blockedPush}
              row={row}
              selected={selected}
              sizing={rowSizing(row.draft, batch.autoSize)}
              tickReason={tickReason(row.draft, batch, mayContribute, pushing)}
            />
          );
        })}
      </ul>

      <div className="analyzer-tix__footer">
        <span className="analyzer-tix__total">{loopTimeText(batch)}</span>
        <div className="analyzer-tix__actions">
          <Button
            onClick={() => void push()}
            reason={blockedPush}
            size="sm"
            title={blockedPush === undefined ? pushTitle(tracker) : undefined}
            tone="primary"
          >
            {mode === "resume" ? (
              RESUME_LABEL
            ) : (
              <>
                {pushLabel(count)} <span aria-hidden="true">{GO_GLYPH}</span>
              </>
            )}
          </Button>
          <Button href={batchHref(PLANNING_PATH, batch.id)} size="sm" tone="ghost">
            {EDIT_DRAFTS_LABEL}
          </Button>
        </div>
      </div>

      {failure !== null && (
        <p className="analyzer-tix__failure" role="alert">
          {failure}
        </p>
      )}
      {busy !== null && (
        <p className="analyzer-tix__busy" role="status">
          {busy}
        </p>
      )}
    </div>
  );
}

/**
 * The select-all checkbox — a real checkbox, mixed when some drafts are ticked and some are not.
 *
 * @param props.state What it shows, and what a press would change.
 * @param props.reason Why it cannot change, when it cannot.
 * @param props.onChange Called on a press.
 * @returns The labelled checkbox.
 */
function SelectAllBox({
  state,
  reason,
  onChange,
}: Readonly<{ state: SelectAll; reason: string | undefined; onChange: () => void }>) {
  const box = useRef<HTMLInputElement>(null);

  // `indeterminate` is a property, not an attribute: there is nothing to render it with.
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = state.indeterminate;
  }, [state.indeterminate]);

  return (
    <label className="analyzer-tix__all" title={reason}>
      <input
        checked={state.checked}
        className="analyzer-tix__check"
        disabled={reason !== undefined || state.keys.length === 0}
        onChange={onChange}
        ref={box}
        type="checkbox"
      />
      {SELECT_ALL_LABEL}
    </label>
  );
}

/**
 * One drafted ticket — the mockup's `.ticket`: checkbox, mono key, title, effort chip, and under
 * them the mono evidence line. Exported so a row can be drawn from values — the card draws its
 * rows from the page's store.
 *
 * The evidence line is a button opening its references. A draft whose body states no evidence
 * says so in its place, rather than showing the analyzer's line beside a ticket that will not
 * carry it. Below it, once a push has touched the row: `pushed ✓ #621` linking to the tracker, or
 * why it failed, with **Retry**.
 *
 * @param props.row The draft and the evidence its body states.
 * @param props.selected Whether it is ticked right now, pending ticks included.
 * @param props.sizing Its estimate as drawn.
 * @param props.push Its push state as drawn.
 * @param props.tickReason Why the checkbox cannot change, when it cannot.
 * @param props.retryReason Why **Retry** cannot act, when it cannot.
 * @param props.onSelect Called with the new checked state.
 * @param props.onEvidence Called when the evidence line is pressed.
 * @param props.onRetry Called when **Retry** is pressed.
 * @returns The list item.
 */
export function TicketItem({
  row,
  selected,
  sizing,
  push,
  tickReason: blockedTick,
  retryReason,
  onSelect,
  onEvidence,
  onRetry,
}: Readonly<{
  row: TicketRow;
  selected: boolean;
  sizing: RowSizing;
  push: RowPush;
  tickReason: string | undefined;
  retryReason: string | undefined;
  onSelect: (selected: boolean) => void;
  onEvidence: () => void;
  onRetry: () => void;
}>) {
  const { draft, stated } = row;

  return (
    <li className="analyzer-tix__row">
      <input
        aria-label={`Include ${draft.localKey}`}
        checked={selected}
        className="analyzer-tix__check"
        disabled={blockedTick !== undefined}
        onChange={(event) => onSelect(event.currentTarget.checked)}
        title={blockedTick}
        type="checkbox"
      />
      <div className="analyzer-tix__main">
        <div className="analyzer-tix__line">
          <span className="analyzer-tix__key">{draft.localKey}</span>
          <span className="analyzer-tix__title">{draft.title}</span>
          {sizing.state === "sized" ? (
            <EffortChip effort={sizing.effort} />
          ) : (
            <span className="analyzer-tix__mark">{sizing.state === "sizing" ? SIZING_MARK : UNSIZED_MARK}</span>
          )}
        </div>
        <EvidenceLine line={stated?.evidenceLine ?? null} onOpen={onEvidence} subject={draft.localKey} />
        <PushLine localKey={draft.localKey} onRetry={onRetry} push={push} retryReason={retryReason} />
      </div>
    </li>
  );
}

/**
 * A row's evidence line — a button that opens its references, or the note that there is none.
 *
 * @param props.subject What the evidence is about, for the control's name.
 * @param props.line The evidence line, or `null`.
 * @param props.onOpen Called when it is pressed.
 * @returns The control, or the note.
 */
function EvidenceLine({
  subject,
  line,
  onOpen,
}: Readonly<{ subject: string; line: string | null; onOpen: () => void }>) {
  return line === null ? (
    <p className="analyzer-tix__noevidence">{NO_EVIDENCE_LINE}</p>
  ) : (
    <button
      aria-haspopup="dialog"
      aria-label={evidenceName(subject, line)}
      className="analyzer-tix__evidence"
      onClick={onOpen}
      type="button"
    >
      {line} <span aria-hidden="true">{OPENS_GLYPH}</span>
    </button>
  );
}

/**
 * What a push has done to a row.
 *
 * @param props.localKey The draft's key, for **Retry**'s name.
 * @param props.push What to say.
 * @param props.retryReason Why **Retry** cannot act, when it cannot.
 * @param props.onRetry Called when **Retry** is pressed.
 * @returns The link, the mark, the failure with its retry, or nothing.
 */
function PushLine({
  localKey,
  push,
  retryReason,
  onRetry,
}: Readonly<{ localKey: string; push: RowPush; retryReason: string | undefined; onRetry: () => void }>) {
  switch (push.state) {
    case "none":
      return null;
    case "pushing":
      return <p className="analyzer-tix__mark">{PUSHING_MARK}</p>;
    case "pushed":
      return push.href === null ? (
        <p className="analyzer-tix__pushed">{push.text}</p>
      ) : (
        <p className="analyzer-tix__pushed">
          <a className="analyzer-tix__ticket" href={push.href} rel="noreferrer" target="_blank">
            {push.text}
          </a>
        </p>
      );
    case "failed":
      return (
        <p className="analyzer-tix__failed">
          <span>{push.text}</span>
          <Button
            aria-label={`${RETRY_LABEL} — ${localKey} did not land`}
            onClick={onRetry}
            reason={retryReason}
            size="sm"
            title={retryReason ?? RETRY_NOTE}
            tone="ghost"
          >
            {RETRY_LABEL}
          </Button>
        </p>
      );
  }
}

/**
 * A batch the service has closed — what reached the tracker, what was left out, and the way to
 * the batch — in place of rows nothing can be done with.
 *
 * @param props.batch The closed batch.
 * @param props.tracker Its tracker, or `undefined` when it is not among the workspace's.
 * @param props.caption Which batch this is, when the card holds more than one group; else `null`.
 * @returns The summary.
 */
function ClosedBatch({
  batch,
  tracker,
  caption,
}: Readonly<{ batch: PlanningBatch; tracker: TrackerOption | undefined; caption: string | null }>) {
  const summary = closedSummary(batch, tracker);

  return (
    <>
      {caption !== null && (
        <div className="analyzer-tix__head">
          <span className="analyzer-tix__caption">{caption}</span>
        </div>
      )}
      <p className="analyzer-tix__closed">
        <span className="analyzer-tix__headline">{summary.headline}</span>
        {summary.leftOut !== null && ` ${summary.leftOut}`}
      </p>
      {summary.pushed.length > 0 && (
        <ul className="analyzer-tix__landed">
          {summary.pushed.map((draft) => (
            <li className="analyzer-tix__landed-row" key={draft.id}>
              <span className="analyzer-tix__key">{draft.localKey}</span>
              <span className="analyzer-tix__landed-title">{draft.title}</span>
              {draft.pushedTicket !== null && (
                <a className="analyzer-tix__ticket" href={draft.pushedTicket.url} rel="noreferrer" target="_blank">
                  {draft.pushedTicket.externalKey}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <Link className="analyzer-tix__link" href={batchHref(PLANNING_PATH, batch.id)}>
        {OPEN_BATCH_LABEL} <span aria-hidden="true">{GO_GLYPH}</span>
      </Link>
    </>
  );
}

/**
 * The ticket suggestions an analysis composed and nobody has drafted yet — each with its title,
 * its confidence and its evidence line — and the control that drafts them into a planning batch.
 *
 * They have no key, no checkbox and no effort chip: those are a draft's, and these are not drafts
 * yet. Drafting is an owner's or an admin's; anybody else is told so on the control.
 *
 * @param props.suggestions The suggestions, most confident first.
 * @param props.onEvidence Called with a suggestion's id when its evidence line is pressed.
 * @param props.onDraft Called when **Draft N tickets** is pressed.
 * @returns The group.
 */
function UndraftedGroup({
  suggestions,
  onEvidence,
  onDraft,
}: Readonly<{
  suggestions: readonly AnalysisUndraftedTicket[];
  onEvidence: (id: string) => void;
  onDraft: () => void;
}>) {
  const { mayAdminister } = useAnalyzer();

  return (
    <div aria-label={UNDRAFTED_HEADING} className="analyzer-tix__group" role="group">
      <div className="analyzer-tix__head">
        <span className="analyzer-tix__caption">{UNDRAFTED_HEADING}</span>
      </div>
      <ul className="analyzer-tix__rows">
        {suggestions.map((suggestion) => (
          <li className="analyzer-tix__row" key={suggestion.id}>
            <div className="analyzer-tix__main">
              <div className="analyzer-tix__line">
                <span className="analyzer-tix__title">{suggestion.title}</span>
                <span className="analyzer-tix__mark">{confidenceText(suggestion.confidence)}</span>
              </div>
              <EvidenceLine
                line={suggestion.evidenceLine}
                onOpen={() => onEvidence(suggestion.id)}
                subject={suggestion.title}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="analyzer-tix__footer">
        <span className="analyzer-tix__total">{UNDRAFTED_NOTE}</span>
        <div className="analyzer-tix__actions">
          <Button
            aria-haspopup="dialog"
            onClick={onDraft}
            reason={mayAdminister ? undefined : DRAFT_ROLE_REASON}
            size="sm"
            tone="primary"
          >
            {draftLabel(suggestions.length)}
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { type ReactNode, useId, useRef, useState } from "react";

import type {
  AuditActorKind,
  AuditLogEvent,
  AuditLogFilter,
  AuditToday,
} from "@/app/api/settings-audit";
import { sectionTitleId, settingsSection } from "@/app/settings/view";
import { Button, Card, CardHead, EmptyState, Tag, cx } from "@/app/ui";

import { readAuditLog } from "./audit-actions";
import { AuditFilters } from "./audit-filters";
import { ExportDialog } from "./export-dialog";
import {
  ACTOR_KIND_CLASS,
  ACTOR_KIND_LABELS,
  type AuditActorOption,
  type AuditFilterErrors,
  type AuditFilterForm,
  EMPTY_FORM,
  EXPORT_LABEL,
  type ExportRange,
  FILTERED_TAG,
  FILTERS_LABEL,
  LOADING_MORE,
  LOAD_MORE,
  LOG_EMPTY,
  LOG_LOADING,
  TODAY_EMPTY,
  TODAY_MORE,
  TODAY_MORE_ACTION,
  TODAY_TAG,
  dayOf,
  defaultExportRange,
  endOfLog,
  mergeEvents,
  parseFilterForm,
  retainedTag,
  stampOf,
} from "./view";

import "./audit-log.css";

/** The filtered log, in the one state it is in. */
type LogState =
  /** The first page is being read. */
  | { readonly status: "loading" }
  /** The first page could not be read. */
  | { readonly status: "failed"; readonly reason: string }
  /** Pages have arrived. */
  | {
      readonly status: "ready";
      readonly events: readonly AuditLogEvent[];
      /** Where the next page starts, or `null` at the end of the log. */
      readonly nextCursor: string | null;
      /** Whether the next page is in flight. */
      readonly loadingMore: boolean;
      /** Why the next page could not be read, or `null`. */
      readonly moreFailure: string | null;
    };

/** What {@link AuditCard} takes. */
export interface AuditCardProps {
  /** The today view as read — the rows, whether there are more, and the retention tier. */
  readonly today: AuditToday;
  /** The actor select's options (`app/audit-log/view.ts`'s `actorOptions`). */
  readonly actors: readonly AuditActorOption[];
  /** The **Stream to SIEM** control, drawn in the footer between the tag and **Export CSV**. */
  readonly siem?: ReactNode;
}

/**
 * The Audit Log card — mockup 17's `c-5` card
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * Today's rows as the mockup draws them — mono time, actor, and the sentence the service composed
 * from the event's typed facts — with the actor styled by kind, so a bot row reads as a bot row.
 * Behind **filters** it is a window onto the whole log: the filters drive BR.2's query, pages
 * follow its keyset cursor, and the list always ends by saying so — either **Load more** or
 * *End of log*. **No list here silently stops being complete**: when today holds more than the
 * card's rows, the card says so and offers all of today.
 *
 * The footer's `retained 400d` is the workspace's own `audit` tier as the read reports it, and
 * **Export CSV** opens the bounded-range dialog carrying whatever filters are applied.
 *
 * The audit reads are owners' and admins', so the card is mounted only for a reader who may read
 * it, and nothing on it is a setting: it has no fields in the page's dirty state.
 *
 * @param props See {@link AuditCardProps}.
 * @returns The card.
 */
export function AuditCard({ today, actors, siem }: AuditCardProps) {
  const section = settingsSection("audit");
  const titleId = sectionTitleId(section.id);
  const filtersId = useId();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AuditFilterForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<AuditFilterErrors>({});
  /** The filter the log is showing, or `null` while the card shows today's rows. */
  const [applied, setApplied] = useState<AuditLogFilter | null>(null);
  const [log, setLog] = useState<LogState>({ status: "loading" });
  const [exporting, setExporting] = useState<ExportRange | null>(null);
  /** Which read is the current one — an answer to an older one is dropped. */
  const latest = useRef(0);

  /**
   * Apply a form: check it, and read the first page of what it narrows to.
   *
   * @param next The form to apply.
   */
  async function apply(next: AuditFilterForm): Promise<void> {
    const parsed = parseFilterForm(next);

    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }

    const read = (latest.current += 1);
    setErrors({});
    setApplied(parsed.filter);
    setLog({ status: "loading" });

    const reading = await readAuditLog(parsed.filter);
    if (latest.current !== read) return;

    setLog(
      reading.ok
        ? {
            status: "ready",
            events: reading.page.items,
            nextCursor: reading.page.nextCursor,
            loadingMore: false,
            moreFailure: null,
          }
        : { status: "failed", reason: reading.reason },
    );
  }

  /** Read the page after the last one drawn, and append it. */
  async function loadMore(): Promise<void> {
    if (applied === null || log.status !== "ready" || log.nextCursor === null || log.loadingMore) {
      return;
    }

    const read = latest.current;
    const shown = log;
    setLog({ ...shown, loadingMore: true, moreFailure: null });

    const reading = await readAuditLog(applied, shown.nextCursor ?? undefined);
    if (latest.current !== read) return;

    setLog(
      reading.ok
        ? {
            status: "ready",
            events: mergeEvents(shown.events, reading.page.items),
            nextCursor: reading.page.nextCursor,
            loadingMore: false,
            moreFailure: null,
          }
        : { ...shown, loadingMore: false, moreFailure: reading.reason },
    );
  }

  /** Empty the form and go back to today's rows. */
  function clear(): void {
    latest.current += 1;
    setForm(EMPTY_FORM);
    setErrors({});
    setApplied(null);
  }

  /** Open the filters on the whole of today — what the card's rows are the newest of. */
  function showAllOfToday(): void {
    const next = { ...EMPTY_FORM, from: dayOf(today.since) };

    setOpen(true);
    setForm(next);
    void apply(next);
  }

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        beside={<Tag>{applied === null ? TODAY_TAG : FILTERED_TAG}</Tag>}
        title={section.title}
        titleId={titleId}
      />

      <div className="audit-log">
        <div className="audit-log__bar">
          <Button
            aria-controls={open ? filtersId : undefined}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            size="sm"
            tone="ghost"
          >
            {FILTERS_LABEL} {open ? "▴" : "▾"}
          </Button>
        </div>

        {open && (
          <AuditFilters
            actors={actors}
            errors={errors}
            form={form}
            id={filtersId}
            onApply={() => void apply(form)}
            onChange={setForm}
            onClear={clear}
          />
        )}

        {applied === null ? (
          <TodayRows onShowAll={showAllOfToday} today={today} />
        ) : (
          <LogRows log={log} onLoadMore={() => void loadMore()} />
        )}

        <div className="audit-log__foot">
          <Tag>{retainedTag(today.retainedDays)}</Tag>
          <span className="audit-log__spacer" />
          {siem}
          <Button
            aria-haspopup="dialog"
            onClick={() => setExporting(defaultExportRange(new Date(), applied ?? {}))}
            size="sm"
            tone="ghost"
          >
            {EXPORT_LABEL}
          </Button>
        </div>
      </div>

      <ExportDialog
        actors={actors}
        filter={applied ?? {}}
        initial={exporting}
        onClose={() => setExporting(null)}
      />
    </Card>
  );
}

/**
 * Today's rows, as the mockup draws them — or that there are none, and that there are more.
 *
 * @param props.today The today view.
 * @param props.onShowAll Open the filtered log on the whole of today.
 * @returns The rows.
 */
function TodayRows({ today, onShowAll }: Readonly<{ today: AuditToday; onShowAll: () => void }>) {
  if (today.rows.length === 0) return <EmptyState note={TODAY_EMPTY} variant="flush" />;

  return (
    <>
      <ol className="audit-log__rows">
        {today.rows.map((row) => (
          <Row actor={row.actor} event={row.event} key={row.id} kind={row.actorKind} time={row.time} />
        ))}
      </ol>
      {today.more && (
        <p className="audit-log__more">
          <span>{TODAY_MORE}</span>
          <Button onClick={onShowAll} size="sm" tone="ghost">
            {TODAY_MORE_ACTION}
          </Button>
        </p>
      )}
    </>
  );
}

/**
 * The filtered log: its rows, and how it ends — a control for the next page, or the line that
 * says there is none.
 *
 * @param props.log The log's state.
 * @param props.onLoadMore Read the next page.
 * @returns The rows, or the state's sentence.
 */
function LogRows({ log, onLoadMore }: Readonly<{ log: LogState; onLoadMore: () => void }>) {
  if (log.status === "loading") {
    return (
      <p className="audit-log__state" role="status">
        {LOG_LOADING}
      </p>
    );
  }

  if (log.status === "failed") {
    return (
      <p className="audit-log__state audit-log__state--error" role="alert">
        {log.reason}
      </p>
    );
  }

  if (log.events.length === 0 && log.nextCursor === null) {
    return <EmptyState note={LOG_EMPTY} variant="flush" />;
  }

  return (
    <>
      <ol className="audit-log__rows">
        {log.events.map((event) => (
          <Row
            actor={event.actor}
            event={event.event}
            key={event.id}
            kind={event.actorKind}
            time={stampOf(event.occurredAt)}
          />
        ))}
      </ol>
      {log.moreFailure !== null && (
        <p className="audit-log__state audit-log__state--error" role="alert">
          {log.moreFailure}
        </p>
      )}
      {log.nextCursor === null ? (
        <p className="audit-log__end" role="status">
          {endOfLog(log.events.length)}
        </p>
      ) : (
        <p className="audit-log__more">
          <Button
            onClick={onLoadMore}
            reason={log.loadingMore ? LOADING_MORE : undefined}
            size="sm"
            tone="ghost"
          >
            {log.loadingMore ? LOADING_MORE : LOAD_MORE}
          </Button>
        </p>
      )}
    </>
  );
}

/**
 * One line of the log — `14:31 ouroboros-app[bot] pushed PR #514 rev 2`.
 *
 * The actor's kind is a class and a word: the colour tells the kinds apart at a glance, and the
 * hidden word says the same to a reader who does not get the colour.
 *
 * @param props.time The row's stamp.
 * @param props.actor Who, as the service prints them.
 * @param props.kind What kind of actor they are.
 * @param props.event What happened, as the service composed it.
 * @returns The row.
 */
function Row({
  time,
  actor,
  kind,
  event,
}: Readonly<{ time: string; actor: string; kind: AuditActorKind; event: string }>) {
  return (
    <li className="audit-log__row">
      <span className="audit-log__time">{time}</span>
      <span className={cx("audit-log__actor", ACTOR_KIND_CLASS[kind])} data-actor-kind={kind}>
        {actor}
        <span className="sr-only"> ({ACTOR_KIND_LABELS[kind]})</span>
      </span>
      <span className="audit-log__event">{event}</span>
    </li>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import type { PlanningEpic, PlanningEpicLinks, PlanningRoadmap, PlanningTicket } from "@/app/api/planning";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SelectField, TextField } from "@/app/ui";

import { MAX_NAME_LENGTH, nameError, rangeError } from "./create";
import {
  ADDING,
  ADD_LABEL,
  ADD_NOTE,
  ADD_TITLE,
  CLOSE_LABEL,
  EDIT_TITLE,
  END_LABEL,
  type EditorFailure,
  type EpicDraft,
  LINK_LABEL,
  LINKS_UNCHANGED,
  MAX_SEARCH_LENGTH,
  MIRRORS_HEADING,
  MIRRORS_NONE,
  MONTHS_HINT,
  NAME_LABEL,
  NOTHING_ADDED,
  NOTHING_SAVED,
  READ_ONLY_NOTE,
  SAVE_LABEL,
  SAVING,
  SEARCHING,
  SEARCH_DEBOUNCE_MS,
  SEARCH_HINT,
  SEARCH_LABEL,
  SEARCH_NONE,
  START_LABEL,
  STATUS_LABEL,
  STATUS_OPTIONS,
  TICKETS_AFTER_ADD,
  TICKETS_LOADING,
  TICKETS_NONE,
  TICKETS_UNREAD,
  TICKET_STATE_LABEL,
  TINT_LABEL,
  TINT_OPTIONS,
  UNLINK_LABEL,
  createLaneBody,
  editorFailure,
  epicDraftProblems,
  linkCandidates,
  linkLabel,
  mirrorLine,
  openingEpicDraft,
  patchBody,
  saveReason,
  ticketsHeading,
  unlinkLabel,
} from "./epic-draft";
import { addEpic, readEpicLinks, searchTickets, setTicketLinked, updateEpic } from "./gantt-actions";

import "./planning.css";

/**
 * The epic editor sheet (AM.4, [#286](https://github.com/NobuData/ouroboros/issues/286)) — what a click
 * on a gantt bar opens, and what **Add epic** opens empty.
 *
 * Name, tint, status and month range are one form, saved with one `PATCH` of only what changed. The
 * lane's linked tickets are listed with their synced states — the ones its chip is computed from — and
 * are linked and unlinked immediately, each write answering the lane with its chip recomputed, which
 * the gantt draws at once. Where the lane is mirrored in a tracker (AL.3's parent issue, milestone or
 * Jira epic) is shown beneath, or that it is not mirrored yet. The decisions are
 * `app/planning/epic-draft.ts`'s.
 *
 * A reader who may not change the roadmap sees the same sheet with the form disabled and no link
 * controls: reading an epic's tickets is every member's.
 */

/** What the sheet needs to be told. */
export interface EpicEditorProps {
  /** The lane to edit, as the gantt draws it — or `null` to add one. */
  readonly epic: PlanningEpic | null;
  /** The roadmap, whose head an added lane is filed under. */
  readonly roadmap: PlanningRoadmap;
  /** Whether this reader is an `owner` or an `admin`. */
  readonly mayAdminister: boolean;
  /** Close the sheet. */
  readonly onClose: () => void;
  /** A write stored the lane — a save or a link change — so the gantt can draw it at once. */
  readonly onSaved: (epic: PlanningEpic) => void;
}

/** The lane's lists, as far as they have been read. */
type LinksState =
  | { readonly status: "loading" }
  | { readonly status: "read"; readonly links: PlanningEpicLinks }
  | { readonly status: "unread" };

/**
 * The sheet.
 *
 * @param props See {@link EpicEditorProps}.
 * @returns The overlay, open.
 */
export function EpicEditor({ epic, roadmap, mayAdminister, onClose, onSaved }: EpicEditorProps) {
  const router = useRouter();
  const fields = useId();
  const adding = epic === null;

  const [draft, setDraft] = useState<EpicDraft>(() => openingEpicDraft(epic));
  const [failure, setFailure] = useState<EditorFailure | null>(null);
  const [saving, startSaving] = useTransition();

  const problems = epicDraftProblems(draft);
  const changes = epic === null ? null : patchBody(epic, draft);
  const blocked = saveReason(problems, changes, mayAdminister);

  /**
   * Hold one field's value.
   *
   * @param key Which field.
   * @param value What is in it.
   */
  function type<K extends keyof EpicDraft>(key: K, value: EpicDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setFailure(null);
  }

  /**
   * Save the form — a `PATCH` of what changed, or the create **Add epic** is.
   *
   * @param event The submit.
   */
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (saving || blocked !== undefined) return;

    setFailure(null);

    startSaving(async () => {
      if (epic === null) {
        const outcome = await addEpic(createLaneBody(draft, roadmap));

        if (!outcome.ok) {
          setFailure(editorFailure(outcome.refusal, NOTHING_ADDED));
          return;
        }

        onClose();
        router.refresh();
        return;
      }

      const outcome = await updateEpic(epic.id, changes ?? {});

      if (!outcome.ok) {
        setFailure(editorFailure(outcome.refusal, NOTHING_SAVED));
        return;
      }

      onSaved(outcome.value);
      onClose();
    });
  }

  return (
    <ShellOverlay label={adding ? ADD_TITLE : EDIT_TITLE} onClose={onClose} open>
      <h2 className="shell-overlay__title">{adding ? ADD_TITLE : EDIT_TITLE}</h2>
      {adding && <p className="shell-overlay__note">{ADD_NOTE}</p>}
      {!mayAdminister && <p className="shell-overlay__note">{READ_ONLY_NOTE}</p>}

      <form className="planning-create" onSubmit={submit}>
        <TextField
          autoComplete="off"
          disabled={!mayAdminister}
          error={nameError(problems.name)}
          id={`${fields}-name`}
          label={NAME_LABEL}
          maxLength={MAX_NAME_LENGTH}
          name="name"
          onChange={(event) => { type("name", event.currentTarget.value); }}
          required
          value={draft.name}
        />

        <div className="planning-create__months">
          <SelectField
            disabled={!mayAdminister}
            id={`${fields}-tint`}
            label={TINT_LABEL}
            name="tint"
            onChange={(event) => { type("tint", event.currentTarget.value as EpicDraft["tint"]); }}
            value={draft.tint}
          >
            {TINT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>

          <SelectField
            disabled={!mayAdminister}
            id={`${fields}-status`}
            label={STATUS_LABEL}
            name="status"
            onChange={(event) => { type("status", event.currentTarget.value as EpicDraft["status"]); }}
            value={draft.status}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="planning-create__months">
          <TextField
            disabled={!mayAdminister}
            hint={MONTHS_HINT}
            id={`${fields}-start`}
            label={START_LABEL}
            name="startMonth"
            onChange={(event) => { type("startMonth", event.currentTarget.value); }}
            type="month"
            value={draft.startMonth}
          />
          <TextField
            disabled={!mayAdminister}
            error={failure?.range ?? rangeError(problems.range)}
            id={`${fields}-end`}
            label={END_LABEL}
            name="endMonth"
            onChange={(event) => { type("endMonth", event.currentTarget.value); }}
            type="month"
            value={draft.endMonth}
          />
        </div>

        {failure !== null && (
          <p className="planning-create__failure" role="alert">
            {failure.message}
          </p>
        )}

        {saving && (
          <p className="planning-create__state" role="status">
            {adding ? ADDING : SAVING}
          </p>
        )}

        <div className="planning-create__actions">
          {mayAdminister && (
            <Button reason={saving ? SAVING : blocked} tone="primary" type="submit">
              {adding ? ADD_LABEL : SAVE_LABEL}
            </Button>
          )}
          <Button onClick={onClose} tone="ghost" type="button">
            {CLOSE_LABEL}
          </Button>
        </div>
      </form>

      {epic === null ? (
        <p className="shell-overlay__note">{TICKETS_AFTER_ADD}</p>
      ) : (
        <EpicLinks epic={epic} mayAdminister={mayAdminister} onSaved={onSaved} />
      )}
    </ShellOverlay>
  );
}

/**
 * The lane's linked tickets, the link picker, and its tracker mirrors.
 *
 * @param props.epic The lane.
 * @param props.mayAdminister Whether this reader may link and unlink.
 * @param props.onSaved Called with the lane each link change answers, chip recomputed.
 * @returns The two sections.
 */
function EpicLinks({
  epic,
  mayAdminister,
  onSaved,
}: Readonly<{ epic: PlanningEpic; mayAdminister: boolean; onSaved: (epic: PlanningEpic) => void }>) {
  const searchId = useId();

  const [state, setState] = useState<LinksState>({ status: "loading" });
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<readonly PlanningTicket[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [writing, startWriting] = useTransition();

  // The lane's lists, once per sheet — the sheet is keyed by lane, so a different lane is a new read.
  useEffect(() => {
    let current = true;

    void readEpicLinks(epic.id).then((outcome) => {
      if (!current) return;

      setState(outcome.ok ? { status: "read", links: outcome.value } : { status: "unread" });
    });

    return () => {
      current = false;
    };
  }, [epic.id]);

  // The picker searches after the reader pauses, and only the latest term's answer is kept.
  useEffect(() => {
    if (!mayAdminister) return;

    let current = true;
    const timer = setTimeout(() => {
      void searchTickets(term).then((outcome) => {
        if (!current) return;

        setFound(outcome.ok ? outcome.value.items : []);
        setSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term, mayAdminister]);

  /**
   * Link or unlink one ticket, and redraw from what the service answered.
   *
   * @param ticket The ticket.
   * @param linked `true` to link it, `false` to unlink it.
   */
  function setLinked(ticket: PlanningTicket, linked: boolean): void {
    setFailure(null);

    startWriting(async () => {
      const outcome = await setTicketLinked(epic.id, ticket.id, linked);

      if (!outcome.ok) {
        setFailure(editorFailure(outcome.refusal, LINKS_UNCHANGED).message);
        return;
      }

      onSaved(outcome.value.epic);

      if (outcome.value.links !== null) {
        setState({ status: "read", links: outcome.value.links });
      }
    });
  }

  const linked = state.status === "read" ? state.links.tickets : [];
  const candidates = found === null ? [] : linkCandidates(found, linked);

  return (
    <>
      <section aria-labelledby={`${searchId}-tickets`} className="planning-epic__section">
        <h3 className="planning-epic__heading" id={`${searchId}-tickets`}>
          {state.status === "read" ? ticketsHeading(linked) : ticketsHeading([])}
        </h3>

        {state.status === "loading" && (
          <p className="planning-epic__note" role="status">
            {TICKETS_LOADING}
          </p>
        )}
        {state.status === "unread" && <p className="planning-epic__note">{TICKETS_UNREAD}</p>}
        {state.status === "read" && linked.length === 0 && <p className="planning-epic__note">{TICKETS_NONE}</p>}

        {linked.length > 0 && (
          <ul className="planning-epic__tickets">
            {linked.map((ticket) => (
              <TicketRow
                action={
                  mayAdminister ? (
                    <Button
                      aria-label={unlinkLabel(ticket)}
                      onClick={() => { setLinked(ticket, false); }}
                      reason={writing ? SAVING : undefined}
                      size="sm"
                      tone="ghost"
                    >
                      {UNLINK_LABEL}
                    </Button>
                  ) : null
                }
                key={ticket.id}
                ticket={ticket}
              />
            ))}
          </ul>
        )}

        {failure !== null && (
          <p className="planning-create__failure" role="alert">
            {failure}
          </p>
        )}

        {mayAdminister && (
          <>
            <TextField
              autoComplete="off"
              hint={SEARCH_HINT}
              id={`${searchId}-search`}
              label={SEARCH_LABEL}
              maxLength={MAX_SEARCH_LENGTH}
              name="ticketSearch"
              onChange={(event) => {
                setTerm(event.currentTarget.value);
                setSearching(true);
              }}
              type="search"
              value={term}
            />
            {searching && (
              <p className="planning-epic__note" role="status">
                {SEARCHING}
              </p>
            )}
            {!searching && found !== null && candidates.length === 0 && (
              <p className="planning-epic__note">{SEARCH_NONE}</p>
            )}
            {candidates.length > 0 && (
              <ul aria-label={SEARCH_LABEL} className="planning-epic__tickets">
                {candidates.map((ticket) => (
                  <TicketRow
                    action={
                      <Button
                        aria-label={linkLabel(ticket)}
                        onClick={() => { setLinked(ticket, true); }}
                        reason={writing ? SAVING : undefined}
                        size="sm"
                        tone="ghost"
                      >
                        {LINK_LABEL}
                      </Button>
                    }
                    key={ticket.id}
                    ticket={ticket}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-labelledby={`${searchId}-mirrors`} className="planning-epic__section">
        <h3 className="planning-epic__heading" id={`${searchId}-mirrors`}>
          {MIRRORS_HEADING}
        </h3>
        {state.status === "read" && state.links.mirrors.length === 0 && (
          <p className="planning-epic__note">{MIRRORS_NONE}</p>
        )}
        {state.status === "read" && state.links.mirrors.length > 0 && (
          <ul className="planning-epic__mirrors">
            {state.links.mirrors.map((mirror) => (
              <li className="planning-epic__mirror" key={`${mirror.sourceId}:${mirror.kind}`}>
                {mirrorLine(mirror)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * One ticket: its key (to the tracker), its title, its synced state, and an action.
 *
 * @param props.ticket The ticket.
 * @param props.action The row's button, or `null` for none.
 * @returns The list item.
 */
function TicketRow({ ticket, action }: Readonly<{ ticket: PlanningTicket; action: React.ReactNode }>) {
  return (
    <li className="planning-epic__ticket">
      <a className="planning-epic__key" href={ticket.url} rel="noreferrer" target="_blank">
        {ticket.externalKey}
      </a>
      <span className="planning-epic__title">{ticket.title}</span>
      <span
        className={
          ticket.state === "closed" ? "planning-epic__state planning-epic__state--done" : "planning-epic__state"
        }
      >
        {TICKET_STATE_LABEL[ticket.state]}
      </span>
      {action}
    </li>
  );
}

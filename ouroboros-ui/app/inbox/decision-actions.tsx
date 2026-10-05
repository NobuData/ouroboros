"use client";

import Link from "next/link";
import { type FormEvent, useId, useRef, useState } from "react";

import type { InboxAction, InboxItem } from "@/app/api/inbox";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, type ButtonTone, TextAreaField } from "@/app/ui";

import {
  ANSWERING,
  ANSWER_IN_FLIGHT,
  NOTE_HINT,
  NOTE_LABEL,
  NOTE_MAX_LENGTH,
  NOTE_REQUIRED,
  SNOOZE_CHOICES,
  SNOOZE_GROUP_LABEL,
  SNOOZE_LABEL,
  VIEWER_CANNOT_SNOOZE_ITEM,
  actionShapes,
  inFlight,
  inertReason,
  sitePath,
} from "./card-view";
import type { DecisionControls } from "./use-decision";
import { CANCEL } from "./view";

/** The button treatment each declared style takes. */
const TONE: Readonly<Record<InboxAction["style"], ButtonTone>> = {
  primary: "primary",
  ghost: "ghost",
  danger: "danger",
};

/** What {@link DecisionActions} takes. */
export interface DecisionActionsProps {
  /** The item — its declared action row and whether this reader may snooze it. */
  readonly item: Pick<InboxItem, "id" | "actions" | "snooze">;
  /** The card's phase and controls (`useDecision`). */
  readonly controls: DecisionControls;
}

/**
 * The inline panel a note-taking action opens: the action's declared consequence, the note, and
 * the action's own button as the confirmation — so *Waive & annotate* is confirmed by the
 * sentence the kind declared for it, never by a generic *are you sure?*.
 *
 * @param props.action The action.
 * @param props.draft What the reader last wrote for this action — a failed answer returns them to
 *   their own words rather than to an empty box.
 * @param props.onSend Hears the note when the reader confirms.
 * @param props.onCancel Closes the panel.
 * @returns The panel.
 */
function NotePanel({
  action,
  draft,
  onSend,
  onCancel,
}: Readonly<{ action: InboxAction; draft: string; onSend: (note: string) => void; onCancel: () => void }>) {
  const field = useId();
  const consequence = useId();
  const [note, setNote] = useState(draft);
  const [missing, setMissing] = useState(false);

  function submit(event: FormEvent): void {
    event.preventDefault();

    const written = note.trim();

    if (written === "") setMissing(true);
    else onSend(written);
  }

  return (
    <form aria-describedby={consequence} aria-label={action.label} className="inbox-card__note" onSubmit={submit}>
      <p className="inbox-card__consequence" id={consequence}>
        {action.consequenceText}
      </p>
      <TextAreaField
        // The panel exists to be typed into, and it opened because the reader asked for it.
        autoFocus
        error={missing ? NOTE_REQUIRED : undefined}
        hint={NOTE_HINT}
        id={field}
        label={NOTE_LABEL}
        maxLength={NOTE_MAX_LENGTH}
        onChange={(event) => {
          setNote(event.target.value);
          setMissing(false);
        }}
        rows={3}
        value={note}
      />
      <div className="inbox-card__note-actions">
        <Button onClick={onCancel} type="button">
          {CANCEL}
        </Button>
        <Button tone={TONE[action.style]} type="submit">
          {action.label}
        </Button>
      </div>
    </form>
  );
}

/**
 * A card's action row, drawn from its kind's declaration (BO.2,
 * [#467](https://github.com/NobuData/ouroboros/issues/467)) — and from nothing else.
 *
 * - **Order and style are the declaration's.** `primary`, `ghost` and `danger` are the button's
 *   tone; the row is in declared order.
 * - **A link is navigation, not a button.** An action that `navigates` is an anchor to the `href`
 *   the service resolved; the first takes the button treatment and any after it is quiet text.
 * - **The service gates, the row explains.** An action this reader may not use is inert with the
 *   reason (`inertReason`) — never hidden, so nobody wonders where *Approve & merge* went — and
 *   is still reachable by keyboard so the reason can be read.
 * - **Every action is described by its consequence**, the sentence the kind declared, so a screen
 *   reader hears what a press does before it is pressed.
 * - **Asking first is the exception.** A note-taking action opens the inline panel; a `danger`
 *   action opens a confirmation carrying its consequence; everything else answers on one press.
 *
 * @param props See {@link DecisionActionsProps}.
 * @returns The row, the open panel or confirmation, and the snooze.
 */
export function DecisionActions({ item, controls }: DecisionActionsProps) {
  const ids = useId();
  const opener = useRef<HTMLElement | null>(null);
  // The note each action was last sent with, so a failed answer does not cost the reader their words.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const { phase } = controls;
  const flying = inFlight(phase);
  const shapes = actionShapes(item.actions);
  const noting = phase.kind === "noting" ? item.actions.find((action) => action.id === phase.actionId) : undefined;
  const confirming =
    phase.kind === "confirming" ? item.actions.find((action) => action.id === phase.actionId) : undefined;

  /** Close whatever is open and hand focus back to the control that opened it. */
  function close(): void {
    controls.cancel();
    opener.current?.focus();
  }

  return (
    <div className="inbox-card__answer">
      <div className="inbox-card__actions">
        {item.actions.map((action, index) => {
          const describedBy = `${ids}-${action.id}`;
          const blocked = inertReason(action);
          const shape = shapes[index];
          const href = sitePath(action.href);
          const description = (
            <span className="sr-only" id={describedBy}>
              {blocked ?? action.consequenceText}
            </span>
          );

          if (shape !== "answer" && blocked === undefined && href !== null) {
            return shape === "link" ? (
              <span className="inbox-card__action" key={action.id}>
                <Button aria-describedby={describedBy} href={href} tone={TONE[action.style]}>
                  {action.label}
                </Button>
                {description}
              </span>
            ) : (
              <span className="inbox-card__action" key={action.id}>
                <Link aria-describedby={describedBy} className="inbox-card__quiet-link" href={href}>
                  {action.label}
                </Link>
                {description}
              </span>
            );
          }

          const sending = phase.kind === "answering" && phase.actionId === action.id;

          return (
            <span className="inbox-card__action" key={action.id}>
              <Button
                aria-describedby={describedBy}
                aria-expanded={action.takesNote && blocked === undefined ? noting?.id === action.id : undefined}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  controls.press(action);
                }}
                reason={blocked ?? (flying ? ANSWER_IN_FLIGHT : undefined)}
                size={shape === "quiet-link" ? "sm" : "md"}
                tone={TONE[action.style]}
              >
                {sending ? ANSWERING : action.label}
              </Button>
              {description}
            </span>
          );
        })}
        <span className="inbox-card__snooze">
          {phase.kind === "choosing-snooze" ? (
            <span aria-label={SNOOZE_GROUP_LABEL} className="inbox-card__snooze-choices" role="group">
              <span aria-hidden className="inbox-card__snooze-lead">
                {SNOOZE_GROUP_LABEL}
              </span>
              {SNOOZE_CHOICES.map((choice, index) => (
                <Button
                  // The durations replace the control that was focused; the first takes its place.
                  autoFocus={index === 0}
                  key={choice.minutes}
                  onClick={() => controls.snoozeFor(choice.minutes)}
                  size="sm"
                  tone="ghost"
                >
                  {choice.label}
                </Button>
              ))}
              <Button onClick={controls.cancel} size="sm" tone="ghost">
                {CANCEL}
              </Button>
            </span>
          ) : (
            <Button
              aria-expanded={false}
              onClick={controls.chooseSnooze}
              reason={item.snooze.allowed ? (flying ? ANSWER_IN_FLIGHT : undefined) : VIEWER_CANNOT_SNOOZE_ITEM}
              size="sm"
              tone="ghost"
            >
              {SNOOZE_LABEL}
            </Button>
          )}
        </span>
      </div>
      {noting !== undefined && (
        <NotePanel
          action={noting}
          draft={drafts.get(noting.id) ?? ""}
          onCancel={close}
          onSend={(note) => {
            setDrafts((before) => new Map(before).set(noting.id, note));
            controls.send(noting, note);
          }}
        />
      )}
      <ShellOverlay
        describedBy={`${ids}-confirm`}
        label={confirming?.label ?? ""}
        onClose={close}
        open={confirming !== undefined}
        role="alertdialog"
      >
        {confirming !== undefined && (
          <div className="inbox-dialog">
            <h2 className="shell-overlay__title">{confirming.label}?</h2>
            <p className="inbox-dialog__warning" id={`${ids}-confirm`}>
              {confirming.consequenceText}
            </p>
            <div className="inbox-dialog__actions">
              <Button onClick={close} type="button">
                {CANCEL}
              </Button>
              <Button onClick={() => controls.send(confirming)} tone="danger">
                {confirming.label}
              </Button>
            </div>
          </div>
        )}
      </ShellOverlay>
    </div>
  );
}

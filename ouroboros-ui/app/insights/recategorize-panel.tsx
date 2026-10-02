"use client";

import { type FormEvent, useEffect, useId, useState } from "react";

import type { InsightsRange, InterventionCause, InterventionList } from "@/app/api/insights";
import { Button, SelectField, TextAreaField } from "@/app/ui";

import {
  CAUSE_NAMES,
  type KeyedBar,
  eventLabel,
  moreEventsNote,
  movedNote,
  targetCauses,
} from "./bars-view";
import { type InterventionOutcome, listCauseEvents, recategorizeEvent } from "./intervention-actions";

/** The two Server Actions, injectable so a suite drives the panel without a service. */
export interface RecategorizeActions {
  readonly list: typeof listCauseEvents;
  readonly recategorize: typeof recategorizeEvent;
}

/** The real actions. */
const SERVER_ACTIONS: RecategorizeActions = { list: listCauseEvents, recategorize: recategorizeEvent };

/** The panel's labels. */
export const PANEL_LABEL = {
  bar: "Bar",
  event: "Intervention",
  target: "Move it to",
  reason: "Why",
  reasonHint: "Kept with the change in the audit trail.",
  submit: "Re-categorize",
  saving: "Saving…",
  loading: "Reading the interventions…",
  none: "No intervention under this bar in the range.",
  needTarget: "Choose the cause it really was.",
  needReason: "Say why — the reason is kept in the audit trail.",
} as const;

/**
 * Why the submit cannot act yet, or `null` when it can — the button's `reason`, so it stays
 * focusable and says what is missing.
 *
 * @param saving Whether a write is in flight.
 * @param target The chosen cause, or `""`.
 * @param reason The typed reason.
 * @returns The sentence, or `null`.
 */
export function submitBlocker(saving: boolean, target: string, reason: string): string | null {
  if (saving) return PANEL_LABEL.saving;
  if (target === "") return PANEL_LABEL.needTarget;
  if (reason.trim() === "") return PANEL_LABEL.needReason;
  return null;
}

/**
 * The re-categorize panel under the interventions card's bars
 * (BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445)) — drawn only for `owner`,
 * `admin` and `member`.
 *
 * **Per row.** The first choice is the bar — one cause — and the panel lists that bar's events,
 * newest first, from `GET /api/v1/insights/interventions`. A person picks the event a rule
 * mis-filed, the cause it really was and why, and the correction goes through BI.3's write
 * ([#434](https://github.com/NobuData/ouroboros/issues/434)). The service re-fills the event's day,
 * so `onMoved` — the page's re-read — brings back bars **and** a computed line that count it under
 * its new cause: the round trip is the proof the card is live rather than a picture.
 *
 * Every control is native, so it is keyboard operable as it stands; what happened is announced
 * through a polite live region.
 *
 * @param props.range The page's range — the list covers the bars' own window.
 * @param props.bars The card's bars; each is a choice of row.
 * @param props.onMoved Called after a correction lands, to re-read the page.
 * @param props.actions Test seam; the card passes none.
 * @returns The panel.
 */
export function RecategorizePanel({
  range,
  bars,
  onMoved,
  actions = SERVER_ACTIONS,
}: Readonly<{
  range: InsightsRange;
  bars: readonly (KeyedBar & { key: InterventionCause })[];
  onMoved: () => void;
  actions?: RecategorizeActions;
}>) {
  const id = useId();
  const [cause, setCause] = useState<InterventionCause>(bars[0]!.key);
  /** The last list read, under the request it answered — so a stale answer is never drawn. */
  const [loaded, setLoaded] = useState<{
    readonly key: string;
    readonly outcome: InterventionOutcome<InterventionList>;
  } | null>(null);
  const [picked, setPicked] = useState("");
  const [target, setTarget] = useState<InterventionCause | "">("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** Moves after each correction, so the bar's list is read again. */
  const [version, setVersion] = useState(0);

  // A bar that left the card — every event moved off it — falls back to the top bar.
  const shown = bars.some((bar) => bar.key === cause) ? cause : bars[0]!.key;
  const request = `${range}|${shown}|${version}`;

  useEffect(() => {
    let current = true;

    void actions.list(range, shown).then((outcome) => {
      if (current) setLoaded({ key: request, outcome });
    });

    return () => {
      current = false;
    };
  }, [actions, range, shown, request]);

  const answer = loaded?.key === request ? loaded.outcome : null;
  const list = answer?.ok === true ? answer.value : null;
  const listFailure = answer?.ok === false ? answer.reason : null;
  // The event chosen, or the newest one until a person chooses.
  const chosen =
    list?.interventions.find((event) => event.id === picked) ?? list?.interventions[0] ?? null;
  const eventId = chosen?.id ?? "";
  const targets = chosen === null ? [] : targetCauses(chosen.cause);
  const more = list === null ? null : moreEventsNote(list.interventions.length, list.total);
  const blocked = submitBlocker(saving, target, reason);

  /**
   * Send the correction.
   *
   * @param event The form's submit.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (chosen === null || target === "" || saving) return;

    setSaving(true);
    setFailure(null);
    setStatus(null);

    const outcome = await actions.recategorize(chosen.id, target, reason);

    setSaving(false);

    if (!outcome.ok) {
      setFailure(outcome.reason);
      return;
    }

    setStatus(movedNote(target));
    setTarget("");
    setReason("");
    setVersion((value) => value + 1);
    onMoved();
  }

  return (
    <form className="insights-recat" onSubmit={(event) => void submit(event)}>
      <SelectField
        id={`${id}-bar`}
        label={PANEL_LABEL.bar}
        onChange={(event) => {
          setCause(event.target.value as InterventionCause);
          setTarget("");
          setFailure(null);
        }}
        value={shown}
      >
        {bars.map((bar) => (
          <option key={bar.key} value={bar.key}>
            {`${bar.name} (${bar.value})`}
          </option>
        ))}
      </SelectField>

      {list === null ? (
        <p className="insights-recat__note">{listFailure ?? PANEL_LABEL.loading}</p>
      ) : list.interventions.length === 0 ? (
        <p className="insights-recat__note">{PANEL_LABEL.none}</p>
      ) : (
        <>
          <SelectField
            hint={more ?? undefined}
            id={`${id}-event`}
            label={PANEL_LABEL.event}
            onChange={(event) => {
              setPicked(event.target.value);
              setTarget("");
            }}
            value={eventId}
          >
            {list.interventions.map((event) => (
              <option key={event.id} value={event.id}>
                {eventLabel(event)}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={`${id}-target`}
            label={PANEL_LABEL.target}
            onChange={(event) => setTarget(event.target.value as InterventionCause | "")}
            required
            value={target}
          >
            <option value="">—</option>
            {targets.map((cause) => (
              <option key={cause} value={cause}>
                {CAUSE_NAMES[cause]}
              </option>
            ))}
          </SelectField>
          <TextAreaField
            hint={PANEL_LABEL.reasonHint}
            id={`${id}-reason`}
            label={PANEL_LABEL.reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={2}
            value={reason}
          />
          <div className="insights-recat__actions">
            <Button reason={blocked ?? undefined} size="sm" tone="primary" type="submit">
              {saving ? PANEL_LABEL.saving : PANEL_LABEL.submit}
            </Button>
          </div>
        </>
      )}

      <p aria-live="polite" className="insights-recat__status" role="status">
        {failure ?? status}
      </p>
    </form>
  );
}

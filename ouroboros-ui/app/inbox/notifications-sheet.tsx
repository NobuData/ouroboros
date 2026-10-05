"use client";

import { useState } from "react";

import type { NotificationPreferences } from "@/app/api/inbox";
import type { Reading } from "@/app/api/reading";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextField, Toggle } from "@/app/ui";

import { readNotificationSettings, updateNotificationSettings } from "./inbox-actions";
import {
  DIGEST_TIME_LABEL,
  DIGEST_TOGGLE,
  INSTANT_TOGGLE,
  MUTABLE_KINDS,
  MUTES_LEGEND,
  PREFERENCES_LEAD,
  PREFERENCES_TITLE,
  PREFERENCES_UNREADABLE,
  SAVED,
  SAVE_LABEL,
  type PreferencesDraft,
  draftOf,
  draftProblem,
  nextDigestLine,
  utcMinute,
} from "./notifications-view";
import { NOTIFICATIONS_LABEL, WORKING } from "./view";

/** The sheet's state: closed, opening (reading), or open on what was read. */
type SheetState =
  | { readonly phase: "closed" }
  | { readonly phase: "loading" }
  | { readonly phase: "open"; readonly reading: Reading<NotificationPreferences> };

/**
 * *Notification settings* — the head's button and the sheet it opens (BO.1,
 * [#466](https://github.com/NobuData/ouroboros/issues/466)). The preferences are read when the
 * sheet opens, not with the page: they are the reader's own and change nowhere else.
 *
 * @returns The button and its sheet.
 */
export function NotificationsAction() {
  const [state, setState] = useState<SheetState>({ phase: "closed" });

  /** Read, then open on what was read. A second press while reading does nothing. */
  function open(): void {
    if (state.phase !== "closed") return;

    setState({ phase: "loading" });
    void readNotificationSettings().then((reading) => setState({ phase: "open", reading }));
  }

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={open}
        reason={state.phase === "loading" ? "Opening…" : undefined}
        tone="ghost"
      >
        {NOTIFICATIONS_LABEL}
      </Button>
      <ShellOverlay
        label={PREFERENCES_TITLE}
        onClose={() => setState({ phase: "closed" })}
        open={state.phase === "open"}
      >
        {state.phase === "open" && (
          <div className="inbox-prefs">
            <h2 className="shell-overlay__title">{PREFERENCES_TITLE}</h2>
            <p className="inbox-prefs__lead">{PREFERENCES_LEAD}</p>
            {state.reading.ok ? (
              <PreferencesForm
                onSaved={(saved) => setState({ phase: "open", reading: { ok: true, value: saved } })}
                preferences={state.reading.value}
              />
            ) : (
              <p className="inbox-prefs__error" role="alert">
                {PREFERENCES_UNREADABLE}
              </p>
            )}
          </div>
        )}
      </ShellOverlay>
    </>
  );
}

/**
 * The form: digest on/off and its UTC time, instant mail, and per-kind mutes, saved together.
 *
 * @param props.preferences What the service answered.
 * @param props.onSaved Hears what the service answered after a save.
 * @returns The form.
 */
function PreferencesForm({
  preferences,
  onSaved,
}: Readonly<{
  preferences: NotificationPreferences;
  onSaved: (saved: NotificationPreferences) => void;
}>) {
  const [draft, setDraft] = useState<PreferencesDraft>(() => draftOf(preferences));
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const problem = draftProblem(draft);

  /**
   * Change one field of the draft.
   *
   * @param change The fields to change.
   */
  function edit(change: Partial<PreferencesDraft>): void {
    setDraft((current) => ({ ...current, ...change }));
    setSaved(false);
  }

  /** Mute or unmute one kind. */
  function flipMute(kindId: string): void {
    edit({
      mutedKinds: draft.mutedKinds.includes(kindId)
        ? draft.mutedKinds.filter((id) => id !== kindId)
        : [...draft.mutedKinds, kindId],
    });
  }

  /** Save the whole draft — once at a time. */
  function save(): void {
    if (saving || problem !== undefined) return;

    setSaving(true);
    setRefusal(null);
    void updateNotificationSettings({
      digestEnabled: draft.digestEnabled,
      digestTime: draft.digestTime,
      instantSeverity: draft.instant ? "err" : "off",
      mutedKinds: [...draft.mutedKinds],
    }).then((outcome) => {
      setSaving(false);

      if (outcome.ok) {
        setSaved(true);
        onSaved(outcome.value);
      } else {
        setRefusal(outcome.reason);
      }
    });
  }

  return (
    <form
      className="inbox-prefs__form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="inbox-prefs__row">
        <Toggle
          checked={draft.digestEnabled}
          label={DIGEST_TOGGLE}
          onClick={() => edit({ digestEnabled: !draft.digestEnabled })}
        />
        <span className="inbox-prefs__label" aria-hidden>
          {DIGEST_TOGGLE}
        </span>
      </div>
      <p className="inbox-prefs__note">{nextDigestLine(preferences, utcMinute)}</p>
      <TextField
        className="inbox-prefs__time"
        error={problem}
        id="inbox-prefs-digest-time"
        inputMode="numeric"
        label={DIGEST_TIME_LABEL}
        mono
        onChange={(event) => edit({ digestTime: event.target.value.trim() })}
        value={draft.digestTime}
      />
      <div className="inbox-prefs__row">
        <Toggle
          checked={draft.instant}
          label={INSTANT_TOGGLE}
          onClick={() => edit({ instant: !draft.instant })}
        />
        <span className="inbox-prefs__label" aria-hidden>
          {INSTANT_TOGGLE}
        </span>
      </div>
      <fieldset className="inbox-prefs__mutes">
        <legend className="inbox-prefs__legend">{MUTES_LEGEND}</legend>
        {MUTABLE_KINDS.map((kind) => (
          <label className="inbox-prefs__mute" key={kind.id}>
            <input
              checked={draft.mutedKinds.includes(kind.id)}
              onChange={() => flipMute(kind.id)}
              type="checkbox"
            />
            {kind.label}
          </label>
        ))}
      </fieldset>
      {refusal !== null && (
        <p className="inbox-prefs__error" role="alert">
          {refusal}
        </p>
      )}
      <div className="inbox-prefs__actions">
        {saved && <span className="inbox-prefs__saved">{SAVED}</span>}
        <Button
          reason={saving ? WORKING : problem}
          tone="primary"
          type="submit"
        >
          {saving ? WORKING : SAVE_LABEL}
        </Button>
      </div>
    </form>
  );
}

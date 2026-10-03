"use client";

import { useId, useState } from "react";

import type { AnalysisSchedule } from "@/app/api/analyzer";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SelectField, TextField, Toggle } from "@/app/ui";

import { saveAnalyzerSchedule } from "./analyzer-actions";
import { useAnalyzer } from "./analyzer-store";
import {
  SCHEDULE_GLYPH,
  SCHEDULE_MEMBER_NOTE,
  SCHEDULE_TITLE,
  type ScheduleField,
  type ScheduleForm,
  WEEKDAYS,
  counterLine,
  scheduleForm,
  scheduleLabel,
  scheduleVerdict,
} from "./view";

/** Why the schedule control is inert before the page has been read. */
const SCHEDULE_UNREAD = "The schedule has not been read yet.";

/**
 * Mockup 18's **Schedule: weekly + every 50 builds ▾** and the editor it opens (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)) — BU.1's schedule: the weekly
 * day-and-time slot, the every-N-builds threshold with its live counter, and the budgets every run
 * is held to.
 *
 * Every member may open it and read it; only an `owner` or `admin` may change it, and a member's
 * form is drawn read-only with the reason. A save is checked against V080's rules here first
 * (`scheduleVerdict`) and then by the service, whose per-field refusals land on the same fields.
 *
 * @returns The control and its sheet.
 */
export function ScheduleAction() {
  const { page, chosen } = useAnalyzer();
  const [open, setOpen] = useState(false);
  const schedule = page?.schedule ?? null;

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        reason={schedule === null ? SCHEDULE_UNREAD : undefined}
        tone="ghost"
      >
        {scheduleLabel(schedule)} <span aria-hidden="true">{SCHEDULE_GLYPH}</span>
      </Button>
      <ShellOverlay label={SCHEDULE_TITLE} onClose={() => setOpen(false)} open={open && schedule !== null}>
        {open && schedule !== null && chosen !== null && (
          <ScheduleEditor
            key={chosen.repo.ref}
            onSaved={() => setOpen(false)}
            repo={chosen.repo.ref}
            schedule={schedule}
          />
        )}
      </ShellOverlay>
    </>
  );
}

/**
 * The editor's form.
 *
 * @param props.repo The repository, `owner/name`.
 * @param props.schedule The schedule as read.
 * @param props.onSaved Called once a save is accepted.
 * @returns The form.
 */
function ScheduleEditor({
  repo,
  schedule,
  onSaved,
}: Readonly<{ repo: string; schedule: AnalysisSchedule; onSaved: () => void }>) {
  const { mayAdminister, refresh } = useAnalyzer();
  const id = useId();
  const [form, setForm] = useState<ScheduleForm>(() => scheduleForm(schedule));
  const [errors, setErrors] = useState<Partial<Record<ScheduleField, string>>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const readOnly = !mayAdminister;

  /**
   * Change one field of the form.
   *
   * @param patch The fields that moved.
   */
  function change(patch: Partial<ScheduleForm>): void {
    setForm((current) => ({ ...current, ...patch }));
  }

  /**
   * Step the every-N threshold by one build, never below one.
   *
   * @param delta `1` or `-1`.
   */
  function step(delta: number): void {
    const current = Number.parseInt(form.everyNBuilds, 10);
    change({ everyNBuilds: String(Math.max(1, (Number.isNaN(current) ? 0 : current) + delta)) });
  }

  /**
   * Check and save the whole form.
   *
   * @param event The form's submit.
   */
  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (readOnly || saving) return;

    const verdict = scheduleVerdict(repo, form);
    if (!verdict.ok) {
      setErrors(verdict.errors);
      return;
    }

    setErrors({});
    setRefusal(null);
    setSaving(true);
    void saveAnalyzerSchedule(verdict.input).then((outcome) => {
      setSaving(false);
      if (outcome.ok) {
        refresh();
        onSaved();
        return;
      }

      setRefusal(outcome.reason);
      setErrors(outcome.fields as Partial<Record<ScheduleField, string>>);
    });
  }

  const field = (name: ScheduleField) => `${id}-${name}`;

  return (
    <form className="analyzer-schedule" noValidate onSubmit={save}>
      <h2 className="shell-overlay__title">{SCHEDULE_TITLE}</h2>
      {readOnly && <p className="analyzer-schedule__note">{SCHEDULE_MEMBER_NOTE}</p>}

      <div className="analyzer-schedule__switch">
        <Toggle
          checked={form.enabled}
          label="Scheduled runs"
          onClick={() => change({ enabled: !form.enabled })}
          reason={readOnly ? SCHEDULE_MEMBER_NOTE : undefined}
        />
        <span aria-hidden="true">Run on a schedule</span>
      </div>

      <fieldset className="analyzer-schedule__group" disabled={readOnly}>
        <legend className="analyzer-schedule__legend">Weekly</legend>
        <div className="analyzer-schedule__switch">
          <Toggle
            checked={form.weeklyEnabled}
            label="Weekly run"
            onClick={() => change({ weeklyEnabled: !form.weeklyEnabled })}
            reason={readOnly ? SCHEDULE_MEMBER_NOTE : undefined}
          />
          <span aria-hidden="true">Once a week</span>
        </div>
        <div className="analyzer-schedule__fields">
          <SelectField
            error={errors.weeklyDay}
            id={field("weeklyDay")}
            label="Day"
            onChange={(event) => change({ weeklyDay: event.target.value })}
            value={form.weeklyDay}
          >
            <option value="">Choose a day</option>
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={String(index + 1)}>
                {day}
              </option>
            ))}
          </SelectField>
          <TextField
            error={errors.weeklyTime}
            hint="24-hour, UTC"
            id={field("weeklyTime")}
            label="Time (UTC)"
            mono
            onChange={(event) => change({ weeklyTime: event.target.value })}
            placeholder="06:00"
            value={form.weeklyTime}
          />
        </div>
      </fieldset>

      <fieldset className="analyzer-schedule__group" disabled={readOnly}>
        <legend className="analyzer-schedule__legend">Every N builds</legend>
        <div className="analyzer-schedule__switch">
          <Toggle
            checked={form.everyEnabled}
            label="Every-N-builds run"
            onClick={() => change({ everyEnabled: !form.everyEnabled })}
            reason={readOnly ? SCHEDULE_MEMBER_NOTE : undefined}
          />
          <span aria-hidden="true">After a number of builds</span>
        </div>
        <div className="analyzer-schedule__stepper">
          <Button aria-label="One build fewer" onClick={() => step(-1)} size="sm">
            −
          </Button>
          <TextField
            error={errors.everyNBuilds}
            id={field("everyNBuilds")}
            inputMode="numeric"
            label="Builds between runs"
            mono
            onChange={(event) => change({ everyNBuilds: event.target.value })}
            value={form.everyNBuilds}
          />
          <Button aria-label="One build more" onClick={() => step(1)} size="sm">
            +
          </Button>
        </div>
        <p className="analyzer-schedule__counter">{counterLine(schedule)}</p>
      </fieldset>

      <fieldset className="analyzer-schedule__group" disabled={readOnly}>
        <legend className="analyzer-schedule__legend">Budgets</legend>
        <div className="analyzer-schedule__fields">
          <TextField
            error={errors.maxBuilds}
            id={field("maxBuilds")}
            inputMode="numeric"
            label="Max builds"
            mono
            onChange={(event) => change({ maxBuilds: event.target.value })}
            value={form.maxBuilds}
          />
          <TextField
            error={errors.maxLogLines}
            id={field("maxLogLines")}
            inputMode="numeric"
            label="Max log lines"
            mono
            onChange={(event) => change({ maxLogLines: event.target.value })}
            value={form.maxLogLines}
          />
          <TextField
            error={errors.computeCeilingSeconds}
            hint="Seconds of compute a run may use"
            id={field("computeCeilingSeconds")}
            inputMode="numeric"
            label="Compute ceiling (s)"
            mono
            onChange={(event) => change({ computeCeilingSeconds: event.target.value })}
            value={form.computeCeilingSeconds}
          />
        </div>
      </fieldset>

      {refusal !== null && (
        <p className="analyzer-schedule__error" role="alert">
          {refusal}
        </p>
      )}
      {!readOnly && (
        <div className="analyzer-schedule__actions">
          <Button reason={saving ? "Saving…" : undefined} tone="primary" type="submit">
            Save schedule
          </Button>
        </div>
      )}
    </form>
  );
}

"use client";

import { type FormEvent, useEffect, useId, useState } from "react";

import type { AttachEvidenceRequest } from "@/app/api/pull-requests";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SelectField, TextField } from "@/app/ui";

import { ATTACH_LABEL, CRITERIA_SENDING } from "./criteria";
import {
  type EvidenceOptions,
  MAX_QUALIFIER_LENGTH,
  PICKER_KINDS,
  type PickerDraft,
  type PickerKind,
  emptyReason,
  readDraft,
} from "./evidence-options";
import type { CriterionOutcome, OptionsOutcome } from "./outcomes";

/** The dialog's title. */
export const EVIDENCE_TITLE = "Attach evidence";

/** The fieldset's legend. */
export const KIND_LEGEND = "What to cite";

/** What is said while the tests and measurements are being read. */
export const OPTIONS_READING = "Reading this PR's test results…";

/** The qualifier's label. */
export const QUALIFIER_LABEL = "Qualifier";

/** What the qualifier says beneath it. */
export const QUALIFIER_HINT =
  "Optional. Appended to the line in parentheses — “10⁶ frames, 0 reordered”.";

/** The tests' select. */
export const TEST_LABEL = "Test to cite";

/** The measurements' select. */
export const MEASUREMENT_LABEL = "Measurement to cite";

/** The changed files' select. */
export const PATH_LABEL = "Changed file";

/** The placeholder option of each select. */
export const CHOOSE = "Choose…";

/** The dialog's cancel. */
export const EVIDENCE_CANCEL = "Keep on this page";

/** A form with nothing chosen. */
const EMPTY: PickerDraft = {
  kind: "test_case",
  testId: "",
  measurementId: "",
  path: "",
  lineStart: "",
  lineEnd: "",
  qualifier: "",
};

/** What the dialog is told. */
export interface EvidenceDialogProps {
  /** The claim evidence is cited for, or `null` while the dialog is closed. */
  readonly claim: string | null;
  /** Close it — Escape, the backdrop, the cancel, or a citation that landed. */
  readonly onClose: () => void;
  /** The paths of the latest revision's files snapshot. */
  readonly paths: readonly string[];
  /** The revision the paths are the snapshot of, or `null`. */
  readonly revisionId: string | null;
  /** Read the tests and measurements the picker offers. */
  readonly loadOptions: () => Promise<OptionsOutcome>;
  /**
   * Send the citation. A refusal comes back here as a value and the dialog stays open to say so.
   */
  readonly onConfirm: (request: AttachEvidenceRequest) => Promise<CriterionOutcome>;
}

/**
 * The evidence picker ([#366](https://github.com/NobuData/ouroboros/issues/366)).
 *
 * **Typed, and only what exists.** A citation is a test, a measurement or a hunk, and each is
 * chosen from a list: the tests and measurements of the attempt the latest revision was judged
 * on — read when the dialog opens — and the paths of that revision's files snapshot. There is no
 * free-text reference to type, so a dangling one cannot be constructed; a kind with nothing to
 * offer says why. The qualifier is the one free-text part, and it qualifies a line rather than
 * being one.
 *
 * The modal contract is the shell overlay's.
 *
 * @param props See {@link EvidenceDialogProps}.
 * @returns The dialog while a claim is given, nothing otherwise.
 */
export function EvidenceDialog({
  claim,
  onClose,
  paths,
  revisionId,
  loadOptions,
  onConfirm,
}: EvidenceDialogProps) {
  const id = useId();
  const open = claim !== null;
  const [draft, setDraft] = useState<PickerDraft>(EMPTY);
  const [options, setOptions] = useState<EvidenceOptions | null>(null);
  const [unread, setUnread] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Read on every opening, so the rows offered are the rows that exist now.
  useEffect(() => {
    if (!open) return;

    let current = true;

    void loadOptions().then((outcome) => {
      if (!current) return;
      if (outcome.ok) setOptions(outcome.answer);
      else setUnread(outcome.reason);
    });

    return () => {
      current = false;
    };
    // The reader is the screen's and is rebuilt on its every render; the opening is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reading = readDraft(draft, { options, paths, revisionId });
  // A failed read stands between the reader and the tests and measurements — never the hunks,
  // which are the page's own.
  const nothing =
    draft.kind !== "hunk" && unread !== null
      ? unread
      : emptyReason(draft.kind, options, paths);
  const pending = draft.kind !== "hunk" && options === null && unread === null;
  const reason = sending
    ? CRITERIA_SENDING
    : pending
      ? OPTIONS_READING
      : (nothing ?? (reading.ok ? undefined : reading.reason));

  /** Close, leaving nothing chosen behind for the next opening. */
  function close(): void {
    setDraft(EMPTY);
    setOptions(null);
    setUnread(null);
    setRefusal(null);
    onClose();
  }

  /**
   * Change part of the form.
   *
   * @param change The fields to replace.
   */
  function change(change: Partial<PickerDraft>): void {
    setDraft((current) => ({ ...current, ...change }));
  }

  /**
   * Send the citation — once, and only a whole one.
   *
   * @param event The form's submission.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!reading.ok || sending || nothing !== null) return;

    setSending(true);
    setRefusal(null);
    void onConfirm(reading.request).then((outcome) => {
      setSending(false);
      if (outcome.ok) {
        close();
        return;
      }
      setRefusal(outcome.reason);
    });
  }

  return (
    <ShellOverlay label={EVIDENCE_TITLE} onClose={close} open={open} role="dialog">
      <form className="prv-dialog" noValidate onSubmit={submit}>
        <h2 className="shell-overlay__title">{EVIDENCE_TITLE}</h2>
        <p className="prv-dialog__claim">{claim}</p>

        <fieldset className="prv-picker__kinds">
          <legend className="prv-picker__legend">{KIND_LEGEND}</legend>
          {PICKER_KINDS.map(({ kind, label }) => (
            <label className="prv-picker__kind" key={kind}>
              <input
                checked={draft.kind === kind}
                className="prv-picker__radio"
                name={`${id}-kind`}
                onChange={() => change({ kind: kind satisfies PickerKind })}
                type="radio"
              />
              {label}
            </label>
          ))}
        </fieldset>

        {pending && (
          <p className="prv-dialog__note" role="status">
            {OPTIONS_READING}
          </p>
        )}
        {!pending && nothing !== null && <p className="prv-dialog__note">{nothing}</p>}

        {draft.kind === "test_case" && options !== null && options.tests.length > 0 && (
          <SelectField
            hint={options.attempt === null ? undefined : `From attempt ${options.attempt.seq}.`}
            id={`${id}-test`}
            label={TEST_LABEL}
            onChange={(event) => change({ testId: event.currentTarget.value })}
            value={draft.testId}
          >
            <option value="">{CHOOSE}</option>
            {options.tests.map((test) => (
              <option key={test.id} value={test.id}>
                {test.label}
              </option>
            ))}
          </SelectField>
        )}

        {draft.kind === "hil_measurement" &&
          options !== null &&
          options.measurements.length > 0 && (
            <SelectField
              hint={options.attempt === null ? undefined : `From attempt ${options.attempt.seq}.`}
              id={`${id}-measurement`}
              label={MEASUREMENT_LABEL}
              onChange={(event) => change({ measurementId: event.currentTarget.value })}
              value={draft.measurementId}
            >
              <option value="">{CHOOSE}</option>
              {options.measurements.map((measurement) => (
                <option key={measurement.id} value={measurement.id}>
                  {measurement.label}
                </option>
              ))}
            </SelectField>
          )}

        {draft.kind === "hunk" && paths.length > 0 && (
          <>
            <SelectField
              hint="A file the latest revision changed."
              id={`${id}-path`}
              label={PATH_LABEL}
              onChange={(event) => change({ path: event.currentTarget.value })}
              value={draft.path}
            >
              <option value="">{CHOOSE}</option>
              {paths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </SelectField>
            <div className="prv-picker__range">
              <TextField
                id={`${id}-start`}
                inputMode="numeric"
                label="First line"
                mono
                onChange={(event) => change({ lineStart: event.currentTarget.value })}
                value={draft.lineStart}
              />
              <TextField
                id={`${id}-end`}
                inputMode="numeric"
                label="Last line"
                mono
                onChange={(event) => change({ lineEnd: event.currentTarget.value })}
                value={draft.lineEnd}
              />
            </div>
          </>
        )}

        {!pending && nothing === null && (
          <TextField
            hint={QUALIFIER_HINT}
            id={`${id}-qualifier`}
            label={QUALIFIER_LABEL}
            maxLength={MAX_QUALIFIER_LENGTH}
            onChange={(event) => change({ qualifier: event.currentTarget.value })}
            value={draft.qualifier}
          />
        )}

        {refusal !== null && (
          <p className="prv-dialog__error" role="alert">
            {refusal}
          </p>
        )}

        <div className="prv-dialog__actions">
          <Button reason={reason} tone="primary" type="submit">
            {sending ? CRITERIA_SENDING : ATTACH_LABEL}
          </Button>
          <Button onClick={close} tone="ghost" type="button">
            {EVIDENCE_CANCEL}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}

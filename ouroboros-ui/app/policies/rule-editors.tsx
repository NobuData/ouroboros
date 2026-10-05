"use client";

import { type KeyboardEvent, type ReactNode, useState } from "react";

import { type GlobPreview } from "@/app/globs/glob";
import { GlobEditor } from "@/app/globs/glob-editor";
import { Button, SelectField, TextField, cx } from "@/app/ui";

import {
  type AutoMergeTerms,
  type DryRunTerms,
  EFFORTS,
  type Effort,
  type HumanReviewTerms,
  LABEL_PROBLEMS,
  LOOPS_MAX,
  NEEDS_A_CAP,
  type ProtectedPathsTerms,
  type SpendGuardTerms,
  clampLoops,
  effortLabel,
  isEffort,
  labelProblem,
  termCount,
} from "./document";
import { amountOfCents, centsOfAmount, isAmountInProgress } from "./money";

import "./policy-rules.css";

/**
 * The chip-level condition editors of the Autonomy policies card
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)) — one per rule type.
 *
 * `effort ≤ M` is a condition with a vocabulary, `boot/` is a glob, `$2.50/run` is an amount in
 * cents. So none of these is a free-text field: each editor is a structured form over the rule's
 * typed terms (`app/policies/document.ts`), and each one **only ever emits terms the document
 * admits**. A select offers the five efforts; a label joins the list only once it passes
 * `labelProblem`; an amount reaches the draft only as integer cents; the last condition of a
 * predicate rule has no remove control. An invalid state is not rejected at save — it is never
 * produced.
 *
 * ### Text a reader is still typing is the editor's, not the draft's
 *
 * A currency field and the loop stepper hold their own text. While it is not (yet) a value —
 * `2.`, an emptied field — the draft keeps the last valid one, and leaving the field restores
 * it. The draft is what would be published, so it is valid at every keystroke.
 *
 * Every editor takes `readOnly` for the length of a save: the controls stay drawn, inert.
 */

/** What every editor is given. */
interface EditorProps<Terms> {
  /** The rule's terms as they stand. */
  readonly terms: Terms;
  /** Called with the next terms — always ones the document admits. */
  readonly onChange: (terms: Terms) => void;
  /** Whether the controls are inert for now (a save is in flight). */
  readonly readOnly: boolean;
  /** The prefix of every control's id — see {@link controlId}. */
  readonly idBase: string;
}

/** The controls a chip can lead to, by the part of the rule each edits. */
export type EditorControl = "effort" | "label" | "globs" | "per-run" | "monthly" | "loops";

/**
 * The id of one of a rule's editor controls — what a pressed chip moves focus to.
 *
 * @param idBase The rule's id prefix.
 * @param control Which control.
 * @returns The id.
 */
export function controlId(idBase: string, control: EditorControl): string {
  return `${idBase}-${control}`;
}

/* ------------------------------------------------------------------ copy */

/** `auto_merge`'s effort select. */
export const AUTO_MERGE_EFFORT_LABEL = "Largest effort that merges on its own";
/** The select's option for no effort condition — offered only while a label is excluded. */
export const ANY_EFFORT = "Any effort";
/** `auto_merge`'s label group and its add field. */
export const EXCLUDED_LABELS = "Labels that never merge on their own";
export const EXCLUDE_A_LABEL = "Exclude a label";
/** What `auto_merge`'s terms mean together. */
export const AUTO_MERGE_SEMANTICS =
  "A pull request merges itself only when every one of these holds.";

/** `human_review`'s label group and its add field. */
export const REVIEW_LABELS = "Labels that always wait for a person";
export const REVIEW_A_LABEL = "Add a label";
/** `human_review`'s effort select. */
export const REVIEW_EFFORT_LABEL = "Smallest effort that always waits for a person";
/** The select's option for no effort condition — offered only while a label is listed. */
export const NO_EFFORT_THRESHOLD = "No effort threshold";
/** The word between `human_review`'s two groups. Text, never adjacency. */
export const OR = "OR";

/** The add button of a label field. */
export const ADD = "Add";

/** What a label group with nothing in it says. */
export const NO_LABELS = "No labels.";

/** `protected_paths`' editor. */
export const PROTECTED_GLOBS_LABEL = "Protected path patterns";

/** `spend_guard`'s two fields. */
export const PER_RUN_LABEL = "Pause a loop when its run would cost more than";
export const MONTHLY_LABEL = "Monthly cap, per provider";
export const PER_RUN_HINT =
  "Enforced now. Where a route sets its own per-run cap, the stricter of the two applies. " +
  "Leave empty for no per-run cap.";
export const MONTHLY_HINT =
  "Applies to each provider's month, and is separate from the cap a provider key itself can " +
  "carry (Models → Providers). Its enforcement arrives with cap enforcement (#237). Leave " +
  "empty for no monthly cap.";
/** What an amount of zero is told. */
export const AMOUNT_TOO_SMALL = "A cap is at least $0.01.";
/** The currency the amounts are in, as the adornment beside each field. */
export const CURRENCY_SYMBOL = "$";

/** `dry_run_new_repos`' stepper. */
export const LOOPS_LABEL = "Loops that open draft PRs on a new repository";
export const ONE_FEWER = "One fewer loop";
export const ONE_MORE = "One more loop";

/**
 * A label's remove control, as its accessible name.
 *
 * @param verb What removing it stops — `Stop excluding` or `Stop requiring review for`.
 * @param label The label.
 * @returns `Stop excluding refactor`.
 */
export function removeLabel(verb: string, label: string): string {
  return `${verb} ${label}`;
}

/**
 * What `human_review`'s terms mean, as one sentence with its `OR` written out.
 *
 * @param terms The rule's terms.
 * @returns `A person reviews when the ticket is labelled refactor OR its effort is at least L.`
 */
export function reviewSemantics(terms: HumanReviewTerms): string {
  const parts = [
    ...terms.labels.map((label) => `is labelled ${label}`),
    ...(terms.minEffort === null ? [] : [`has an effort of at least ${effortLabel(terms.minEffort)}`]),
  ];

  return `A person reviews when the ticket ${parts.join(` ${OR} `)}.`;
}

/**
 * What the first-N rule does, spelled out for the count as it stands.
 *
 * @param loops How many loops.
 * @returns The consequence — and for zero, that the rule holds nothing back.
 */
export function loopsConsequence(loops: number): string {
  if (loops === 0) {
    return "No loops are held as drafts: a new repository is treated like any other from its first loop.";
  }

  const first = loops === 1 ? "first loop opens a draft PR" : `first ${String(loops)} loops open draft PRs`;

  return `A new repository's ${first}; nothing of theirs merges on its own until then.`;
}

/* ------------------------------------------------------------------ shared parts */

/**
 * A list of labels with a remove control on each that may go, and a field that adds one.
 *
 * @param props.id The add field's id.
 * @param props.legend What the list is.
 * @param props.addLabel The add field's label.
 * @param props.removeVerb The start of each remove control's name.
 * @param props.labels The labels.
 * @param props.terms How many terms the rule holds — the last one has no remove control, and
 *   a full rule refuses another.
 * @param props.readOnly Whether the controls are inert.
 * @param props.onAdd Called with a label that may join the list.
 * @param props.onRemove Called with the label to drop.
 * @returns The group.
 */
function LabelList({
  id,
  legend,
  addLabel,
  removeVerb,
  labels,
  terms,
  readOnly,
  onAdd,
  onRemove,
}: Readonly<{
  id: string;
  legend: string;
  addLabel: string;
  removeVerb: string;
  labels: readonly string[];
  terms: number;
  readOnly: boolean;
  onAdd: (label: string) => void;
  onRemove: (label: string) => void;
}>) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  /** Add what is typed, or say why it cannot be added. Nothing is emitted for an invalid label. */
  function add(): void {
    if (readOnly) return;

    const label = text.trim();
    const problem = labelProblem(label, labels, terms);

    if (problem !== null) {
      setError(LABEL_PROBLEMS[problem]);
      return;
    }

    onAdd(label);
    setText("");
    setError(undefined);
  }

  /**
   * Enter adds — and never submits whatever form the card may sit in.
   *
   * @param event The key press.
   */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") return;

    event.preventDefault();
    add();
  }

  return (
    <div aria-label={legend} className="policy-rule__group" role="group">
      <span className="policy-rule__legend">{legend}</span>
      {labels.length === 0 ? (
        <p className="policy-rule__none">{NO_LABELS}</p>
      ) : (
        <ul className="policy-rule__labels">
          {labels.map((label) => (
            <li className="policy-rule__label" key={label}>
              <span className="policy-rule__label-text">{label}</span>
              {terms > 1 && (
                <button
                  aria-label={removeLabel(removeVerb, label)}
                  className="policy-rule__remove"
                  disabled={readOnly}
                  onClick={() => {
                    onRemove(label);
                  }}
                  type="button"
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="policy-rule__add">
        <TextField
          className="policy-rule__add-field"
          error={error}
          id={id}
          label={addLabel}
          mono
          onChange={(event) => {
            setText(event.target.value);
            setError(undefined);
          }}
          onKeyDown={onKeyDown}
          readOnly={readOnly}
          value={text}
        />
        <Button onClick={add} reason={readOnly ? "Saving…" : undefined} size="sm">
          {ADD}
        </Button>
      </div>
    </div>
  );
}

/**
 * The options of an effort select: the five sizes, smallest first.
 *
 * @returns The `<option>` elements.
 */
function effortOptions(): ReactNode {
  return EFFORTS.map((effort) => (
    <option key={effort} value={effort}>
      {effortLabel(effort)}
    </option>
  ));
}

/**
 * A select's value as an effort.
 *
 * @param value The `<select>`'s value — an effort, or `""` for the "none" option.
 * @returns The effort, or `null`.
 */
function effortOf(value: string): Effort | null {
  return isEffort(value) ? value : null;
}

/* ------------------------------------------------------------------ auto_merge */

/**
 * `auto_merge`'s editor: the largest effort that merges on its own, and the labels that never do.
 *
 * The rule keeps at least one term: *Any effort* is offered only while a label is excluded, and
 * the last excluded label has no remove control while there is no effort condition.
 *
 * @param props See {@link EditorProps}.
 * @returns The form.
 */
export function AutoMergeEditor({ terms, onChange, readOnly, idBase }: EditorProps<AutoMergeTerms>) {
  const count = termCount(terms);

  return (
    <div className="policy-rule__form">
      <p className="policy-rule__semantics">{AUTO_MERGE_SEMANTICS}</p>
      <SelectField
        disabled={readOnly}
        id={controlId(idBase, "effort")}
        label={AUTO_MERGE_EFFORT_LABEL}
        onChange={(event) => {
          const maxEffort = effortOf(event.target.value);
          // "Any effort" is only ever an option while a label is excluded; this is the belt.
          if (maxEffort === null && terms.excludedLabels.length === 0) return;

          onChange({ ...terms, maxEffort });
        }}
        value={terms.maxEffort ?? ""}
      >
        {terms.excludedLabels.length > 0 && <option value="">{ANY_EFFORT}</option>}
        {effortOptions()}
      </SelectField>
      <LabelList
        addLabel={EXCLUDE_A_LABEL}
        id={controlId(idBase, "label")}
        labels={terms.excludedLabels}
        legend={EXCLUDED_LABELS}
        onAdd={(label) => {
          onChange({ ...terms, excludedLabels: [...terms.excludedLabels, label] });
        }}
        onRemove={(label) => {
          if (count <= 1) return;

          onChange({ ...terms, excludedLabels: terms.excludedLabels.filter((each) => each !== label) });
        }}
        readOnly={readOnly}
        removeVerb="Stop excluding"
        terms={count}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ human_review */

/**
 * `human_review`'s editor: the labels that always wait for a person, **OR** the smallest effort
 * that does — with the `OR` on the page as a word, and the whole condition as a sentence.
 *
 * The rule keeps at least one term, by the same two absences as {@link AutoMergeEditor}.
 *
 * @param props See {@link EditorProps}.
 * @returns The form.
 */
export function HumanReviewEditor({ terms, onChange, readOnly, idBase }: EditorProps<HumanReviewTerms>) {
  const count = termCount(terms);

  return (
    <div className="policy-rule__form">
      <p className="policy-rule__semantics">{reviewSemantics(terms)}</p>
      <LabelList
        addLabel={REVIEW_A_LABEL}
        id={controlId(idBase, "label")}
        labels={terms.labels}
        legend={REVIEW_LABELS}
        onAdd={(label) => {
          onChange({ ...terms, labels: [...terms.labels, label] });
        }}
        onRemove={(label) => {
          if (count <= 1) return;

          onChange({ ...terms, labels: terms.labels.filter((each) => each !== label) });
        }}
        readOnly={readOnly}
        removeVerb="Stop requiring review for"
        terms={count}
      />
      <p className="policy-rule__or">{OR}</p>
      <SelectField
        disabled={readOnly}
        id={controlId(idBase, "effort")}
        label={REVIEW_EFFORT_LABEL}
        onChange={(event) => {
          const minEffort = effortOf(event.target.value);
          if (minEffort === null && terms.labels.length === 0) return;

          onChange({ ...terms, minEffort });
        }}
        value={terms.minEffort ?? ""}
      >
        {terms.labels.length > 0 && <option value="">{NO_EFFORT_THRESHOLD}</option>}
        {effortOptions()}
      </SelectField>
    </div>
  );
}

/* ------------------------------------------------------------------ protected_paths */

/**
 * `protected_paths`' editor: the shared glob editor (`app/globs/glob-editor.tsx`), with its match
 * preview against the workspace's repositories.
 *
 * @param props See {@link EditorProps}, and `previewPaths` — what the globs match, asked of the
 *   service.
 * @returns The editor.
 */
export function ProtectedPathsEditor({
  terms,
  onChange,
  readOnly,
  idBase,
  previewPaths,
}: EditorProps<ProtectedPathsTerms> &
  Readonly<{ previewPaths: (globs: readonly string[]) => Promise<GlobPreview> }>) {
  return (
    <div className="policy-rule__form">
      <GlobEditor
        globs={terms.globs}
        id={controlId(idBase, "globs")}
        label={PROTECTED_GLOBS_LABEL}
        onChange={(globs) => {
          onChange({ globs });
        }}
        preview={previewPaths}
        readOnly={readOnly}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ spend_guard */

/**
 * A field's text for a cap.
 *
 * @param cents The cap, or `null` for none.
 * @returns The amount for editing, or the empty string.
 */
function amountText(cents: number | null): string {
  return cents === null ? "" : amountOfCents(cents);
}

/**
 * One cap, as a currency field over integer cents.
 *
 * The field holds its own text and accepts a keystroke only while the text could still become an
 * amount (`isAmountInProgress`) — a letter or a third decimal never appears. Cents are emitted
 * only for a complete amount, assembled from the text's two halves with no floating point; an
 * emptied field emits *no cap* only when the other cap stands. Anything else leaves the draft at
 * its last valid value, says why, and is restored on leaving the field.
 *
 * @param props.id The input's id.
 * @param props.label What the cap is.
 * @param props.hint How it is enforced.
 * @param props.cents The cap as the draft holds it.
 * @param props.otherSet Whether the rule's other cap is set — what lets this one be emptied.
 * @param props.readOnly Whether the field is inert.
 * @param props.onChange Called with the cents, or `null` for no cap.
 * @returns The field.
 */
function CurrencyField({
  id,
  label,
  hint,
  cents,
  otherSet,
  readOnly,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  hint: string;
  cents: number | null;
  otherSet: boolean;
  readOnly: boolean;
  onChange: (cents: number | null) => void;
}>) {
  const [text, setText] = useState(amountText(cents));
  const [seen, setSeen] = useState(cents);

  // The draft moved underneath the field (a discard, a re-read): show what it holds now —
  // unless the text already says exactly that, which is the echo of this field's own edit.
  if (seen !== cents) {
    setSeen(cents);
    if (text === "" ? cents !== null : centsOfAmount(text) !== cents) setText(amountText(cents));
  }

  const typed = centsOfAmount(text);
  const error =
    text === ""
      ? cents !== null
        ? NEEDS_A_CAP
        : undefined
      : typed === null && /^0*(?:\.0*)?$/.test(text) && /\d/.test(text)
        ? AMOUNT_TOO_SMALL
        : undefined;

  /**
   * Take a keystroke if the text could still become an amount, and emit what it now stands for.
   *
   * @param next The field's text after the keystroke.
   */
  function type(next: string): void {
    if (readOnly || !isAmountInProgress(next)) return;

    setText(next);

    if (next === "") {
      if (otherSet && cents !== null) onChange(null);
      return;
    }

    const value = centsOfAmount(next);
    if (value !== null && value !== cents) onChange(value);
  }

  /** Leaving the field with text that is not the draft's value restores the draft's value. */
  function settle(): void {
    if (text === "" ? cents !== null : centsOfAmount(text) !== cents) setText(amountText(cents));
  }

  return (
    <div className="ou-field">
      <label className="ou-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="policy-rule__money">
        <span aria-hidden="true" className="policy-rule__currency">
          {CURRENCY_SYMBOL}
        </span>
        <input
          aria-describedby={error === undefined ? `${id}-hint` : `${id}-hint ${id}-error`}
          aria-invalid={error !== undefined ? true : undefined}
          autoComplete="off"
          className={cx("ou-input", "ou-input--mono")}
          id={id}
          inputMode="decimal"
          onBlur={settle}
          onChange={(event) => {
            type(event.target.value);
          }}
          readOnly={readOnly}
          type="text"
          value={text}
        />
      </div>
      <p className="ou-field__hint" id={`${id}-hint`}>
        {hint}
      </p>
      {error !== undefined && (
        <p className="ou-field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * `spend_guard`'s editor: the per-run cap and the monthly per-provider cap, in dollars as typed
 * and integer cents as held — and what each one does today.
 *
 * The rule keeps at least one cap: a field can be emptied only while the other holds an amount.
 *
 * @param props See {@link EditorProps}.
 * @returns The form.
 */
export function SpendGuardEditor({ terms, onChange, readOnly, idBase }: EditorProps<SpendGuardTerms>) {
  return (
    <div className="policy-rule__form">
      <CurrencyField
        cents={terms.perRunCents}
        hint={PER_RUN_HINT}
        id={controlId(idBase, "per-run")}
        label={PER_RUN_LABEL}
        onChange={(perRunCents) => {
          if (perRunCents === null && terms.monthlyCents === null) return;

          onChange({ ...terms, perRunCents });
        }}
        otherSet={terms.monthlyCents !== null}
        readOnly={readOnly}
      />
      <CurrencyField
        cents={terms.monthlyCents}
        hint={MONTHLY_HINT}
        id={controlId(idBase, "monthly")}
        label={MONTHLY_LABEL}
        onChange={(monthlyCents) => {
          if (monthlyCents === null && terms.perRunCents === null) return;

          onChange({ ...terms, monthlyCents });
        }}
        otherSet={terms.perRunCents !== null}
        readOnly={readOnly}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ dry_run_new_repos */

/** What the stepper's field may hold while a count is being typed: digits, up to the bound's width. */
const LOOPS_IN_PROGRESS = new RegExp(`^\\d{0,${String(String(LOOPS_MAX).length)}}$`);

/**
 * `dry_run_new_repos`' editor: a first-N stepper, with what N means written under it.
 *
 * The field takes digits only and every emitted count is a whole number within the grammar's
 * bounds (`clampLoops`); an emptied field keeps the draft's count and is restored on leaving.
 *
 * @param props See {@link EditorProps}.
 * @returns The form.
 */
export function DryRunEditor({ terms, onChange, readOnly, idBase }: EditorProps<DryRunTerms>) {
  const id = controlId(idBase, "loops");
  const { firstLoops } = terms;
  const [text, setText] = useState(String(firstLoops));
  const [seen, setSeen] = useState(firstLoops);

  if (seen !== firstLoops) {
    setSeen(firstLoops);
    if (text === "" || Number(text) !== firstLoops) setText(String(firstLoops));
  }

  /**
   * Set the count, clamped, and show it.
   *
   * @param value The count asked for.
   */
  function step(value: number): void {
    if (readOnly) return;

    const next = clampLoops(value);
    setText(String(next));
    if (next !== firstLoops) onChange({ firstLoops: next });
  }

  /**
   * Take a keystroke if it leaves only digits, and emit the count it now stands for.
   *
   * @param next The field's text after the keystroke.
   */
  function type(next: string): void {
    if (readOnly || !LOOPS_IN_PROGRESS.test(next)) return;

    setText(next);
    if (next === "") return;

    const value = clampLoops(Number(next));
    if (value !== firstLoops) onChange({ firstLoops: value });
  }

  return (
    <div className="policy-rule__form">
      <div className="ou-field">
        <label className="ou-field__label" htmlFor={id}>
          {LOOPS_LABEL}
        </label>
        <div className="policy-rule__stepper">
          <Button
            aria-label={ONE_FEWER}
            onClick={() => {
              step(firstLoops - 1);
            }}
            reason={readOnly ? "Saving…" : firstLoops <= 0 ? "Zero is the fewest." : undefined}
            size="sm"
          >
            <span aria-hidden="true">−</span>
          </Button>
          <input
            aria-describedby={`${id}-hint`}
            autoComplete="off"
            className={cx("ou-input", "ou-input--mono", "policy-rule__count")}
            id={id}
            inputMode="numeric"
            onBlur={() => {
              setText(String(firstLoops));
            }}
            onChange={(event) => {
              type(event.target.value);
            }}
            readOnly={readOnly}
            type="text"
            value={text}
          />
          <Button
            aria-label={ONE_MORE}
            onClick={() => {
              step(firstLoops + 1);
            }}
            reason={
              readOnly
                ? "Saving…"
                : firstLoops >= LOOPS_MAX
                  ? `${LOOPS_MAX.toLocaleString("en-US")} is the most.`
                  : undefined
            }
            size="sm"
          >
            <span aria-hidden="true">+</span>
          </Button>
        </div>
        <p className="ou-field__hint" id={`${id}-hint`}>
          {loopsConsequence(firstLoops)}
        </p>
      </div>
    </div>
  );
}

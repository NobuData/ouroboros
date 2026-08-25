"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Chip, EmptyState, Table, Tag, TextField, type Column, cx } from "@/app/ui";

import {
  type CandidatesReading,
  type ImportOutcome,
  importAliases,
  readCandidates,
} from "./import-actions";
import type { ImportResult } from "@/app/api/registry";
import {
  CANDIDATES_CAPTION,
  CANDIDATES_LOADING,
  CHOOSE_NOTE,
  COLUMN_ALIAS,
  COLUMN_CAPABILITIES,
  COLUMN_IMPORT,
  COLUMN_MODEL,
  COLUMN_PRICE,
  type CandidateRow,
  EMPTY_HREF,
  EMPTY_LINK,
  EMPTY_TITLE,
  FIX_ROWS,
  IMPORTED_TITLE,
  IMPORTING,
  IMPORT_CANCEL,
  IMPORT_DONE,
  IMPORT_STEPS,
  IMPORT_SUBMIT,
  type ImportFailure,
  type RowProblem,
  NOTHING_CHOSEN,
  PREVIEW_LABEL,
  REVIEW_BACK,
  REVIEW_NEXT,
  SELECT_ALL_LABEL,
  SKIPPED_LABEL,
  STEPS_LABEL,
  type StepIndex,
  type StepState,
  aliasedMark,
  allSelected,
  candidateRows,
  chosen,
  importFailure,
  importRequest,
  importSummary,
  previewSummary,
  rowError,
  rowNameLabel,
  rowProblems,
  rowSelectLabel,
  selectAll,
  selectable,
  skippedLine,
  stepState,
  wizardTitle,
} from "./wizard";
import type { ImportSource } from "./view";

import "./registry.css";

/**
 * Mockup 21's **Import from provider ▾**, past the menu: the wizard behind one connection
 * ([#594](https://github.com/NobuData/ouroboros/issues/594)) over CH.4's annotated candidates
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * ### Three steps, and the first one is already answered
 *
 * The connection was chosen in the menu row that opened this, so it is in the heading rather
 * than in a screen somebody has to walk back to — and the step list says so, with the first
 * step already behind the reader. What is left is **Models** (tick what to add, edit any name)
 * and **Review** (what will be created, by name), and then one call.
 *
 * ### The operator's vocabulary, beside discovery's truth
 *
 * Every cell on a candidate row is the service's — CH.3's price string, CH.2's capability
 * headline, the mark on a model that already has an alias — except the name, which is the
 * operator's. That is the whole design: forty discovered models must not become forty
 * machine-named aliases (decision **R7**), and naming forty by hand is not it either, so the
 * service suggests and the row's box is editable.
 *
 * ### Nothing is created until every row is acceptable
 *
 * The batch is one transaction, so a `422` means **nothing landed** and names every offending
 * item. `wizard.ts`'s `importItemErrors` maps those back onto rows through the order the body
 * was built in, and `rowProblems` anticipates the ordinary ones — a name edited into a
 * collision, a ticked row with an empty box — before a round trip is spent on them. Both end as
 * a line under the row's own name box.
 *
 * ### Re-entry is idempotent because the read is
 *
 * The candidates are read on **every** open, so the two aliases an operator just imported come
 * back marked *aliased: …* and unticked. Nothing is remembered between opens, which is what
 * makes that true rather than hoped for.
 */

/** What the wizard needs to be told. */
export interface ImportWizardProps {
  /**
   * The connection to import from — the menu row that opened this.
   *
   * Required rather than nullable: the menu renders the wizard only while one is chosen, and
   * keyed by its id, so **mounting is opening**. There is no state in which this component
   * exists and does not know which connection it is about, and no reset path to get wrong when
   * a reader closes the wizard on one connection and opens it on another.
   */
  readonly source: ImportSource;
  /** Every alias name this workspace has, for the row-level uniqueness check. */
  readonly aliasNames: readonly string[];
  /** Close it. Called for Escape, the backdrop, **Cancel** and **Done** alike. */
  readonly onClose: () => void;
}

/**
 * The import wizard.
 *
 * @param props See {@link ImportWizardProps}.
 * @returns The dialog.
 */
export function ImportWizard({ source, aliasNames, onClose }: ImportWizardProps) {
  const router = useRouter();
  const ids = useId();

  const [reading, setReading] = useState<CandidatesReading | null>(null);
  const [rows, setRows] = useState<readonly CandidateRow[]>([]);
  const [step, setStep] = useState<StepIndex>(1);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startWriting] = useTransition();

  const connectionId = source.id;

  /**
   * Read the connection's candidates, once, on mount.
   *
   * An effect rather than a call in the menu row's `onClick`, because the answer is this
   * component's state and splitting it across the opener would put half the wizard in the menu.
   * It resets nothing first — **mounting is opening** (see {@link ImportWizardProps.source}), so
   * every piece of state above is already at its initial value, and a second connection is a
   * second mount rather than a reset this file has to remember to perform.
   *
   * The flag is what stops a late answer from landing in a wizard the reader has already
   * closed: a Server Action's round trip cannot be cancelled, so what is available is to ignore
   * it.
   */
  useEffect(() => {
    let current = true;

    void readCandidates(connectionId).then((answer) => {
      if (!current) return;

      setReading(answer);
      setRows(answer.ok ? candidateRows(answer.candidates) : []);
    });

    return () => { current = false; };
  }, [connectionId]);

  const problems = rowProblems(rows, aliasNames);
  const picked = chosen(rows);

  /**
   * Move one row's tick.
   *
   * @param modelId Which row.
   * @param selected Whether it is now ticked.
   */
  function tick(modelId: string, selected: boolean): void {
    setRows((held) => held.map((row) => (row.modelId === modelId ? { ...row, selected } : row)));
  }

  /**
   * Rename one row.
   *
   * @param modelId Which row.
   * @param name What is now in its box.
   */
  function rename(modelId: string, name: string): void {
    setRows((held) => held.map((row) => (row.modelId === modelId ? { ...row, name } : row)));
  }

  /** Send the batch. */
  function create(): void {
    if (pending) return;

    const request = importRequest(connectionId, rows);

    setFailure(null);

    startWriting(async () => {
      const outcome: ImportOutcome = await importAliases(request.body);

      if (!outcome.ok) {
        // Back to the rows, with each message on the row it belongs to — and nothing created,
        // which is what the sentence above the table says.
        setFailure(importFailure(outcome.refusal, request.order));
        setStep(1);
        return;
      }

      setResult(outcome.result);
      setStep(2);
    });
  }

  /** Close, re-reading the page behind only when something was actually created. */
  function close(): void {
    if (result !== null && result.created.length > 0) router.refresh();
    onClose();
  }

  const title = wizardTitle(source.name);

  return (
    <ShellOverlay label={title} onClose={close} open>
      <h2 className="shell-overlay__title">{title}</h2>
      <Steps current={result === null ? step : 2} />

      {result !== null ? (
        <DoneStep onDone={close} result={result} />
      ) : reading === null ? (
        <p className="registry-wizard__state" role="status">
          {CANDIDATES_LOADING}
        </p>
      ) : !reading.ok ? (
        <p className="registry-wizard__state" role="alert">
          {reading.reason}
        </p>
      ) : reading.empty !== null ? (
        <EmptyStep message={reading.empty.message} onClose={close} />
      ) : step === 1 ? (
        <ChooseStep
          failure={failure}
          idPrefix={ids}
          onCancel={close}
          onNext={() => { setStep(2); }}
          onRename={rename}
          onSelectAll={(select) => { setRows((held) => selectAll(held, select)); }}
          onTick={tick}
          problems={problems}
          rows={rows}
        />
      ) : (
        <PreviewStep
          onBack={() => { setStep(1); }}
          onCreate={create}
          pending={pending}
          rows={picked}
        />
      )}
    </ShellOverlay>
  );
}

/**
 * The modifier each step state adds.
 *
 * Every state has one — a step never falls back to another's treatment — and the names are
 * written out rather than interpolated for the reason `HEALTH_TONE_CLASS` is
 * (`app/registry/registry-table.tsx`): the sheet's own suite looks for each class rendered
 * somewhere, and a class that only ever exists inside a template string is a class it cannot
 * find.
 */
const STEP_CLASS: Record<StepState, string> = {
  done: "registry-wizard__step--done",
  current: "registry-wizard__step--current",
  todo: "registry-wizard__step--todo",
};

/**
 * The step list.
 *
 * An ordered list rather than a row of divs, because it is one: three steps in a sequence, and
 * a screen reader announcing *"list, 3 items"* is telling the reader something true. The
 * current step carries `aria-current`, which is what makes *where am I* answerable without
 * seeing the accent.
 *
 * @param props.current Which step the reader is on.
 * @returns The list.
 */
function Steps({ current }: Readonly<{ current: StepIndex }>) {
  return (
    <ol aria-label={STEPS_LABEL} className="registry-wizard__steps">
      {IMPORT_STEPS.map((label, index) => {
        const state = stepState(index, current);

        return (
          <li
            aria-current={state === "current" ? "step" : undefined}
            className={cx("registry-wizard__step", STEP_CLASS[state])}
            key={label}
          >
            {label}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The candidates step: the table, the **select all** affordance, and the way on.
 *
 * @param props.rows The rows as they stand.
 * @param props.problems What is wrong with which rows, before the service is asked.
 * @param props.failure What the service said, if it has been asked and refused.
 * @param props.idPrefix The prefix every control's id is built from.
 * @param props.onTick Called with a row's model id and its new tick.
 * @param props.onRename Called with a row's model id and its new name.
 * @param props.onSelectAll Called with whether to tick everything or nothing.
 * @param props.onNext Move to the review.
 * @param props.onCancel Close without writing.
 * @returns The step.
 */
function ChooseStep({
  rows,
  problems,
  failure,
  idPrefix,
  onTick,
  onRename,
  onSelectAll,
  onNext,
  onCancel,
}: Readonly<{
  rows: readonly CandidateRow[];
  problems: Readonly<Record<string, RowProblem>>;
  failure: ImportFailure | null;
  idPrefix: string;
  onTick: (modelId: string, selected: boolean) => void;
  onRename: (modelId: string, name: string) => void;
  onSelectAll: (select: boolean) => void;
  onNext: () => void;
  onCancel: () => void;
}>) {
  const picked = chosen(rows);
  const unresolved = Object.keys(problems).length > 0;

  const columns: readonly Column<CandidateRow>[] = [
    {
      key: "import",
      header: (
        // The heading keeps its word *and* carries the affordance: the checkbox is named for
        // what it does rather than by the column it sits in, so a reader hears "Import" as the
        // column and "Select every model that is not already named" as the control.
        <span className="registry-wizard__all">
          <input
            aria-label={SELECT_ALL_LABEL}
            checked={allSelected(rows)}
            className="registry-wizard__checkbox"
            onChange={(event) => { onSelectAll(event.currentTarget.checked); }}
            type="checkbox"
          />
          {COLUMN_IMPORT}
        </span>
      ),
      className: "registry-wizard__tick",
      cell: (row) => (
        <input
          aria-label={rowSelectLabel(row.modelId)}
          checked={row.selected}
          className="registry-wizard__checkbox"
          // A real `disabled`, not the `aria-disabled` a button takes: the house rule
          // (`app/ui/field.tsx`) is that a *form control* which accepts input and then discards
          // it is worse than one that does not, and that it keeps its explanation beside it
          // rather than in a tooltip only a focused control could show. The explanation here is
          // the row's own `aliased: …` mark, two cells away and visible to everybody. The
          // service would skip this model anyway, reported rather than silently.
          disabled={!selectable(row)}
          onChange={(event) => { onTick(row.modelId, event.currentTarget.checked); }}
          type="checkbox"
        />
      ),
    },
    {
      key: "model",
      header: COLUMN_MODEL,
      mono: true,
      className: "registry-wizard__model",
      cell: (row) => (
        <>
          {row.display}
          {row.aliased !== null && (
            <span className="registry-wizard__aliased">{aliasedMark(row.aliased)}</span>
          )}
        </>
      ),
    },
    {
      key: "alias",
      header: COLUMN_ALIAS,
      className: "registry-wizard__name",
      cell: (row) => <NameCell idPrefix={idPrefix} onRename={onRename} problems={problems} row={row} failure={failure} />,
    },
    {
      key: "price",
      header: COLUMN_PRICE,
      align: "end",
      mono: true,
      className: "registry-wizard__price",
      cell: (row) => <span title={row.provenance ?? undefined}>{row.price}</span>,
    },
    {
      key: "capabilities",
      header: COLUMN_CAPABILITIES,
      className: "registry-wizard__caps",
      cell: (row) => row.capabilities,
    },
  ];

  return (
    <>
      <p className="shell-overlay__note">{CHOOSE_NOTE}</p>

      {failure !== null && (
        <p className="registry-wizard__failure" role="alert">
          {failure.message}
        </p>
      )}

      <Table
        caption={CANDIDATES_CAPTION}
        captionHidden
        className="registry-wizard__table"
        columns={columns}
        rowClassName={(row) => row.aliased !== null && "registry-wizard__row--aliased"}
        rowKey={(row) => row.modelId}
        rows={rows}
      />

      <div className="registry-wizard__actions">
        <Button
          onClick={onNext}
          reason={picked.length === 0 ? NOTHING_CHOSEN : unresolved ? FIX_ROWS : undefined}
          tone="primary"
          type="button"
        >
          {REVIEW_NEXT}
        </Button>
        <Button onClick={onCancel} tone="ghost" type="button">
          {IMPORT_CANCEL}
        </Button>
      </div>
    </>
  );
}

/**
 * One row's name box, with whatever is wrong with it underneath.
 *
 * The service's message wins over the browser's guess when both exist: the reader has just
 * pressed **Create**, and the sentence they need is the one that explains why nothing was
 * created.
 *
 * @param props.row The row.
 * @param props.problems What the browser found.
 * @param props.failure What the service said.
 * @param props.idPrefix The prefix every control's id is built from.
 * @param props.onRename Called with the row's model id and its new name.
 * @returns The cell.
 */
function NameCell({
  row,
  problems,
  failure,
  idPrefix,
  onRename,
}: Readonly<{
  row: CandidateRow;
  problems: Readonly<Record<string, RowProblem>>;
  failure: ImportFailure | null;
  idPrefix: string;
  onRename: (modelId: string, name: string) => void;
}>) {
  const served = failure?.rows[row.modelId];
  const problem = problems[row.modelId];
  const message =
    served !== undefined && served.length > 0
      ? served.join(" ")
      : problem === undefined
        ? undefined
        : rowError(problem);
  const controlId = `${idPrefix}-${row.modelId}`;

  return (
    <TextField
      autoComplete="off"
      className="registry-wizard__name-field"
      error={message}
      id={controlId}
      // The column heading is what a sighted reader reads this box by, so the field's own
      // `<label>` is the same name said once for everybody else — visually hidden rather than
      // absent, because the #46 field requires a real `<label for>` and a box named only by
      // the column above it is named by nothing.
      label={<span className="sr-only">{rowNameLabel(row.modelId)}</span>}
      mono
      onChange={(event) => { onRename(row.modelId, event.currentTarget.value); }}
      spellCheck={false}
      type="text"
      value={row.name}
    />
  );
}

/**
 * The review step: exactly what will be created, by name.
 *
 * A list of names rather than the table again, because the question this step answers is
 * different — not *which models* but *which aliases*, which is what routes will point at and
 * what a reader is being asked to commit to.
 *
 * @param props.rows The ticked rows.
 * @param props.pending Whether the write is in flight.
 * @param props.onCreate Send the batch.
 * @param props.onBack Back to the candidates.
 * @returns The step.
 */
function PreviewStep({
  rows,
  pending,
  onCreate,
  onBack,
}: Readonly<{
  rows: readonly CandidateRow[];
  pending: boolean;
  onCreate: () => void;
  onBack: () => void;
}>) {
  return (
    <>
      <p className="shell-overlay__note">{previewSummary(rows.length)}</p>

      <ul aria-label={PREVIEW_LABEL} className="registry-wizard__preview">
        {rows.map((row) => (
          <li className="registry-wizard__preview-row" key={row.modelId}>
            <Chip mono tone="accent">
              {row.name.trim()}
            </Chip>
            <span className="registry-wizard__preview-model">{row.display}</span>
            <span className="registry-wizard__preview-price">{row.price}</span>
          </li>
        ))}
      </ul>

      {pending && (
        <p className="registry-wizard__state" role="status">
          {IMPORTING}
        </p>
      )}

      <div className="registry-wizard__actions">
        <Button
          onClick={onCreate}
          reason={pending ? IMPORTING : undefined}
          tone="primary"
          type="button"
        >
          {IMPORT_SUBMIT}
        </Button>
        <Button onClick={onBack} tone="ghost" type="button">
          {REVIEW_BACK}
        </Button>
      </div>
    </>
  );
}

/**
 * The done step: what happened, including the zero.
 *
 * A re-run that created nothing is a **success**, and saying so plainly — *0 aliases created ·
 * 3 already named, and passed over* — is what stops an operator from running it again to see
 * whether it worked.
 *
 * @param props.result What the service answered.
 * @param props.onDone Close, and re-read the table behind.
 * @returns The step.
 */
function DoneStep({
  result,
  onDone,
}: Readonly<{ result: ImportResult; onDone: () => void }>) {
  return (
    <>
      <h3 className="registry-wizard__subtitle">{IMPORTED_TITLE}</h3>
      <p className="shell-overlay__note" role="status">
        {importSummary(result)}
      </p>

      {result.created.length > 0 && (
        <ul aria-label={PREVIEW_LABEL} className="registry-wizard__preview">
          {result.created.map((created) => (
            <li className="registry-wizard__preview-row" key={created.alias.id}>
              <Chip mono tone="accent">
                {created.alias.alias}
              </Chip>
              <span className="registry-wizard__preview-model">{created.alias.modelId}</span>
            </li>
          ))}
        </ul>
      )}

      {result.skipped.length > 0 && (
        <ul aria-label={SKIPPED_LABEL} className="registry-wizard__skipped">
          {result.skipped.map((skipped) => (
            <li key={skipped.modelId}>
              <Tag>{skippedLine(skipped.modelId, skipped.alias.alias)}</Tag>
            </li>
          ))}
        </ul>
      )}

      <div className="registry-wizard__actions">
        <Button onClick={onDone} tone="primary" type="button">
          {IMPORT_DONE}
        </Button>
      </div>
    </>
  );
}

/**
 * The empty state: the connection reported nothing, and where to do something about it.
 *
 * The service's own sentence names the connection, so it is drawn rather than paraphrased; the
 * link is the application's, spelled from `app/paths.ts` — the server's `fix` is the *trigger*,
 * and the route is this product's to write down in one place.
 *
 * @param props.message The service's sentence.
 * @param props.onClose Close.
 * @returns The step.
 */
function EmptyStep({
  message,
  onClose,
}: Readonly<{ message: string; onClose: () => void }>) {
  return (
    <>
      <EmptyState note={message} title={EMPTY_TITLE}>
        <Link className="registry-wizard__link" href={EMPTY_HREF}>
          {EMPTY_LINK}
        </Link>
      </EmptyState>

      <div className="registry-wizard__actions">
        <Button onClick={onClose} tone="ghost" type="button">
          {IMPORT_CANCEL}
        </Button>
      </div>
    </>
  );
}

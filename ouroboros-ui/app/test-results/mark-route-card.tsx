"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, type Ref, useId } from "react";

import type { FailureClass } from "@/app/api/test-results";
import { Button, Card, CardHead, Eyebrow, Tag, TextAreaField, Toggle, cx } from "@/app/ui";

import type { FailureEntry } from "./failure";
import {
  CLASSIFY_LEGEND,
  type FormView,
  KEEP_DECISION_LABEL,
  MARK_ROUTE_ID,
  MARK_ROUTE_TITLE,
  MAX_NOTE_LENGTH,
  NOTE_LABEL,
  RECEIPT_EYEBROW,
  RECEIPT_LABEL,
  RECLASSIFY_LABEL,
  RECORDED_EYEBROW,
  STAGED_LABEL,
  STAGED_NOTE,
  STAGED_UNOPENABLE,
  type ToggleField,
  type ToggleView,
  VIEWER_NOTE,
  WAIVE_LABEL,
  type WorklistRow,
} from "./mark-route";
import {
  NOTHING_DISPATCHED,
  type ReceiptView,
  type RecordedView,
  type WaiverView,
} from "./mark-route-decision";

/** What the card is told. */
export interface MarkRouteCardProps {
  /** The failure being decided — the one on the failure-detail card — or `null`. */
  readonly target: FailureEntry | null;
  /** What the card says in place of a decision while there is no failure to decide. */
  readonly empty: string;
  /** The staged failed set, or `null` when nothing is staged. */
  readonly worklist: readonly WorklistRow[] | null;
  /** A staged failure was chosen. */
  readonly onPick: (caseId: string) => void;
  /** The failure's recorded decision, or `null` while it is undecided. */
  readonly recorded: RecordedView | null;
  /** Whether the form is open over a recorded decision. */
  readonly editing: boolean;
  /** The form, from `formView`. */
  readonly form: FormView;
  /** The note as typed. */
  readonly note: string;
  /** A radio was pressed. */
  readonly onChoose: (value: FailureClass) => void;
  /** The note changed. */
  readonly onNote: (text: string) => void;
  /** The primary action was pressed. */
  readonly onSubmit: () => void;
  /** *Re-classify* was pressed. */
  readonly onReclassify: () => void;
  /** The form over a recorded decision was left. */
  readonly onKeep: () => void;
  /** Why the last decision was not recorded, or `null`. */
  readonly refusal: string | null;
  /** Whether the reader may classify and set the toggles — owner, admin or member. */
  readonly mayClassify: boolean;
  /** The two toggles, or `null` while the timeline has not been read. */
  readonly toggles: readonly ToggleView[] | null;
  /** A toggle was pressed. */
  readonly onToggle: (field: ToggleField) => void;
  /** Why the last toggle was not stored, or `null`. */
  readonly toggleRefusal: string | null;
  /** Whether the reader may waive — owner or admin. The action is not drawn otherwise. */
  readonly mayWaive: boolean;
  /** *Waive & annotate PR* was pressed — the panel opens its dialog. */
  readonly onWaive: () => void;
  /** The waiver this reader just recorded for the failure, or `null`. */
  readonly waiver: WaiverView | null;
  /** The region, for the screen to scroll to and focus. */
  readonly ref?: Ref<HTMLElement>;
}

/**
 * The routed receipt — what was dispatched, as evidence.
 *
 * @param props.receipt The receipt, from `receiptView`.
 * @returns The control's id, the attempt it opens as a link into the run console, and when.
 */
function Receipt({ receipt }: Readonly<{ receipt: ReceiptView }>) {
  return (
    <div aria-label={RECEIPT_LABEL} className="tests-route__receipt" role="group">
      <Eyebrow>{RECEIPT_EYEBROW}</Eyebrow>
      <dl className="tests-route__facts">
        <div className="tests-route__fact">
          <dt className="tests-route__key">Route</dt>
          <dd className="tests-route__value">{receipt.headline}</dd>
        </div>
        {receipt.controlId !== null && (
          <div className="tests-route__fact">
            <dt className="tests-route__key">Control</dt>
            <dd className="tests-route__value tests-route__value--mono">{receipt.controlId}</dd>
          </div>
        )}
        {receipt.attempt !== null && (
          <div className="tests-route__fact">
            <dt className="tests-route__key">Target</dt>
            <dd className="tests-route__value">
              <Link className="tests-route__link" href={receipt.attempt.href}>
                <span>{`${receipt.attempt.label} ↗`}</span>
              </Link>
            </dd>
          </div>
        )}
        {receipt.rerunJobId !== null && (
          <div className="tests-route__fact">
            <dt className="tests-route__key">Build</dt>
            <dd className="tests-route__value tests-route__value--mono">{receipt.rerunJobId}</dd>
          </div>
        )}
        {receipt.time !== null && (
          <div className="tests-route__fact">
            <dt className="tests-route__key">Dispatched</dt>
            <dd className="tests-route__value">
              <time dateTime={receipt.at}>{`${receipt.time} UTC`}</time>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * A recorded decision — what was decided, by whom, and what it dispatched.
 *
 * @param props.recorded The decision, from `recordedView`.
 * @returns The decision, its note and its receipt.
 */
function Recorded({ recorded }: Readonly<{ recorded: RecordedView }>) {
  return (
    <div className="tests-route__recorded">
      <Eyebrow>{RECORDED_EYEBROW}</Eyebrow>
      <p className="tests-route__decision">
        <span className="tests-route__class">{recorded.classLabel}</span>
        <span>{` · by ${recorded.actor}`}</span>
        {recorded.time !== null && (
          <>
            <span>{" · "}</span>
            <time dateTime={recorded.at}>{`${recorded.time} UTC`}</time>
          </>
        )}
      </p>
      {recorded.note !== null && <p className="tests-route__quote">{recorded.note}</p>}
      {recorded.supersedes !== null && (
        <p className="tests-route__note">{`Replaced: ${recorded.supersedes}`}</p>
      )}
      {recorded.receipt !== null && <Receipt receipt={recorded.receipt} />}
      {recorded.flagged !== null && <p className="tests-route__note">{recorded.flagged}</p>}
      {recorded.receipt === null && recorded.flagged === null && (
        <p className="tests-route__note">{NOTHING_DISPATCHED}</p>
      )}
      {recorded.skipped.length > 0 && (
        <ul aria-label="What routing could not do" className="tests-route__skipped">
          {recorded.skipped.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What holds the card's controls, in the mockup's order — fields, toggles, then one row of
 * actions. A form while there is a decision to send, so Enter in a radio sends it as the button
 * does; otherwise a plain block, because a form with nothing to submit is a control that lies.
 *
 * @param props.onSubmit The form's submission, or `null` when there is nothing to send.
 * @param props.children The controls.
 * @returns The form, or the block.
 */
function Frame({
  onSubmit,
  children,
}: Readonly<{
  onSubmit: ((event: FormEvent<HTMLFormElement>) => void) | null;
  children: ReactNode;
}>) {
  return onSubmit === null ? (
    <div className="tests-route__body">{children}</div>
  ) : (
    <form className="tests-route__body" noValidate onSubmit={onSubmit}>
      {children}
    </form>
  );
}

/**
 * The Mark & Route card ([#340](https://github.com/NobuData/ouroboros/issues/340)) — mockup 11's
 * decision surface: the classify radios with their honest affix, the correction note, the two PR
 * toggles, and the actions that dispatch.
 *
 * Every sentence and every decision is `mark-route.ts`'s; this file only draws.
 *
 * **After routing it is not a blank form.** A decided failure shows what was decided, by whom and
 * what was dispatched — the receipt — with *Re-classify* to decide again; the form then opens over
 * the decision it would replace.
 *
 * **What a reader may not do is not offered.** A viewer is shown the decisions and the toggles,
 * read-only and said to be; a member is shown no waive action at all. The service refuses both
 * whatever this draws.
 *
 * **Every control is labelled.** The radios are a fieldset under its legend, the note is a
 * labelled field whose hint and error are its description, and each switch is named by what
 * pressing it does and described by where its enforcement stands — which is its tooltip too.
 *
 * @param props See {@link MarkRouteCardProps}.
 * @returns The card.
 */
export function MarkRouteCard({
  target,
  empty,
  worklist,
  onPick,
  recorded,
  editing,
  form,
  note,
  onChoose,
  onNote,
  onSubmit,
  onReclassify,
  onKeep,
  refusal,
  mayClassify,
  toggles,
  onToggle,
  toggleRefusal,
  mayWaive,
  onWaive,
  waiver,
  ref,
}: MarkRouteCardProps) {
  const titleId = useId();
  const radioName = useId();
  const noteId = useId();
  const showForm = target !== null && mayClassify && (recorded === null || editing);

  /**
   * Send the decision, from the button or from Enter in a radio.
   *
   * @param event The form's submission.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (form.reason === null) onSubmit();
  }

  return (
    <section
      aria-labelledby={titleId}
      className="tests-route"
      id={MARK_ROUTE_ID}
      ref={ref}
      tabIndex={-1}
    >
      <Card>
        <CardHead
          title={MARK_ROUTE_TITLE}
          titleId={titleId}
          trailing={
            target === null ? undefined : (
              <Tag title={`${target.suite} › ${target.name}`}>
                <span>{target.name}</span>
              </Tag>
            )
          }
        />

        {worklist !== null && (
          <div className="tests-route__staged">
            <p className="tests-route__note">{STAGED_NOTE}</p>
            <ul aria-label={STAGED_LABEL} className="tests-route__list">
              {worklist.map((row) => (
                <li className="tests-route__item" key={row.caseId}>
                  {row.state === "openable" ? (
                    <button
                      aria-current={row.bound ? "true" : undefined}
                      className="tests-route__pick"
                      onClick={() => onPick(row.caseId)}
                      type="button"
                    >
                      {row.text}
                    </button>
                  ) : (
                    <span className="tests-route__unopenable">
                      {row.state === "unread" ? row.text : `${row.text} — ${STAGED_UNOPENABLE}`}
                    </span>
                  )}
                  {row.decided !== null && (
                    <Tag>
                      <span>{row.decided}</span>
                    </Tag>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {target === null && <p className="tests-route__note">{empty}</p>}

        {target !== null && recorded !== null && <Recorded recorded={recorded} />}

        {target !== null && !mayClassify && <p className="tests-route__note">{VIEWER_NOTE}</p>}

        <Frame onSubmit={showForm ? submit : null}>
          {showForm && (
            <>
              <fieldset className="tests-route__classes">
                <legend className="tests-route__legend">{CLASSIFY_LEGEND}</legend>
                {form.radios.map((radio) => (
                  <label
                    className={cx("tests-route__radio", radio.checked && "tests-route__radio--on")}
                    key={radio.value}
                  >
                    <input
                      checked={radio.checked}
                      className="tests-route__input"
                      name={radioName}
                      onChange={() => onChoose(radio.value)}
                      type="radio"
                      value={radio.value}
                    />
                    <span className="tests-route__name">{radio.label}</span>
                    {radio.affix !== null && (
                      <span className="tests-route__affix" title={radio.affixTitle ?? undefined}>
                        {radio.affix}
                      </span>
                    )}
                  </label>
                ))}
              </fieldset>

              <TextAreaField
                aria-required={form.noteRequired}
                error={form.noteError ?? undefined}
                hint={form.noteHint}
                id={noteId}
                label={NOTE_LABEL}
                maxLength={MAX_NOTE_LENGTH}
                onChange={(event) => onNote(event.currentTarget.value)}
                rows={3}
                value={note}
              />

              {refusal !== null && (
                <p className="tests-route__error" role="alert">
                  {refusal}
                </p>
              )}
            </>
          )}

          {toggles !== null && (
            <div className="tests-route__toggles">
              {toggles.map((toggle) => (
                <ToggleRow key={toggle.field} onToggle={onToggle} toggle={toggle} />
              ))}
              {toggleRefusal !== null && (
                <p className="tests-route__error" role="alert">
                  {toggleRefusal}
                </p>
              )}
            </div>
          )}

          {waiver !== null && (
            <div className="tests-route__waiver" role="status">
              <p className="tests-route__decision">{waiver.headline}</p>
              <p className="tests-route__quote">{waiver.reason}</p>
              {waiver.annotation !== null && (
                <p className="tests-route__note">{waiver.annotation}</p>
              )}
            </div>
          )}

          {target !== null && (mayClassify || mayWaive) && (
            <div className="tests-route__actions">
              {showForm && (
                <Button reason={form.reason ?? undefined} tone="primary" type="submit">
                  {form.primary}
                </Button>
              )}
              {showForm && recorded !== null && (
                <Button onClick={onKeep} tone="ghost" type="button">
                  {KEEP_DECISION_LABEL}
                </Button>
              )}
              {!showForm && recorded !== null && mayClassify && (
                <Button onClick={onReclassify} tone="default" type="button">
                  {RECLASSIFY_LABEL}
                </Button>
              )}
              {mayWaive && (
                <Button aria-haspopup="dialog" onClick={onWaive} tone="ghost" type="button">
                  {WAIVE_LABEL}
                </Button>
              )}
            </div>
          )}
        </Frame>
      </Card>
    </section>
  );
}

/**
 * One toggle's row: its words, where its enforcement stands, and the switch.
 *
 * The note is the `ⓘ`'s tooltip for a pointer and the switch's description for a screen reader,
 * as the run console's guardrail rows draw theirs.
 *
 * @param props.toggle The toggle, from `togglesView`.
 * @param props.onToggle A toggle was pressed.
 * @returns The row.
 */
function ToggleRow({
  toggle,
  onToggle,
}: Readonly<{ toggle: ToggleView; onToggle: (field: ToggleField) => void }>) {
  const noteId = useId();

  return (
    <div className="tests-route__toggle">
      <span className="tests-route__words">
        <span>{toggle.text}</span>
        <span className="tests-route__info" title={toggle.note}>
          <span aria-hidden>ⓘ</span>
          <span className="sr-only" id={noteId}>
            {toggle.note}
          </span>
        </span>
      </span>
      <Toggle
        checked={toggle.checked}
        describedBy={noteId}
        label={toggle.label}
        onClick={() => onToggle(toggle.field)}
        reason={toggle.reason ?? undefined}
      />
    </div>
  );
}

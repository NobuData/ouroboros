"use client";

import Link from "next/link";
import { type Ref, useId } from "react";

import { POLICIES_PATH } from "@/app/paths";
import { POLICIES_LINK_LABEL } from "@/app/policies/view";
import {
  Button,
  Card,
  CardHead,
  Chip,
  SelectField,
  Tag,
  TextAreaField,
  Toggle,
  cx,
} from "@/app/ui";

import {
  DISCARD_MESSAGE,
  MAX_COMMIT_MESSAGE_LENGTH,
  MESSAGE_HINT,
  MESSAGE_LABEL,
  MESSAGE_MOVED,
  MESSAGE_PREVIEW_LABEL,
  type MessageDraft,
  SAVE_MESSAGE,
  unsendable,
} from "./merge-message";
import {
  ARMED_WORD,
  DISARM_LABEL,
  EDIT_POLICY_LINK,
  EPIC_LABEL,
  MERGED_WORD,
  MERGE_PLAN_ID,
  MERGE_PLAN_TITLE,
  type MergePlanCardView,
  NO_EPIC,
  PLAN_SENDING,
  type PlanNotice,
  STRATEGY_LABEL,
  type ToggleView,
} from "./merge-plan";

/** What the card is told. */
export interface MergePlanCardProps {
  /** The card, from `mergePlanCard`. */
  readonly view: MergePlanCardView;
  /** The unsaved edit of the message, or `null`. */
  readonly draft: MessageDraft | null;
  /** The message field changed. */
  readonly onDraft: (text: string) => void;
  /** *Save message* was pressed. */
  readonly onSave: () => void;
  /** *Discard* was pressed. */
  readonly onDiscard: () => void;
  /** A switch was pressed. */
  readonly onToggle: (field: ToggleView["field"]) => void;
  /** An epic was chosen — `null` for *No epic*. */
  readonly onEpic: (epicId: string | null) => void;
  /** The primary control was pressed — the screen opens its confirmation. */
  readonly onPrimary: () => void;
  /** *Disarm* was pressed. */
  readonly onDisarm: () => void;
  /** Whether a change is in flight — every control waits. */
  readonly sending: boolean;
  /** What became of the last press, or `null`. */
  readonly notice: PlanNotice | null;
  /** The region, for the screen to scroll to and focus. */
  readonly ref?: Ref<HTMLElement>;
}

/**
 * The Merge plan card ([#369](https://github.com/NobuData/ouroboros/issues/369)) — mockup 12's
 * merge plan: the strategy, the editable message, three switches, who the merge is made as, and
 * the control that arms it.
 *
 * Every sentence and every decision is `merge-plan.ts`'s and its neighbours'; this file only
 * draws. A control the reader may not use is drawn read-only with its reason rather than hidden —
 * a plan with no visible settings would read as one that has none — except the two that act:
 * arming and disarming are not drawn at all for a reader who may not.
 *
 * **Nothing is armed from here.** The primary control opens the confirmation that states the
 * terms; it is the confirmation that sends.
 *
 * The message is drawn in full and wraps, so the card never scrolls inside itself.
 *
 * @param props See {@link MergePlanCardProps}.
 * @returns The card.
 */
export function MergePlanCard({
  view,
  draft,
  onDraft,
  onSave,
  onDiscard,
  onToggle,
  onEpic,
  onPrimary,
  onDisarm,
  sending,
  notice,
  ref,
}: MergePlanCardProps) {
  const titleId = useId();
  const messageId = useId();
  const epicId = useId();
  const warningId = useId();
  const waiting = sending ? PLAN_SENDING : undefined;
  const blocked = draft === null ? null : unsendable(draft);
  const moved = draft !== null && draft.base !== view.message;

  return (
    <section
      aria-labelledby={titleId}
      className={cx("prv-merge", view.armed !== null && "prv-merge--armed")}
      id={MERGE_PLAN_ID}
      ref={ref}
      tabIndex={-1}
    >
      <Card>
        <CardHead
          beside={
            view.armed !== null ? (
              <Chip dot="pulse" tone="accent">
                {ARMED_WORD}
              </Chip>
            ) : view.receipt !== null ? (
              <Chip tone="ok">{MERGED_WORD}</Chip>
            ) : undefined
          }
          title={MERGE_PLAN_TITLE}
          titleId={titleId}
          trailing={
            view.policy === null ? undefined : (
              <Link className="prv-gates__link" href={view.policy}>
                {EDIT_POLICY_LINK}
              </Link>
            )
          }
        />

        {view.receipt !== null && (
          <div className="prv-merge__receipt">
            <p className="prv-merge__receipt-line">
              <span className="prv-merge__sha">{view.receipt.sha}</span>
              <span>{` · merged as `}</span>
              <span className="prv-merge__identity">{view.receipt.identity}</span>
              {view.receipt.time !== null && (
                <>
                  <span>{" · "}</span>
                  <time dateTime={view.receipt.at}>{view.receipt.time}</time>
                </>
              )}
            </p>
            {view.receipt.ran.length > 0 && (
              <p className="prv-merge__ran">{`Ran: ${view.receipt.ran.join(" · ")}`}</p>
            )}
            {view.receipt.skipped.length > 0 && (
              <ul aria-label="Switched on, and did not run" className="prv-merge__skipped">
                {view.receipt.skipped.map((skipped) => (
                  <li className="prv-merge__skipped-row" key={skipped.action}>
                    {`Did not run: ${skipped.label}`}
                    {skipped.detail !== null && ` — ${skipped.detail}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {view.note !== null && (
          <p className="prv-merge__note" role="note">
            {view.note}
          </p>
        )}

        {view.armed !== null && (
          <div className="prv-merge__armed">
            <p className="prv-merge__terms">{view.armed.terms}</p>
            {(view.armed.against !== null || view.armed.time !== null) && (
              <p className="prv-merge__meta">
                {view.armed.against !== null && <span>{view.armed.against}</span>}
                {view.armed.against !== null && view.armed.time !== null && <span>{" · "}</span>}
                {view.armed.time !== null && view.armed.at !== null && (
                  <time dateTime={view.armed.at}>{`armed ${view.armed.time}`}</time>
                )}
              </p>
            )}
            {view.armed.stale !== null && (
              <p className="prv-merge__warning" role="status">
                {view.armed.stale}
              </p>
            )}
          </div>
        )}

        {view.disarmed !== null && (
          <div className="prv-merge__disarmed" role="status">
            <p className="prv-merge__disarmed-head">{`Disarmed — ${view.disarmed.headline}`}</p>
            <p className="prv-merge__disarmed-text">{view.disarmed.message}</p>
            <p className="prv-merge__disarmed-text">{view.disarmed.next}</p>
          </div>
        )}

        <div className="prv-merge__row">
          <span className="prv-merge__key">{STRATEGY_LABEL}</span>
          <Tag>
            <span>{view.strategy}</span>
          </Tag>
        </div>

        <div className="prv-merge__message">
          {view.editable ? (
            <>
              <TextAreaField
                aria-describedby={view.close.kind === "agrees" ? undefined : warningId}
                error={blocked ?? undefined}
                hint={MESSAGE_HINT}
                id={messageId}
                label={MESSAGE_LABEL}
                maxLength={MAX_COMMIT_MESSAGE_LENGTH}
                mono
                onChange={(event) => onDraft(event.currentTarget.value)}
                rows={5}
                value={draft?.text ?? view.message}
              />
              {moved && (
                <p className="prv-merge__warning" role="status">
                  {MESSAGE_MOVED}
                </p>
              )}
              {draft !== null && (
                <div className="prv-merge__actions">
                  <Button
                    onClick={onSave}
                    reason={waiting ?? blocked ?? undefined}
                    size="sm"
                    tone="primary"
                  >
                    {SAVE_MESSAGE}
                  </Button>
                  <Button onClick={onDiscard} reason={waiting} size="sm" tone="ghost">
                    {DISCARD_MESSAGE}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="prv-merge__key">{MESSAGE_PREVIEW_LABEL}</p>
              <p className="prv-merge__preview">{view.message}</p>
            </>
          )}
          {view.close.kind !== "agrees" && (
            <p className="prv-merge__warning" id={warningId} role="status">
              {view.close.text}
            </p>
          )}
        </div>

        {view.toggles.map((toggle) => (
          <div className="prv-merge__row" key={toggle.field}>
            <span className="prv-merge__key">{toggle.text}</span>
            <Toggle
              checked={toggle.checked}
              label={toggle.label}
              onClick={() => onToggle(toggle.field)}
              reason={toggle.reason ?? waiting}
            />
          </div>
        ))}

        <div className="prv-merge__epic">
          <SelectField
            disabled={!view.epic.enabled || sending}
            hint={view.epic.hint ?? undefined}
            id={epicId}
            label={EPIC_LABEL}
            onChange={(event) => {
              const chosen = event.currentTarget.value;

              onEpic(chosen === "" ? null : chosen);
            }}
            value={view.epic.value}
          >
            <option value="">{NO_EPIC}</option>
            {view.epic.options.map((epic) => (
              <option key={epic.id} value={epic.id}>
                {epic.name}
              </option>
            ))}
          </SelectField>
        </div>

        {view.footer !== null && <p className="prv-merge__footer">{view.footer}</p>}

        {view.dryRun !== null && (
          <div className="prv-merge__dry-run" role="note">
            <p className="prv-merge__dry-run-text">
              {view.dryRun.note}{" "}
              <Link className="prv-merge__dry-run-link" href={POLICIES_PATH}>
                {POLICIES_LINK_LABEL}
              </Link>
            </p>
            {view.dryRun.override !== null && (
              <p className="prv-merge__dry-run-text">{view.dryRun.override}</p>
            )}
          </div>
        )}

        {view.handedOff !== null && (
          <p className="prv-merge__handoff" role="status">
            {view.handedOff}
          </p>
        )}

        {(view.primary !== null || view.disarm) && (
          <div className="prv-merge__actions">
            {view.primary !== null && (
              <Button
                aria-haspopup="dialog"
                onClick={onPrimary}
                reason={view.primary.reason ?? waiting}
                tone="primary"
              >
                {view.primary.label}
              </Button>
            )}
            {view.disarm && (
              <Button onClick={onDisarm} reason={waiting} tone="default">
                {DISARM_LABEL}
              </Button>
            )}
          </div>
        )}

        {notice !== null && (
          <p
            className={cx("prv-merge__outcome", notice.failed && "prv-merge__outcome--failed")}
            role="status"
          >
            {notice.text}
          </p>
        )}
      </Card>
    </section>
  );
}

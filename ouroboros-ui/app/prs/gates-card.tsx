"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Button, Card, CardHead, Chip, Tag, cx } from "@/app/ui";

import {
  APPROVAL_SENDING,
  APPROVE_LABEL,
  DECLINE_LABEL,
  FOLLOW_LATEST,
  GATES_TITLE,
  type GateRowView,
  type GateVerdict,
  type GatesCardView,
  NO_GATES,
  REQUEST_LABEL,
  RUN_CONSOLE_LINK,
  WAIVER_AUTHOR_UNKNOWN,
  WAIVER_BUTTON,
  WAIVER_NO_REASON,
  WAIVER_TITLE,
} from "./gates";

/** The element id the gates sit at — what a link to the card is addressed to. */
export const GATES_ID = "gates";

/** The class each verdict's row takes. */
const ROW_CLASS: Record<GateVerdict, string> = {
  green: "prv-gate--green",
  red: "prv-gate--red",
  pending: "prv-gate--pending",
  waived: "prv-gate--waived",
  not_required: "prv-gate--not-required",
  unavailable: "prv-gate--unavailable",
};

/** What one row is told. */
interface GateProps {
  /** The row. */
  readonly row: GateRowView;
  /** Why the row's buttons wait, or `undefined` while they do not. */
  readonly waiting: string | undefined;
  /** *Request review* was pressed. */
  readonly onRequestReview: () => void;
  /** *Approve* was pressed. */
  readonly onApprove: () => void;
  /** *Decline* was pressed. */
  readonly onDecline: () => void;
}

/**
 * One gate: its line, and beneath a waived one the popover its button opens.
 *
 * The popover is a disclosure rather than a modal: the button says whether it is open
 * (`aria-expanded`), and Escape or a press outside the row closes it. It is drawn in the row's
 * own flow, beneath the line, so the rows' scrolling wrapper never clips it. It shows the
 * engine's line, which carries the reason, and why the gate is on the PR. The payload names no
 * author on a gate, and the popover says so rather than leaving a blank where a name belongs.
 *
 * @param props See {@link GateProps}.
 * @returns The row.
 */
function Gate({ row, waiting, onRequestReview, onApprove, onDecline }: GateProps) {
  const panelId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLLIElement>(null);
  const shown = open && row.waived;

  useEffect(() => {
    if (!shown) return;

    /** Close on Escape. */
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }

    /** Close on a press outside the row. */
    function onPress(event: MouseEvent): void {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPress);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPress);
    };
  }, [shown]);

  return (
    <li className={cx("prv-gate", ROW_CLASS[row.verdict])} ref={root}>
      <div className="prv-gate__line">
        <span aria-label={row.word} className="prv-gate__mark" role="img">
          {row.mark ?? <span className="prv-gate__dot" />}
        </span>
        <span className="prv-gate__name">{row.label}</span>
        <span className="prv-gate__evidence">{row.evidence}</span>

        {row.note !== null && <span className="prv-gate__note">{row.note}</span>}
        {row.pill !== null && <Chip tone="accent">{row.pill}</Chip>}
        {row.tag !== null && <Tag>{row.tag}</Tag>}
        {row.waived && (
          <Button
            aria-controls={shown ? panelId : undefined}
            aria-expanded={shown}
            onClick={() => setOpen((current) => !current)}
            size="sm"
            tone="ghost"
          >
            {WAIVER_BUTTON}
          </Button>
        )}

        {row.approval === "request" && (
          <Button onClick={onRequestReview} reason={waiting} size="sm" tone="ghost">
            {REQUEST_LABEL}
          </Button>
        )}
        {row.approval === "decide" && (
          <>
            <Button onClick={onApprove} reason={waiting} size="sm" tone="primary">
              {APPROVE_LABEL}
            </Button>
            <Button
              aria-haspopup="dialog"
              onClick={onDecline}
              reason={waiting}
              size="sm"
              tone="danger"
            >
              {DECLINE_LABEL}
            </Button>
          </>
        )}

        {row.link !== null && (
          <Link className="prv-gates__link" href={row.link.href}>
            {row.link.label}
          </Link>
        )}
      </div>

      {shown && (
        <div aria-labelledby={titleId} className="prv-gate__popover" id={panelId} role="group">
          <p className="prv-gate__popover-title" id={titleId}>
            {`${WAIVER_TITLE} · ${row.label}`}
          </p>
          <p className="prv-gate__popover-reason">{row.evidence ?? WAIVER_NO_REASON}</p>
          <p className="prv-gate__popover-note">{row.source}</p>
          <p className="prv-gate__popover-note">{WAIVER_AUTHOR_UNKNOWN}</p>
        </div>
      )}
    </li>
  );
}

/** What the card is told. */
export interface GatesCardProps {
  /** The card, from `gatesCard`. */
  readonly view: GatesCardView;
  /** Follow the latest revision again. */
  readonly onFollowLatest: () => void;
  /** *Request review* was pressed. */
  readonly onRequestReview: () => void;
  /** *Approve* was pressed. */
  readonly onApprove: () => void;
  /** *Decline* was pressed — the screen opens the dialog. */
  readonly onDecline: () => void;
  /** Whether an answer or a request is in flight — the row's buttons wait. */
  readonly sending: boolean;
  /** What became of the last answer, or `null`. */
  readonly outcome: { readonly text: string; readonly failed: boolean } | null;
}

/**
 * The Verification gates card ([#365](https://github.com/NobuData/ouroboros/issues/365)) —
 * mockup 12's seven rows, for the revision the strip scoped ([#364](https://github.com/NobuData/ouroboros/issues/364)).
 *
 * Every row is `gates.ts`'s; this file only draws. The mark is announced as the verdict in
 * words, so the state is never carried by hue or shape alone. `pending` is the one row that
 * moves; `unavailable` stands still and states its note.
 *
 * The rows scroll sideways inside their own wrapper, so a long evidence line never scrolls the
 * pane.
 *
 * @param props See {@link GatesCardProps}.
 * @returns The card.
 */
export function GatesCard({
  view,
  onFollowLatest,
  onRequestReview,
  onApprove,
  onDecline,
  sending,
  outcome,
}: GatesCardProps) {
  const titleId = useId();
  const waiting = sending ? APPROVAL_SENDING : undefined;

  return (
    <section aria-labelledby={titleId} className="prv-gates" id={GATES_ID}>
      <Card>
        <CardHead
          beside={view.pill === null ? undefined : <Chip tone={view.pill.tone}>{view.pill.label}</Chip>}
          title={GATES_TITLE}
          titleId={titleId}
          trailing={
            view.runConsole === null ? undefined : (
              <Link className="prv-gates__link" href={view.runConsole}>
                {RUN_CONSOLE_LINK}
              </Link>
            )
          }
        />

        <p className="prv-gates__scope">
          {view.heading}
          {view.scoped && (
            <Button onClick={onFollowLatest} size="sm" tone="ghost">
              {FOLLOW_LATEST}
            </Button>
          )}
        </p>

        {view.rows.length === 0 ? (
          <p className="prv-gates__note">{NO_GATES}</p>
        ) : (
          <div className="prv-gates__scroll">
            <ul className="prv-gates__rows">
              {view.rows.map((row) => (
                <Gate
                  key={row.key}
                  onApprove={onApprove}
                  onDecline={onDecline}
                  onRequestReview={onRequestReview}
                  row={row}
                  waiting={waiting}
                />
              ))}
            </ul>
          </div>
        )}

        {outcome !== null && (
          <p
            className={cx("prv-gates__outcome", outcome.failed && "prv-gates__outcome--failed")}
            role="status"
          >
            {outcome.text}
          </p>
        )}
      </Card>
    </section>
  );
}

"use client";

import Link from "next/link";
import { Fragment, type MouseEvent, useId, useState } from "react";

import { Button, Card, CardHead, Chip, Tag, cx } from "@/app/ui";

import {
  ADD_CLAIM_LABEL,
  ATTACH_LABEL,
  CRITERIA_SENDING,
  CRITERIA_TITLE,
  type CriteriaCardView,
  type CriteriaOutcome,
  type CriterionRowView,
  type EvidenceView,
  IMPORT_LABEL,
  NO_CRITERIA,
  OPENS_HOST,
  type StatusView,
  VERIFY_LABEL,
} from "./criteria";
import type { Hunk } from "./hunk";

/** The element id the matrix sits at — what a link to the card is addressed to. */
export const CRITERIA_ID = "criteria";

/** What one evidence line is told. */
interface EvidenceProps {
  /** The line. */
  readonly evidence: EvidenceView;
  /** A hunk reference was followed. */
  readonly onHunk: (hunk: Hunk) => void;
}

/**
 * One evidence line, leading where its reference does.
 *
 * A test, a measurement and an artifact are links. A hunk is a link too — its address names the
 * range, so it can be opened in a new tab — and a plain press brings the reader to the changed
 * files on this page instead of reloading it. An analysis note is a disclosure: the note is the
 * evidence, so it opens in place, in full, with the revision it was read on.
 *
 * @param props See {@link EvidenceProps}.
 * @returns The line.
 */
function Evidence({ evidence, onHunk }: EvidenceProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const { target, text } = evidence;

  if (target.kind === "link") {
    return (
      <Link className="prv-crit__ref" href={target.href}>
        {text}
      </Link>
    );
  }

  if (target.kind === "hunk") {
    /**
     * Follow the hunk on this page — unless the press asks for a new tab or window.
     *
     * @param event The press.
     */
    const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();
      onHunk(target.hunk);
    };

    return (
      <a
        className="prv-crit__ref prv-crit__ref--hunk"
        href={target.href}
        onClick={follow}
        title={target.where}
      >
        {text}
      </a>
    );
  }

  if (target.kind === "note") {
    return (
      <>
        <button
          aria-controls={open ? panelId : undefined}
          aria-expanded={open}
          className="prv-crit__note-toggle"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {text}
        </button>
        {open && (
          <span className="prv-crit__note" id={panelId} role="group">
            <span className="prv-crit__note-text">{text}</span>
            <span className="prv-crit__note-read">
              {target.readOn === null
                ? "Analysis note — the note is the evidence."
                : `Analysis note, read on ${target.readOn} — the note is the evidence.`}
            </span>
          </span>
        )}
      </>
    );
  }

  return <span>{text}</span>;
}

/**
 * A row's status pill — a link to the host comment when the waive's annotation is there.
 *
 * @param props.status The pill.
 * @returns The pill.
 */
function Status({ status }: Readonly<{ status: StatusView }>) {
  const pill = (
    <Chip dot={status.dot ?? undefined} tone={status.tone}>
      {status.label}
      {status.href !== null && (
        <span aria-label={OPENS_HOST} role="img">
          {" ↗"}
        </span>
      )}
    </Chip>
  );

  return status.href === null ? (
    pill
  ) : (
    <a
      className="prv-crit__pill-link"
      href={status.href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {pill}
    </a>
  );
}

/** What one row is told. */
interface RowProps {
  /** The row. */
  readonly row: CriterionRowView;
  /** Why the row's buttons wait, or `undefined` while they do not. */
  readonly waiting: string | undefined;
  /** A hunk reference was followed. */
  readonly onHunk: (hunk: Hunk) => void;
  /** *Attach evidence* was pressed. */
  readonly onAttach: (criterionId: string) => void;
  /** *Verify* was pressed. */
  readonly onVerify: (criterionId: string) => void;
  /** *Waive* was pressed. */
  readonly onWaive: (criterionId: string) => void;
}

/**
 * One claim: the quoted claim, its evidence, its pill, and beneath them what the reader may do.
 *
 * @param props See {@link RowProps}.
 * @returns The row.
 */
function Row({ row, waiting, onHunk, onAttach, onVerify, onWaive }: RowProps) {
  const acts = row.attach || row.verify !== null || row.waive !== null;

  return (
    <li className={cx("prv-crit", row.status.status === "waived" && "prv-crit--waived")}>
      <div className="prv-crit__claim-cell">
        <span className="prv-crit__claim">{row.claim}</span>
        <Tag title={row.source.title}>{row.source.label}</Tag>
      </div>

      <div className="prv-crit__evidence">
        {row.evidence.map((evidence, index) => (
          <Fragment key={evidence.id}>
            {index > 0 && " · "}
            <Evidence evidence={evidence} onHunk={onHunk} />
          </Fragment>
        ))}
        {row.waiverReason !== null && (
          <>
            {row.evidence.length > 0 && " · "}
            <span className="prv-crit__waiver">{row.waiverReason}</span>
          </>
        )}
        {row.evidence.length === 0 && row.waiverReason === null && (
          <span className="prv-crit__none">no evidence cited</span>
        )}
      </div>

      <div className="prv-crit__status">
        <Status status={row.status} />
      </div>

      {(acts || row.status.note !== null) && (
        <div className="prv-crit__foot">
          {row.status.note !== null && <p className="prv-crit__foot-note">{row.status.note}</p>}
          {row.attach && (
            <Button
              aria-haspopup="dialog"
              onClick={() => onAttach(row.id)}
              reason={waiting}
              size="sm"
              tone="ghost"
            >
              {ATTACH_LABEL}
            </Button>
          )}
          {row.verify !== null && (
            <Button
              onClick={() => onVerify(row.id)}
              reason={waiting ?? row.verify.reason}
              size="sm"
              tone="ghost"
            >
              {VERIFY_LABEL}
            </Button>
          )}
          {row.verify?.reason !== undefined && (
            <span className="prv-crit__foot-note">{row.verify.reason}</span>
          )}
          {row.waive !== null && (
            <Button
              aria-haspopup="dialog"
              onClick={() => onWaive(row.id)}
              reason={waiting}
              size="sm"
              tone="ghost"
            >
              {row.waive}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** What the card is told. */
export interface CriteriaCardProps {
  /** The card, from `criteriaCard`. */
  readonly view: CriteriaCardView;
  /** Whether a change is in flight — the card's buttons wait. */
  readonly sending: boolean;
  /** What became of the last press, or `null`. */
  readonly outcome: CriteriaOutcome | null;
  /** A hunk reference was followed — the screen brings the changed files into view. */
  readonly onHunk: (hunk: Hunk) => void;
  /** *Add claim* was pressed — the screen opens the dialog. */
  readonly onAddClaim: () => void;
  /** *Import from plan* was pressed. */
  readonly onImport: () => void;
  /** *Attach evidence* was pressed — the screen opens the picker. */
  readonly onAttach: (criterionId: string) => void;
  /** *Verify* was pressed. */
  readonly onVerify: (criterionId: string) => void;
  /** *Waive* was pressed — the screen opens the dialog. */
  readonly onWaive: (criterionId: string) => void;
}

/**
 * The acceptance criteria matrix ([#366](https://github.com/NobuData/ouroboros/issues/366)) —
 * mockup 12's *Does the PR do what the ticket says?*.
 *
 * Every row is `criteria.ts`'s; this file only draws. A status is always carried in the pill's
 * words, never by hue alone, and a link that leaves the product says so.
 *
 * The grid is the mockup's three columns — claim, evidence, pill — and collapses per its rule on
 * a narrow pane: the pill beside the claim, the evidence beneath both. It scrolls sideways inside
 * its own wrapper, so a long evidence line never scrolls the pane.
 *
 * @param props See {@link CriteriaCardProps}.
 * @returns The card.
 */
export function CriteriaCard({
  view,
  sending,
  outcome,
  onHunk,
  onAddClaim,
  onImport,
  onAttach,
  onVerify,
  onWaive,
}: CriteriaCardProps) {
  const titleId = useId();
  const waiting = sending ? CRITERIA_SENDING : undefined;

  return (
    <section aria-labelledby={titleId} className="prv-criteria" id={CRITERIA_ID}>
      <Card>
        <CardHead
          title={CRITERIA_TITLE}
          titleId={titleId}
          trailing={
            view.ticket === null ? undefined : (
              <a
                className="prv-criteria__link"
                href={view.ticket.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {view.ticket.label}
              </a>
            )
          }
        />

        <p className="prv-criteria__intro">
          {view.intro}
          {view.counts !== null && <span className="prv-criteria__counts">{view.counts}</span>}
        </p>

        {view.rows.length === 0 ? (
          <p className="prv-criteria__note">{NO_CRITERIA}</p>
        ) : (
          <div className="prv-criteria__scroll">
            <ul className="prv-criteria__rows">
              {view.rows.map((row) => (
                <Row
                  key={row.id}
                  onAttach={onAttach}
                  onHunk={onHunk}
                  onVerify={onVerify}
                  onWaive={onWaive}
                  row={row}
                  waiting={waiting}
                />
              ))}
            </ul>
          </div>
        )}

        {(view.addClaim || view.importPlan) && (
          <div className="prv-criteria__actions">
            {view.addClaim && (
              <Button
                aria-haspopup="dialog"
                onClick={onAddClaim}
                reason={waiting}
                size="sm"
                tone="default"
              >
                {ADD_CLAIM_LABEL}
              </Button>
            )}
            {view.importPlan && (
              <Button onClick={onImport} reason={waiting} size="sm" tone="ghost">
                {IMPORT_LABEL}
              </Button>
            )}
          </div>
        )}

        {outcome !== null && (
          <p
            className={cx(
              "prv-criteria__outcome",
              outcome.failed && "prv-criteria__outcome--failed",
            )}
            role="status"
          >
            {outcome.text}
          </p>
        )}
      </Card>
    </section>
  );
}

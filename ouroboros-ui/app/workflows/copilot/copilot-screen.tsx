import type { ReactNode } from "react";

import type { Role } from "@/app/api/membership";
import type { CopilotConversation } from "@/app/api/workflow-copilot";
import { Card, CardHead, EmptyState } from "@/app/ui";

import { EmptyWorkspaceActions } from "../empty-workspace-actions";
import { RAIL_FAILED_HEADLINE } from "../states";
import { StudioFailedBanner } from "../studio-banner";
import { StudioFrame } from "../studio-frame";
import { StudioReadOnlyNote } from "../studio-readonly-note";
import { WorkflowRail } from "../workflow-rail";
import { CopilotFlows, CopilotHeadActions, CopilotNotice } from "./copilot-flows";
import {
  CONVERSATION_FAILED_HEADLINE,
  COPILOT_EYEBROW,
  COPILOT_SEATS,
  COPILOT_SUBLINE,
  COPILOT_TITLE,
  type CopilotReadings,
  type CopilotSeatId,
  type CopilotState,
  PROMOTION_FAILED_HEADLINE,
  TRANSCRIPT_EMPTY,
  TRANSCRIPT_LABEL,
  type TranscriptReason,
  anchorDefinition,
  copilotSeatCopy,
  copilotState,
  seatElementId,
  transcriptLines,
  transcriptNote,
  transcriptReason,
} from "./copilot-view";

import "../workflows.css";
import "./copilot.css";

/**
 * The workflow studio's copilot (CE.1, [#565](https://github.com/NobuData/ouroboros/issues/565))
 * — `docs/mockups/20-workflow-copilot.html`'s page head, over the three regions later tickets
 * fill.
 *
 * It shares the studio's frame (`app/workflows/studio-frame.tsx`) and its rail, so the three
 * surfaces are one section with three tabs: the same sticky tab row with **Copilot** marked
 * current, the same gutter rhythm, inside the shell's content pane under the sidebar's
 * **Workflows** entry, with no navigation chrome of its own
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` supersedes the mockup's topbar). The pane is the only thing
 * that scrolls; nothing here has a height of its own to scroll inside.
 *
 * ### The head is copy, and the same in every state
 *
 * The eyebrow, the title and the subline are mockup 20's, verbatim. Unlike the canvas's head —
 * whose title is the workflow's name — nothing in them depends on a read, so a refused rail and a
 * slug the workspace does not have draw the same head and explain themselves in the body.
 *
 * ### Promote and discard are the head's two actions
 *
 * `copilot-flows.tsx` draws them, with every judgement decided in `copilot-view.ts`: whether the
 * draft can be promoted, what blocks it and what is only flagged, and whether there is anything
 * to discard. Both are drawn for every reader and are inert, with the reason, for one who may not
 * act.
 *
 * ### What is seated rather than drawn
 *
 * The conversation (CE.2, #566), the draft's stage list (CE.3, #567) and the dry-run card (CE.4,
 * #568) are later tickets. Each has a **labelled seat** in mockup 20's two columns — the
 * conversation on the left, the stage list over the dry run on the right — that says which issue
 * fills it. No bubble, stage row or result is faked. A later ticket mounts its card by passing it
 * to its seat.
 *
 * ### The one thing the conversation's seat does draw
 *
 * A conversation that is **closed** — promoted, or discarded with its draft — is kept, and the
 * ticket's criterion is that it stays readable. So is an open one for a reader who may not edit.
 * In those cases the seat draws the transcript read-only: a note saying why, then a plain ordered
 * list of who said what and when. Deliberately plain — no bubbles, chips or traces — so CE.2 has
 * nothing to undo.
 *
 * ### The role, and the states
 *
 * The same `mayAdminister` and the same read-only note as the other two surfaces. A refused rail
 * and an empty workspace draw one seat in place of the three; a refused promotion summary or
 * conversation wears the studio's banner and takes only its own region with it.
 */

/** What the screen takes. */
export interface CopilotScreenProps {
  /** Everything the route was able to read, and why not for the rest. */
  readonly readings: CopilotReadings;
  /**
   * Whether this reader's role may promote and discard — decided at the gate. Defaults to
   * `false`, for the reason `StudioScreenProps.mayAdminister` gives.
   */
  readonly mayAdminister?: boolean;
  /** The reader's strongest role, for the read-only note's one sentence. Defaults to `viewer`. */
  readonly role?: Role;
}

/**
 * The copilot.
 *
 * @param props See {@link CopilotScreenProps}.
 * @returns The screen.
 */
export function CopilotScreen({ readings, mayAdminister = false, role = "viewer" }: CopilotScreenProps) {
  const state = copilotState(readings);
  const open = state.kind === "open" ? state : null;
  // The conversation the seat may draw read-only, and why — `null` leaves the seat to CE.2 (#566).
  const conversation = open !== null && open.conversation.ok ? open.conversation.value : null;
  const readOnly = transcriptReason(conversation, mayAdminister);
  // The rail as served, or nothing for a rail nobody could read — the tile still draws.
  const entries = readings.rail.ok ? readings.rail.value : [];

  const page = (
    <StudioFrame
      actions={
        <CopilotHeadActions
          definition={open === null ? {} : anchorDefinition(open)}
          entry={open === null ? null : open.entry}
          mayAdminister={mayAdminister}
          promotion={open === null ? null : open.promotion}
        />
      }
      current="copilot"
      eyebrow={COPILOT_EYEBROW}
      // The slug the URL named, whatever the reads found — Copilot is this page, and the other
      // two segments lead to the same workflow's own surfaces, as on the code view.
      slug={readings.requested}
      subline={COPILOT_SUBLINE}
      title={COPILOT_TITLE}
    >
      {!mayAdminister && <StudioReadOnlyNote role={role} />}
      <CopilotNotice />

      {state.kind === "failed" && <StudioFailedBanner headline={RAIL_FAILED_HEADLINE} reason={state.reason} />}
      {open !== null && !open.promotion.ok && (
        <StudioFailedBanner headline={PROMOTION_FAILED_HEADLINE} reason={open.promotion.reason} />
      )}
      {open !== null && !open.conversation.ok && (
        <StudioFailedBanner headline={CONVERSATION_FAILED_HEADLINE} reason={open.conversation.reason} />
      )}

      <div className="studio__grid">
        <WorkflowRail
          activeSlug={open === null ? null : open.entry.slug}
          entries={entries}
          mayAdminister={mayAdminister}
          surface="copilot"
        />

        {open === null ? (
          <Card className="copilot-view__vacant" fill>
            <Vacant mayAdminister={mayAdminister} state={state as Exclude<CopilotState, { kind: "open" }>} />
          </Card>
        ) : (
          <div className="copilot-view__body">
            <Seat id="conversation">
              {conversation !== null && readOnly !== null ? (
                <Transcript
                  conversation={conversation}
                  name={open.entry.name}
                  now={new Date(readings.now)}
                  reason={readOnly}
                />
              ) : undefined}
            </Seat>

            <div className="copilot-view__side">
              <Seat id="stages" />
              <Seat id="dry-run" />
            </div>
          </div>
        )}
      </div>
    </StudioFrame>
  );

  // Keyed by the workflow, so another workflow's page starts with no notice.
  return open === null ? page : <CopilotFlows key={open.entry.slug}>{page}</CopilotFlows>;
}

/**
 * One region a later ticket fills: a card with the region's heading, and — until its card is
 * mounted — one honest line saying what will be here and which issue builds it.
 *
 * The seat owns the element id (`copilot-view.ts`' `seatElementId`) and the heading, so a link to
 * the region lands on the same element before and after its card arrives.
 *
 * @param props.id Which region.
 * @param props.children The region's content. Omitted, the seat draws its placeholder.
 * @returns The seat.
 */
function Seat({ id, children }: Readonly<{ id: CopilotSeatId; children?: ReactNode }>) {
  const seat = COPILOT_SEATS[id];
  const element = seatElementId(id);
  const titleId = `${element}-title`;

  return (
    <Card aria-labelledby={titleId} as="section" className="copilot-view__seat" id={element}>
      <CardHead title={seat.title} titleId={titleId} />
      {children ?? <EmptyState note={seat.note} variant="flush" />}
    </Card>
  );
}

/**
 * A conversation that can be read and not continued: why, then who said what and when.
 *
 * Drawn only when `copilot-view.ts`' `transcriptReason` names a reason. A workflow with no
 * conversation, and an open conversation whose reader may edit, are CE.2's to draw — the seat's
 * placeholder says so.
 *
 * @param props.conversation The conversation.
 * @param props.reason Why it is read-only.
 * @param props.name The workflow's name, for the note.
 * @param props.now The instant the page was read — what *2h ago* is measured from.
 * @returns The note and the transcript.
 */
function Transcript({
  conversation,
  reason,
  name,
  now,
}: Readonly<{ conversation: CopilotConversation; reason: TranscriptReason; name: string; now: Date }>) {
  const lines = transcriptLines(conversation.messages, now);

  return (
    <div className="copilot-view__transcript">
      <p className="copilot-view__readonly" role="note">
        {transcriptNote(reason, name)}
      </p>

      {lines.length === 0 ? (
        <p className="copilot-view__silent">{TRANSCRIPT_EMPTY}</p>
      ) : (
        <ol aria-label={TRANSCRIPT_LABEL} className="copilot-view__messages">
          {lines.map((line) => (
            <li className="copilot-view__message" key={line.id}>
              <p className="copilot-view__message-head">
                <span className="copilot-view__speaker">{line.speaker}</span>{" "}
                <time className="copilot-view__time" dateTime={line.at}>
                  {line.ago}
                </time>
              </p>
              <p className="copilot-view__message-body">{line.body}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Where the three seats would be, in the states with no workflow open — a designed empty state
 * rather than a blank region (§ 3.3).
 *
 * An empty workspace draws the studio's own role-aware calls to action (`EmptyWorkspaceActions`),
 * as the canvas's and the code view's empty seats do.
 *
 * @param props.state Which state the page is in.
 * @param props.mayAdminister Whether the reader may create workflows.
 * @returns The panel.
 */
function Vacant({
  state,
  mayAdminister,
}: Readonly<{ state: Exclude<CopilotState, { kind: "open" }>; mayAdminister: boolean }>) {
  const copy = copilotSeatCopy(state, mayAdminister);

  return (
    <EmptyState fill note={copy.note} title={copy.title}>
      {state.kind === "empty" && <EmptyWorkspaceActions mayAdminister={mayAdminister} />}
    </EmptyState>
  );
}

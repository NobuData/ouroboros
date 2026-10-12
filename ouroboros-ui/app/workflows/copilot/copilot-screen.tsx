import type { ReactNode } from "react";

import type { Role } from "@/app/api/membership";
import { Card, CardHead, EmptyState } from "@/app/ui";

import { EmptyWorkspaceActions } from "../empty-workspace-actions";
import { RAIL_FAILED_HEADLINE } from "../states";
import { StudioFailedBanner } from "../studio-banner";
import { StudioFrame } from "../studio-frame";
import { StudioReadOnlyNote } from "../studio-readonly-note";
import { WorkflowRail } from "../workflow-rail";
import { ConversationCard } from "./conversation-card";
import { DryRunCard } from "./dry-run-card";
import { DRY_RUN_FAILED_HEADLINE } from "./dry-run";
import { SafetyStrip } from "./safety-strip";
import { SAFETY_FAILED_HEADLINE } from "./safety";
import { StagesCard } from "./stages-card";
import { DRAFT_FAILED_HEADLINE, stageOrder } from "./stages";
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
  anchorDefinition,
  copilotSeatCopy,
  copilotState,
  seatElementId,
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
 * ### The conversation, the stage list and the dry run
 *
 * The conversation is CE.2's card (#566, `conversation-card.tsx`), in mockup 20's left column: it
 * takes what this route read — the conversation and the service's readiness — and is the same
 * card for every reader. One who may not write, and a conversation that is **closed** (promoted,
 * or discarded with its draft), get it read-only: the bubbles and the answered chips, and in the
 * composer's place the sentence saying why. A conversation that could not be read keeps a
 * labelled seat under the banner that says so.
 *
 * The draft's stage list is CE.3's card (#567, `stages-card.tsx`), at the head of the right
 * column: it takes the draft this route read, keeps it current by itself, and is the same list
 * for every reader. A draft that could not be read keeps a labelled seat under the banner that
 * says so.
 *
 * The dry run is CE.4's card (#568, `dry-run-card.tsx`), under the stage list: it takes the board
 * this route read — the history, the newest run and its suggestions — follows a run in flight by
 * itself, and is the same card for every reader. Its writes are for owners, admins **and
 * members** (`mayContribute`), wider than the conversation's; a viewer reads it with its controls
 * inert. A board that could not be read keeps a labelled seat under the banner that says so.
 *
 * The safety strip is CE.5's card (#569, `safety-strip.tsx`), under the dry run: it draws the
 * claims the service derived from the installed harness — only the ones that hold — and is the
 * same strip for every reader. A strip that could not be read keeps a labelled seat under the
 * banner that says so, and makes no claim.
 *
 * ### The role, and the states
 *
 * The same `mayAdminister` and the same read-only note as the other two surfaces. A refused rail
 * and an empty workspace draw one seat in place of the four; a refused promotion summary,
 * conversation, draft, dry run or safety strip wears the studio's banner and takes only its own
 * region with it.
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
  /**
   * Whether this reader's role may start dry runs and settle suggestions — owners, admins and
   * members. Defaults to `mayAdminister`, so a caller that says nothing grants nothing wider.
   */
  readonly mayContribute?: boolean;
}

/**
 * The copilot.
 *
 * @param props See {@link CopilotScreenProps}.
 * @returns The screen.
 */
export function CopilotScreen({
  readings,
  mayAdminister = false,
  role = "viewer",
  mayContribute = mayAdminister,
}: CopilotScreenProps) {
  const state = copilotState(readings);
  const open = state.kind === "open" ? state : null;
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
      {open !== null && !open.draft.ok && (
        <StudioFailedBanner headline={DRAFT_FAILED_HEADLINE} reason={open.draft.reason} />
      )}
      {open !== null && !open.dryRun.ok && (
        <StudioFailedBanner headline={DRY_RUN_FAILED_HEADLINE} reason={open.dryRun.reason} />
      )}

      {open !== null && !open.safety.ok && (
        <StudioFailedBanner headline={SAFETY_FAILED_HEADLINE} reason={open.safety.reason} />
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
            {open.conversation.ok ? (
              <ConversationCard
                conversation={open.conversation.value}
                mayAdminister={mayAdminister}
                name={open.entry.name}
                // Providers that could not be read cost the gateway notice its status line only.
                providers={open.providers.ok ? open.providers.value : null}
                // Readiness that could not be read gates nothing: the service still refuses what it must.
                readiness={open.readiness.ok ? open.readiness.value : null}
                slug={open.entry.slug}
                workflowId={open.entry.id}
              />
            ) : (
              <Seat id="conversation" />
            )}

            <div className="copilot-view__side">
              {open.draft.ok ? (
                <StagesCard
                  // Keyed by the workflow, so another workflow's page starts its own poll and list.
                  key={open.entry.id}
                  // Aliases that could not be read resolve nothing: a tag then names the alias.
                  aliases={open.aliases.ok ? open.aliases.value : NO_ALIASES}
                  currentVersion={open.entry.currentVersion}
                  draft={open.draft.value}
                  name={open.entry.name}
                  promotion={open.promotion}
                  slug={open.entry.slug}
                  workflowId={open.entry.id}
                />
              ) : (
                <Seat id="stages" />
              )}
              {open.dryRun.ok ? (
                <DryRunCard
                  // Keyed by the workflow, so another workflow's page starts its own card.
                  key={open.entry.id}
                  board={open.dryRun.value}
                  conversation={open.conversation.ok ? open.conversation.value : null}
                  definition={anchorDefinition(open)}
                  // A draft that could not be read gates nothing: the service refuses what it must.
                  hasStages={!open.draft.ok || stageOrder(open.draft.value.definition).length > 0}
                  mayContribute={mayContribute}
                  now={readings.now}
                  workflowId={open.entry.id}
                />
              ) : (
                <Seat id="dry-run" />
              )}
              {/* A strip that could not be read claims nothing — the seat says so, never the copy. */}
              {open.safety.ok ? <SafetyStrip safety={open.safety.value} /> : <Seat id="safety" />}
            </div>
          </div>
        )}
      </div>
    </StudioFrame>
  );

  // Keyed by the workflow, so another workflow's page starts with no notice.
  return open === null ? page : <CopilotFlows key={open.entry.slug}>{page}</CopilotFlows>;
}

/** What the stage list resolves aliases against when the registry could not be read. */
const NO_ALIASES: readonly never[] = [];

/**
 * One region without its card: the region's heading over one honest line — that it could not
 * be read.
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

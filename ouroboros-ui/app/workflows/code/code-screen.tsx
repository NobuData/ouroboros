import type { Role } from "@/app/api/membership";
import { workflowPath } from "@/app/paths";
import { Button, Card, EmptyState } from "@/app/ui";

import { EmptyWorkspaceActions } from "../empty-workspace-actions";
import { RAIL_FAILED_HEADLINE } from "../states";
import { StudioFailedBanner } from "../studio-banner";
import { StudioFrame } from "../studio-frame";
import { StudioReadOnlyNote } from "../studio-readonly-note";
import { CodeFlows } from "./code-flows-session";
import { CodeFlowsNotice, CodeHeadActions } from "./code-flows-view";
import {
  CODE_FAILED_HEADLINE,
  CODE_SEAT_EMPTY_LINE,
  type CodeFinding,
  type CodeReadings,
  type CodeSeatState,
  type CodeState,
  UNPROJECTABLE_ACTION,
  UNPROJECTABLE_TITLE,
  UNREAD_EXPLORER,
  codeEntry,
  codeHead,
  codeSeatCopy,
  codeState,
  fileEditable,
  findingLine,
} from "./code-view";
import { CodeWorkbench } from "./code-workbench";

import "./code-view.css";

/**
 * The workflow studio's code view (V.1, [#169](https://github.com/NobuData/ouroboros/issues/169))
 * — `docs/mockups/05-workflow-code.html`'s page head and segmented control, over the workbench.
 *
 * It shares the visual editor's frame (`app/workflows/studio-frame.tsx`), so the two editors are
 * one surface with two tabs: the same eyebrow, the same sticky tab row with **Code** marked
 * current, the same gutter rhythm, inside the shell's content pane under the sidebar's
 * **Workflows** entry. What differs is the head's words — mockup 05's filename and its promise —
 * its two actions, and what sits under the control.
 *
 * ### The file is the draft, in the workbench
 *
 * Under the control is the workbench of V.3 ([#171](https://github.com/NobuData/ouroboros/issues/171),
 * `code-workbench.tsx`): the explorer and the tab strip around the file U.3 prints from the draft
 * slot both editors share (decision **C3**), in the CodeMirror editor of V.2
 * ([#170](https://github.com/NobuData/ouroboros/issues/170)). A role that may publish can type into
 * it; a member, or anyone reading a published version, gets the read-only variant. Typed changes
 * are kept per file for the browser session and saved into the draft as they are typed, by the save
 * loop of V.4 ([#172](https://github.com/NobuData/ouroboros/issues/172)).
 *
 * ### The two actions run the shared pipelines
 *
 * V.6 ([#174](https://github.com/NobuData/ouroboros/issues/174)): **Validate** runs the publish gate
 * without publishing and draws what it finds in the editor and Loop Checks; **Publish vN+1** opens S.6's
 * publish dialog ([#152](https://github.com/NobuData/ouroboros/issues/152)), the one the visual editor
 * opens. `code-flows-session.tsx` holds both around the page, and the notice either leaves sits above
 * the workbench. **Publish** is drawn for a role that may publish and only when there is a workflow,
 * exactly as on the visual editor; both are inert, saying why, when there is no file to act on.
 *
 * ### The role, and the states
 *
 * The same `mayAdminister` and the same read-only note as the visual editor, so a member reaches
 * this page, reads the file, and is told once what they may not do: no save loop runs, no **Publish**
 * is drawn, and the explorer, the tabs and the outline stay navigable. Every state the mockup does
 * not show is decided in `code-view.ts` (V.7, [#175](https://github.com/NobuData/ouroboros/issues/175),
 * verifies them at the screen level). A refused rail and an empty workspace have no files, so
 * they draw a seat in place of the workbench; every other state keeps the workbench, so the
 * explorer is there to leave by — a refused file wears the DASH-I.7 banner above it, an unknown
 * slug points back at the rail, and a draft with no faithful spelling as code yet lists what the
 * validator found and leads to the visual editor where it can be finished.
 */

/** The workspace the code view is in. */
export interface CodeWorkspace {
  /** Its id — whose tabs and buffers the workbench keeps. */
  readonly id: string;
  /** Its display name — the explorer's head. */
  readonly name: string;
}

/** The workspace a screen rendered without one is given: no name, and one shared session. */
export const UNNAMED_WORKSPACE: CodeWorkspace = { id: "", name: "" };

/** What the screen takes. */
export interface CodeScreenProps {
  /** Everything the route was able to read, and why not for the rest. */
  readonly readings: CodeReadings;
  /**
   * Whether this reader's role may publish — decided at the gate. Defaults to `false`, for the
   * reason `StudioScreenProps.mayAdminister` gives.
   */
  readonly mayAdminister?: boolean;
  /** The reader's strongest role, for the read-only note's one sentence. Defaults to `viewer`. */
  readonly role?: Role;
  /** The workspace, for the explorer's head and the session's key. Defaults to {@link UNNAMED_WORKSPACE}. */
  readonly workspace?: CodeWorkspace;
}

/**
 * The code view.
 *
 * @param props See {@link CodeScreenProps}.
 * @returns The screen.
 */
export function CodeScreen({
  readings,
  mayAdminister = false,
  role = "viewer",
  workspace = UNNAMED_WORKSPACE,
}: CodeScreenProps) {
  const state = codeState(readings);
  const head = codeHead(state);
  const entry = codeEntry(state);

  const page = (
    <StudioFrame
      actions={<CodeHeadActions entry={entry} mayAdminister={mayAdminister} />}
      current="code"
      // The slug the URL named, whatever the reads found: Code is this page, and Visual leads to
      // the same workflow's canvas — which, for a slug the rail does not hold, is the visual
      // editor's own *No such workflow* beside the rail a reader needs next.
      slug={readings.requested}
      subline={head.subline}
      title={head.title}
    >
      {!mayAdminister && <StudioReadOnlyNote role={role} />}
      <CodeFlowsNotice />

      {state.kind === "failed" && (
        <StudioFailedBanner headline={RAIL_FAILED_HEADLINE} reason={state.reason} />
      )}
      {state.kind === "unread" && (
        <StudioFailedBanner headline={CODE_FAILED_HEADLINE} reason={state.reason} />
      )}

      {state.kind === "failed" || state.kind === "empty" ? (
        <Card className="code-view__seat" fill>
          <SeatBody mayAdminister={mayAdminister} state={state} />
        </Card>
      ) : (
        <CodeWorkbench
          editable={state.kind === "populated" && fileEditable(state.file, mayAdminister)}
          explorer={readings.explorer ?? UNREAD_EXPLORER}
          file={state.kind === "populated" ? state.file : null}
          // A fresh read of the file — a new etag — starts a fresh save loop over it (V.4, #172).
          key={state.kind === "populated" ? `${state.file.path}\n${state.file.etag}` : state.kind}
          // The right panel (V.5, #173) is about the file in the pane, so only a file that opened has one.
          panel={state.kind === "populated" ? readings.panel : null}
          scope={workspace.id}
          seat={<RouteSeat state={state} />}
          slug={state.kind === "missing" ? null : state.entry.slug}
          workspaceName={workspace.name}
        />
      )}
    </StudioFrame>
  );

  // Keyed by the workflow, so another workflow's page starts its flows afresh.
  return entry === null ? (
    page
  ) : (
    <CodeFlows entry={entry} key={entry.slug}>
      {page}
    </CodeFlows>
  );
}

/**
 * What the workbench's pane shows for the route when it has no file to open.
 *
 * @param props.state A state that draws the workbench.
 * @returns The unprojectable draft's guidance, the seat for a refused or missing file, or nothing
 *   for a file that was read.
 */
function RouteSeat({ state }: Readonly<{ state: Exclude<CodeState, { kind: "failed" | "empty" }> }>) {
  switch (state.kind) {
    case "populated":
      return null;
    case "unprojectable":
      return <Unprojectable findings={state.findings} reason={state.reason} slug={state.entry.slug} />;
    default:
      // The role changes only the empty seat's words, which is not a state the workbench draws.
      return <SeatBody mayAdminister={false} state={state} />;
  }
}

/**
 * A draft that has no faithful spelling as code yet: what the service said, what the validator
 * found, and the way to the editor that can finish it.
 *
 * No banner and no retry — nothing failed, and reading again would answer the same until the
 * draft changes.
 *
 * @param props.slug The workflow's slug, for the link to its canvas.
 * @param props.reason The service's sentence.
 * @param props.findings What the validator reported, in its order.
 * @returns The panel.
 */
function Unprojectable({
  slug,
  reason,
  findings,
}: Readonly<{ slug: string; reason: string; findings: readonly CodeFinding[] }>) {
  return (
    <EmptyState fill note={reason} title={UNPROJECTABLE_TITLE}>
      {findings.length > 0 && (
        <ul className="code-view__findings">
          {findings.map((finding, index) => (
            // The service's order is the list's; two findings may say the same words.
            <li className="code-view__finding" key={index}>
              {findingLine(finding)}
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button href={workflowPath(slug)} tone="primary">
          {UNPROJECTABLE_ACTION}
        </Button>
      </div>
    </EmptyState>
  );
}

/**
 * Where the file would be, in the states with none — a designed empty state rather than a
 * blank region (§ 3.3).
 *
 * An empty workspace mirrors the visual editor's seat (S.7, #153; V.7, #175): the same title, the
 * same role-aware calls to action and development note (`EmptyWorkspaceActions`), and one line of its
 * own about the files this tab would list.
 *
 * @param props.state Which state the page is in.
 * @param props.mayAdminister Whether the reader may create workflows — only the empty seat asks.
 * @returns The panel.
 */
function SeatBody({ state, mayAdminister }: Readonly<{ state: CodeSeatState; mayAdminister: boolean }>) {
  const copy = codeSeatCopy(state, mayAdminister);

  return (
    <EmptyState fill note={copy.note} title={copy.title}>
      {state.kind === "empty" && (
        <>
          <p className="code-view__empty-line">{CODE_SEAT_EMPTY_LINE}</p>
          <EmptyWorkspaceActions mayAdminister={mayAdminister} />
        </>
      )}
    </EmptyState>
  );
}

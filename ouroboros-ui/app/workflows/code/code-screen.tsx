import type { Role } from "@/app/api/membership";
import type { WorkflowCode, WorkflowRailEntry } from "@/app/api/workflows";
import { workflowPath } from "@/app/paths";
import { Button, Card, CardHead, EmptyState } from "@/app/ui";

import { RAIL_FAILED_HEADLINE } from "../states";
import { StudioFailedBanner } from "../studio-banner";
import { StudioFrame } from "../studio-frame";
import { StudioReadOnlyNote } from "../studio-readonly-note";
import { PUBLISH_SOON, publishLabel } from "../view";
import {
  CODE_FAILED_HEADLINE,
  type CodeFinding,
  type CodeReadings,
  type CodeSeatState,
  FILE_LABEL,
  UNPROJECTABLE_ACTION,
  UNPROJECTABLE_TITLE,
  VALIDATE_LABEL,
  VALIDATE_SOON,
  codeEntry,
  codeHead,
  codeSeatCopy,
  codeState,
  fileEditNote,
  fileEditable,
  fileSource,
  findingLine,
} from "./code-view";
import { CodeEditor } from "./code-editor";

import "./code-view.css";

/**
 * The workflow studio's code view (V.1, [#169](https://github.com/NobuData/ouroboros/issues/169))
 * — `docs/mockups/05-workflow-code.html`'s page head and segmented control, over the workflow's
 * file.
 *
 * It shares the visual editor's frame (`app/workflows/studio-frame.tsx`), so the two editors are
 * one surface with two tabs: the same eyebrow, the same sticky tab row with **Code** marked
 * current, the same gutter rhythm, inside the shell's content pane under the sidebar's
 * **Workflows** entry. What differs is the head's words — mockup 05's filename and its promise —
 * its two actions, and what sits under the control.
 *
 * ### The file is the draft, in the editor
 *
 * Under the control is the file U.3 prints from the draft slot both editors share (decision
 * **C3**), with where it was printed from, in the CodeMirror editor of V.2
 * ([#170](https://github.com/NobuData/ouroboros/issues/170), `code-editor.tsx`). A role that may
 * publish can type into it; a member, or anyone reading a published version, gets the read-only
 * variant. Typed changes stay in the tab, and the card says so, until the save loop of V.4
 * ([#172](https://github.com/NobuData/ouroboros/issues/172)) replaces that note.
 *
 * ### The two actions wait, and say for what
 *
 * **Validate** is V.6's ([#174](https://github.com/NobuData/ouroboros/issues/174)) and **Publish
 * vN+1** opens S.6's publish dialog ([#152](https://github.com/NobuData/ouroboros/issues/152)),
 * the one the visual editor will open — so both are drawn where the mockup draws them and inert
 * with the issue each waits for as the reason (design system § 3.5). **Publish** is drawn for a
 * role that may publish and only when there is a workflow, exactly as on the visual editor.
 *
 * ### The role, and the states
 *
 * The same `mayAdminister` and the same read-only note as the visual editor, so a member reaches
 * this page, reads the file, and is told once what they may not do. Every state the mockup does
 * not show is decided in `code-view.ts`: a refused rail and a refused file each wear the
 * DASH-I.7 banner, an empty workspace and an unknown slug point back at the Visual tab's rail,
 * and a draft with no faithful spelling as code yet lists what the validator found and leads to
 * the visual editor where it can be finished.
 */

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
}

/**
 * The code view.
 *
 * @param props See {@link CodeScreenProps}.
 * @returns The screen.
 */
export function CodeScreen({ readings, mayAdminister = false, role = "viewer" }: CodeScreenProps) {
  const state = codeState(readings);
  const head = codeHead(state);
  const entry = codeEntry(state);

  return (
    <StudioFrame
      actions={<Actions entry={entry} mayAdminister={mayAdminister} />}
      current="code"
      // The slug the URL named, whatever the reads found: Code is this page, and Visual leads to
      // the same workflow's canvas — which, for a slug the rail does not hold, is the visual
      // editor's own *No such workflow* beside the rail a reader needs next.
      slug={readings.requested}
      subline={head.subline}
      title={head.title}
    >
      {!mayAdminister && <StudioReadOnlyNote role={role} />}

      {state.kind === "failed" && (
        <StudioFailedBanner headline={RAIL_FAILED_HEADLINE} reason={state.reason} />
      )}
      {state.kind === "unread" && (
        <StudioFailedBanner headline={CODE_FAILED_HEADLINE} reason={state.reason} />
      )}

      {state.kind === "populated" && <CodeFile file={state.file} mayAdminister={mayAdminister} />}
      {state.kind === "unprojectable" && (
        <Unprojectable findings={state.findings} reason={state.reason} slug={state.entry.slug} />
      )}
      {state.kind !== "populated" && state.kind !== "unprojectable" && <Seat state={state} />}
    </StudioFrame>
  );
}

/**
 * Mockup 05's two head actions, each inert with the issue it waits for.
 *
 * @param props.entry The selected workflow's rail entry, or `null` when nothing is selected.
 * @param props.mayAdminister Whether the reader may publish.
 * @returns The actions.
 */
function Actions({
  entry,
  mayAdminister,
}: Readonly<{ entry: WorkflowRailEntry | null; mayAdminister: boolean }>) {
  return (
    <>
      <Button reason={VALIDATE_SOON} tone="ghost">
        {VALIDATE_LABEL}
      </Button>
      {mayAdminister && entry !== null && (
        <Button reason={PUBLISH_SOON} tone="primary">
          {publishLabel(entry.currentVersion)}
        </Button>
      )}
    </>
  );
}

/**
 * The file: its path, where it was printed from and whether it can be typed into, then the
 * editor over its text.
 *
 * The editor scrolls inside itself, so a long line never widens the pane (§ 1.3), and its
 * editable region is named by the file's path.
 *
 * @param props.file The file.
 * @param props.mayAdminister Whether the reader's role may publish.
 * @returns The card.
 */
function CodeFile({ file, mayAdminister }: Readonly<{ file: WorkflowCode; mayAdminister: boolean }>) {
  const editable = fileEditable(file, mayAdminister);

  return (
    <Card aria-label={FILE_LABEL} as="section">
      <CardHead
        className="code-view__head"
        title={<code className="code-view__path">{file.path}</code>}
        trailing={
          <span className="code-view__meta">
            {fileSource(file)} · {fileEditNote(editable)}
          </span>
        }
      />

      <CodeEditor label={file.path} readOnly={!editable} text={file.text} />
    </Card>
  );
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
 * @returns The seat.
 */
function Unprojectable({
  slug,
  reason,
  findings,
}: Readonly<{ slug: string; reason: string; findings: readonly CodeFinding[] }>) {
  return (
    <Card className="code-view__seat" fill>
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
    </Card>
  );
}

/**
 * Where the file would be, in the states with none — a designed empty state rather than a
 * blank region (§ 3.3).
 *
 * @param props.state Which state the page is in.
 * @returns The seat.
 */
function Seat({ state }: Readonly<{ state: CodeSeatState }>) {
  const copy = codeSeatCopy(state);

  return (
    <Card className="code-view__seat" fill>
      <EmptyState fill note={copy.note} title={copy.title} />
    </Card>
  );
}

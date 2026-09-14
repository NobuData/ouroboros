import type { Role } from "@/app/api/membership";
import type { WorkflowRailEntry } from "@/app/api/workflows";
import { Button, Card, EmptyState } from "@/app/ui";

import {
  DEV_SEED_NOTE,
  RAIL_FAILED_HEADLINE,
  type SeatState,
  WORKFLOW_FAILED_HEADLINE,
  seatCopy,
  selectedEntry,
  studioHead,
  studioState,
} from "./states";
import { StudioFailedBanner } from "./studio-banner";
import { StudioEditor } from "./studio-editor";
import { StudioFrame } from "./studio-frame";
import { StudioReadOnlyNote } from "./studio-readonly-note";
import {
  BROWSE_TEMPLATES_LABEL,
  BROWSE_TEMPLATES_SOON,
  DRY_RUN_LABEL,
  DRY_RUN_SOON,
  PUBLISH_SOON,
  type StudioReadings,
  canvasDefinition,
  publishLabel,
} from "./view";
import { WorkflowRail } from "./workflow-rail";

import "./workflows.css";

/**
 * The workflow studio's frame (S.1, [#147](https://github.com/NobuData/ouroboros/issues/147))
 * — `docs/mockups/04-workflow-builder.html`'s page head, segmented control, actions and rail
 * as a working page.
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no
 * chrome of its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2). The mockup's `.topbar`/`.nav`
 * markup is superseded: this surface is reached from the sidebar's **Workflows** entry, and
 * the segmented control that would have sat beside the actions is the CP.4 `PageSubnav`
 * primitive, sticky inside the pane's own scroll (`app/workflows/studio-subnav.tsx`).
 *
 * It is a component rather than markup written in the route, for the reason the dashboard
 * and the routing page are: everything it draws can then be rendered and asserted on without
 * Next.js's routing around it. The route reads (`app/workflows/data.ts`), two pure modules
 * decide (`app/workflows/view.ts`, `app/workflows/states.ts`), and this draws.
 *
 * ### The head is real, and the one sentence it composes is derived
 *
 * The `<h1>` is the selected workflow's name, the version and the usage caption are the
 * service's, *Last edited 2h ago* is the draft's stamp against the instant the page was read,
 * and *Runs when a sized issue with effort ≤ M is queued* is composed from the definition's
 * trigger on every render and stored nowhere — the ticket's *head values are real* criterion,
 * with `view.ts` carrying the argument for each.
 *
 * ### The canvas sits in the seat, when there is a workflow to draw
 *
 * A populated page mounts the React Flow canvas (S.2,
 * [#148](https://github.com/NobuData/ouroboros/issues/148)) where the frame reserved its seat,
 * open on the workflow's draft — or its version in force, or nothing, in that order
 * (`view.ts`'s `canvasDefinition`). It is keyed by the workflow's id, so following the rail to
 * another workflow is a new canvas rather than one re-derived under a reader's selection. The
 * seat itself draws only in the four states that have no workflow to draw.
 *
 * ### What this page does not pretend
 *
 * The frame is honest about being a frame. **Code** and **Copilot** are labelled *soon* rather
 * than linked to a `404`; **Browse templates**, **Dry run** and **Publish vN+1** are drawn
 * where the mockup draws them and are inert with the issue each waits for as its reason
 * (§ 3.5) — a control that cannot act says what is missing, never quietly does nothing. The
 * canvas's own toolbar keeps the same rule for every edit it refuses (S.5, #151), and says out
 * loud that an edit is not saved yet.
 *
 * ### The role decides what is drawn, and is explained
 *
 * **Publish** is drawn for a role that may publish and for nobody else — a member sees no
 * publish affordance, and a disabled one is an affordance — and the rail's tile is inert with
 * its reason for the same reader. A page that quietly draws less reads as broken rather than
 * as scoped, so a reader who may not edit is told so once, near the top, as what they are
 * (`readOnlyNote`). `mayAdminister` is the one decision, made at the gate; the screen decides
 * nothing from the role's name and prints it.
 *
 * ### Two reads, two independent failures
 *
 * The rail and the selected workflow are separate reads and degrade separately
 * (`app/workflows/states.ts` decides every state): a refused rail is the whole frame's failure
 * and wears the banner over an empty seat; a refused workflow leaves the rail standing, the
 * head printing the rail's own facts, and the banner saying which read failed. Neither takes
 * the frame with it.
 */

/** What the screen takes. */
export interface StudioScreenProps {
  /** Everything the reader was able to read, and why not for the rest. */
  readonly readings: StudioReadings;
  /**
   * Whether this reader's role may create and publish workflows — `app/api/membership.ts`'s
   * `mayAdminister`, decided at the gate.
   *
   * A boolean rather than the role itself, because the page asks one question of it and a
   * screen holding a role would be a second place deciding what a role may do. It defaults
   * to `false` so that a caller which forgot it renders the page a member sees — the one
   * with nothing to press — rather than controls the service would refuse.
   */
  readonly mayAdminister?: boolean;
  /**
   * The reader's strongest role, **for one sentence**: the read-only note names it. Nothing
   * is decided from it — {@link StudioScreenProps.mayAdminister} is the decision — and it
   * defaults to `viewer`, the least the API grants, so a caller which forgot it names the
   * role the page is already drawn for.
   */
  readonly role?: Role;
}

/**
 * The studio screen.
 *
 * @param props See {@link StudioScreenProps}.
 * @returns The screen.
 */
export function StudioScreen({
  readings,
  mayAdminister = false,
  role = "viewer",
}: StudioScreenProps) {
  const state = studioState(readings);
  const head = studioHead(state, new Date(readings.now));
  const entry = selectedEntry(state);
  const slug = entry === null ? null : entry.slug;
  // The rail as served, or nothing for a rail nobody could read — the tile still draws.
  const entries = readings.rail.ok ? readings.rail.value : [];

  return (
    <StudioFrame
      actions={<Actions entry={entry} mayAdminister={mayAdminister} />}
      current="visual"
      slug={slug}
      subline={head.subline}
      title={head.title}
    >
      {/* The role, explained, for a reader who may look and not change. */}
      {!mayAdminister && <StudioReadOnlyNote role={role} />}

      {/* The one place a refused read is explained, above everything it took with it. */}
      {state.kind === "failed" && (
        <StudioFailedBanner headline={RAIL_FAILED_HEADLINE} reason={state.reason} />
      )}
      {state.kind === "unread" && (
        <StudioFailedBanner headline={WORKFLOW_FAILED_HEADLINE} reason={state.reason} />
      )}

      <div className="studio__grid">
        <WorkflowRail activeSlug={slug} entries={entries} mayAdminister={mayAdminister} />
        {state.kind === "populated" ? (
          // The canvas and the inspector, sharing one draft (S.4, #150). Keyed by the workflow's
          // id, so following the rail to another workflow is a new draft rather than this one.
          <StudioEditor
            key={state.workflow.id}
            definition={canvasDefinition(state.workflow)}
            inspector={readings.inspector}
            mayAdminister={mayAdminister}
            workflowId={state.workflow.id}
          />
        ) : (
          <Seat state={state} />
        )}
      </div>
    </StudioFrame>
  );
}

/**
 * The mockup's three head actions, each inert with the issue it waits for.
 *
 * **Publish vN+1** is drawn for a role that may publish and only when there is a workflow to
 * publish: its label counts from the version in force, which is the rail's fact and so is
 * known even when the workflow's own read failed.
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
      <Button reason={BROWSE_TEMPLATES_SOON} tone="ghost">
        {BROWSE_TEMPLATES_LABEL}
      </Button>
      <Button reason={DRY_RUN_SOON} tone="ghost">
        {DRY_RUN_LABEL}
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
 * Where the canvas would be — a designed empty state rather than a blank region (§ 3.3), with
 * copy that differs by state because the states are different facts: *nothing could be read*,
 * *nothing exists yet*, *nothing is selected*, *this one could not be read*.
 *
 * @param props.state Which state the page is in, decided once by the screen — any but
 *   populated, which has a canvas instead.
 * @returns The seat.
 */
function Seat({ state }: Readonly<{ state: SeatState }>) {
  const copy = seatCopy(state);

  return (
    <Card className="studio__seat" fill>
      <EmptyState fill note={copy.note} title={copy.title}>
        {state.kind === "empty" && <p className="studio__dev">{DEV_SEED_NOTE}</p>}
      </EmptyState>
    </Card>
  );
}

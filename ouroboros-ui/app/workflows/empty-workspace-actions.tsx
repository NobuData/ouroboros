import { Button } from "@/app/ui";

import { NewWorkflow } from "./new-workflow";
import { DEV_SEED_NOTE, START_BLANK_LABEL } from "./states";
import { BROWSE_TEMPLATES_LABEL, BROWSE_TEMPLATES_SOON } from "./view";

import "./workflows.css";

/**
 * What an empty workspace's seat offers under its title and note, on both studio tabs (S.7,
 * [#153](https://github.com/NobuData/ouroboros/issues/153); shared with the code view by V.7,
 * [#175](https://github.com/NobuData/ouroboros/issues/175)).
 *
 * One component for both editors because an empty workspace is one fact: the visual editor's seat and
 * the code view's say the same thing and offer the same ways out, so the two cannot drift.
 *
 * ### The calls to action are role-aware
 *
 * A reader who may create gets the two ways a workflow begins, as buttons: **Start blank**, which opens
 * the rail tile's own create dialog, and **Browse templates**, inert with the issue it waits for. A
 * reader who may not gets no buttons at all — a control that would be refused is not drawn — and the
 * seat's note (decided by the caller's copy) says who can create one instead.
 *
 * Under both, the development seed is named for somebody exploring locally.
 *
 * @param props.mayAdminister Whether the reader may create workflows, decided at the gate.
 * @returns The buttons, for a reader who may create, and the development note.
 */
export function EmptyWorkspaceActions({ mayAdminister }: Readonly<{ mayAdminister: boolean }>) {
  return (
    <>
      {mayAdminister && (
        <div className="studio__seat-actions">
          {/* An empty workspace has no slugs to collide with. */}
          <NewWorkflow className="studio__seat-start" label={START_BLANK_LABEL} mayAdminister slugs={[]} tone="primary" />
          <Button reason={BROWSE_TEMPLATES_SOON} tone="ghost">
            {BROWSE_TEMPLATES_LABEL}
          </Button>
        </div>
      )}
      <p className="studio__dev">{DEV_SEED_NOTE}</p>
    </>
  );
}

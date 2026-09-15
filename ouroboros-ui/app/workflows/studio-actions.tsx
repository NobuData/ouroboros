"use client";

import type { WorkflowRailEntry } from "@/app/api/workflows";
import { Button } from "@/app/ui";

import { useStudioSession } from "./studio-session-context";
import {
  BROWSE_TEMPLATES_LABEL,
  BROWSE_TEMPLATES_SOON,
  DRY_RUN_LABEL,
  DRY_RUN_NEEDS_WORKFLOW,
  PUBLISH_NEEDS_WORKFLOW,
  publishLabel,
} from "./view";

/**
 * Mockup 04's three head actions (S.1, [#147](https://github.com/NobuData/ouroboros/issues/147); live
 * since S.6, [#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * - **Browse templates** stays inert, naming #159.
 * - **Dry run** opens the picker for every member, because a dry run writes nothing.
 * - **Publish vN+1** is drawn for a role that may publish and nobody else, and counts from the version in
 *   force — the session's, so it moves the moment a publish takes.
 *
 * Outside a session — a page whose workflow could not be read — Dry run and Publish are inert and say why:
 * there is no definition to walk or to freeze.
 *
 * @param props.entry The selected workflow's rail entry, or `null` when nothing is selected.
 * @param props.mayAdminister Whether the reader may publish.
 * @returns The actions.
 */
export function StudioActions({
  entry,
  mayAdminister,
}: Readonly<{ entry: WorkflowRailEntry | null; mayAdminister: boolean }>) {
  const session = useStudioSession();

  return (
    <>
      <Button reason={BROWSE_TEMPLATES_SOON} tone="ghost">
        {BROWSE_TEMPLATES_LABEL}
      </Button>
      <Button
        onClick={session?.openDryRun}
        reason={session === null ? DRY_RUN_NEEDS_WORKFLOW : undefined}
        tone="ghost"
      >
        {DRY_RUN_LABEL}
      </Button>
      {mayAdminister && entry !== null && (
        <Button
          onClick={session?.openPublish}
          reason={session === null ? PUBLISH_NEEDS_WORKFLOW : undefined}
          tone="primary"
        >
          {publishLabel(session === null ? entry.currentVersion : session.currentVersion)}
        </Button>
      )}
    </>
  );
}

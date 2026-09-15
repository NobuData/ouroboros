"use client";

import { createContext, useContext } from "react";

import type { WorkflowDefinition, WorkflowDryRunResult } from "@/app/api/workflows";

import type { SaveStatus } from "./autosave";
import type { EdgeRef } from "./canvas/graph";

/**
 * The open workflow's session, as its readers see it — S.6
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * Kept apart from the provider (`studio-session.tsx`) on purpose: the provider calls the Server Actions,
 * and a module that imports them cannot be rendered without the server-only client behind it. The head's
 * actions and subline, the editor and the toast only *read* the session, so they import this file, and
 * each of them still renders — as its suites render it — with no session at all.
 */

/** A stage asked for from outside the canvas — `nonce` makes asking for the same stage twice a second request. */
export interface FocusRequest {
  readonly id: string;
  readonly nonce: number;
}

/** A dry run on the canvas, and the draft it walked — an edit to any other draft clears it. */
export interface ShownDryRun {
  readonly result: WorkflowDryRunResult;
  readonly walked: WorkflowDefinition;
}

/** Everything one open workflow's page shares between the head, the editor and the dialogs. */
export interface StudioSessionValue {
  /** The workflow. */
  readonly workflowId: string;
  /** Whether the reader may save and publish. */
  readonly mayAdminister: boolean;
  /** The draft as the editor holds it now. */
  readonly draft: WorkflowDefinition;
  /** The version in force's document, or `null` for a workflow that has published nothing. */
  readonly published: WorkflowDefinition | null;
  /** The version in force, or `null`. Follows a publish. */
  readonly currentVersion: number | null;
  /** The stored draft's *Last edited* stamp. Follows a save. */
  readonly draftUpdatedAt: string | null;
  /** The instant *Last edited* is measured from — the page's read, then each save's. */
  readonly now: string;
  /** Where the autosave stands. */
  readonly save: SaveStatus;
  /** The dry run on the canvas, or `null`. */
  readonly dryRun: ShownDryRun | null;
  /** The path the canvas paints, or `null`. */
  readonly highlight: readonly EdgeRef[] | null;
  /** The last stage asked for from outside the canvas, or `null`. */
  readonly focus: FocusRequest | null;
  /** The toast a publish left, or `null`. */
  readonly toast: string | null;
  /** The editor's seam: told the draft after every edit. */
  readonly onDraftChange: (draft: WorkflowDefinition) => void;
  /** Open the publish dialog. */
  readonly openPublish: () => void;
  /** Open the dry-run picker. */
  readonly openDryRun: () => void;
  /** Take the dry run off the canvas. */
  readonly closeDryRun: () => void;
  /** Select a stage and bring it into view, leaving everything else as it is. */
  readonly focusStage: (id: string) => void;
  /** Select a stage for the inspector — closing any dialog and the dry run's sheet in its way. */
  readonly selectStage: (id: string) => void;
  /** Dismiss the toast. */
  readonly dismissToast: () => void;
}

/** The context the provider fills. */
export const StudioSessionContext = createContext<StudioSessionValue | null>(null);

/**
 * The open workflow's session, when the page has one.
 *
 * @returns The session, or `null` outside `StudioSession` — a page with no workflow to edit, or a
 *   suite rendering one part alone.
 */
export function useStudioSession(): StudioSessionValue | null {
  return useContext(StudioSessionContext);
}

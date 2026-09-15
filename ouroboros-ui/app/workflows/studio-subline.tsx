"use client";

import type { WorkflowRailEntry } from "@/app/api/workflows";

import { draftDiverges } from "./autosave";
import { useStudioSession } from "./studio-session-context";
import { sublineOf } from "./view";

/**
 * The head's subline, following the session — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * The same sentence `view.ts`' `studioSubline` composes on the server — *Runs when a sized issue with
 * effort ≤ M is queued. Last edited 2h ago · v14 · used by 42% of runs.* — composed from the session
 * instead, so a save moves *Last edited*, a publish moves the version, and an edit that makes the draft
 * diverge from the version in force adds the ticket's `draft edits`.
 *
 * @param props.entry The rail entry, for the usage caption.
 * @param props.fallback The server's sentence, for a render outside a session.
 * @returns The sentence.
 */
export function StudioSubline({ entry, fallback }: Readonly<{ entry: WorkflowRailEntry; fallback: string }>) {
  const session = useStudioSession();
  if (session === null) return fallback;

  return sublineOf(
    {
      definition: session.published ?? session.draft,
      draftUpdatedAt: session.draftUpdatedAt,
      currentVersion: session.currentVersion,
      draftEdits: draftDiverges(session.draft, session.published),
      usageCaption: entry.usageCaption,
    },
    new Date(session.now),
  );
}

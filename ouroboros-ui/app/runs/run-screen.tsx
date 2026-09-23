"use client";

import Link from "next/link";
import { useEffect } from "react";

import type { RunConsole } from "@/app/api/runs";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { setNavOrigin } from "@/app/shell/nav-registry";
import { RetryBanner } from "@/app/ui";

import { type RunPollOptions, createRunPoll, runUrl } from "./console-poll";
import type { RunOrigin } from "./origin";
import { RunHead } from "./run-head";
import {
  BREADCRUMB_LABEL,
  SIMULATED_HEADLINE,
  SIMULATED_NOTE,
  STALE_HEADLINE,
  UNREAD_HEADLINE,
  runHead,
} from "./view";

import "./runs.css";

/**
 * The run console's frame ([#309](https://github.com/NobuData/ouroboros/issues/309)) — the
 * breadcrumb, the simulated-run watermark and the page head, polled.
 *
 * **A contextual surface.** It renders in the shell's content pane and adds no chrome of its
 * own, so the header and the sidebar stay put while the pane scrolls. It has no sidebar entry:
 * the module it was opened from is published as the registry's origin while this is mounted
 * (`setNavOrigin`), which keeps that entry lit, and the breadcrumb leads back to it.
 *
 * **Polled** on the shared I.8 cadence ([#87](https://github.com/NobuData/ouroboros/issues/87))
 * through `useKeyedPoll`, keyed on the run's id. The server's first read paints the page; each
 * answer after it replaces the head. A failed refresh keeps the last answer on screen under a
 * banner rather than blanking it.
 *
 * **The watermark sits at the frame**, above everything else, so every card the later AQ
 * issues add below the head inherits its context (decision R4).
 *
 * @param props.id The run's id.
 * @param props.initial The server's first read, or `null` when it failed.
 * @param props.initialError Why the first read failed, or `null`.
 * @param props.origin The module the console was opened from.
 * @param props.poll Test seams for the poll; production passes none.
 * @returns The screen.
 */
export function RunScreen({
  id,
  initial,
  initialError,
  origin,
  poll,
}: Readonly<{
  id: string;
  initial: RunConsole | null;
  initialError: string | null;
  origin: RunOrigin;
  poll?: RunPollOptions;
}>) {
  const { snapshot, refresh } = useKeyedPoll(id, (run) => createRunPoll(runUrl(run), poll));

  useEffect(() => setNavOrigin(origin.id), [origin.id]);

  const data = snapshot.data ?? initial;
  // A poll's own verdict supersedes the server's once it has one — either way.
  const error = snapshot.updatedAt === null ? (snapshot.error ?? initialError) : snapshot.error;
  const view = data === null ? null : runHead(data);

  return (
    <main className="run">
      <nav aria-label={BREADCRUMB_LABEL} className="run__crumbs">
        <ol className="run__crumb-list">
          <li className="run__crumb">
            <Link className="run__crumb-link" href={origin.route}>
              {origin.label}
            </Link>
          </li>
          <li aria-current="page" className="run__crumb">
            {view?.loopLabel ?? "Run"}
          </li>
        </ol>
      </nav>

      {error !== null && (
        <RetryBanner
          className="run__banner"
          headline={data === null ? UNREAD_HEADLINE : STALE_HEADLINE}
          onRetry={refresh}
          reason={error}
        />
      )}

      {view?.simulated && (
        <p className="run__simulated" role="note">
          <span className="run__simulated-headline">{SIMULATED_HEADLINE}</span>{" "}
          {SIMULATED_NOTE}
        </p>
      )}

      {view !== null && <RunHead view={view} />}
    </main>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { RunConsole } from "@/app/api/runs";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { setNavOrigin } from "@/app/shell/nav-registry";
import { RetryBanner } from "@/app/ui";

import { type RunPollOptions, createRunPoll, runUrl } from "./console-poll";
import type { ControlsPollOptions } from "./controls-poll";
import type { RunOrigin } from "./origin";
import { type ControlSender, RunControls } from "./run-controls";
import { RunHead } from "./run-head";
import { RunStepper } from "./run-stepper";
import { type SteerSender, TranscriptCard } from "./transcript-card";
import type { TranscriptStreamOptions } from "./transcript-stream";
import { runStepper, selectedStage, withStage } from "./stepper";
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
 * **The head's controls** ([#310](https://github.com/NobuData/ouroboros/issues/310)) — *Pause
 * loop*, *Take over in IDE*, *Abort run* — are drawn for an owner or admin while the run is
 * live, and for nobody else: a member sees none of them, and the service refuses a direct call
 * all the same. Once a run has ended there is nothing left to control, and the row goes.
 *
 * **The stage timeline** ([#311](https://github.com/NobuData/ouroboros/issues/311)) sits under
 * the head. The stage it is filtered to lives here, in the URL's `?stage=`, so the filtered view
 * is shareable; the transcript (#312) reads the same value. A key the run does not have is no
 * filter at all.
 *
 * @param props.id The run's id.
 * @param props.initial The server's first read, or `null` when it failed.
 * @param props.initialError Why the first read failed, or `null`.
 * @param props.origin The module the console was opened from.
 * **The agent transcript** ([#312](https://github.com/NobuData/ouroboros/issues/312)) sits under
 * the timeline, filtered to the same stage, with the steering box beneath it for anyone who may
 * put work in front of the loop — a viewer reads it and is told why they cannot steer.
 *
 * @param props.initialStage The `?stage=` the page was opened with, or `null`.
 * @param props.mayControl Whether the reader may pause, abort or take over — owner or admin.
 *   `false` when absent, erring the way `mayAdminister` does.
 * @param props.mayContribute Whether the reader may steer — owner, admin or member. `false` when
 *   absent, erring the way `mayContribute` does.
 * @param props.poll Test seams for the poll; production passes none.
 * @param props.transcript Test seams for the transcript's stream; production passes none.
 * @param props.steer How to send a steer. Defaults to the Server Action; tests replace it.
 * @param props.controlsPoll Test seams for the controls' poll; production passes none.
 * @param props.send How to send a control. Defaults to the Server Action; tests replace it.
 * @returns The screen.
 */
export function RunScreen({
  id,
  initial,
  initialError,
  origin,
  initialStage = null,
  mayControl = false,
  mayContribute = false,
  poll,
  transcript,
  steer,
  controlsPoll,
  send,
}: Readonly<{
  id: string;
  initial: RunConsole | null;
  initialError: string | null;
  origin: RunOrigin;
  initialStage?: string | null;
  mayControl?: boolean;
  mayContribute?: boolean;
  poll?: RunPollOptions;
  transcript?: TranscriptStreamOptions;
  steer?: SteerSender;
  controlsPoll?: ControlsPollOptions;
  send?: ControlSender;
}>) {
  const { snapshot, refresh } = useKeyedPoll(id, (run) => createRunPoll(runUrl(run), poll));

  useEffect(() => setNavOrigin(origin.id), [origin.id]);

  const data = snapshot.data ?? initial;
  // A poll's own verdict supersedes the server's once it has one — either way.
  const error = snapshot.updatedAt === null ? (snapshot.error ?? initialError) : snapshot.error;
  const view = data === null ? null : runHead(data);
  const stepper = data === null ? null : runStepper(data);

  const [requestedStage, setRequestedStage] = useState<string | null>(initialStage);
  const stage = stepper === null ? null : selectedStage(requestedStage, stepper.steps);

  /**
   * Filter to a stage, or clear the filter, and say so in the address — replaced rather than
   * pushed, so Back leaves the page instead of stepping through every click. Next.js keeps its
   * router in step with the native History API.
   *
   * @param next The stage, or `null`.
   */
  function selectStage(next: string | null): void {
    setRequestedStage(next);

    const { pathname, search, hash } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}${withStage(search, next)}${hash}`);
  }

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

      {data !== null && view !== null && (
        <RunHead
          actions={
            mayControl && data.head.live ? (
              <RunControls
                branch={view.branch}
                loopSeq={data.head.loopSeq}
                onRunChanged={refresh}
                poll={controlsPoll}
                runId={id}
                send={send}
                trackerUrl={view.trackerUrl}
              />
            ) : null
          }
          view={view}
        />
      )}

      {stepper !== null && <RunStepper onSelect={selectStage} selected={stage} view={stepper} />}

      {data !== null && stepper !== null && (
        <TranscriptCard
          controlsPoll={controlsPoll}
          mayContribute={mayContribute}
          onClearStage={() => selectStage(null)}
          runId={id}
          runLive={data.head.live}
          send={steer}
          stage={stage}
          stageLabel={stepper.steps.find((step) => step.key === stage)?.label ?? null}
          stream={transcript}
        />
      )}
    </main>
  );
}

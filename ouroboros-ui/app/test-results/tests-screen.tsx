"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { PullRequestRef } from "@/app/api/pull-requests";
import type {
  RerunAvailability,
  RerunScope,
  TestRunPage,
  TestRunTimeline,
} from "@/app/api/test-results";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { TESTS_ATTEMPT_PARAM, TESTS_SUITE_PARAM, runPath } from "@/app/paths";
import type { CommitSource } from "@/app/runs/cards";
import type { RunOrigin } from "@/app/runs/origin";
import { BREADCRUMB_LABEL } from "@/app/runs/view";
import { setNavOrigin } from "@/app/shell/nav-registry";
import { RetryBanner } from "@/app/ui";

import { AttemptsTimeline } from "./attempts-timeline";
import { MarkRouteSlot, type StagedFailures } from "./mark-route-slot";
import {
  type TestsPollOptions,
  createGatePoll,
  createPagePoll,
  createTimelinePoll,
} from "./poll";
import type { RerunOutcome } from "./rerun";
import { requestRerun } from "./rerun-actions";
import { type SuiteSelection, resolveSuite, selectionCleared, suitesView } from "./suites";
import { SuitesCard } from "./suites-card";
import { SummaryStrip } from "./summary-strip";
import { type ActionOutcome, TestsActions } from "./tests-actions";
import { TestsHead } from "./tests-head";
import { timelineView } from "./timeline";
import {
  NO_ATTEMPTS,
  STALE_HEADLINE,
  TESTS_CRUMB,
  UNREAD_HEADLINE,
  actionsView,
  pullRequestLink,
  rerunOutcome,
  selectedAttempt,
  stripView,
  testsHead,
} from "./view";

import "./tests.css";

/** How a re-run is sent. The Server Action in production; tests pass their own. */
export type RerunSender = (testRunId: string, scope: RerunScope) => Promise<RerunOutcome>;

/** A value that belongs to one attempt — drawn only while that attempt is on screen. */
interface ForAttempt<T> {
  readonly testRunId: string;
  readonly value: T;
}

/**
 * The address with `?attempt=` set, everything else kept.
 *
 * @param search The current query, `?…` or empty.
 * @param attemptSeq The attempt's ordinal.
 * @returns The new query, with its `?`.
 */
export function withAttempt(search: string, attemptSeq: number): string {
  const query = new URLSearchParams(search);
  query.set(TESTS_ATTEMPT_PARAM, String(attemptSeq));

  return `?${query.toString()}`;
}

/**
 * The address with `?suite=` set or removed, everything else kept.
 *
 * @param search The current query, `?…` or empty.
 * @param suite The selected suite's name, or `null` for none.
 * @returns The new query, with its `?` — or empty when nothing is left to say.
 */
export function withSuite(search: string, suite: string | null): string {
  const query = new URLSearchParams(search);

  if (suite === null) query.delete(TESTS_SUITE_PARAM);
  else query.set(TESTS_SUITE_PARAM, suite);

  const next = query.toString();

  return next === "" ? "" : `?${next}`;
}

/** What the screen is told. */
export interface TestsScreenProps {
  /** The run's id. */
  readonly runId: string;
  /** The server's first read of the timeline, or `null` when it failed. */
  readonly initial: TestRunTimeline | null;
  /** Why the first read failed, or `null`. */
  readonly initialError: string | null;
  /** The attempt `?attempt=` named, or `null` for the latest. */
  readonly initialAttempt: number | null;
  /** The first read's gate for that attempt, or `null`. */
  readonly initialGate?: RerunAvailability | null;
  /** The suite `?suite=` named, or `null` for none. `null` when absent. */
  readonly initialSuite?: string | null;
  /** The first read's page — the suites — for that attempt, or `null`. */
  readonly initialPage?: TestRunPage | null;
  /** The ticket on its tracker, or `null`. */
  readonly trackerUrl: string | null;
  /** Where the run's commits live, or `null` when no sha can be linked. `null` when absent. */
  readonly commitSource?: CommitSource | null;
  /** The run's pull request, or `null` when it opened none. `null` when absent. */
  readonly pullRequest?: PullRequestRef | null;
  /** The module the page was opened from. */
  readonly origin: RunOrigin;
  /** Whether the reader may start a build — owner, admin or member. `false` when absent. */
  readonly mayContribute?: boolean;
  /** Test seams for the timeline's poll; production passes none. */
  readonly timelinePoll?: TestsPollOptions<TestRunTimeline>;
  /** Test seams for the gate's poll; production passes none. */
  readonly gatePoll?: TestsPollOptions<RerunAvailability>;
  /** Test seams for the attempt page's poll; production passes none. */
  readonly pagePoll?: TestsPollOptions<TestRunPage>;
  /** How to send a re-run. Defaults to the Server Action. */
  readonly send?: RerunSender;
}

/**
 * The test-results frame ([#335](https://github.com/NobuData/ouroboros/issues/335)) — mockup 11's
 * breadcrumb, head, actions, build attempts timeline
 * ([#336](https://github.com/NobuData/ouroboros/issues/336)), summary strip and suites card
 * ([#337](https://github.com/NobuData/ouroboros/issues/337)), for one attempt of one run.
 *
 * **A contextual surface.** It renders in the shell's content pane and adds no chrome of its own,
 * so the header and the sidebar stay put while the pane scrolls. It has no sidebar entry: the
 * module it was opened from is published as the registry's origin while it is mounted, which
 * keeps that entry lit, and the breadcrumb leads back through the run console to it.
 *
 * **The attempt is the page's state.** It lives here and in `?attempt=` (replaced, not pushed, so
 * Back leaves the page), defaulting to the latest, and the timeline's cards are what switch it; every region below is drawn from the one
 * attempt `selectedAttempt` answers, so switching redraws all of them in the same render. Anything
 * that belongs to an attempt — the gate's answer, a re-run's outcome, a staged failed set — is held
 * with the attempt's id and drawn only while that attempt is on screen.
 *
 * **The selected suite is the page's second state**, and it is a *name*: it lives here and in
 * `?suite=` (replaced, like the attempt), starts as nothing, and is found again by name in
 * whichever attempt is on screen. When that attempt has no suite of the name, the selection is
 * cleared — here and in the address — and the card says so; it never becomes another suite's
 * data. `suitesView`'s `scope` is what the physical-tests
 * ([#338](https://github.com/NobuData/ouroboros/issues/338)) and failure-detail
 * ([#339](https://github.com/NobuData/ouroboros/issues/339)) cards are scoped by.
 *
 * **Three polls on the I.8 cadence** ([#87](https://github.com/NobuData/ouroboros/issues/87)): the
 * run's timeline, so a running build's strip moves; the attempt's re-run gate, rebuilt when the
 * attempt changes, so a runner coming online switches the buttons on; and the attempt's page, for
 * its suites, rebuilt the same way. A failed refresh keeps the last answer on screen under a
 * banner rather than blanking it.
 *
 * **The actions are honestly gated** (`actionsView`), and *Send failures back to loop* stages the
 * failed set on the Mark & Route slot and moves focus there.
 *
 * @param props See {@link TestsScreenProps}.
 * @returns The screen.
 */
export function TestsScreen({
  runId,
  initial,
  initialError,
  initialAttempt,
  initialGate = null,
  initialSuite = null,
  initialPage = null,
  trackerUrl,
  commitSource = null,
  pullRequest = null,
  origin,
  mayContribute = false,
  timelinePoll,
  gatePoll,
  pagePoll,
  send = requestRerun,
}: TestsScreenProps) {
  const timelineRead = useKeyedPoll(runId, (id) => createTimelinePoll(id, timelinePoll));

  useEffect(() => setNavOrigin(origin.id), [origin.id]);

  const timeline = timelineRead.snapshot.data ?? initial;
  // A poll's own verdict supersedes the server's once it has one — either way.
  const error =
    timelineRead.snapshot.updatedAt === null
      ? (timelineRead.snapshot.error ?? initialError)
      : timelineRead.snapshot.error;

  const [requested, setRequested] = useState<number | null>(initialAttempt);
  const attempt = timeline === null ? null : selectedAttempt(timeline.attempts, requested);

  const gateRead = useKeyedPoll(attempt?.id ?? null, (id) => createGatePoll(id, gatePoll));
  const gate =
    gateRead.snapshot.data ?? (initialGate !== null && initialGate.testRunId === attempt?.id ? initialGate : null);

  const pageRead = useKeyedPoll(attempt?.id ?? null, (id) => createPagePoll(id, pagePoll));
  const page =
    pageRead.snapshot.data ??
    (initialPage !== null && initialPage.testRun.id === attempt?.id ? initialPage : null);

  const [suite, setSuite] = useState<SuiteSelection | null>(
    initialSuite === null ? null : { name: initialSuite, platform: null },
  );
  const [cleared, setCleared] = useState<ForAttempt<string> | null>(null);

  // The attempt on screen has no suite of the selected name — an attempt switch, or an address
  // naming one that never ran. Cleared during render, so another suite's data is never drawn
  // under the selection, and said on the card.
  if (
    suite !== null &&
    attempt !== null &&
    page !== null &&
    page.testRun.id === attempt.id &&
    resolveSuite(page.suites, suite) === null
  ) {
    setSuite(null);
    setCleared({
      testRunId: attempt.id,
      value: selectionCleared(suite.name, attempt.attemptSeq),
    });
  }

  // The address follows the selection, however it changed — a press or a clearing.
  const suiteName = suite?.name ?? null;
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const next = withSuite(search, suiteName);
    if (next === search) return;

    window.history.replaceState(window.history.state, "", `${pathname}${next}${hash}`);
  }, [suiteName]);

  const [pending, setPending] = useState<RerunScope | null>(null);
  const [outcome, setOutcome] = useState<ForAttempt<ActionOutcome> | null>(null);
  const [staged, setStaged] = useState<StagedFailures | null>(null);
  const [focusRequests, setFocusRequests] = useState(0);
  const slot = useRef<HTMLElement>(null);

  // After *Send failures back to loop* has staged the set and the slot has drawn it: bring the
  // slot into the pane's view and put focus on it, so a keyboard or screen-reader user lands
  // where a sighted one is looking.
  useEffect(() => {
    if (focusRequests === 0) return;

    const region = slot.current;
    region?.scrollIntoView?.({ block: "start" });
    region?.focus({ preventScroll: true });
  }, [focusRequests]);

  /**
   * Read another attempt, and say so in the address.
   *
   * @param attemptSeq The attempt's ordinal.
   */
  function selectAttempt(attemptSeq: number): void {
    setRequested(attemptSeq);

    const { pathname, search, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${withAttempt(search, attemptSeq)}${hash}`,
    );
  }

  /**
   * Select a suite, or clear the selection. The address follows.
   *
   * @param selection The suite, by name and platform, or `null`.
   */
  function selectSuite(selection: SuiteSelection | null): void {
    setSuite(selection);
    setCleared(null);
  }

  /**
   * Queue a re-run of the attempt on screen, then say what became of it.
   *
   * @param scope `failed` or `full`.
   */
  async function rerun(scope: RerunScope): Promise<void> {
    if (attempt === null || pending !== null) return;

    const testRunId = attempt.id;
    setPending(scope);

    try {
      const answer = await send(testRunId, scope);
      setOutcome({
        testRunId,
        value: answer.ok
          ? { text: rerunOutcome(answer.rerun), failed: false }
          : { text: answer.reason, failed: true },
      });
    } finally {
      setPending(null);
      timelineRead.refresh();
      gateRead.refresh();
    }
  }

  /** Stage the attempt's failed set on Mark & Route, and take the reader there. */
  function sendBack(): void {
    if (attempt === null) return;

    setStaged({ testRunId: attempt.id, cases: attempt.strip.failedCases });
    setFocusRequests((count) => count + 1);
  }

  const head =
    timeline === null
      ? null
      : testsHead(timeline, attempt, trackerUrl, pullRequestLink(pullRequest, origin.id));
  const actions =
    attempt === null
      ? null
      : actionsView({
          attempt,
          gate,
          gateError: gateRead.snapshot.error,
          mayContribute,
          pending,
        });

  return (
    <main className="tests">
      <nav aria-label={BREADCRUMB_LABEL} className="tests__crumbs">
        <ol className="tests__crumb-list">
          <li className="tests__crumb">
            <Link className="tests__crumb-link" href={origin.route}>
              {origin.label}
            </Link>
          </li>
          <li className="tests__crumb">
            <Link className="tests__crumb-link" href={runPath(runId, origin.id)}>
              {timeline === null ? "Run" : `Loop #${timeline.run.loopSeq}`}
            </Link>
          </li>
          <li aria-current="page" className="tests__crumb">
            {TESTS_CRUMB}
          </li>
        </ol>
      </nav>

      {error !== null && (
        <RetryBanner
          className="tests__banner"
          headline={timeline === null ? UNREAD_HEADLINE : STALE_HEADLINE}
          onRetry={timelineRead.refresh}
          reason={error}
        />
      )}

      {head !== null && (
        <TestsHead
          actions={
            actions === null ? null : (
              <TestsActions
                onRerun={(scope) => void rerun(scope)}
                onSendBack={sendBack}
                outcome={outcome !== null && outcome.testRunId === attempt?.id ? outcome.value : null}
                view={actions}
              />
            )
          }
          view={head}
        />
      )}

      {timeline !== null && attempt === null && <p className="tests__empty">{NO_ATTEMPTS}</p>}

      {timeline !== null && attempt !== null && (
        <>
          <AttemptsTimeline
            onSelect={selectAttempt}
            view={timelineView(timeline, attempt.attemptSeq, commitSource)}
          />
          <SummaryStrip view={stripView(attempt.strip)} />
          <SuitesCard
            error={pageRead.snapshot.error}
            notice={cleared !== null && cleared.testRunId === attempt.id ? cleared.value : null}
            onRetry={pageRead.refresh}
            onSelect={selectSuite}
            view={page === null ? null : suitesView(page.suites, suite)}
          />
          <MarkRouteSlot
            ref={slot}
            staged={staged !== null && staged.testRunId === attempt.id ? staged : null}
          />
        </>
      )}
    </main>
  );
}

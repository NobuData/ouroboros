"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { FarmPage } from "@/app/api/farm";
import type { PullRequestRef } from "@/app/api/pull-requests";
import type {
  RerunAvailability,
  RerunScope,
  TestCaseFailureDetail,
  TestRunHints,
  TestRunPage,
  TestRunTimeline,
} from "@/app/api/test-results";
import { type FarmPollOptions, createFarmPoll } from "@/app/farm/farm-poll";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { TESTS_ATTEMPT_PARAM, TESTS_CASE_PARAM, TESTS_SUITE_PARAM, runPath } from "@/app/paths";
import type { CommitSource } from "@/app/runs/cards";
import type { RunOrigin } from "@/app/runs/origin";
import { BREADCRUMB_LABEL } from "@/app/runs/view";
import { setNavOrigin } from "@/app/shell/nav-registry";
import { workflowCaption } from "@/app/runs/view";
import { RetryBanner } from "@/app/ui";

import { artifactsView } from "./artifacts";
import type { ArtifactReader } from "./artifact-viewer";
import { ArtifactsCard } from "./artifacts-card";
import { AttemptsTimeline } from "./attempts-timeline";
import { failureScope } from "./failure";
import { FailureDetail } from "./failure-detail";
import { TestsIngestLagBanner } from "./ingest-lag-banner";
import { MarkRouteSlot, type StagedFailures } from "./mark-route-slot";
import {
  type CaseSelection,
  caseCleared,
  caseOutOfScope,
  physicalSuites,
  physicalView,
  resolveCase,
} from "./physical";
import { ParseWarnings } from "./parse-warnings";
import { PartialNote } from "./partial-note";
import { PhysicalCard } from "./physical-card";
import {
  type TestsPollOptions,
  createGatePoll,
  createHintsPoll,
  createPagePoll,
  createTimelinePoll,
} from "./poll";
import type { RerunOutcome } from "./rerun";
import { requestRerun } from "./rerun-actions";
import { emptyKind, parseWarningsView, partialNote, unknownAttemptNote } from "./states";
import { type SuiteSelection, resolveSuite, selectionCleared, suitesView } from "./suites";
import { SuitesCard } from "./suites-card";
import { SummaryStrip } from "./summary-strip";
import { type ActionOutcome, TestsActions } from "./tests-actions";
import { TestsEmpty } from "./tests-empty";
import { TestsHead } from "./tests-head";
import { timelineView } from "./timeline";
import {
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
 * The address with a name parameter set or removed, everything else kept.
 *
 * @param search The current query, `?…` or empty.
 * @param param The parameter.
 * @param name The name it carries, or `null` to remove it.
 * @returns The new query, with its `?` — or empty when nothing is left to say.
 */
function withName(search: string, param: string, name: string | null): string {
  const query = new URLSearchParams(search);

  if (name === null) query.delete(param);
  else query.set(param, name);

  const next = query.toString();

  return next === "" ? "" : `?${next}`;
}

/**
 * The address with `?suite=` set or removed, everything else kept.
 *
 * @param search The current query, `?…` or empty.
 * @param suite The selected suite's name, or `null` for none.
 * @returns The new query, with its `?` — or empty when nothing is left to say.
 */
export function withSuite(search: string, suite: string | null): string {
  return withName(search, TESTS_SUITE_PARAM, suite);
}

/**
 * The address with `?case=` set or removed, everything else kept.
 *
 * @param search The current query, `?…` or empty.
 * @param name The selected physical case's name, or `null` for none.
 * @returns The new query, with its `?` — or empty when nothing is left to say.
 */
export function withCase(search: string, name: string | null): string {
  return withName(search, TESTS_CASE_PARAM, name);
}

/** What the farm's poll is keyed on: there is one farm, asked only while a rig is on screen. */
const FARM_KEY = "farm";

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
  /** The physical case `?case=` named, or `null` for none. `null` when absent. */
  readonly initialCase?: string | null;
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
  /**
   * Whether the run's stages include the test stage, or `null` when they could not be read.
   * `null` when absent.
   */
  readonly hasTestStage?: boolean | null;
  /**
   * When the server made the first read, in epoch milliseconds — the ingest-lag banner's clock
   * on the server's render and the hydration pass, so the two match. `null` when absent or when
   * that read failed; the banner is then first drawn in the browser, by its own clock.
   */
  readonly readAt?: number | null;
  /** Test seams for the timeline's poll; production passes none. */
  readonly timelinePoll?: TestsPollOptions<TestRunTimeline>;
  /** Test seams for the gate's poll; production passes none. */
  readonly gatePoll?: TestsPollOptions<RerunAvailability>;
  /** Test seams for the attempt page's poll; production passes none. */
  readonly pagePoll?: TestsPollOptions<TestRunPage>;
  /** Test seams for the farm's poll — the rigs' presence; production passes none. */
  readonly farmPoll?: FarmPollOptions;
  /** Test seams for the triage hints' poll; production passes none. */
  readonly hintsPoll?: TestsPollOptions<TestRunHints>;
  /** Test seams for the bound failure's poll; production passes none. */
  readonly failurePoll?: TestsPollOptions<TestCaseFailureDetail>;
  /** How to send a re-run. Defaults to the Server Action. */
  readonly send?: RerunSender;
  /** How the artifacts card's viewer reads a file; production passes none. */
  readonly artifactRead?: ArtifactReader;
}

/**
 * The test-results frame ([#335](https://github.com/NobuData/ouroboros/issues/335)) — mockup 11's
 * breadcrumb, head, actions, build attempts timeline
 * ([#336](https://github.com/NobuData/ouroboros/issues/336)), summary strip, suites card
 * ([#337](https://github.com/NobuData/ouroboros/issues/337)), physical-tests card
 * ([#338](https://github.com/NobuData/ouroboros/issues/338)), failure-detail card
 * ([#339](https://github.com/NobuData/ouroboros/issues/339)) and artifacts card
 * ([#341](https://github.com/NobuData/ouroboros/issues/341)), for one attempt of one run.
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
 * **The selected physical case is the third**, a name in `?case=` kept the same way. It is looked
 * for among the physical suites the selected suite leaves on the card; a case the attempt did not
 * run on a rig, or one outside the selected suite, is cleared and said to be.
 * `physicalView`'s `scope` is what the failure-detail card is scoped by.
 *
 * **Three polls on the I.8 cadence** ([#87](https://github.com/NobuData/ouroboros/issues/87)): the
 * run's timeline, so a running build's strip moves; the attempt's re-run gate, rebuilt when the
 * attempt changes, so a runner coming online switches the buttons on; and the attempt's page, for
 * its suites, rebuilt the same way. A failed refresh keeps the last answer on screen under a
 * banner rather than blanking it.
 *
 * **And the farm's, while a rig is on screen** — the build farm's own poll, read for one thing:
 * whether a runner of the rig's name is connected. Until it answers, and whenever it cannot, the
 * `rig online` pill is omitted.
 *
 * **The failure-detail card is bound by both selections** (`failureScope`): the selected
 * physical case alone, else the selected suite's failures, else the attempt's. It is keyed by the
 * attempt and both selections, so a change to either re-binds it from the first failure. The
 * attempt's triage hints are a poll of their own, asked only while a failure is in scope; the
 * bound case's failure is the card's.
 *
 * **The artifacts card reads the attempt's page too** — its files, its tombstones and its
 * coverage — and is keyed by the attempt, so an open viewer closes when the attempt changes.
 *
 * **The actions are honestly gated** (`actionsView`), and *Send failures back to loop* stages the
 * failed set on the Mark & Route slot and moves focus there.
 *
 * **The states the mockup does not draw** ([#342](https://github.com/NobuData/ouroboros/issues/342),
 * `states.ts`): a running build's figures are labelled *partial*; a run with no attempt says
 * whether its workflow has no test stage or has simply reported nothing; a report that parsed in
 * part names what is missing; a running build whose uploads have gone quiet says when a report
 * last arrived — never over a failed read's banner, which takes precedence; and an `?attempt=`
 * naming no build says which build is shown instead.
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
  initialCase = null,
  initialPage = null,
  trackerUrl,
  commitSource = null,
  pullRequest = null,
  origin,
  mayContribute = false,
  hasTestStage = null,
  readAt = null,
  timelinePoll,
  gatePoll,
  pagePoll,
  farmPoll,
  hintsPoll,
  failurePoll,
  send = requestRerun,
  artifactRead,
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

  const [picked, setPicked] = useState<CaseSelection | null>(
    initialCase === null ? null : { name: initialCase, platform: null },
  );
  const [caseNotice, setCaseNotice] = useState<ForAttempt<string> | null>(null);

  const onScreen = page !== null && attempt !== null && page.testRun.id === attempt.id ? page : null;
  const partial = attempt === null ? null : partialNote(attempt);
  const warnings =
    onScreen === null || attempt === null
      ? null
      : parseWarningsView(onScreen.parseWarnings, attempt);
  const unknownAttempt = unknownAttemptNote(requested, attempt);
  // Resolved against the page on screen: a selection that is about to be cleared scopes nothing.
  const suiteScope = onScreen === null ? null : suitesView(onScreen.suites, suite).scope;

  // The selected case is not on the card — the attempt did not run it on a rig, or the suite
  // now selected does not hold it. Cleared during render, for the suite selection's reason.
  if (picked !== null && attempt !== null && onScreen !== null) {
    const stillSelected = suite === null || suiteScope !== null;

    if (stillSelected && resolveCase(physicalSuites(onScreen.suites, suiteScope), picked) === null) {
      const ranOnARig = resolveCase(physicalSuites(onScreen.suites, null), picked) !== null;

      setPicked(null);
      setCaseNotice({
        testRunId: attempt.id,
        value:
          ranOnARig && suiteScope !== null
            ? caseOutOfScope(picked.name, suiteScope.name)
            : caseCleared(picked.name, attempt.attemptSeq),
      });
    }
  }

  const pickedName = picked?.name ?? null;
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const next = withCase(search, pickedName);
    if (next === search) return;

    window.history.replaceState(window.history.state, "", `${pathname}${next}${hash}`);
  }, [pickedName]);

  const hasRig = onScreen !== null && physicalSuites(onScreen.suites, null).length > 0;
  const farmRead = useKeyedPoll<FarmPage>(hasRig ? FARM_KEY : null, () => createFarmPoll(farmPoll));

  const physical =
    onScreen === null
      ? null
      : physicalView(onScreen, suiteScope, picked, farmRead.snapshot.data?.runners ?? null);
  const caseScope = physical?.scope ?? null;
  const failures =
    onScreen === null || attempt === null
      ? null
      : failureScope(onScreen.suites, suiteScope, caseScope, attempt.attemptSeq);
  const hasFailures = failures !== null && failures.entries.length > 0;
  const hintsRead = useKeyedPoll(hasFailures ? (attempt?.id ?? null) : null, (id) =>
    createHintsPoll(id, hintsPoll),
  );

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
    setCaseNotice(null);
  }

  /**
   * Select a physical case, or clear the selection. The address follows.
   *
   * @param selection The case, by name and its suite's platform, or `null`.
   */
  function selectCase(selection: CaseSelection | null): void {
    setPicked(selection);
    setCaseNotice(null);
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

      {error === null && attempt !== null && (
        <TestsIngestLagBanner
          attempt={attempt}
          onRetry={timelineRead.refresh}
          readAt={readAt ?? 0}
        />
      )}

      {timeline !== null && attempt === null && (
        <TestsEmpty
          consoleHref={runPath(runId, origin.id)}
          kind={emptyKind(hasTestStage)}
          workflow={workflowCaption(timeline.run.workflowTag, timeline.run.workflowVersionPin)}
          workflowSlug={timeline.run.workflowTag}
        />
      )}

      {timeline !== null && attempt !== null && (
        <>
          {unknownAttempt !== null && (
            <p className="tests__notice" role="status">
              {unknownAttempt}
            </p>
          )}
          {warnings !== null && <ParseWarnings view={warnings} />}
          <AttemptsTimeline
            onSelect={selectAttempt}
            view={timelineView(timeline, attempt.attemptSeq, commitSource)}
          />
          {partial !== null && <PartialNote note={partial} />}
          <SummaryStrip view={stripView(attempt.strip)} />
          <SuitesCard
            error={pageRead.snapshot.error}
            notice={cleared !== null && cleared.testRunId === attempt.id ? cleared.value : null}
            onRetry={pageRead.refresh}
            onSelect={selectSuite}
            view={page === null ? null : suitesView(page.suites, suite)}
          />
          <PhysicalCard
            notice={
              caseNotice !== null && caseNotice.testRunId === attempt.id ? caseNotice.value : null
            }
            onSelect={selectCase}
            view={physical}
          />
          <FailureDetail
            attemptSeq={attempt.attemptSeq}
            failurePoll={failurePoll}
            hints={hintsRead.snapshot.data}
            hintsError={hintsRead.snapshot.error}
            key={`${attempt.id}:${suiteScope?.id ?? ""}:${caseScope?.caseId ?? ""}`}
            scope={failures}
            testRunId={attempt.id}
          />
          <MarkRouteSlot
            ref={slot}
            staged={staged !== null && staged.testRunId === attempt.id ? staged : null}
          />
          <ArtifactsCard
            key={attempt.id}
            read={artifactRead}
            view={onScreen === null ? null : artifactsView(onScreen)}
          />
        </>
      )}
    </main>
  );
}

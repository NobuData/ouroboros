"use client";

import { useRouter } from "next/navigation";
import { Fragment, useId, useState } from "react";

import type { RepoDetection } from "@/app/api/detection";
import type { Onboarding } from "@/app/api/onboarding";
import type { Reading } from "@/app/api/reading";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { SOURCES_PATH } from "@/app/paths";
import { Button, Eyebrow } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { continueStep, enableRepository, launchFirstLoop, skipWizard } from "./actions";
import { DetectionCard } from "./detection-card";
import type { DetectionPollOptions } from "./detection-poll";
import { type OnboardingPollOptions, createOnboardingPoll, onboardingEndpoint } from "./poll";
import {
  BACK_FROM_FIRST_HREF,
  BACK_LABEL,
  CONNECT_LABEL,
  EYEBROW,
  NO_REPOSITORY_LINE,
  NO_REPOSITORY_TITLE,
  PROMISE,
  PROMISE_TERM,
  RAIL_LABEL,
  REGRESSION_TITLE,
  SKIPPING,
  SKIP_LABEL,
  SKIP_NOTE,
  STEP_MARKS,
  STEP_STATES,
  TITLE,
  VIEWER_REASON,
  WORKING,
  type Abilities,
  type PrimaryAction,
  openingStep,
  primaryAction,
  receiptLine,
  regressionLine,
  regressionsOf,
  stepCounter,
} from "./view";

import "./get-started.css";

/** What {@link GetStartedScreen} takes. */
export interface GetStartedScreenProps {
  /** The repository the wizard is for, or null when the workspace has mirrored none. */
  readonly repo: string | null;
  /** The first paint's read of its wizard, or null when there is no repository. */
  readonly wizard: Reading<Onboarding> | null;
  /** The first paint's read of its detection card (BC.2, #391), or null when there is no repository. */
  readonly detection?: Reading<RepoDetection> | null;
  /** Why the repository list could not be read, when that is why there is no repository. */
  readonly reposFailure: string | null;
  /** What the person may do. */
  readonly abilities: Abilities;
  /** Test seams for the wizard's poll. */
  readonly poll?: OnboardingPollOptions;
  /** Test seams for the detection card's poll and clock. */
  readonly detectionPoll?: DetectionPollOptions;
  /** The detection card's clock — a test seam. */
  readonly now?: () => number;
}

/**
 * The head: the mockup's eyebrow and headline, the promise from the approved claim set with its
 * one bold term, and the corner link — labelled for what it does (skip to Settings), not for the
 * bundle import that arrives with #398.
 *
 * @param props.repo The repository, or null.
 * @param props.abilities What the person may do.
 * @returns The head.
 */
function WizardHead({ repo, abilities }: Readonly<{ repo: string | null; abilities: Abilities }>) {
  const router = useRouter();
  const note = useId();
  const [state, setState] = useState<{ phase: "idle" | "skipping" } | { phase: "refused"; reason: string }>({
    phase: "idle",
  });

  /** Mark the wizard bypassed, then go where the service says. */
  function skip(): void {
    if (repo === null || state.phase === "skipping") return;

    setState({ phase: "skipping" });
    void skipWizard(repo).then((outcome) => {
      if (outcome.ok) router.push(outcome.value);
      else setState({ phase: "refused", reason: outcome.reason });
    });
  }

  const promise = PROMISE.map((claim) => claim.text);

  return (
    <header className="wizard__head">
      <div className="wizard__headings">
        <Eyebrow>{EYEBROW}</Eyebrow>
        <h1 className="wizard__title">{TITLE}</h1>
        <p className="wizard__sub">
          {/* "Ouroboros starts in **dry-run**: it opens draft PRs and never merges until you say so." */}
          {promise[0]!.slice(0, promise[0]!.length - PROMISE_TERM.length)}
          <strong className="wizard__term">{PROMISE_TERM}</strong>: {promise[1]} and {promise[2]}. {promise[3]}
        </p>
      </div>
      <div className="wizard__skip">
        <Button
          aria-describedby={note}
          className="wizard__skip-link"
          onClick={skip}
          reason={
            repo === null
              ? "Nothing to skip until a repository is connected."
              : !abilities.contribute
                ? VIEWER_REASON
                : state.phase === "skipping"
                  ? SKIPPING
                  : undefined
          }
          size="sm"
          tone="ghost"
        >
          {SKIP_LABEL}
        </Button>
        <span className="sr-only" id={note}>
          {SKIP_NOTE}
        </span>
        {state.phase === "refused" && (
          <p className="wizard__refusal" role="alert">
            {state.reason}
          </p>
        )}
      </div>
    </header>
  );
}

/**
 * The step rail — the mockup's four steps, each a button that puts its step on screen. Done
 * steps print the service's result line; a regressed step is drawn as not done, and the banner
 * above the content says why.
 *
 * @param props.wizard The wizard.
 * @param props.viewed The step on screen.
 * @param props.onView Puts a step on screen.
 * @returns The rail.
 */
function StepRail({
  wizard,
  viewed,
  onView,
}: Readonly<{ wizard: Onboarding; viewed: number; onView: (step: number) => void }>) {
  return (
    <nav aria-label={RAIL_LABEL} className="wizard-rail">
      <ol className="wizard-rail__steps">
        {wizard.steps.map((step) => (
          <li
            className={cx(
              "wizard-step",
              step.status === "done" && "wizard-step--done",
              step.status === "active" && "wizard-step--active",
              step.status === "todo" && "wizard-step--todo",
              step.regressed && "wizard-step--regressed",
            )}
            key={step.step}
          >
            <button
              aria-current={viewed === step.step ? "step" : undefined}
              className="wizard-step__button"
              onClick={() => onView(step.step)}
              type="button"
            >
              <span aria-hidden className="wizard-step__mark">
                {STEP_MARKS[step.status]}
              </span>
              <span className="wizard-step__text">
                <span className="wizard-step__num">Step {step.step}</span>
                <span className="wizard-step__name">{step.title}</span>
                <span className="sr-only">
                  , {step.regressed ? "no longer done" : STEP_STATES[step.status]}
                </span>
                {step.status === "done" && step.evidence !== null && (
                  <span className="wizard-step__result">{step.evidence}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The action bar — the counter, Back, and the step's primary action, disabled with its reason
 * whenever a guard would refuse it.
 *
 * @param props.counter The counter.
 * @param props.onBack Puts the previous step on screen, or null on the first.
 * @param props.action The primary action.
 * @param props.busy Whether a write is in flight.
 * @param props.onPress Runs the action (everything but a link).
 * @param props.status What the last write said, or null.
 * @returns The bar.
 */
function ActionBar({
  counter,
  onBack,
  action,
  busy,
  onPress,
  status,
}: Readonly<{
  counter: string;
  onBack: (() => void) | null;
  action: PrimaryAction;
  busy: boolean;
  onPress: () => void;
  status: { readonly tone: "ok" | "refused"; readonly text: string } | null;
}>) {
  return (
    <div aria-label="Wizard actions" className="wizard-bar" role="group">
      <span className="wizard-bar__counter">{counter}</span>
      {status !== null && (
        <p
          className={cx("wizard-bar__status", status.tone === "refused" && "wizard-bar__status--refused")}
          role={status.tone === "refused" ? "alert" : "status"}
        >
          {status.text}
        </p>
      )}
      <span className="wizard-bar__spacer" />
      {onBack === null ? (
        <Button href={BACK_FROM_FIRST_HREF} tone="ghost">
          {BACK_LABEL}
        </Button>
      ) : (
        <Button onClick={onBack} tone="ghost">
          {BACK_LABEL}
        </Button>
      )}
      {action.kind === "link" && action.href !== undefined && action.blocked === null ? (
        <Button href={action.href} tone="primary">
          {action.label}
        </Button>
      ) : (
        <Button onClick={onPress} reason={busy ? WORKING : (action.blocked ?? undefined)} tone="primary">
          {busy ? WORKING : action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * `/get-started` (BC.1, [#390](https://github.com/NobuData/ouroboros/issues/390), mockup 13) —
 * the standalone wizard frame: the promise in the head, the four-step rail that displays the
 * service's derived answer, and the glow action bar whose primary action changes with the step.
 *
 * **Standalone.** It renders outside the app shell (design system § 5): no shell header or
 * sidebar. The document is locked (`app/globals.css`), so the frame owns its scroll: the head,
 * the rail and the action bar stay put and only the step content scrolls.
 *
 * **Live.** The rail is re-read on the poll family's cadence, so a source disconnected elsewhere
 * regresses step 1 here — and the banner says why, in the service's words.
 *
 * **The detection card** (BC.2, [#391](https://github.com/NobuData/ouroboros/issues/391)) sits in
 * the step content under the step panel whenever there is a repository, on a poll of its own.
 *
 * **Which step is on screen** is the page's own choice — the service's current step at first,
 * then whichever the person picks on the rail or reaches with Back and Continue. What the step
 * *is* stays the service's.
 *
 * @param props See {@link GetStartedScreenProps}.
 * @returns The screen.
 */
export function GetStartedScreen({
  repo,
  wizard: initial,
  detection = null,
  reposFailure,
  abilities,
  poll,
  detectionPoll,
  now,
}: GetStartedScreenProps) {
  const { snapshot, refresh } = useKeyedPoll(repo === null ? null : onboardingEndpoint(repo), (endpoint) =>
    createOnboardingPoll(endpoint, poll),
  );
  const wizard = snapshot.data ?? (initial?.ok === true ? initial.value : null);
  const failure = wizard === null ? (snapshot.error ?? (initial?.ok === false ? initial.reason : reposFailure)) : null;
  const [viewed, setViewed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "refused"; text: string } | null>(null);
  const content = useId();

  const step = viewed ?? (wizard === null ? 1 : openingStep(wizard));
  const action: PrimaryAction =
    wizard === null
      ? { kind: "link", label: CONNECT_LABEL, href: SOURCES_PATH, blocked: null }
      : primaryAction(wizard, step, abilities);
  const regressions = wizard === null ? [] : regressionsOf(wizard);
  const onScreen = wizard?.steps.find((one) => one.step === step);

  /** Run the primary action — continue, enable or launch — and say what the service answered. */
  function press(): void {
    if (busy || action.blocked !== null || repo === null) return;

    setBusy(true);
    setStatus(null);

    const done = (outcome: { ok: true } | { ok: false; reason: string }, after?: () => void): void => {
      setBusy(false);

      if (outcome.ok) {
        after?.();
        refresh();
      } else {
        setStatus({ tone: "refused", text: outcome.reason });
      }
    };

    switch (action.kind) {
      case "continue":
        void continueStep(repo, step).then((outcome) => done(outcome, () => setViewed(step + 1)));
        break;
      case "enable":
        void enableRepository(repo).then((outcome) => done(outcome));
        break;
      case "launch":
        void launchFirstLoop(repo).then((outcome) =>
          done(outcome, () => {
            if (outcome.ok) setStatus({ tone: "ok", text: receiptLine(outcome.value) });
          }),
        );
        break;
      default:
        setBusy(false);
    }
  }

  return (
    <div className="wizard">
      <WizardHead abilities={abilities} repo={repo} />
      {wizard !== null && <StepRail onView={setViewed} viewed={step} wizard={wizard} />}
      <main aria-labelledby={content} className="wizard__content">
        {regressions.length > 0 && (
          <section aria-label={REGRESSION_TITLE} className="wizard-regress">
            <h2 className="wizard-regress__title">{REGRESSION_TITLE}</h2>
            <ul className="wizard-regress__rows">
              {regressions.map((regression) => (
                <li key={regression.step}>{regressionLine(regression)}</li>
              ))}
            </ul>
          </section>
        )}
        {wizard === null ? (
          <section className="wizard-panel">
            <h2 className="wizard-panel__title" id={content}>
              {failure ?? NO_REPOSITORY_TITLE}
            </h2>
            {failure === null && <p className="wizard-panel__line">{NO_REPOSITORY_LINE}</p>}
          </section>
        ) : (
          <section className="wizard-panel">
            <h2 className="wizard-panel__title" id={content}>
              {onScreen === undefined ? (
                TITLE
              ) : (
                <Fragment>
                  <span className="wizard-panel__num">Step {onScreen.step}</span> {onScreen.title}
                </Fragment>
              )}
            </h2>
            {onScreen !== undefined && (
              <p className={cx("wizard-panel__line", onScreen.status === "done" && "wizard-panel__line--done")}>
                {onScreen.status === "done" ? onScreen.evidence : onScreen.reason}
              </p>
            )}
            <p className="wizard-panel__repo">{wizard.repo}</p>
          </section>
        )}
        {repo !== null && (
          <DetectionCard
            abilities={abilities}
            initial={detection}
            now={now}
            poll={detectionPoll}
            repo={repo}
            stepDone={wizard?.steps.find((one) => one.step === 2)?.status === "done"}
          />
        )}
      </main>
      <ActionBar
        action={action}
        busy={busy}
        counter={stepCounter(step)}
        onBack={step > 1 && wizard !== null ? () => setViewed(step - 1) : null}
        onPress={press}
        status={status}
      />
    </div>
  );
}

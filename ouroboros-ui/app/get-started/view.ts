/**
 * The Get Started frame's words and pure rules (BC.1,
 * [#390](https://github.com/NobuData/ouroboros/issues/390), mockup 13).
 *
 * **This frame cannot show a checkmark it cannot defend.** Every step's state, result line and
 * reason is the service's (BB.2, #385 — derived on read from the subsystem that owns it); this
 * module only decides how an answer is *drawn*: which step the action bar is about, what its
 * primary action is, and why it is disabled when it is. A step that went backwards is explained
 * ({@link regressionsOf}), never silently un-ticked.
 */

import type { Onboarding, OnboardingLaunchReceipt, OnboardingStep } from "@/app/api/onboarding";
import { DASHBOARD_PATH, SOURCES_PATH } from "@/app/paths";

/** The wizard's route. */
export const GET_STARTED_PATH = "/get-started";

/** The query parameter naming the repository the wizard is for. */
export const REPO_PARAM = "repo";

/** How many steps the rail has. */
export const STEP_COUNT = 4;

/** The head, verbatim from mockup 13. */
export const EYEBROW = "Get Started";
export const TITLE = "Your first loop in about 4 minutes.";

/** One claim of the head's promise, with the mechanism that keeps it (decision **O9**). */
export interface PromiseClaim {
  /** The words, as the subline prints them. */
  readonly text: string;
  /** What makes it true — named, so the promise cannot widen without the mechanism widening. */
  readonly mechanism: string;
}

/**
 * The subline — the product's central promise — as the **approved claim set** (decision O9).
 * The head renders these and only these; each names the mechanism that keeps it, so a change
 * to the words is a change reviewed against the mechanism, never free text:
 *
 * > Ouroboros starts in **dry-run**: it opens draft PRs and never merges until you say so.
 * > Nothing here is irreversible.
 */
export const PROMISE: readonly PromiseClaim[] = [
  {
    text: "Ouroboros starts in dry-run",
    mechanism: "The first-run launch turns the dry-run policy on when the workspace never answered (BB.5, #388).",
  },
  {
    text: "it opens draft PRs",
    mechanism: "The PR opener forces a draft while dry-run is active (BA.3, #382).",
  },
  {
    text: "never merges until you say so",
    mechanism: "Arming and merging are refused while dry-run is active, re-checked at execution (BA.3, #382).",
  },
  {
    text: "Nothing here is irreversible.",
    mechanism: "Every choice here is stored as a choice — a template pick, an issue pick, dismissal, the skip — and changed or cleared later (BB.2, #385).",
  },
];

/** The term the subline sets in bold — the mockup's **dry-run**. */
export const PROMISE_TERM = "dry-run";

/**
 * The corner link — honest about what it does. The mockup's *"import config"* names a bundle
 * import that arrives with [#398](https://github.com/NobuData/ouroboros/issues/398); until then
 * the link marks this wizard skipped and goes to Settings, and imports nothing.
 */
export const SKIP_LABEL = "I've done this before — set it up in Settings ↗";
export const SKIP_NOTE = "Marks this wizard skipped and opens Settings. Nothing is imported — importing a saved configuration arrives with #398.";
export const SKIPPING = "Opening Settings…";

/** The rail's accessible name. */
export const RAIL_LABEL = "Get Started steps";

/** The step marks, by state — the mockup's ✓ ● ○. */
export const STEP_MARKS: Readonly<Record<OnboardingStep["status"], string>> = {
  done: "✓",
  active: "●",
  todo: "○",
};

/** How a screen reader hears each state. */
export const STEP_STATES: Readonly<Record<OnboardingStep["status"], string>> = {
  done: "done",
  active: "in progress",
  todo: "not started",
};

/** The action bar's Back, and where it leads from step 1. */
export const BACK_LABEL = "Back";
export const BACK_FROM_FIRST_HREF = DASHBOARD_PATH;

/** The primary action's labels, per step. */
export const CONNECT_LABEL = "Connect GitHub →";
export const CONTINUE_LABEL = "Continue →";
export const LAUNCH_LABEL = "Run my first loop →";
export const FINISHED_LABEL = "Open the dashboard →";
export const WORKING = "Working…";

/** Why a person cannot press the primary action. */
export const VIEWER_REASON = "Viewers can follow the wizard but not move it on — ask an owner, admin or member.";
export const ENABLE_ADMIN_REASON = "Only an owner or admin can enable a repository.";
/** Step 4's reason when the service gave none — launching needs a picked first issue. */
export const NO_PICK_REASON = "Pick a first issue to run.";

/** What the page says when nothing is mirrored yet, so there is no repository to ask about. */
export const NO_REPOSITORY_TITLE = "No repository is connected yet";
export const NO_REPOSITORY_LINE =
  "Connect GitHub and choose which repositories Ouroboros may read; the steps below follow from that.";

/** What a write says when the service failed rather than refused. */
export const WIZARD_WRITE_FAILED = "That did not go through. Try again.";

/** What a write says for a repository that is not shaped like one. */
export const NOT_A_REPOSITORY = "That is not a repository — expected owner/name.";

/** What the page says when the wizard could not be read. */
export const UNREACHABLE_ONBOARDING = "The wizard could not be reached.";
export const UNREADABLE_ONBOARDING = "The wizard could not be read.";

/** The dashboard's offer of the wizard — present only while the fresh-org rule offers it. */
export interface GetStartedOffer {
  /** The repository the banner's link opens and its dismissal is recorded on, or null for none. */
  readonly repo: string | null;
}

/** The dashboard's offer of the wizard (the fresh-org rule, #385). */
export const OFFER_LINE = "New workspace — your first loop in about 4 minutes.";
export const OFFER_LINK = "Get started →";
export const OFFER_DISMISS = "Dismiss";
export const OFFER_DISMISSING = "Dismissing…";
export const OFFER_NO_REPO = "Nothing to dismiss until a repository is connected — the wizard is per repository.";

/** The regression banner's heading. */
export const REGRESSION_TITLE = "A step that was done is not any more";

/** A repository as the query names it — V067's `owner/name`. */
const REPO_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/**
 * Read the repository a request names, if it is shaped like one.
 *
 * @param value The query value.
 * @returns `owner/name`, or null for anything else — nothing malformed is forwarded.
 */
export function parseRepo(value: string | string[] | undefined | null): string | null {
  const one = Array.isArray(value) ? value[0] : value;

  return typeof one === "string" && REPO_SHAPE.test(one) ? one : null;
}

/**
 * The wizard's address for a repository.
 *
 * @param repo `owner/name`, or null for the default.
 * @returns `/get-started?repo=owner%2Fname`, or `/get-started`.
 */
export function getStartedPath(repo: string | null): string {
  return repo === null ? GET_STARTED_PATH : `${GET_STARTED_PATH}?${REPO_PARAM}=${encodeURIComponent(repo)}`;
}

/**
 * The repository the wizard opens on when the request names none: an enabled one first (its
 * account enabled too), then any other — each group by `owner/name`, so the choice is stable.
 *
 * @param candidates The workspace's mirrored repositories.
 * @returns `owner/name`, or null when nothing is mirrored.
 */
export function defaultRepo(
  candidates: readonly { readonly login: string; readonly name: string; readonly enabled: boolean }[],
): string | null {
  const ranked = [...candidates].sort(
    (left, right) =>
      Number(right.enabled) - Number(left.enabled) ||
      `${left.login}/${left.name}`.localeCompare(`${right.login}/${right.name}`),
  );
  const first = ranked[0];

  return first === undefined ? null : `${first.login}/${first.name}`;
}

/**
 * The action bar's counter — the mockup's *Step 3 of 4*.
 *
 * @param step The step the bar is about.
 * @returns The counter.
 */
export function stepCounter(step: number): string {
  return `Step ${String(step)} of ${String(STEP_COUNT)}`;
}

/**
 * The step the frame opens on: the service's current step — the first not done — or the last
 * when every step is done.
 *
 * @param wizard The wizard.
 * @returns The step, 1–4.
 */
export function openingStep(wizard: Pick<Onboarding, "currentStep">): number {
  return wizard.currentStep ?? STEP_COUNT;
}

/** A step that went backwards, explained. */
export interface Regression {
  readonly step: number;
  readonly title: string;
  /** The service's reason — *The GitHub source "…" is paused, so … is not being read.* */
  readonly reason: string;
}

/**
 * Every step that was done and is not any more, with the service's reason — what the banner
 * says so a step never un-ticks without an explanation.
 *
 * @param wizard The wizard.
 * @returns The regressions, in rail order.
 */
export function regressionsOf(wizard: Pick<Onboarding, "steps">): Regression[] {
  return wizard.steps
    .filter((step) => step.regressed)
    .map((step) => ({
      step: step.step,
      title: step.title,
      reason: step.reason ?? `Step ${String(step.step)} is no longer done.`,
    }));
}

/**
 * The line a regressed step's banner row reads.
 *
 * @param regression The regression.
 * @returns `Step 1 · Connect GitHub — The GitHub source "…" is paused, …`.
 */
export function regressionLine(regression: Regression): string {
  return `Step ${String(regression.step)} · ${regression.title} — ${regression.reason}`;
}

/** What the primary action does. */
export type PrimaryKind = "link" | "continue" | "enable" | "launch";

/** The action bar's primary action for one step. */
export interface PrimaryAction {
  readonly kind: PrimaryKind;
  readonly label: string;
  /** Where a link goes. */
  readonly href?: string;
  /** Why it cannot be pressed, or null when it can. */
  readonly blocked: string | null;
  /**
   * The picker's suggestion a launch stores before it queues (BC.4, #393) — set only while the
   * wizard stores no pick and the first-issue card shows one; null otherwise.
   */
  readonly pickIssueId?: string | null;
}

/** What the frame knows beyond the wizard when it decides the primary action. */
export interface PrimaryContext {
  /** The picker's suggestion on screen while nothing is stored (its `issueId`), or null. */
  readonly suggestedIssueId?: string | null;
}

/** What the person may do in this workspace. */
export interface Abilities {
  /** `owner`, `admin` or `member` — may move the wizard on. */
  readonly contribute: boolean;
  /** `owner` or `admin` — may enable a repository. */
  readonly administer: boolean;
}

/**
 * The repository's own name — `helios-firmware` of `acme-robotics/helios-firmware`.
 *
 * @param repo `owner/name`.
 * @returns The name.
 */
export function repoName(repo: string): string {
  return repo.slice(repo.indexOf("/") + 1);
}

/**
 * The action bar's primary action for the step on screen — connect, enable, continue, then
 * **Run my first loop** — disabled with the reason whenever a guard would refuse it.
 *
 * - **An earlier step not done blocks it**, with that step's own reason: nothing skips ahead.
 * - **A done step continues** through the service's guard (`complete-step`), and the last one
 *   leads to the dashboard.
 * - **Step 1 links to Settings → Sources**, where GitHub is connected; **step 2 enables** the
 *   repository (owner or admin); **step 3 continues** once a workflow is instantiated — its
 *   reason until then is the service's; **step 4 runs the first loop** once an issue is picked
 *   (launching is what queues it, so *not queued yet* is what the button is for) — or, with
 *   nothing stored, once the first-issue card shows the picker's suggestion, which the press
 *   stores first (BC.4, #393).
 *
 * @param wizard The wizard.
 * @param step The step on screen, 1–4.
 * @param abilities What the person may do.
 * @param context The picker's suggestion on screen, when the card shows one.
 * @returns The action.
 */
export function primaryAction(
  wizard: Pick<Onboarding, "steps" | "repo" | "choices">,
  step: number,
  abilities: Abilities,
  context: PrimaryContext = {},
): PrimaryAction {
  const at = wizard.steps.find((one) => one.step === step);
  const earlier = wizard.steps.find((one) => one.step < step && one.status !== "done");
  const blockedBy = earlier === undefined ? null : `Step ${String(earlier.step)} first: ${earlier.reason ?? earlier.title}`;

  if (at === undefined) {
    return { kind: "link", label: FINISHED_LABEL, href: DASHBOARD_PATH, blocked: null };
  }

  if (at.status === "done") {
    return step >= STEP_COUNT
      ? { kind: "link", label: FINISHED_LABEL, href: DASHBOARD_PATH, blocked: null }
      : { kind: "continue", label: CONTINUE_LABEL, blocked: blockedBy ?? (abilities.contribute ? null : VIEWER_REASON) };
  }

  switch (step) {
    case 1:
      return { kind: "link", label: CONNECT_LABEL, href: SOURCES_PATH, blocked: null };
    case 2:
      return {
        kind: "enable",
        label: `Enable ${repoName(wizard.repo)} →`,
        blocked: blockedBy ?? (abilities.administer ? null : ENABLE_ADMIN_REASON),
      };
    case 3:
      return {
        kind: "continue",
        label: CONTINUE_LABEL,
        blocked: blockedBy ?? at.reason ?? `${at.title} is not done yet.`,
      };
    default: {
      const suggested = wizard.choices.pickedTicketId === null ? (context.suggestedIssueId ?? null) : null;

      return {
        kind: "launch",
        label: LAUNCH_LABEL,
        blocked:
          blockedBy ??
          (!abilities.contribute
            ? VIEWER_REASON
            : wizard.choices.pickedTicketId === null && suggested === null
              ? (at.reason ?? NO_PICK_REASON)
              : null),
        pickIssueId: suggested,
      };
    }
  }
}

/** What *Run my first loop* says once the service queued it. */
export const LAUNCH_OUTCOMES: Readonly<Record<OnboardingLaunchReceipt["outcome"], string>> = {
  queued: "queued",
  already_queued: "was already queued",
  already_started: "has already started",
};

/**
 * The line under the action bar after a launch — the receipt in a sentence, the dry-run note the
 * service composed included, so the page never implies draft-only when dry-run is off.
 *
 * @param receipt What the launch answered.
 * @returns `#488 queued under quick-fixes. Dry-run is on: …`.
 */
export function receiptLine(receipt: Pick<OnboardingLaunchReceipt, "issue" | "outcome" | "workflow" | "dryRun">): string {
  return `#${String(receipt.issue.number)} ${LAUNCH_OUTCOMES[receipt.outcome]} under ${receipt.workflow.slug}. ${receipt.dryRun.note}`;
}

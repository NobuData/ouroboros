/**
 * The onboarding rail, derived — never stored
 * ([#385](https://github.com/NobuData/ouroboros/issues/385), BB.2, decision **O1**).
 *
 * Mockup 13's rail is four checkmarks, and this file is where each one comes from. None of them
 * comes from the wizard: every step is a question put to the subsystem that owns the answer, and
 * this module composes the answers. The contract is V070's header table:
 *
 * ```
 * step                        done when                                          derived from
 * 1 Connect GitHub            an active GitHub source covers the repository      sources (WF-Q)
 * 2 Pick a repo               the repository and its GitHub account are enabled  tenancy
 * 3 Choose a workflow         a workflow instantiated from the picked template   workflows
 * 4 Run your first loop       the picked issue is queued or has a run            intake
 * ```
 *
 * Pure: {@link deriveRail} takes the facts the repository read and returns the rail, so the
 * derivation matrix is testable without a database, and nothing here can write.
 *
 * **Regression is derived too.** A step that is not done but shows evidence of having been done
 * — a later step is done, the wizard was completed, or its own subsystem still holds the thing in
 * a broken state (a paused or failing source) — is `todo` with `regressed: true` and a reason,
 * so the UI can explain rather than silently un-tick.
 */

/** A step's number on the rail. */
export type OnboardingStepNumber = 1 | 2 | 3 | 4;

/** Every step number, in rail order. */
export const ONBOARDING_STEPS: readonly OnboardingStepNumber[] = [1, 2, 3, 4];

/** How the rail draws a step. */
export type OnboardingStepStatus = "done" | "active" | "todo";

/** The subsystem a step's state was read from. */
export type OnboardingStepSource = "sources" | "tenancy" | "workflows" | "intake";

/** The GitHub ticket source that covers the repository, if any (`ticket_sources_public`). */
export interface SourceFact {
  /** The source's display name — "GitHub · acme-robotics". */
  readonly displayName: string;
  /** The account its config names. */
  readonly login: string;
  /** `active | paused | error`. */
  readonly status: "active" | "paused" | "error";
  /** Why the sync loop set `error`, when it did. */
  readonly statusReason: string | null;
  /** Whether the account's GitHub App is installed (`github_orgs.installed_at`, INTAKE-O.1). */
  readonly appInstalled: boolean;
}

/** The repository's enablement (`github_repos` under `github_orgs`). */
export interface RepositoryFact {
  /** `github_repos.enabled`. */
  readonly enabled: boolean;
  /** `github_orgs.enabled` — a repository is in scope only when its account is too. */
  readonly accountEnabled: boolean;
}

/** A workflow of the workspace instantiated from the picked template (V068 provenance). */
export interface WorkflowFact {
  readonly slug: string;
  readonly templateSlug: string;
  readonly templateVersion: number;
}

/** The picked ticket, and whether it has reached the loop. */
export interface PickedTicketFact {
  /** `#488`, `HEL-142`. */
  readonly externalKey: string;
  /** Whether the ticket is an issue of the wizard's repository (GitHub, same owner/name). */
  readonly inRepository: boolean;
  /** Whether a queue item for it exists. */
  readonly queued: boolean;
  /** Whether a run for it exists. */
  readonly run: boolean;
}

/** Everything the rail is derived from. */
export interface RailFacts {
  /** `owner/name`, lower-case. */
  readonly repo: string;
  readonly source: SourceFact | null;
  readonly repository: RepositoryFact | null;
  /** Whether a detection scan exists — step 2's evidence line reads "auto-detected below". */
  readonly scanned: boolean;
  /** `onboarding_state.selected_template`. */
  readonly selectedTemplate: string | null;
  readonly workflow: WorkflowFact | null;
  /** Null when no ticket is picked. */
  readonly pickedTicket: PickedTicketFact | null;
  /** `onboarding_state.completed_at` — evidence that every step was once done. */
  readonly completed: boolean;
}

/** One step of the rail, as derived. */
export interface DerivedStep {
  readonly step: OnboardingStepNumber;
  readonly status: OnboardingStepStatus;
  /** The result line a done step renders — "acme-robotics · token". Null when not done. */
  readonly evidence: string | null;
  /** Why the step is not done — the action bar's stated reason. Null when done. */
  readonly reason: string | null;
  /** True when the step is not done but was — see the file header. */
  readonly regressed: boolean;
  readonly derivedFrom: OnboardingStepSource;
}

/** The whole rail. */
export interface DerivedRail {
  /** Steps 1–4, in order. */
  readonly steps: readonly DerivedStep[];
  /** The first step that is not done — the action bar's `Step 3 of 4` — or null when all are. */
  readonly currentStep: OnboardingStepNumber | null;
}

/** One step's verdict before rail-level status is assigned. */
interface StepVerdict {
  readonly done: boolean;
  readonly evidence: string | null;
  readonly reason: string | null;
  /** The subsystem itself still holds the step's thing, broken — a paused or failing source. */
  readonly brokenInPlace: boolean;
  readonly derivedFrom: OnboardingStepSource;
}

/**
 * Step 1 — is the repository covered by a healthy GitHub source?
 *
 * The evidence says App or token truthfully: "GitHub App installed" only when the account's
 * `installed_at` is set (INTAKE-O.1), and "token" otherwise.
 */
function sourceStep(facts: RailFacts): StepVerdict {
  const { source, repo } = facts;

  if (source === null) {
    return {
      done: false,
      evidence: null,
      reason: `No GitHub source covers ${repo} yet — connect GitHub to continue.`,
      brokenInPlace: false,
      derivedFrom: "sources",
    };
  }

  if (source.status === "paused") {
    return {
      done: false,
      evidence: null,
      reason: `The GitHub source "${source.displayName}" is paused, so ${repo} is not being read.`,
      brokenInPlace: true,
      derivedFrom: "sources",
    };
  }

  if (source.status === "error") {
    const why = source.statusReason === null ? "" : `: ${source.statusReason}`;

    return {
      done: false,
      evidence: null,
      reason: `The GitHub source "${source.displayName}" is failing${why}.`,
      brokenInPlace: true,
      derivedFrom: "sources",
    };
  }

  return {
    done: true,
    evidence: `${source.login} · ${source.appInstalled ? "GitHub App installed" : "token"}`,
    reason: null,
    brokenInPlace: false,
    derivedFrom: "sources",
  };
}

/**
 * Step 2 — is the repository enabled, under an enabled account?
 *
 * A disabled repository is not, by itself, a regression: `github_repos.enabled` and
 * `github_orgs.enabled` both default to false, so "mirrored but not enabled" is the ordinary
 * state of a repository nobody has enabled yet. It regresses only on the rail-level evidence —
 * a later step done, or the wizard completed.
 */
function repositoryStep(facts: RailFacts): StepVerdict {
  const { repository, repo } = facts;
  const [owner, name] = splitRepo(repo);

  if (repository === null) {
    return {
      done: false,
      evidence: null,
      reason: `${repo} is not a repository of this workspace's GitHub accounts.`,
      brokenInPlace: false,
      derivedFrom: "tenancy",
    };
  }

  if (!repository.accountEnabled) {
    return {
      done: false,
      evidence: null,
      reason: `The GitHub account ${owner} is not enabled for this workspace.`,
      brokenInPlace: false,
      derivedFrom: "tenancy",
    };
  }

  if (!repository.enabled) {
    return {
      done: false,
      evidence: null,
      reason: `${repo} is not enabled — enable it to continue.`,
      brokenInPlace: false,
      derivedFrom: "tenancy",
    };
  }

  return {
    done: true,
    evidence: `${name} · ${facts.scanned ? "auto-detected below" : "enabled"}`,
    reason: null,
    brokenInPlace: false,
    derivedFrom: "tenancy",
  };
}

/** Step 3 — does a real workflow instantiated from the picked template exist? */
function workflowStep(facts: RailFacts): StepVerdict {
  if (facts.selectedTemplate === null) {
    return {
      done: false,
      evidence: null,
      reason: "No starting workflow has been chosen yet.",
      brokenInPlace: false,
      derivedFrom: "workflows",
    };
  }

  if (facts.workflow === null) {
    return {
      done: false,
      evidence: null,
      reason: `No workflow has been created from the ${facts.selectedTemplate} template yet.`,
      brokenInPlace: false,
      derivedFrom: "workflows",
    };
  }

  const { slug, templateSlug, templateVersion } = facts.workflow;

  return {
    done: true,
    evidence: `${slug} · from ${templateSlug}@v${templateVersion}`,
    reason: null,
    brokenInPlace: false,
    derivedFrom: "workflows",
  };
}

/** Step 4 — has the picked issue reached the loop? */
function firstRunStep(facts: RailFacts): StepVerdict {
  const ticket = facts.pickedTicket;

  if (ticket === null) {
    return {
      done: false,
      evidence: null,
      reason: "No first issue has been picked yet.",
      brokenInPlace: false,
      derivedFrom: "intake",
    };
  }

  if (!ticket.inRepository) {
    return {
      done: false,
      evidence: null,
      reason: `${ticket.externalKey} is not an issue of ${facts.repo}, so it cannot be its first run.`,
      brokenInPlace: false,
      derivedFrom: "intake",
    };
  }

  if (!ticket.queued && !ticket.run) {
    return {
      done: false,
      evidence: null,
      reason: `${ticket.externalKey} has not been queued yet.`,
      brokenInPlace: false,
      derivedFrom: "intake",
    };
  }

  return {
    done: true,
    evidence: `${ticket.externalKey} · ${ticket.run ? "run started" : "queued"}`,
    reason: null,
    brokenInPlace: false,
    derivedFrom: "intake",
  };
}

/**
 * Derive the rail from subsystem facts.
 *
 * Status rules, per step:
 *
 *   * **done** — its subsystem says so.
 *   * **todo, regressed** — not done, but a later step is done, the wizard was completed, or the
 *     subsystem holds the step's thing in a broken state. Carries the reason.
 *   * **active** — the first step that is not done, when it has not regressed.
 *   * **todo** — any other step that is not done.
 *
 * @param facts - What the repository read from the four subsystems and the wizard's choices.
 * @returns The four steps and the current step (the first not done, or null).
 */
export function deriveRail(facts: RailFacts): DerivedRail {
  const verdicts = [
    sourceStep(facts),
    repositoryStep(facts),
    workflowStep(facts),
    firstRunStep(facts),
  ];
  const firstOpen = verdicts.findIndex((verdict) => !verdict.done);

  const steps = verdicts.map((verdict, index): DerivedStep => {
    const step = ONBOARDING_STEPS[index];

    if (verdict.done) {
      return { step, status: "done", ...shared(verdict), regressed: false };
    }

    const laterDone = verdicts.slice(index + 1).some((later) => later.done);
    const regressed = laterDone || facts.completed || verdict.brokenInPlace;
    const status: OnboardingStepStatus = index === firstOpen && !regressed ? "active" : "todo";

    return { step, status, ...shared(verdict), regressed };
  });

  return { steps, currentStep: firstOpen === -1 ? null : ONBOARDING_STEPS[firstOpen] };
}

/**
 * The guard `POST /complete-step` applies: every step up to and including `step` is done.
 *
 * @param rail - The rail as derived now.
 * @param step - The step being completed.
 * @returns The first step at or before `step` that is not done, or undefined when the guard
 *   passes.
 */
export function blockingStep(
  rail: DerivedRail,
  step: OnboardingStepNumber,
): DerivedStep | undefined {
  return rail.steps.find((derived) => derived.step <= step && derived.status !== "done");
}

/** The fields a verdict hands to its step unchanged. */
function shared(verdict: StepVerdict): Pick<DerivedStep, "evidence" | "reason" | "derivedFrom"> {
  return { evidence: verdict.evidence, reason: verdict.reason, derivedFrom: verdict.derivedFrom };
}

/**
 * Split `owner/name` into its two halves. A nested namespace keeps everything before the last
 * segment as its owner.
 *
 * @param repo - The repository reference.
 * @returns `[owner, name]`.
 */
export function splitRepo(repo: string): readonly [string, string] {
  const slash = repo.lastIndexOf("/");

  return [repo.slice(0, slash), repo.slice(slash + 1)];
}

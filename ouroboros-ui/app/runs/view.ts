/**
 * The run console's head, as data ([#309](https://github.com/NobuData/ouroboros/issues/309)) —
 * mockup 10's eyebrow, headline and meta row, decided here and drawn by `run-head.tsx`.
 *
 * **Nothing here computes a figure the service did not state** (the `RunConsole` contract's own
 * rule): the loop number, the pin, the model, the branch and the watermark are read, and the
 * one moving figure — *elapsed* — is anchored to the server's start timestamp rather than
 * accumulated (see {@link RunElapsed}).
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { RunStatus } from "@/app/api/dashboard";
import type { RunConsole, RunRepository } from "@/app/api/runs";
import type { ChipDot, ChipTone } from "@/app/ui";

/** The eyebrow's fixed half — `Run Console · Loop #1847`. */
export const RUN_EYEBROW = "Run Console";

/** The simulated-run watermark (decision R4), as the banner says it. */
export const SIMULATED_HEADLINE = "Simulated run.";

/** What the watermark means, beside {@link SIMULATED_HEADLINE}. */
export const SIMULATED_NOTE =
  "This run was opened by the simulated-run driver — no executor, repository or model did " +
  "any of the work shown here.";

/** The copy control's name, before and after it has copied. */
export const COPY_BRANCH_LABEL = "Copy branch name";

/** What the copy control announces once the branch is on the clipboard. */
export const COPIED_BRANCH = "Branch name copied";

/** What the copy control announces when the browser refused the clipboard. */
export const COPY_BRANCH_FAILED = "Could not copy the branch name";

/** The pull request link's text on a merged run — `PR #512`. */
export const PR_LINK_PREFIX = "PR";

/** What stands in the meta row while the run has no branch yet. */
export const NO_BRANCH = "no branch yet";

/** The banner headline when a refresh failed and the page shows its last answer. */
export const STALE_HEADLINE = "This run could not be refreshed.";

/** The banner headline when the page has nothing to show at all. */
export const UNREAD_HEADLINE = "This run could not be read.";

/** What the breadcrumb's landmark is called. */
export const BREADCRUMB_LABEL = "Breadcrumb";

/**
 * Each status, as the pill prints it — the contract's own word, with `needs_human`'s underscore
 * taken out, which is the substitution every run card makes.
 */
export const RUN_STATUS_LABEL: Readonly<Record<RunStatus, string>> = {
  coding: "coding",
  building: "building",
  review: "review",
  merged: "merged",
  needs_human: "needs human",
  failed: "failed",
  canceled: "canceled",
};

/**
 * Each status's hue — the accent while in flight, then the outcome's own: `ok` for merged,
 * `warn` for a run waiting on a person, `err` for a failure, and neutral for `canceled`, which
 * is a person's decision rather than an outcome (#306).
 */
export const RUN_STATUS_TONE: Readonly<Record<RunStatus, ChipTone>> = {
  coding: "accent",
  building: "accent",
  review: "accent",
  merged: "ok",
  needs_human: "warn",
  failed: "err",
  canceled: "neutral",
};

/**
 * The moving half of the meta row — *elapsed*.
 *
 * **Anchored, not accumulated.** A live run carries the server's `startedAt` (in whole seconds)
 * and the elapsed figure the server measured at `asOf`; the head renders `now − startedAt` from
 * the shared one-second clock (`app/dashboard/elapsed.tsx`), never below the server's figure.
 * A refresh, a tab restore and a slow poll all land on the same number because none of them
 * resets a counter — there is no counter. A finished run carries a fixed duration instead.
 */
export type RunElapsed =
  | {
      /** Still moving: tick from the anchor. */
      readonly live: true;
      /** `startedAt`, in whole seconds since the epoch — the anchor. */
      readonly startedAtSeconds: number;
      /** What the server measured at `asOf`, the floor the clock may not undercut. */
      readonly serverSeconds: number;
    }
  | {
      /** Stopped: the duration is final. */
      readonly live: false;
      /** Start to finish, in whole seconds, as the server stated it. */
      readonly seconds: number;
    };

/** The head, ready to draw. */
export interface RunHeadView {
  /** `Run Console · Loop #1847`. */
  readonly eyebrow: string;
  /** `Loop #1847` — the breadcrumb's current page. */
  readonly loopLabel: string;
  /** `#482 — Fix flaky CAN-bus telemetry test`. */
  readonly headline: string;
  /** Where the headline links — the issue on its tracker — or `null` when unknown. */
  readonly trackerUrl: string | null;
  /** The status pill's word. */
  readonly statusLabel: string;
  /** The status pill's hue. */
  readonly statusTone: ChipTone;
  /** The status pill's dot — a pulse only while the run is live. */
  readonly statusDot: ChipDot;
  /** `standard-fix v14`, or just `standard-fix` when nothing was pinned. */
  readonly workflow: string;
  /** The model identifier, opaque — drawn, never parsed. */
  readonly model: string;
  /** The branch, or `null` until the loop has one. */
  readonly branch: string | null;
  /** Decision R4's watermark. */
  readonly simulated: boolean;
  /** *Elapsed*. */
  readonly elapsed: RunElapsed;
  /**
   * The pull request a merged run opened — the one thing anyone wants from the page once it has
   * landed (#314) — or `null` for any other run, or when there is no URL to build.
   */
  readonly pullRequest: RunPullRequest | null;
}

/** The meta row's pull request link. */
export interface RunPullRequest {
  /** `PR #512`. */
  readonly label: string;
  /** Its page on GitHub. */
  readonly url: string;
}

/**
 * The pull request link, for a merged run.
 *
 * @param snapshot The run console snapshot.
 * @returns The link, or `null` unless the run merged and its pull request can be addressed.
 */
export function runPullRequest(snapshot: RunConsole): RunPullRequest | null {
  if (snapshot.run.status !== "merged") return null;

  const url = pullRequestUrl(snapshot.head.repository, snapshot.run.prNumber);

  return url === null ? null : { label: `${PR_LINK_PREFIX} #${snapshot.run.prNumber}`, url };
}

/**
 * The eyebrow for a loop number.
 *
 * @param loopSeq The per-workspace loop counter.
 * @returns `Run Console · Loop #1847`.
 */
export function runEyebrow(loopSeq: number): string {
  return `${RUN_EYEBROW} · ${loopLabel(loopSeq)}`;
}

/**
 * The loop's short name.
 *
 * @param loopSeq The per-workspace loop counter.
 * @returns `Loop #1847`.
 */
export function loopLabel(loopSeq: number): string {
  return `Loop #${loopSeq}`;
}

/**
 * The headline — the ticket's key and its title, as the mockup sets them.
 *
 * @param issueNumber The issue's number.
 * @param issueTitle The title as it was when the run started.
 * @returns `#482 — Fix flaky CAN-bus telemetry test`.
 */
export function runHeadline(issueNumber: number, issueTitle: string): string {
  return `#${issueNumber} — ${issueTitle}`;
}

/**
 * One numbered page of a repository on GitHub — an issue or a pull request.
 *
 * @param repository The repository, or `undefined` when the service could not read it.
 * @param kind Which page: `issues` or `pull`.
 * @param number The issue's or the pull request's number.
 * @returns The URL with each segment encoded, or `null` when there is no repository or the
 *   number is not a positive integer — a missing link rather than a guessed one.
 */
function githubPage(
  repository: RunRepository | undefined,
  kind: "issues" | "pull",
  number: number | null,
): string | null {
  if (repository === undefined || number === null) return null;
  if (!Number.isInteger(number) || number < 1) return null;

  return (
    `https://github.com/${encodeURIComponent(repository.owner)}/` +
    `${encodeURIComponent(repository.name)}/${kind}/${number}`
  );
}

/**
 * Where the headline links: the issue on its tracker.
 *
 * Runs are keyed on a GitHub repository and an issue number today, and the run console's
 * contract (#304) names the repository as GitHub names it — so the tracker is GitHub's issue
 * page. A ticket from another source (Jira, Linear, GitLab) needs the contract to carry the
 * ticket's own URL, which it does not yet.
 *
 * @param repository The repository, or `undefined` when the service could not read it.
 * @param issueNumber The issue's number.
 * @returns The issue's URL with each segment encoded, or `null` when there is no repository to
 *   build it from — the headline is then plain text rather than a guessed link.
 */
export function trackerUrl(
  repository: RunRepository | undefined,
  issueNumber: number,
): string | null {
  return githubPage(repository, "issues", issueNumber);
}

/**
 * Where a run's pull request is — GitHub's pull page, for {@link trackerUrl}'s reason.
 *
 * @param repository The repository, or `undefined` when the service could not read it.
 * @param prNumber The pull request's number, or `null`.
 * @returns The URL with each segment encoded, or `null` when either half is missing.
 */
export function pullRequestUrl(
  repository: RunRepository | undefined,
  prNumber: number | null,
): string | null {
  return githubPage(repository, "pull", prNumber);
}

/**
 * The workflow tag — the pinned workflow and its version.
 *
 * @param tag The workflow's label.
 * @param version The pinned version, or `null` when nothing was published to pin.
 * @returns `standard-fix v14`, or `standard-fix` alone rather than a made-up version.
 */
export function workflowCaption(tag: string, version: number | null): string {
  return version === null ? tag : `${tag} v${version}`;
}

/**
 * *Elapsed*, as the head draws it.
 *
 * @param snapshot The run console snapshot.
 * @returns The anchor for a live run, or the fixed duration for a finished one. A live run
 *   whose start cannot be parsed falls back to the server's fixed figure rather than ticking
 *   from nothing.
 */
export function runElapsed(snapshot: RunConsole): RunElapsed {
  const { wallClock } = snapshot.resources;
  const startedAtMs = Date.parse(wallClock.startedAt);

  if (!snapshot.head.live || wallClock.finishedAt !== null || Number.isNaN(startedAtMs)) {
    return { live: false, seconds: wallClock.elapsedSeconds };
  }

  return {
    live: true,
    startedAtSeconds: Math.floor(startedAtMs / 1000),
    serverSeconds: wallClock.elapsedSeconds,
  };
}

/**
 * The whole head from one snapshot.
 *
 * @param snapshot The run console snapshot.
 * @returns What `run-head.tsx` draws.
 */
export function runHead(snapshot: RunConsole): RunHeadView {
  const { run, head } = snapshot;

  return {
    eyebrow: runEyebrow(head.loopSeq),
    loopLabel: loopLabel(head.loopSeq),
    headline: runHeadline(run.issueNumber, run.issueTitle),
    trackerUrl: trackerUrl(head.repository, run.issueNumber),
    statusLabel: RUN_STATUS_LABEL[run.status],
    statusTone: RUN_STATUS_TONE[run.status],
    statusDot: head.live ? "pulse" : "filled",
    workflow: workflowCaption(run.workflowTag, head.workflowVersion),
    model: run.model,
    branch: head.branchName,
    simulated: head.simulated,
    elapsed: runElapsed(snapshot),
    pullRequest: runPullRequest(snapshot),
  };
}

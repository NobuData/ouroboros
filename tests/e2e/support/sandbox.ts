/**
 * The sandbox tracker's pull requests, as a leg asks about them
 * ([#470](https://github.com/NobuData/ouroboros/issues/470), BO.5).
 *
 * The inbox's action chains end on a host: approving a merge card merges a PR there, and waiving a
 * claim posts an annotation to it. What proves either happened is a question put to the host, not
 * a line read back off the page that asked for it — so these two helpers ask
 * `fixtures/tracker-stub/server.mjs`'s inspection controls, `GET /__sandbox/pulls/…` and
 * `GET /__sandbox/comments/…`, which answer what the store holds in GitHub's own shapes.
 *
 * The controls are the fixture's, under `/__sandbox/`, and take no credential: they are the
 * suite's questions, and nothing in `ouroboros-rest` knows they exist. Resetting the store is
 * `support/planning.ts`'s `resetTracker`, which puts `#504` back open and drops every comment.
 *
 * Both failures name **the sandbox tracker**, for `support/planning.ts`'s reason:
 * `scripts/verify-failure-modes.sh` requires the broken layer to be named in the output rather
 * than left as a connection error against a port.
 */

import { TRACKER_URL } from "./stack";

/** The repository the seeded GitHub source's PR plane lives in — its push target. */
export const SANDBOX_PR_REPO = { owner: "acme-robotics", repo: "helios-firmware" } as const;

/** The PR the sandbox seeds — `R__dev_seed_workspace_triage_inbox.sql`'s `#504`, `verifying`. */
export const SANDBOX_SEEDED_PR = 504;

/** One PR, as the sandbox's inspection answers it — GitHub's pulls payload and how it was merged. */
export interface SandboxPull {
  /** The PR's number. */
  readonly number: number;
  /** Its page — `https://sandbox-tracker.invalid/…`. */
  readonly html_url: string;
  /** Its title. */
  readonly title: string;
  /** `open`, or `closed` — a merged PR is closed. */
  readonly state: "open" | "closed";
  /** Whether it was merged. */
  readonly merged: boolean;
  /** When it was merged, or null. */
  readonly merged_at: string | null;
  /** The merge commit's forty-character sha, or null before a merge. */
  readonly merge_commit_sha: string | null;
  /** GitHub's mergeability — null once the PR is closed. */
  readonly mergeable: boolean | null;
  /** The head branch and commit. */
  readonly head: { readonly ref: string; readonly sha: string };
  /** The base branch. */
  readonly base: { readonly ref: string };
  /** `merge`, `squash` or `rebase` — what the merge asked for — or null before one. */
  readonly merge_method: "merge" | "squash" | "rebase" | null;
  /** The merge commit's title the product sent, or null. */
  readonly commit_title: string | null;
  /** The merge commit's body the product sent, or null when it sent none. */
  readonly commit_message: string | null;
  /** Whether the product deleted the head branch after the merge. */
  readonly head_branch_deleted: boolean;
}

/** One conversation comment, as the sandbox answers it. */
export interface SandboxComment {
  /** GitHub's comment id. */
  readonly id: number;
  /** The Markdown, including any `<!-- ouroboros:… -->` marker the product keyed it by. */
  readonly body: string;
  /** Its page. */
  readonly html_url: string;
  /** When it was posted. */
  readonly created_at: string;
  /** When it was last edited — equal to `created_at` for a comment never edited. */
  readonly updated_at: string;
}

/**
 * Ask one of the sandbox's inspection controls.
 *
 * @param path - The path under `/__sandbox/`, beginning with a slash.
 * @returns The parsed answer.
 * @throws When the tracker is not answering, or refused — saying which, and naming the tracker.
 */
async function inspect<Answer>(path: string): Promise<Answer> {
  const url = `${TRACKER_URL}/__sandbox${path}`;
  const response = await fetch(url).catch((reason: unknown) => {
    throw new Error(`the sandbox tracker is not answering at ${TRACKER_URL}: ${String(reason)}`);
  });

  if (!response.ok) {
    throw new Error(
      `the sandbox tracker answered ${response.status.toString()} for /__sandbox${path}`,
    );
  }

  return (await response.json()) as Answer;
}

/**
 * The address of one PR or conversation, as the inspection paths spell it.
 *
 * @param owner - The repository's owner.
 * @param repo - The repository.
 * @param n - The PR or issue number.
 * @returns `/{owner}/{repo}/{n}`, each segment encoded.
 */
function addressOf(owner: string, repo: string, n: number): string {
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${String(n)}`;
}

/**
 * One PR as the sandbox host holds it now.
 *
 * @param owner - The repository's owner — {@link SANDBOX_PR_REPO}'s for the seeded PR.
 * @param repo - The repository.
 * @param n - The PR's number — {@link SANDBOX_SEEDED_PR} for the seeded one.
 * @returns The PR, with how it was merged.
 * @throws When the tracker is not answering, or holds no such PR (`404`).
 */
export function sandboxPull(owner: string, repo: string, n: number): Promise<SandboxPull> {
  return inspect<SandboxPull>(`/pulls${addressOf(owner, repo, n)}`);
}

/**
 * An issue's or a PR's conversation comments as the sandbox host holds them now.
 *
 * @param owner - The repository's owner.
 * @param repo - The repository.
 * @param n - The issue or PR number.
 * @returns Its comments, oldest first — empty when it has none.
 * @throws When the tracker is not answering.
 */
export function sandboxComments(
  owner: string,
  repo: string,
  n: number,
): Promise<readonly SandboxComment[]> {
  return inspect<readonly SandboxComment[]>(`/comments${addressOf(owner, repo, n)}`);
}

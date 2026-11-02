/**
 * What opening a live run's draft pull request answers (DI.3,
 * [#1311](https://github.com/NobuData/ouroboros/issues/1311)).
 */

/** `POST /internal/runs/:id/pull-request` → `200`. */
export interface PullRequestOpenedResource {
  /** The mirror row's id (`pull_requests.id`) — the PR page's `/prs/:id`. */
  readonly pull_request_id: string;
  /** The host's number. */
  readonly number: number;
  /** The PR's page on the host. */
  readonly url: string;
  /** Always `true`: a loop's pull request is a draft, and the publisher links no other. */
  readonly draft: true;
  /**
   * `true` when this request opened and linked the PR; `false` when the run already had one —
   * the idempotent path a resumed terminal takes.
   */
  readonly created: boolean;
}

/**
 * What the push grant and the push result answer (DI.2,
 * [#1310](https://github.com/NobuData/ouroboros/issues/1310)).
 *
 * The grant is the second answer on the internal surface that carries a live credential (the run
 * start's `repository.ref.token` is the first), which is why it lives in `ingest/` beside it,
 * outside the `no-secret-in-internal-response` rule's scope: the credential **is** the answer.
 * It is opened for this one call, never stored — not in a receipt, not in the audit detail — and
 * the engine hands it to its git client as basic-auth for one push and drops it.
 */

/** `POST /internal/runs/:id/push` → `200`. */
export interface PushGrantResource {
  /**
   * The one refspec the engine may push: `refs/heads/<branch>:refs/heads/<branch>`, never
   * forced, built from the run's own branch.
   */
  readonly refspec: string;
  /** The repository's clone URL — `OURO_GITHUB_CLONE_BASE_URL/<owner>/<name>.git`. */
  readonly remote: string;
  /** GitHub's basic-auth user for a token: `x-access-token`. */
  readonly username: string;
  /** The workspace's GitHub token, opened for this one push. */
  readonly password: string;
}

/** `POST /internal/runs/:id/push/result` → `200`. */
export interface PushRecordedResource {
  /** Always `true`: the outcome is on the audit trail. */
  readonly recorded: true;
}

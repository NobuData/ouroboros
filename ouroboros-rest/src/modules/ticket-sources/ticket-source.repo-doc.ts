/**
 * Repository documents — a fifth, small family on the provider SPI (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * The roadmap pipeline projects `ROADMAP.md` into a repository: it reads the file as a branch
 * holds it, commits a new version of it to a branch, and keeps a pull request's description in
 * step with the document. That is three operations no other family has — the probes read the
 * default branch only and return no revision, and the PR family opens and merges but never
 * writes a file.
 *
 * ```
 * defaultBranch(ctx)                       → "main"
 * fileAt(ctx, path, ref)                   → { content, blobSha, commitSha } | null
 * commitFile(ctx, { path, content, … })    → { commitSha, changed }            idempotent
 * updatePR(ctx, number, { title?, body? }) → void                              idempotent
 * ```
 *
 * **`commitFile` is idempotent by content.** A file that already holds the content is not
 * committed again — the answer names the commit that last touched it and `changed: false` — so a
 * retried projection adds no empty commit. A branch that does not exist is created from `base`.
 *
 * **The guard is by member, not by capability flag.** The other families declare themselves in
 * `capabilities()` and every provider answers for them; this one is asked of a provider only
 * after it has said it can open pull requests, and a host without these members simply cannot
 * hold a roadmap. {@link supportsRepoDocs} checks both.
 *
 * Every member throws `TicketSourceError` on a refusal, classified the write-side way.
 */

import { supportsPullRequests } from "./ticket-source.provider";
import type { PrCapableProvider, TicketSourceProvider } from "./ticket-source.provider";
import type { TicketSyncContext } from "./ticket-source.provider";

/** A file as one ref holds it. */
export interface RepoDocState {
  /** The file's text. */
  readonly content: string;
  /** The blob's sha — what an update must name. */
  readonly blobSha: string;
  /** The commit that last touched the file on that ref, or null when the host did not say. */
  readonly commitSha: string | null;
}

/** A file to commit. */
export interface CommitFileInput {
  /** The file, relative to the root. */
  readonly path: string;
  /** Its whole new text. */
  readonly content: string;
  /** The commit message. Non-blank. */
  readonly message: string;
  /** The branch to commit to. */
  readonly branch: string;
  /** The branch {@link branch} is created from when it does not exist. May equal it. */
  readonly base: string;
}

/** What `commitFile` did. */
export interface CommitFileResult {
  /** The commit holding this content — the new one, or the one that already did. */
  readonly commitSha: string;
  /** False when the branch already held exactly this content and nothing was committed. */
  readonly changed: boolean;
}

/** A PR's editable description. Only the present fields change. */
export interface UpdatePrInput {
  readonly title?: string;
  readonly body?: string;
}

/** The members a repository-document host adds. */
export interface RepoDocCapableProvider extends PrCapableProvider {
  /**
   * @param context - The source, opened.
   * @returns The push target's default branch — where a document lands.
   * @throws {TicketSourceError} On a refusal.
   */
  defaultBranch(context: TicketSyncContext): Promise<string>;

  /**
   * One file as a ref holds it.
   *
   * @param context - The source, opened.
   * @param path - Relative to the root; {@link isRepoDocPath} holds.
   * @param ref - A branch name or commit sha.
   * @returns The file, or `null` when the ref holds no such file (or does not exist).
   * @throws {TicketSourceError} On a refusal; `validation` for a path this family refuses.
   */
  fileAt(context: TicketSyncContext, path: string, ref: string): Promise<RepoDocState | null>;

  /**
   * Commit one file to a branch, creating the branch from `base` when it is missing.
   *
   * @param context - The source, opened.
   * @param input - The file, its text, the message and the branches.
   * @returns The commit, and whether anything was written.
   * @throws {TicketSourceError} On a refusal; `validation` for a bad path, branch or message.
   */
  commitFile(context: TicketSyncContext, input: CommitFileInput): Promise<CommitFileResult>;

  /**
   * Change a PR's title or description.
   *
   * @param context - The source, opened.
   * @param prNumber - The PR's number.
   * @param input - The fields to change.
   * @throws {TicketSourceError} On a refusal; `not_found` for a number the host does not have.
   */
  updatePR(context: TicketSyncContext, prNumber: number, input: UpdatePrInput): Promise<void>;
}

/** The members {@link RepoDocCapableProvider} adds, as values. */
export const REPO_DOC_MEMBERS = ["defaultBranch", "fileAt", "commitFile", "updatePR"] as const;

/** The longest path a document may have — V113's bound on `repo_projection.path`. */
export const MAX_REPO_DOC_PATH = 512;

/**
 * Whether a path is one a document may be written to: relative, no empty, `.` or `..` segment, no
 * whitespace — V113's `roadmap_repo_projection_valid` rule, held here too so a bad path never
 * reaches a host.
 *
 * @param path - The path.
 * @returns True for `docs/ROADMAP.md`.
 */
export function isRepoDocPath(path: string): boolean {
  return (
    path.length <= MAX_REPO_DOC_PATH &&
    /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(path) &&
    !/(^|\/)\.\.?(\/|$)/.test(path)
  );
}

/**
 * Whether a provider can hold repository documents.
 *
 * @param provider - Any provider.
 * @returns True when it opens pull requests and has every member of this family.
 */
export function supportsRepoDocs(
  provider: TicketSourceProvider,
): provider is RepoDocCapableProvider {
  const members = provider as unknown as Record<string, unknown>;

  return (
    supportsPullRequests(provider) &&
    REPO_DOC_MEMBERS.every((member) => typeof members[member] === "function")
  );
}

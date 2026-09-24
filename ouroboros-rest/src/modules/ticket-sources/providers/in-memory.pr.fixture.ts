/**
 * The in-memory git host — the PR family's fake, so the gate engine, the merge executor and their
 * suites never need a live host.
 *
 * AX.1 ([#357](https://github.com/NobuData/ouroboros/issues/357)). The same two halves as
 * `in-memory.provider.fixture.ts`, for the same reasons: {@link InMemoryPrHost} is the far side of the
 * wire — branches of commits, pull requests, conversation comments, issues a merge can close, an
 * access token kept only as a digest, and a request log — and {@link InMemoryPrTicketSourceProvider}
 * is the client, holding nothing but the tracker and host it was pointed at.
 *
 * ```
 * host.push(branch, files)  ─▶ a commit; an open PR on that branch moves its head   (the sandbox)
 * provider.createPR ─▶ host.open        provider.syncPR ─▶ host.pull + host.files
 * provider.mergePR  ─▶ host.merge ─▶ same-repository `Closes #N` into the default branch closes N
 * provider.commentPR ─▶ host.comments ─▶ edit the marked one, or post
 * ```
 *
 * **It behaves like a host rather than agreeing with the kit.** It refuses a PR whose branch does
 * not exist, a merge of a PR that is not open, a strategy the repository has switched off, and a
 * second open PR for the same branch and base. It closes an issue by keyword only on a merge into
 * the default branch and only in its own repository — so a cross-repository reference stays open,
 * which is exactly the silent failure `mergePR`'s verification exists to report.
 *
 * **Its cursor is a change sequence.** Every change to a PR is numbered, and `prEvents` answers the
 * PRs changed after a number — exclusive and exact, where GitHub's is an inclusive instant. The kit
 * checks what both promise and neither's mechanism.
 *
 * It is a `.fixture.ts`: nothing that ships imports it, and `tsconfig.build.json` leaves it out.
 */

import { createHash } from "node:crypto";

import { TicketSourceError, type TicketSourceErrorClass } from "../ticket-source.errors";
import {
  assertAdvertisedStrategy,
  closingReferences,
  diffExcerptOf,
  hasPrCommentMarker,
  withPrCommentMarker,
  type CreatePrInput,
  type HostPrState,
  type IssueClosure,
  type MergePrInput,
  type MergePrResult,
  type MergeStrategy,
  type PrCommentInput,
  type PrCommentResult,
  type PrEventPage,
  type PrFileChange,
  type PrRef,
  type PrSyncResult,
  type PullRequestSnapshot,
  type ReviewRequestResult,
  type TicketSourcePrCapabilities,
} from "../ticket-source.pr";
import type {
  PrCapableProvider,
  TicketSourceCapabilities,
  TicketSyncContext,
} from "../ticket-source.provider";
import {
  IN_MEMORY_EPOCH,
  IN_MEMORY_PROJECT,
  IN_MEMORY_SITE,
  IN_MEMORY_TICK_MS,
  IN_MEMORY_TOKEN,
  InMemoryTicketSourceProvider,
  InMemoryTrackerRefusal,
  REFUSAL_STATUS,
  asInMemoryWriteFailure,
  readInMemoryConfig,
  type InMemoryProviderOptions,
  type InMemoryTracker,
} from "./in-memory.provider.fixture";

/** The branch every host starts with, and the one a keyword close requires a merge into. */
export const IN_MEMORY_DEFAULT_BRANCH = "main";

/** Who merges, on this host — the token's owner. */
export const IN_MEMORY_MERGER = "ouroboros-bot";

/** How many changes one `prEvents` poll answers unless told otherwise. */
export const IN_MEMORY_PR_EVENT_PAGE = 50;

/** One changed file, as a push carries it. */
export interface InMemoryFileChange extends PrFileChange {
  /** The patch text, or null for a binary. */
  readonly patch?: string | null;
}

/** One commit on a branch. */
interface InMemoryCommit {
  /** Forty hex characters. */
  readonly sha: string;
  /** What it changed. */
  readonly files: readonly InMemoryFileChange[];
}

/** A pull request, as the host holds it. */
export interface InMemoryPull {
  /** Its number, from 1. */
  readonly number: number;
  /** The branch it merges from. */
  readonly head: string;
  /** The branch it merges into. */
  readonly base: string;
  /** Its title. */
  readonly title: string;
  /** Its description. */
  readonly body: string | null;
  /** Where it stands. */
  state: HostPrState;
  /** The head it merged at — frozen once merged, since the branch may then be deleted. */
  mergedHead: string | null;
  /** The commits it merged — frozen with the head, so a deleted branch keeps its files. */
  mergedCommits: readonly InMemoryCommit[] | null;
  /** When it merged. */
  mergedAt: string | null;
  /** When it last changed. */
  updated: string;
  /** Its conversation, in posting order: id → body. */
  readonly comments: Map<number, string>;
  /** Who is asked to review. */
  readonly reviewers: Set<string>;
}

/** What a host holds that a PR operation could have changed, counted from its own state. */
export interface InMemoryPrLedger {
  /** Every PR's number. */
  readonly prs: readonly number[];
  /** Every comment, as `[prNumber, commentId, body]`. */
  readonly comments: readonly (readonly [number, string, string])[];
  /** Every merged PR's number. */
  readonly merged: readonly number[];
  /** Every branch that exists. */
  readonly branches: readonly string[];
  /** Every closed issue's number. */
  readonly closedIssues: readonly number[];
  /** How many requests the host has served, refusals included. */
  readonly requests: number;
}

/** How a host is set up. */
export interface InMemoryPrHostOptions {
  /** The token it accepts, or null for a public host. {@link IN_MEMORY_TOKEN} unless given. */
  readonly token?: string | null;
  /** Its one repository's project key. {@link IN_MEMORY_PROJECT} unless given. */
  readonly project?: string;
  /** The strategies the repository allows. All three unless given. */
  readonly strategies?: readonly MergeStrategy[];
}

/**
 * The far side of the wire: one repository's branches, PRs, comments and issues.
 *
 * Every change moves the clock by {@link IN_MEMORY_TICK_MS} and numbers a change, so a suite can
 * state stamps and cursors exactly.
 */
export class InMemoryPrHost {
  /** Every operation served, in order. Carries no token. */
  readonly requests: string[] = [];

  /** Branches, by name — each a list of commits, oldest first. */
  private readonly branches = new Map<string, InMemoryCommit[]>();

  /** PRs, by number. */
  private readonly pulls = new Map<number, InMemoryPull>();

  /** Issues, by number: whether each is closed. */
  private readonly issues = new Map<number, boolean>();

  /** The change log `prEvents` reads: sequence → PR number. */
  private readonly changes: { readonly seq: number; readonly number: number }[] = [];

  /** The project key. */
  readonly project: string;

  /** The accepted token's digest, or null. */
  private readonly tokenDigest: string | null;

  /** The strategies the repository allows. */
  private readonly strategies: ReadonlySet<MergeStrategy>;

  /** The clock, in epoch milliseconds. */
  private clock = IN_MEMORY_EPOCH.getTime();

  /** Counters for commits, comments and issues. */
  private commits = 0;
  private commentIds = 0;
  private seq = 0;

  /** The refusal every request meets until {@link recover}, or null. */
  private refusal: InMemoryTrackerRefusal | null = null;

  /**
   * @param options - The token, the project and the allowed strategies.
   */
  constructor(options: InMemoryPrHostOptions = {}) {
    const token = options.token === undefined ? IN_MEMORY_TOKEN : options.token;

    this.tokenDigest = token === null ? null : digestOf(token);
    this.project = options.project ?? IN_MEMORY_PROJECT;
    this.strategies = new Set(options.strategies ?? ["merge", "squash", "rebase"]);
    this.branches.set(IN_MEMORY_DEFAULT_BRANCH, [{ sha: this.nextSha(), files: [] }]);
  }

  /**
   * Push a commit — the sandbox's `git push`. An open PR on the branch moves its head.
   *
   * @param branch - The branch; created off the default branch when it does not exist.
   * @param files - What the commit changes.
   * @returns The commit's sha.
   */
  push(branch: string, files: readonly InMemoryFileChange[]): string {
    const commit = { sha: this.nextSha(), files: files.map((file) => ({ ...file })) };
    const commits = this.branches.get(branch) ?? [];

    commits.push(commit);
    this.branches.set(branch, commits);

    for (const pull of this.pulls.values()) {
      if (pull.head === branch && pull.state === "open") {
        this.touch(pull);
      }
    }

    return commit.sha;
  }

  /**
   * File an open issue a merge message can close.
   *
   * @returns Its number — numbered after the PRs and issues so far, as a shared numbering would be.
   */
  openIssue(): number {
    const number = this.pulls.size + this.issues.size + 1;

    this.issues.set(number, false);

    return number;
  }

  /**
   * Refuse every request from now on, until {@link recover}.
   *
   * @param errorClass - Which class of refusal.
   * @param retryAt - When a rate window lifts.
   */
  refuse(errorClass: TicketSourceErrorClass, retryAt: Date | null = null): void {
    this.refusal = new InMemoryTrackerRefusal(
      REFUSAL_STATUS[errorClass],
      errorClass === "rate_limit" ? retryAt : null,
    );
  }

  /** Answer requests again. */
  recover(): void {
    this.refusal = null;
  }

  /**
   * What the host holds, read off its own state — never through the provider.
   *
   * @returns The ledger.
   */
  ledger(): InMemoryPrLedger {
    return {
      prs: [...this.pulls.keys()],
      comments: [...this.pulls.values()].flatMap((pull) =>
        [...pull.comments].map(
          ([id, body]) => [pull.number, String(id), body] as [number, string, string],
        ),
      ),
      merged: [...this.pulls.values()]
        .filter((pull) => pull.state === "merged")
        .map((pull) => pull.number),
      branches: [...this.branches.keys()],
      closedIssues: [...this.issues].filter(([, closed]) => closed).map(([number]) => number),
      requests: this.requests.length,
    };
  }

  /**
   * The open PR proposing a branch into a base.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param head - The branch.
   * @param base - The base.
   * @returns The PR, or undefined.
   */
  findOpen(
    token: string | null,
    project: string,
    head: string,
    base: string,
  ): InMemoryPull | undefined {
    this.admit("find-open", token, project);

    return [...this.pulls.values()].find(
      (pull) => pull.state === "open" && pull.head === head && pull.base === base,
    );
  }

  /**
   * Open a PR.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param input - The branches, title and description.
   * @returns The PR.
   * @throws {InMemoryTrackerRefusal} `422` for a missing branch, a branch into itself, or a second
   *   open PR for the same pair.
   */
  open(token: string | null, project: string, input: CreatePrInput): InMemoryPull {
    this.admit("open", token, project);

    if (
      !this.branches.has(input.branch) ||
      !this.branches.has(input.base) ||
      input.branch === input.base ||
      [...this.pulls.values()].some(
        (pull) => pull.state === "open" && pull.head === input.branch && pull.base === input.base,
      )
    ) {
      throw new InMemoryTrackerRefusal(422);
    }

    const pull: InMemoryPull = {
      number: this.pulls.size + this.issues.size + 1,
      head: input.branch,
      base: input.base,
      title: input.title,
      body: input.body,
      state: "open",
      mergedHead: null,
      mergedCommits: null,
      mergedAt: null,
      updated: "",
      comments: new Map(),
      reviewers: new Set(),
    };

    this.pulls.set(pull.number, pull);
    this.touch(pull);

    return pull;
  }

  /**
   * One PR.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param number - Its number.
   * @returns The PR.
   * @throws {InMemoryTrackerRefusal} `404` for a number the host does not have.
   */
  pull(token: string | null, project: string, number: number): InMemoryPull {
    this.admit("pull", token, project);

    return this.pullOf(number);
  }

  /**
   * A PR's head sha — its branch's newest commit, or the one it merged at.
   *
   * @param pull - The PR.
   * @returns The sha.
   */
  headOf(pull: InMemoryPull): string {
    return pull.mergedHead ?? this.commitsOf(pull.head).at(-1)?.sha ?? "0".repeat(40);
  }

  /**
   * A PR's changed files — every commit on its branch, summed per path.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param number - The PR.
   * @returns The files, in first-touched order, with the newest patch per path.
   */
  files(token: string | null, project: string, number: number): InMemoryFileChange[] {
    this.admit("files", token, project);

    return this.filesOf(this.pullOf(number));
  }

  /**
   * Merge a PR.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param number - The PR.
   * @param strategy - How.
   * @param message - The message — its closing keywords close issues, on a merge into the default
   *   branch and in this repository only.
   * @returns The merge commit's sha.
   * @throws {InMemoryTrackerRefusal} `405` for a PR that is not open or a strategy the repository
   *   has switched off.
   */
  merge(
    token: string | null,
    project: string,
    number: number,
    strategy: MergeStrategy,
    message: string,
  ): string {
    this.admit("merge", token, project);

    const pull = this.pullOf(number);

    if (pull.state !== "open" || !this.strategies.has(strategy)) {
      throw new InMemoryTrackerRefusal(405);
    }

    pull.mergedHead = this.headOf(pull);
    pull.mergedCommits = [...this.commitsOf(pull.head)];
    pull.state = "merged";
    this.touch(pull);
    pull.mergedAt = pull.updated;

    if (pull.base === IN_MEMORY_DEFAULT_BRANCH) {
      for (const reference of closingReferences(message, pull.body)) {
        if (reference.owner === null && this.issues.has(reference.number)) {
          this.issues.set(reference.number, true);
        }
      }
    }

    return this.nextSha();
  }

  /**
   * Delete a branch.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param branch - The branch.
   * @throws {InMemoryTrackerRefusal} `422` for a branch that does not exist, or the default one.
   */
  deleteBranch(token: string | null, project: string, branch: string): void {
    this.admit("delete-branch", token, project);

    if (!this.branches.has(branch) || branch === IN_MEMORY_DEFAULT_BRANCH) {
      throw new InMemoryTrackerRefusal(422);
    }

    this.branches.delete(branch);
  }

  /**
   * Whether an issue is closed.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param number - The issue.
   * @returns Whether it is closed.
   * @throws {InMemoryTrackerRefusal} `404` for an issue the host does not have.
   */
  issueClosed(token: string | null, project: string, number: number): boolean {
    this.admit("issue", token, project);

    const closed = this.issues.get(number);

    if (closed === undefined) {
      throw new InMemoryTrackerRefusal(404);
    }

    return closed;
  }

  /**
   * Post a comment.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param number - The PR.
   * @param body - The body.
   * @returns The comment's id.
   */
  comment(token: string | null, project: string, number: number, body: string): number {
    this.admit("comment", token, project);

    const pull = this.pullOf(number);

    this.commentIds += 1;
    pull.comments.set(this.commentIds, body);
    this.touch(pull);

    return this.commentIds;
  }

  /**
   * Edit a comment.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param number - The PR.
   * @param id - The comment.
   * @param body - The new body.
   * @throws {InMemoryTrackerRefusal} `404` for a comment the PR does not have.
   */
  editComment(
    token: string | null,
    project: string,
    number: number,
    id: number,
    body: string,
  ): void {
    this.admit("edit-comment", token, project);

    const pull = this.pullOf(number);

    if (!pull.comments.has(id)) {
      throw new InMemoryTrackerRefusal(404);
    }

    pull.comments.set(id, body);
    this.touch(pull);
  }

  /**
   * A PR's comments.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param number - The PR.
   * @returns `[id, body]` pairs, in posting order.
   */
  comments(token: string | null, project: string, number: number): [number, string][] {
    this.admit("comments", token, project);

    return [...this.pullOf(number).comments];
  }

  /**
   * Ask a login to review.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param number - The PR.
   * @param login - The reviewer.
   * @returns Everybody asked.
   */
  requestReviewer(token: string | null, project: string, number: number, login: string): string[] {
    this.admit("request-review", token, project);

    const pull = this.pullOf(number);

    pull.reviewers.add(login);

    return [...pull.reviewers];
  }

  /**
   * The PRs changed after a sequence number.
   *
   * @param token - The token presented.
   * @param project - The project.
   * @param after - The last sequence number seen, or 0.
   * @param limit - The most changes to answer.
   * @returns The changes, oldest first, the sequence to resume after, and whether more waited.
   */
  changesAfter(
    token: string | null,
    project: string,
    after: number,
    limit: number,
  ): { changes: { seq: number; pull: InMemoryPull }[]; last: number; more: boolean } {
    this.admit("changes", token, project);

    const pending = this.changes.filter((change) => change.seq > after);
    const kept = pending.slice(0, limit);

    return {
      changes: kept.map((change) => ({ seq: change.seq, pull: this.pullOf(change.number) })),
      last: kept.at(-1)?.seq ?? after,
      more: pending.length > kept.length,
    };
  }

  /**
   * Refuse a request, or let it through — and log it either way.
   *
   * @param operation - What was asked.
   * @param token - The token presented.
   * @param project - The project asked about.
   * @throws {InMemoryTrackerRefusal} The arranged refusal; `401` for a bad token; `404` for another
   *   project.
   */
  private admit(operation: string, token: string | null, project: string): void {
    this.requests.push(operation);

    if (this.refusal !== null) {
      throw this.refusal;
    }

    if (this.tokenDigest !== null && (token === null || digestOf(token) !== this.tokenDigest)) {
      throw new InMemoryTrackerRefusal(401);
    }

    if (project !== this.project) {
      throw new InMemoryTrackerRefusal(404);
    }
  }

  /**
   * One PR, or a `404`.
   *
   * @param number - Its number.
   * @returns The PR.
   */
  private pullOf(number: number): InMemoryPull {
    const pull = this.pulls.get(number);

    if (pull === undefined) {
      throw new InMemoryTrackerRefusal(404);
    }

    return pull;
  }

  /**
   * A branch's commits, or none once deleted.
   *
   * @param branch - The branch.
   * @returns Its commits.
   */
  private commitsOf(branch: string): readonly InMemoryCommit[] {
    return this.branches.get(branch) ?? [];
  }

  /**
   * Every file a PR's commits changed, summed per path.
   *
   * @param pull - The PR.
   * @returns The files.
   */
  private filesOf(pull: InMemoryPull): InMemoryFileChange[] {
    const byPath = new Map<string, InMemoryFileChange>();

    for (const commit of pull.mergedCommits ?? this.commitsOf(pull.head)) {
      for (const file of commit.files) {
        const known = byPath.get(file.path);

        byPath.set(file.path, {
          path: file.path,
          additions: (known?.additions ?? 0) + file.additions,
          deletions: (known?.deletions ?? 0) + file.deletions,
          patch: file.patch ?? known?.patch ?? null,
        });
      }
    }

    return [...byPath.values()];
  }

  /**
   * Stamp a PR changed, and log the change.
   *
   * @param pull - The PR.
   */
  private touch(pull: InMemoryPull): void {
    this.clock += IN_MEMORY_TICK_MS;
    pull.updated = new Date(this.clock).toISOString();
    this.seq += 1;
    this.changes.push({ seq: this.seq, number: pull.number });
  }

  /**
   * The next commit sha — forty hex characters, deterministic.
   *
   * @returns The sha.
   */
  private nextSha(): string {
    this.commits += 1;

    return createHash("sha1")
      .update(`in-memory-commit-${String(this.commits)}`)
      .digest("hex");
  }
}

/** How a PR provider is set up. */
export interface InMemoryPrProviderOptions extends InMemoryProviderOptions {
  /** What it declares beyond `pullRequests`. Everything, all three strategies and a poll unless given. */
  readonly pr?: Partial<Pick<TicketSourcePrCapabilities, "create" | "mergeStrategies" | "reviews">>;
  /** The most changes one `prEvents` poll answers. {@link IN_MEMORY_PR_EVENT_PAGE} unless given. */
  readonly eventPage?: number;
}

/**
 * The in-memory provider, with pull requests — AX.1's `PrCapableProvider` over an
 * {@link InMemoryPrHost}. The declaration is an option, so one class is the fully featured host and
 * the host without creation or reviews that proves `null` is an answer.
 */
export class InMemoryPrTicketSourceProvider
  extends InMemoryTicketSourceProvider
  implements PrCapableProvider
{
  /** The PR declaration, fixed at construction so `capabilities()` is stable. */
  private readonly prs: TicketSourcePrCapabilities & { readonly pullRequests: true };

  /** The most changes one poll answers. */
  private readonly eventPage: number;

  /**
   * @param tracker - The tracker the read half talks to.
   * @param host - The git host the PR half talks to.
   * @param options - The kind, the page sizes and the PR declaration.
   */
  constructor(
    tracker: InMemoryTracker,
    private readonly host: InMemoryPrHost,
    options: InMemoryPrProviderOptions = {},
  ) {
    super(tracker, options);

    this.prs = Object.freeze({
      pullRequests: true,
      create: options.pr?.create ?? true,
      mergeStrategies: Object.freeze([
        ...(options.pr?.mergeStrategies ?? ["merge", "squash", "rebase"]),
      ]),
      reviews: options.pr?.reviews ?? true,
      events: "poll",
    });
    this.eventPage = options.eventPage ?? IN_MEMORY_PR_EVENT_PAGE;
  }

  /**
   * What this provider can do.
   *
   * @returns The polling provider's flags, with pull requests declared.
   */
  override capabilities(): TicketSourceCapabilities & {
    readonly pr: TicketSourcePrCapabilities & { readonly pullRequests: true };
  } {
    return { ...super.capabilities(), pr: this.prs };
  }

  /**
   * Open a PR, or answer the open one for this branch and base.
   *
   * @param context - The source, opened.
   * @param input - The branches, title and description.
   * @returns The PR, or null when `create` is not declared.
   */
  createPR(context: TicketSyncContext, input: CreatePrInput): Promise<PrRef | null> {
    return settled(() => {
      if (!this.prs.create) {
        return null;
      }

      if (input.title.trim() === "" || input.branch.trim() === "" || input.base.trim() === "") {
        throw invalid("a PR needs a title, a branch and a base");
      }

      if (input.branch === input.base) {
        throw invalid("a branch cannot be proposed into itself");
      }

      const { project } = readInMemoryConfig(context.config);
      const pull =
        this.host.findOpen(context.credentials, project, input.branch, input.base) ??
        this.host.open(context.credentials, project, { ...input, title: input.title.trim() });

      return { number: pull.number, url: pullUrl(project, pull.number) };
    });
  }

  /**
   * One PR as the host reports it now.
   *
   * @param context - The source, opened.
   * @param prNumber - Its number.
   * @returns The snapshot.
   */
  getPR(context: TicketSyncContext, prNumber: number): Promise<PullRequestSnapshot> {
    return settled(() => {
      const { project } = readInMemoryConfig(context.config);

      return this.snapshot(
        context,
        project,
        this.host.pull(context.credentials, project, prNumber),
      );
    });
  }

  /**
   * One PR, and a revision when its head moved.
   *
   * @param context - The source, opened.
   * @param prNumber - Its number.
   * @param knownHeadSha - The caller's latest head, or null.
   * @returns The snapshot and, when the head moved, the revision.
   */
  syncPR(
    context: TicketSyncContext,
    prNumber: number,
    knownHeadSha: string | null,
  ): Promise<PrSyncResult> {
    return settled(() => {
      const { project } = readInMemoryConfig(context.config);
      const pr = this.snapshot(
        context,
        project,
        this.host.pull(context.credentials, project, prNumber),
      );

      if (knownHeadSha === pr.headSha) {
        return { pr, revision: null };
      }

      const files = this.host.files(context.credentials, project, prNumber);

      return {
        pr,
        revision: {
          headSha: pr.headSha,
          pushedAt: pr.updatedAt,
          files: files.map(({ path, additions, deletions }) => ({ path, additions, deletions })),
          diffExcerpt: diffExcerptOf(
            files.map((file) => ({ path: file.path, patch: file.patch ?? null })),
          ),
        },
      };
    });
  }

  /**
   * Merge a PR through the host, delete its branch, and verify its closing keywords.
   *
   * @param context - The source, opened.
   * @param prNumber - Its number.
   * @param input - The strategy, message and branch deletion.
   * @returns What happened.
   */
  mergePR(
    context: TicketSyncContext,
    prNumber: number,
    input: MergePrInput,
  ): Promise<MergePrResult> {
    return settled(() => {
      const strategy = assertAdvertisedStrategy(this.prs, input.strategy);
      const message = input.message.trim();

      if (message === "") {
        throw invalid("a merge needs a message");
      }

      const { project } = readInMemoryConfig(context.config);
      const pull = this.host.pull(context.credentials, project, prNumber);
      const alreadyMerged = pull.state === "merged";

      if (pull.state === "closed") {
        throw invalid(`#${String(prNumber)} is closed, and a closed PR cannot be merged`);
      }

      const sha = alreadyMerged
        ? null
        : this.host.merge(context.credentials, project, prNumber, strategy, message);
      let branchDeleted = false;

      if (input.deleteBranch) {
        try {
          this.host.deleteBranch(context.credentials, project, pull.head);
          branchDeleted = true;
        } catch (error) {
          // Already gone is the outcome asked for; any other refusal is reported, not thrown.
          branchDeleted = error instanceof InMemoryTrackerRefusal && error.status === 422;
        }
      }

      const closures: IssueClosure[] = closingReferences(message, pull.body).map((reference) => {
        if (reference.owner !== null) {
          return {
            reference: reference.reference,
            closed: false,
            detail: `${reference.reference} is in another repository, which this host cannot see`,
          };
        }

        try {
          return this.host.issueClosed(context.credentials, project, reference.number)
            ? { reference: reference.reference, closed: true, detail: null }
            : {
                reference: reference.reference,
                closed: false,
                detail: `${reference.reference} is still open after the merge`,
              };
        } catch {
          return {
            reference: reference.reference,
            closed: false,
            detail: `${reference.reference} could not be verified after the merge`,
          };
        }
      });

      return { sha, alreadyMerged, branchDeleted, closures };
    });
  }

  /**
   * Publish a comment, editing the one an earlier publish under the same key left.
   *
   * @param context - The source, opened.
   * @param prNumber - The PR.
   * @param comment - The key and the Markdown.
   * @returns The comment's id and how it landed.
   */
  commentPR(
    context: TicketSyncContext,
    prNumber: number,
    comment: PrCommentInput,
  ): Promise<PrCommentResult> {
    return settled(() => {
      const body = withPrCommentMarker(comment.body, comment.key);
      const { project } = readInMemoryConfig(context.config);
      const existing = this.host
        .comments(context.credentials, project, prNumber)
        .find(([, text]) => hasPrCommentMarker(text, comment.key));

      if (existing === undefined) {
        return {
          commentId: String(this.host.comment(context.credentials, project, prNumber, body)),
          mode: "created" as const,
        };
      }

      if (existing[1] === body) {
        return { commentId: String(existing[0]), mode: "unchanged" as const };
      }

      this.host.editComment(context.credentials, project, prNumber, existing[0], body);

      return { commentId: String(existing[0]), mode: "edited" as const };
    });
  }

  /**
   * Ask a login to review a PR.
   *
   * @param context - The source, opened.
   * @param prNumber - The PR.
   * @param user - The login.
   * @returns Who is asked, or null when `reviews` is not declared.
   */
  requestReview(
    context: TicketSyncContext,
    prNumber: number,
    user: string,
  ): Promise<ReviewRequestResult | null> {
    return settled(() => {
      if (!this.prs.reviews) {
        return null;
      }

      const login = user.trim();

      if (login === "") {
        throw invalid("a reviewer needs a login");
      }

      const { project } = readInMemoryConfig(context.config);

      return {
        requested: this.host.requestReviewer(context.credentials, project, prNumber, login),
      };
    });
  }

  /**
   * The PRs changed after a cursor.
   *
   * @param context - The source, opened.
   * @param cursor - A change sequence this member answered, or null.
   * @returns The events, oldest first.
   */
  prEvents(context: TicketSyncContext, cursor: string | null): Promise<PrEventPage> {
    return settled(() => {
      const { project } = readInMemoryConfig(context.config);
      const after = cursor !== null && /^\d{1,15}$/.test(cursor) ? Number(cursor) : 0;
      const { changes, last, more } = this.host.changesAfter(
        context.credentials,
        project,
        after,
        this.eventPage,
      );

      return {
        events: changes.map(({ pull }) => ({
          number: pull.number,
          state: pull.state,
          updatedAt: new Date(pull.updated),
        })),
        nextCursor: String(last),
        hasMore: more,
      };
    });
  }

  /**
   * A PR as the SPI's snapshot.
   *
   * @param context - The source, opened — the file walk is a request of its own.
   * @param project - The project.
   * @param pull - The PR.
   * @returns The snapshot.
   */
  private snapshot(
    context: TicketSyncContext,
    project: string,
    pull: InMemoryPull,
  ): PullRequestSnapshot {
    const files = this.host.files(context.credentials, project, pull.number);

    return {
      number: pull.number,
      url: pullUrl(project, pull.number),
      title: pull.title,
      body: pull.body,
      state: pull.state,
      headBranch: pull.head,
      baseBranch: pull.base,
      headSha: this.host.headOf(pull),
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      changedFiles: files.length,
      mergedAt: pull.mergedAt === null ? null : new Date(pull.mergedAt),
      mergedBy: pull.state === "merged" ? IN_MEMORY_MERGER : null,
      updatedAt: new Date(pull.updated),
    };
  }
}

/**
 * A PR's page on the in-memory host.
 *
 * @param project - The project.
 * @param number - The PR.
 * @returns `https://tracker.example.invalid/PROJ/pull/1`.
 */
export function pullUrl(project: string, number: number): string {
  return `${IN_MEMORY_SITE}/${project}/pull/${String(number)}`;
}

/**
 * Run a synchronous host call as the promise a PR member answers.
 *
 * @param run - The call.
 * @returns Its value, or a rejection carrying a `TicketSourceError` classified the write-side way.
 */
function settled<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(asInMemoryWriteFailure(error));
  }
}

/**
 * A refusal of an argument, before anything is sent.
 *
 * @param detail - What is wrong.
 * @returns The error.
 */
function invalid(detail: string): TicketSourceError {
  return new TicketSourceError("validation", detail);
}

/**
 * A token's digest — the host never keeps the token itself.
 *
 * @param token - The token.
 * @returns Its SHA-256, hex.
 */
function digestOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

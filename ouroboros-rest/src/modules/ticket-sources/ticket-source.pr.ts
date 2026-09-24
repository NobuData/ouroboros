/**
 * The PR half of the ticket-source SPI — what a git host says it can do with pull requests, and
 * the values that cross the interface when it does.
 *
 * AX.1 ([#357](https://github.com/NobuData/ouroboros/issues/357)): *the third capability family*.
 * WF-Q reads tickets through this SPI and AL.2 ([#278](https://github.com/NobuData/ouroboros/issues/278))
 * extended it to write them; PRs join the same discipline rather than getting a GitHub-only module
 * (the issue's option 1-A). `ticket-source.provider.ts` holds the members (`PrCapableProvider`);
 * this file holds everything those members take and answer, plus the pure rules every provider and
 * the conformance kit apply the same way.
 *
 * ```
 * capabilities().pr = {
 *   pullRequests     boolean                         — the gate for every member
 *   create           boolean                         — else createPR answers null
 *   mergeStrategies  ('merge' | 'squash' | 'rebase')[] — mergePR refuses anything else, before any call
 *   reviews          boolean                         — else requestReview answers null
 *   events           'poll' | 'webhook' | 'none'     — poll for the MVP; webhook reserved for #122
 * }
 * createPR(ctx, {branch, base, title, body})    → { number, url } | null     idempotent by branch → base
 * getPR(ctx, n)                                 → PullRequestSnapshot
 * syncPR(ctx, n, knownHeadSha)                  → { pr, revision | null }     revision when the head sha moved
 * mergePR(ctx, n, {strategy, message, deleteBranch}) → { sha, branchDeleted, closures[] }
 * commentPR(ctx, n, {key, body})                → { commentId, mode }        edits, never re-posts
 * requestReview(ctx, n, user)                   → { requested } | null
 * prEvents(ctx, cursor)                         → { events[], nextCursor, hasMore }
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why merging goes through the host, never around it.** The issue's option 1-C — pushing our own
 * merge commits — is rejected explicitly: it would bypass branch protection, merge queues, required
 * checks and the host's audit trail. `mergePR` asks the host to merge, and a host that refuses
 * (checks red, protection unmet) answers a classified `validation` refusal rather than a merge.
 *
 * **Why comments are edited, not re-posted** — decision **V9**, the O.5 pattern. A PR carrying
 * fourteen near-identical evidence comments is worse than one carrying none. So a published
 * comment carries a marker line ({@link prCommentMarker}) keyed by the caller, and a second
 * publish under the same key edits the comment the marker finds. The conformance kit publishes
 * twice and counts.
 *
 * **Why issue closure is verified, not assumed.** `Closes #482` in a merge message closes the issue
 * only when the host decides it should — GitHub ignores the keyword on a merge into a non-default
 * branch and across repositories it cannot see. {@link MergePrResult.closures} is what the host
 * *actually* did to every referenced issue, read back after the merge, so the merge executor can
 * report a failure to close instead of claiming a close that never happened.
 *
 * **Why the flags are a total shape**, when the issue sketches two as optional: the write file's
 * argument, unchanged. {@link NO_PR_CAPABILITIES} is the one-line answer of a provider with no PRs
 * (every ticket tracker), so totality costs it nothing.
 *
 * **Why an absent sub-capability answers `null`.** `createPR` under `create: false` and
 * `requestReview` under `reviews: false` are configurations, not crashes — AL.2's rule for
 * `ensureMilestone`, kept. `mergePR` is the exception: a strategy the host does not advertise is a
 * caller's mistake, refused as `validation` **before any request is sent**.
 *
 * PR semantics differ per host — GitLab approvals are not GitHub reviews, squash options differ —
 * and `docs/TICKET_SOURCES.md` § 7b keeps the per-host mapping table. No host's SDK and no provider
 * is imported here (decision **P5**).
 */

import { TicketSourceError } from "./ticket-source.errors";

/** How a host may merge a PR. The three every host in V030's git-host set names. */
export type MergeStrategy = "merge" | "squash" | "rebase";

/** The three as values, in the order the merge plan's selector draws them. */
export const MERGE_STRATEGIES = [
  "merge",
  "squash",
  "rebase",
] as const satisfies readonly MergeStrategy[];

/**
 * How a provider learns that a PR changed.
 *
 * `poll` is the MVP's — {@link PrCapableProvider.prEvents} walks a cursor, the established intake
 * pattern. `webhook` is the slot reserved for the GitHub App ([#122](https://github.com/NobuData/ouroboros/issues/122));
 * no delivery endpoint exists yet, so {@link prCapabilityViolations} refuses it until one does.
 * `none` is a provider without PRs.
 */
export type PrEventMode = "poll" | "webhook" | "none";

/** The three as values. */
export const PR_EVENT_MODES = ["poll", "webhook", "none"] as const satisfies readonly PrEventMode[];

/** What a provider can do with pull requests. See this file's header for why every flag is required. */
export interface TicketSourcePrCapabilities {
  /**
   * Whether this provider implements `PrCapableProvider`.
   *
   * **The gate for everything else** — every other flag is off when this is, and the registry
   * refuses a declaration that disagrees with the members at boot.
   */
  readonly pullRequests: boolean;
  /** Whether `createPR` opens anything. `false` makes it answer `null`. */
  readonly create: boolean;
  /**
   * The strategies `mergePR` accepts — the host's advertised list. Non-empty on a provider with
   * PRs, one entry per strategy.
   */
  readonly mergeStrategies: readonly MergeStrategy[];
  /** Whether `requestReview` asks anybody. `false` makes it answer `null`. */
  readonly reviews: boolean;
  /** How changes are learned. `none` exactly when {@link pullRequests} is false. */
  readonly events: PrEventMode;
}

/**
 * The declaration of a provider without pull requests — every ticket tracker's `pr`.
 *
 * Frozen, list included, so a provider returning it cannot have it edited under another's feet.
 */
export const NO_PR_CAPABILITIES: TicketSourcePrCapabilities = Object.freeze({
  pullRequests: false,
  create: false,
  mergeStrategies: Object.freeze([]),
  reviews: false,
  events: "none",
});

/** Where a PR stands on its host. The verification plane's refinements (V052) are not the host's. */
export type HostPrState = "open" | "closed" | "merged";

/** One changed file — a row of the changed-files card, and one entry of `pr_revisions.files`. */
export interface PrFileChange {
  /** The path, repository-relative. Non-blank; one entry per path. */
  readonly path: string;
  /** Lines added. A whole number ≥ 0. */
  readonly additions: number;
  /** Lines deleted. A whole number ≥ 0. */
  readonly deletions: number;
}

/**
 * A PR as its host reports it right now — V052's sync-owned `pull_requests` columns and nothing the
 * verification plane owns.
 */
export interface PullRequestSnapshot {
  /** The host's number — `pull_requests.external_number`. A whole number ≥ 1. */
  readonly number: number;
  /** The PR's page — `external_url`. `https` with a host. */
  readonly url: string;
  /** The title. Non-blank. */
  readonly title: string;
  /** The description, or null. Where a host reads closing keywords from alongside the merge message. */
  readonly body: string | null;
  /** Open, closed or merged. */
  readonly state: HostPrState;
  /** The branch it merges from — `loop/482-canbus-flake`. */
  readonly headBranch: string;
  /** The branch it merges into — `main`. */
  readonly baseBranch: string;
  /** The head commit — 7 to 40 lowercase hex, `pr_revisions.head_sha`'s grammar. */
  readonly headSha: string;
  /** Lines added across the PR. */
  readonly additions: number;
  /** Lines deleted across the PR. */
  readonly deletions: number;
  /** Files changed across the PR. */
  readonly changedFiles: number;
  /** When it merged; set exactly when {@link state} is `merged`. */
  readonly mergedAt: Date | null;
  /** The host login that merged it, or null — only ever set on a merged PR. */
  readonly mergedBy: string | null;
  /** When the host last changed it. */
  readonly updatedAt: Date;
}

/** A push, as `syncPR` detected it — the sync-owned columns of one `pr_revisions` row. */
export interface PrRevisionSnapshot {
  /** The head after the push. Equal to the snapshot's {@link PullRequestSnapshot.headSha}. */
  readonly headSha: string;
  /**
   * When the host saw the push. A host that reports no push time (GitHub's PR API does not)
   * answers the PR's last-updated instant at the sync that detected it.
   */
  readonly pushedAt: Date;
  /** The changed-files card's rows — the PR's files at this head. */
  readonly files: readonly PrFileChange[];
  /** A bounded diff sample ({@link MAX_DIFF_EXCERPT}), or null when the host gave no patch text. */
  readonly diffExcerpt: string | null;
}

/** What `syncPR` answers. */
export interface PrSyncResult {
  /** The PR now. */
  readonly pr: PullRequestSnapshot;
  /**
   * The new revision — non-null exactly when the head sha differs from the one the caller already
   * holds (or the caller holds none). **Revision detection is by head-sha change**, never by time.
   */
  readonly revision: PrRevisionSnapshot | null;
}

/** A PR to open. */
export interface CreatePrInput {
  /** The branch to merge from. Must already exist on the host. */
  readonly branch: string;
  /** The branch to merge into. Different from {@link branch}. */
  readonly base: string;
  /** The title. Non-blank. */
  readonly title: string;
  /** The description, or null. */
  readonly body: string | null;
}

/** A PR that exists on a host. */
export interface PrRef {
  /** Its number. */
  readonly number: number;
  /** Its page. */
  readonly url: string;
}

/** How to merge. */
export interface MergePrInput {
  /** One of the provider's advertised {@link TicketSourcePrCapabilities.mergeStrategies}. */
  readonly strategy: MergeStrategy;
  /**
   * The merge message — `fix(can): … Closes #482.` Its first line is the commit title and the
   * rest the commit body, on hosts that take the two apart. Non-blank.
   */
  readonly message: string;
  /** Whether to delete the head branch once merged — the merge plan's `delete branch`. */
  readonly deleteBranch: boolean;
}

/** What the host did to one issue a merge referenced with a closing keyword. */
export interface IssueClosure {
  /** The reference as written — `#482`, or `acme/other#7` across repositories. */
  readonly reference: string;
  /** Whether the issue is closed now, read back from the host after the merge. */
  readonly closed: boolean;
  /** Why it is not, in words fit for a report — or null when it is closed. */
  readonly detail: string | null;
}

/** What `mergePR` did. */
export interface MergePrResult {
  /** The merge commit, or null when the host did not say. */
  readonly sha: string | null;
  /** Whether the PR was already merged before this call — a retried merge is not a second merge. */
  readonly alreadyMerged: boolean;
  /** Whether the head branch is gone. `false` when not asked, or when the host refused to delete it. */
  readonly branchDeleted: boolean;
  /** One entry per issue the message or description closes by keyword — **verified**, not assumed. */
  readonly closures: readonly IssueClosure[];
}

/** A comment to publish, idempotently. */
export interface PrCommentInput {
  /**
   * The caller's key — the evidence comment's, a gate's. **The dedupe contract**: a second publish
   * with the same key edits the first comment. {@link PR_COMMENT_KEY}'s grammar.
   */
  readonly key: string;
  /** The Markdown to publish. Non-blank. */
  readonly body: string;
}

/** How a publish landed. */
export type PrCommentMode = "created" | "edited" | "unchanged";

/** What `commentPR` did. */
export interface PrCommentResult {
  /** The host's id for the comment — the same on every publish under one key. */
  readonly commentId: string;
  /** `created` the first time, `edited` when the body changed, `unchanged` when it did not. */
  readonly mode: PrCommentMode;
}

/** What `requestReview` did. */
export interface ReviewRequestResult {
  /** The logins now asked to review — including any already asked. */
  readonly requested: readonly string[];
}

/** One change to one PR — a hint to `syncPR` it, never the change itself. */
export interface PrEvent {
  /** The PR. */
  readonly number: number;
  /** Where it stands. */
  readonly state: HostPrState;
  /** When the host changed it. */
  readonly updatedAt: Date;
}

/** One poll of `prEvents`. */
export interface PrEventPage {
  /** The changes, oldest first. A PR may appear again on a later page; `syncPR` is idempotent. */
  readonly events: readonly PrEvent[];
  /** What to pass next time. Opaque — the loop never interprets it, as with ticket cursors. */
  readonly nextCursor: string;
  /** Whether more changes were waiting than this page carried. */
  readonly hasMore: boolean;
}

/** The longest diff sample a revision keeps — `pr_revisions_diff_excerpt_bounded`'s 16 KiB. */
export const MAX_DIFF_EXCERPT = 16_384;

/** The grammar a comment key is held to — one marker line that cannot close its HTML comment. */
export const PR_COMMENT_KEY = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

/** `pr_revisions_head_sha_shape`, as a pattern. */
export const HEAD_SHA = /^[0-9a-f]{7,40}$/;

/**
 * Everything wrong with a `capabilities().pr` declaration, judged on its own.
 *
 * Shared by `TicketSourceRegistry` (refuses at boot) and the conformance kit (reports in a test run)
 * — one rule, two places it is enforced.
 *
 * @param pr - The declaration. `unknown`, for the write file's reason.
 * @returns The violations. Empty means a total, coherent declaration.
 */
export function prCapabilityViolations(pr: unknown): string[] {
  if (typeof pr !== "object" || pr === null || Array.isArray(pr)) {
    return ["capabilities().pr must be an object — NO_PR_CAPABILITIES says no"];
  }

  const declared = pr as Record<string, unknown>;
  const violations: string[] = [];

  for (const flag of ["pullRequests", "create", "reviews"] as const) {
    if (typeof declared[flag] !== "boolean") {
      violations.push(`capabilities().pr.${flag} must be a boolean — false is an answer`);
    }
  }

  const strategies = declared.mergeStrategies;

  if (
    !Array.isArray(strategies) ||
    strategies.some((strategy) => !(MERGE_STRATEGIES as readonly unknown[]).includes(strategy)) ||
    new Set(strategies).size !== strategies.length
  ) {
    violations.push(
      `capabilities().pr.mergeStrategies must list each of ${MERGE_STRATEGIES.join(", ")} at most once`,
    );
  }

  if (!(PR_EVENT_MODES as readonly unknown[]).includes(declared.events)) {
    violations.push(`capabilities().pr.events must be one of ${PR_EVENT_MODES.join(", ")}`);
  }

  if (violations.length > 0) {
    return violations;
  }

  const list = strategies as readonly MergeStrategy[];

  if (declared.pullRequests === true) {
    if (list.length === 0) {
      violations.push(
        "capabilities().pr.mergeStrategies is empty — a host with PRs merges somehow",
      );
    }

    if (declared.events === "none") {
      violations.push(
        "capabilities().pr.events is none but pullRequests is true — poll is the MVP's",
      );
    }

    if (declared.events === "webhook") {
      violations.push(
        "capabilities().pr.events is webhook, which is reserved for the GitHub App (#122) — no " +
          "delivery endpoint exists yet, so declare poll",
      );
    }

    return violations;
  }

  // Coherence: nothing can be created, merged, reviewed or watched without PRs.
  for (const flag of ["create", "reviews"] as const) {
    if (declared[flag] === true) {
      violations.push(`capabilities().pr.${flag} is true but pullRequests is false`);
    }
  }

  if (list.length > 0) {
    violations.push("capabilities().pr.mergeStrategies is non-empty but pullRequests is false");
  }

  if (declared.events !== "none") {
    violations.push(
      `capabilities().pr.events is ${String(declared.events)} but pullRequests is false — a ` +
        "provider without PRs watches none",
    );
  }

  return violations;
}

/**
 * Refuse a strategy the host does not advertise — **before any request is sent**.
 *
 * Every provider calls this first thing in `mergePR`, so the criterion *"a strategy the host does
 * not advertise is rejected before any API call"* is one rule rather than one per host.
 *
 * @param pr - The provider's `capabilities().pr`.
 * @param strategy - What the caller asked for. `unknown`, because a merge plan row is text.
 * @returns The strategy, narrowed.
 * @throws {TicketSourceError} `validation`, naming what the host does advertise.
 */
export function assertAdvertisedStrategy(
  pr: TicketSourcePrCapabilities,
  strategy: unknown,
): MergeStrategy {
  if (!(pr.mergeStrategies as readonly unknown[]).includes(strategy)) {
    throw new TicketSourceError(
      "validation",
      `the host does not advertise the ${String(strategy)} merge strategy — it offers ` +
        (pr.mergeStrategies.length === 0 ? "none" : pr.mergeStrategies.join(", ")),
    );
  }

  return strategy as MergeStrategy;
}

/**
 * The marker line a published comment carries — see this file's header on decision V9.
 *
 * @param key - The caller's key.
 * @returns `<!-- ouroboros:pr-comment <key> -->`.
 * @throws {TicketSourceError} `validation`, for a key {@link PR_COMMENT_KEY} refuses or one holding
 *   `--`, which would close the comment early.
 */
export function prCommentMarker(key: string): string {
  if (!PR_COMMENT_KEY.test(key) || key.includes("--")) {
    throw new TicketSourceError(
      "validation",
      `a comment key must match ${PR_COMMENT_KEY.source} and hold no "--"`,
    );
  }

  return `<!-- ouroboros:pr-comment ${key} -->`;
}

/**
 * The body a comment is published with: what the caller wrote, then its marker on its own line.
 *
 * @param body - The Markdown. Non-blank.
 * @param key - The caller's key.
 * @returns The body with the marker.
 * @throws {TicketSourceError} `validation`, for a blank body or a key {@link prCommentMarker} refuses.
 */
export function withPrCommentMarker(body: string, key: string): string {
  const marker = prCommentMarker(key);

  if (body.trim() === "") {
    throw new TicketSourceError("validation", "a comment needs a body");
  }

  return `${body.trimEnd()}\n\n${marker}`;
}

/**
 * Whether a comment carries a key's marker as a whole line.
 *
 * @param body - A comment's body, or null.
 * @param key - The key.
 * @returns `true` when one trimmed line is exactly the marker — a marker quoted mid-sentence is not one.
 */
export function hasPrCommentMarker(body: string | null | undefined, key: string): boolean {
  const marker = prCommentMarker(key);

  return (body ?? "").split("\n").some((line) => line.trim() === marker);
}

/** An issue a closing keyword names. */
export interface ClosingReference {
  /** The reference as written — `#482` or `acme/other#7`. */
  readonly reference: string;
  /** The repository's owner, or null for the PR's own repository. */
  readonly owner: string | null;
  /** The repository, or null for the PR's own. */
  readonly repo: string | null;
  /** The issue number. */
  readonly number: number;
}

/**
 * A closing keyword, then a same-repository or `owner/repo` reference. GitHub's and GitLab's
 * keyword sets agree on these nine words.
 */
const CLOSING_KEYWORD =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+((?:([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+))?#([1-9]\d{0,9}))\b/gi;

/**
 * Every issue some text closes by keyword — `Closes #482.`, `fixes acme/other#7`.
 *
 * @param texts - The merge message and the PR description; nulls are skipped.
 * @returns The references, in order of first appearance, each once.
 */
export function closingReferences(...texts: readonly (string | null)[]): ClosingReference[] {
  const found = new Map<string, ClosingReference>();

  for (const text of texts) {
    for (const match of (text ?? "").matchAll(CLOSING_KEYWORD)) {
      const [, reference, owner, repo, number] = match;
      const key = reference.toLowerCase();

      if (!found.has(key)) {
        found.set(key, {
          reference,
          owner: owner ?? null,
          repo: repo ?? null,
          number: Number(number),
        });
      }
    }
  }

  return [...found.values()];
}

/**
 * A revision's diff sample — patches in file order, cut at {@link MAX_DIFF_EXCERPT}.
 *
 * @param patches - Each file's path and patch text, or null where the host gave none (a binary).
 * @returns The sample, or null when there was no patch text at all.
 */
export function diffExcerptOf(
  patches: readonly { readonly path: string; readonly patch: string | null }[],
): string | null {
  const parts = patches
    .filter((file) => file.patch !== null && file.patch !== "")
    .map((file) => `--- ${file.path}\n${file.patch ?? ""}`);

  if (parts.length === 0) {
    return null;
  }

  const joined = parts.join("\n");

  return joined.length <= MAX_DIFF_EXCERPT ? joined : joined.slice(0, MAX_DIFF_EXCERPT);
}

/**
 * Everything wrong with a files snapshot — `ouroboros.pr_revision_files_valid()`'s rule, in
 * TypeScript, so a provider's answer is refused in a test run rather than by a CHECK in production.
 *
 * @param files - What a provider answered. `unknown`, for the kit.
 * @param at - What to prefix every sentence with.
 * @returns The violations.
 */
export function prFileViolations(files: unknown, at: string): string[] {
  if (!Array.isArray(files)) {
    return [`${at}: files must be an array`];
  }

  const violations: string[] = [];
  const paths = new Set<string>();

  for (const file of files as unknown[]) {
    const { path, additions, deletions } = (file ?? {}) as Record<string, unknown>;

    if (typeof path !== "string" || path.trim() === "") {
      violations.push(`${at}: every file needs a non-blank path`);
      continue;
    }

    for (const [name, count] of [
      ["additions", additions],
      ["deletions", deletions],
    ] as const) {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        violations.push(`${at}: ${path}'s ${name} must be a whole number ≥ 0`);
      }
    }

    if (paths.has(path)) {
      violations.push(`${at}: ${path} is listed twice — one entry per path`);
    }

    paths.add(path);
  }

  return violations;
}

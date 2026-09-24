/**
 * The conformance kit's PR suites — what every `TicketSourceProvider` declaring pull requests has to
 * pass before the gate engine or the merge executor is allowed to point at it.
 *
 * AX.1 ([#357](https://github.com/NobuData/ouroboros/issues/357)), extending Q.5's kit
 * ([#142](https://github.com/NobuData/ouroboros/issues/142)) beside AL.2's write suites. A provider
 * author adds one call:
 *
 * ```ts
 * describeTicketSourcePrConformance("GitlabTicketSourceProvider", () => ({
 *   provider, context, base, push, open, openIssue, foreignReference, reviewer, ledger, refuse, recover,
 * }));
 * ```
 *
 * ```
 * describeTicketSourcePrConformance(provider, sandbox)
 *   ├─ declaration      coherent · agrees with the seven members
 *   ├─ round trip       push → createPR (twice → one PR) → getPR → syncPR revision 1 → no change →
 *   │                   push a second commit → revision 2 detected, with correct file counts
 *   ├─ merge            unadvertised strategy refused before any request · squash + delete branch ·
 *   │                   `Closes #N` verified closed · a foreign reference reported not closed ·
 *   │                   a retried merge merges nothing
 *   ├─ comments         re-publish edits, never re-posts · another key is another comment
 *   ├─ reviews          asked once however often · null when not declared
 *   ├─ events           a pushed PR is on the next poll · every event names a PR the host has
 *   ├─ error taxonomy   auth · permission · validation · rate_limit · not_found · upstream
 *   └─ rollback         a refused comment or merge leaves nothing behind
 * ```
 *
 * **The harness is a sandbox, not a script.** `push` is `git push`, `openIssue` files an issue, and
 * `ledger` reads what the host holds — never through the provider, for the write kit's reason: an
 * idempotency claim is a claim about the host. An HTTP provider's sandbox is a recorded host; the
 * in-memory fake's is `InMemoryPrHost` itself. The GitLab implementation (AZ.3,
 * [#373](https://github.com/NobuData/ouroboros/issues/373)) passes these same suites.
 *
 * **Every case builds a fresh harness**, so a refusal arranged in one cannot leak into the next.
 *
 * It is a `.fixture.ts`: type-checked with the code it gates, left out of the image by
 * `tsconfig.build.json`, and held to the fake by `ticket-source-core-tests-run-on-the-fake`.
 */

import { describeThrown, retentionViolations, settle } from "./conformance.fixture";
import { writeFailureViolations } from "./conformance.write.fixture";
import {
  TICKET_SOURCE_WRITE_ERROR_CLASSES,
  type TicketSourceErrorClass,
} from "./ticket-source.errors";
import {
  HEAD_SHA,
  MAX_DIFF_EXCERPT,
  MERGE_STRATEGIES,
  prFileViolations,
  type MergeStrategy,
  type PrFileChange,
  type PullRequestSnapshot,
} from "./ticket-source.pr";
import {
  prMemberViolations,
  supportsPullRequests,
  type PrCapableProvider,
  type TicketSourceProvider,
  type TicketSyncContext,
} from "./ticket-source.provider";

/** What a host holds that a PR operation could have changed. See this file's header. */
export interface PrLedger {
  /** Every PR's number. */
  readonly prs: readonly number[];
  /** Every conversation comment, as `[prNumber, commentId, body]`. */
  readonly comments: readonly (readonly [number, string, string])[];
  /** Every merged PR's number. */
  readonly merged: readonly number[];
  /** Every branch that exists. */
  readonly branches: readonly string[];
  /** How many requests the host has served, refusals included. */
  readonly requests: number;
}

/** Everything the PR suites need from a provider author. */
export interface TicketSourcePrConformance {
  /** The provider under test. Must declare `pr.pullRequests`. */
  readonly provider: TicketSourceProvider;
  /** The source the PR operations run against. Its credential must be distinctive. */
  readonly context: TicketSyncContext;
  /** The default branch — what a PR merges into, and what a keyword close requires. */
  readonly base: string;
  /**
   * Push a commit — the sandbox's `git push`. Creates the branch off {@link base} when absent.
   *
   * @returns The commit's sha.
   */
  readonly push: (branch: string, files: readonly PrFileChange[]) => string;
  /**
   * Open a PR on the host directly — how a case gets one when the provider declares `create: false`.
   *
   * @returns Its number.
   */
  readonly open: (branch: string, title: string) => number;
  /**
   * File an open issue in the PR's repository, for a merge message to close.
   *
   * @returns Its number.
   */
  readonly openIssue: () => number;
  /** A closing reference the host cannot close — an issue in another repository: `acme/other#7`. */
  readonly foreignReference: string;
  /** A login the host accepts as a reviewer. */
  readonly reviewer: string;
  /** What the host holds right now. */
  readonly ledger: () => PrLedger;
  /** One arranger per class: after it runs, **every** request meets that refusal. */
  readonly refuse: Readonly<Record<TicketSourceErrorClass, () => void>>;
  /** Undo whatever {@link refuse} arranged. */
  readonly recover: () => void;
}

/** The first commit's files — two, so counts are sums rather than one number read back. */
export const FIRST_PUSH: readonly PrFileChange[] = Object.freeze([
  { path: "src/can/telemetry.c", additions: 41, deletions: 9 },
  { path: "src/can/isr.h", additions: 6, deletions: 2 },
]);

/** The second commit's files — one new path and one touched again. */
export const SECOND_PUSH: readonly PrFileChange[] = Object.freeze([
  { path: "src/can/telemetry.c", additions: 12, deletions: 4 },
  { path: "tests/can/test_frame_order.c", additions: 9, deletions: 0 },
]);

/**
 * The files a branch carrying some pushes changes, summed per path — what a host's file listing
 * must answer.
 *
 * @param pushes - Each push's files, in order.
 * @returns The expected snapshot, sorted by path.
 */
export function expectedFiles(...pushes: readonly (readonly PrFileChange[])[]): PrFileChange[] {
  const byPath = new Map<string, PrFileChange>();

  for (const file of pushes.flat()) {
    const known = byPath.get(file.path);

    byPath.set(file.path, {
      path: file.path,
      additions: (known?.additions ?? 0) + file.additions,
      deletions: (known?.deletions ?? 0) + file.deletions,
    });
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Everything wrong with a snapshot, judged against V052's columns.
 *
 * @param pr - What a provider answered. `unknown`, for the read kit's reason.
 * @param at - What to prefix every sentence with.
 * @returns The violations. Empty means a row `pull_requests` accepts.
 */
export function snapshotViolations(pr: unknown, at: string): string[] {
  if (typeof pr !== "object" || pr === null) {
    return [`${at}: must answer a snapshot`];
  }

  const snapshot = pr as Partial<PullRequestSnapshot>;
  const violations: string[] = [];

  if (!Number.isInteger(snapshot.number) || (snapshot.number ?? 0) < 1) {
    violations.push(`${at}: number must be a whole number ≥ 1`);
  }

  if (typeof snapshot.url !== "string" || !/^https:\/\/[^/\s]+\//.test(snapshot.url)) {
    violations.push(`${at}: url must be an https link with a host`);
  }

  for (const field of ["title", "headBranch", "baseBranch"] as const) {
    if (typeof snapshot[field] !== "string" || snapshot[field].trim() === "") {
      violations.push(`${at}: ${field} must be non-blank — V052 refuses ''`);
    }
  }

  if (typeof snapshot.headSha !== "string" || !HEAD_SHA.test(snapshot.headSha)) {
    violations.push(`${at}: headSha must be 7–40 lowercase hex`);
  }

  for (const field of ["additions", "deletions", "changedFiles"] as const) {
    const count = snapshot[field];

    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      violations.push(`${at}: ${field} must be a whole number ≥ 0`);
    }
  }

  if (!["open", "closed", "merged"].includes(String(snapshot.state))) {
    violations.push(`${at}: state must be open, closed or merged`);
  }

  if ((snapshot.state === "merged") !== snapshot.mergedAt instanceof Date) {
    violations.push(`${at}: mergedAt must be set exactly when the PR is merged`);
  }

  if (snapshot.mergedBy !== null && snapshot.state !== "merged") {
    violations.push(`${at}: mergedBy is only ever set on a merged PR`);
  }

  if (!(snapshot.updatedAt instanceof Date) || Number.isNaN(snapshot.updatedAt.getTime())) {
    violations.push(`${at}: updatedAt must be a valid Date`);
  }

  return violations;
}

/**
 * Everything wrong between a files snapshot and the one expected.
 *
 * @param files - What the provider answered.
 * @param expected - {@link expectedFiles}.
 * @param at - What to prefix every sentence with.
 * @returns The violations.
 */
export function fileSnapshotViolations(
  files: readonly PrFileChange[] | undefined,
  expected: readonly PrFileChange[],
  at: string,
): string[] {
  const shape = prFileViolations(files, at);

  if (shape.length > 0 || files === undefined) {
    return shape;
  }

  const sorted = [...files]
    .map(({ path, additions, deletions }) => ({ path, additions, deletions }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return JSON.stringify(sorted) === JSON.stringify(expected)
    ? []
    : [`${at}: answered files ${JSON.stringify(sorted)}, expected ${JSON.stringify(expected)}`];
}

/**
 * Run a call and report a rejection as a sentence.
 *
 * @param at - What the call is, for the sentence.
 * @param run - The call.
 * @returns The value, or the violation that it rejected.
 */
async function attempt<T>(
  at: string,
  run: () => Promise<T>,
): Promise<{ value: T; violations: [] } | { value: undefined; violations: [string] }> {
  const settled = await settle(run);

  return settled.resolved
    ? { value: settled.value, violations: [] }
    : { value: undefined, violations: [`${at} rejected: ${describeThrown(settled.error)}`] };
}

/**
 * The provider, narrowed — or a thrown sentence, which fails the case with the reason.
 *
 * @param provider - The harness's provider.
 * @returns It, as a PR-capable provider.
 * @throws {Error} When it does not declare pull requests.
 */
function prHost(provider: TicketSourceProvider): PrCapableProvider {
  if (!supportsPullRequests(provider)) {
    throw new Error(
      "the PR suites run only against a provider declaring pr.pullRequests — a provider without " +
        "PRs has its declaration checked by the read kit",
    );
  }

  return provider;
}

/**
 * A strategy to merge with: squash when advertised — the merge plan's default — else the first.
 *
 * @param provider - The provider.
 * @returns The strategy.
 */
function strategyOf(provider: PrCapableProvider): MergeStrategy {
  const { mergeStrategies } = provider.capabilities().pr;

  return mergeStrategies.includes("squash") ? "squash" : mergeStrategies[0];
}

/**
 * An open PR on a pushed branch, through `createPR` when declared and the sandbox otherwise.
 *
 * @param harness - The harness.
 * @param branch - The branch, pushed already.
 * @returns The PR's number, or the violations that stopped it.
 */
async function openedPR(
  harness: TicketSourcePrConformance,
  branch: string,
): Promise<{ number: number | undefined; violations: string[] }> {
  const provider = prHost(harness.provider);

  if (!provider.capabilities().pr.create) {
    return { number: harness.open(branch, "can: fix flaky telemetry frame order"), violations: [] };
  }

  const created = await attempt("createPR", () =>
    provider.createPR(harness.context, {
      branch,
      base: harness.base,
      title: "can: fix flaky telemetry frame order under ISR load",
      body: "Loop #1847 · issue work.",
    }),
  );

  return {
    number: created.value?.number,
    violations: [
      ...created.violations,
      ...(created.value === null ? ["createPR answered null although pr.create is true"] : []),
    ],
  };
}

/**
 * The PR suites.
 *
 * @param name - What the provider is called, for the `describe` block.
 * @param build - Builds a harness, fresh for every case.
 */
export function describeTicketSourcePrConformance(
  name: string,
  build: () => TicketSourcePrConformance,
): void {
  describe(`${name} — TicketSourceProvider PR conformance`, () => {
    it("declares a coherent PR declaration that agrees with its seven members", () => {
      const { provider } = build();

      expect([
        ...prMemberViolations(provider),
        ...(supportsPullRequests(provider)
          ? []
          : ["pr.pullRequests must be true to take these suites"]),
      ]).toEqual([]);
    });

    it("round-trips a sandbox: push → one PR however often it is created → revision 1 → push again → revision 2 with correct file counts", async () => {
      const harness = build();
      const { context, push, ledger } = harness;
      const provider = prHost(harness.provider);
      const branch = "loop/482-canbus-flake";
      const first = push(branch, FIRST_PUSH);
      const before = ledger();
      const opened = await openedPR(harness, branch);
      const violations = [...opened.violations];

      if (opened.number === undefined) {
        expect([...violations, "a PR could not be opened"]).toEqual([]);

        return;
      }

      const prNumber = opened.number;

      if (provider.capabilities().pr.create) {
        const again = await attempt("createPR again", () =>
          provider.createPR(context, {
            branch,
            base: harness.base,
            title: "can: fix flaky telemetry frame order under ISR load",
            body: null,
          }),
        );

        violations.push(...again.violations);

        if (again.value?.number !== prNumber) {
          violations.push("createPR for the same branch and base answered a second PR");
        }
      } else {
        const refused = await attempt("createPR", () =>
          provider.createPR(context, { branch, base: harness.base, title: "t", body: null }),
        );

        if (refused.value !== null) {
          violations.push("pr.create is false, so createPR must answer null");
        }
      }

      if (ledger().prs.length - before.prs.length !== 1) {
        violations.push(
          `the host holds ${String(ledger().prs.length - before.prs.length)} new PRs — expected one`,
        );
      }

      const got = await attempt("getPR", () => provider.getPR(context, prNumber));
      const revisionOne = await attempt("syncPR with no revision held", () =>
        provider.syncPR(context, prNumber, null),
      );
      const unchanged = await attempt("syncPR with the head held", () =>
        provider.syncPR(context, prNumber, first),
      );
      const second = push(branch, SECOND_PUSH);
      const revisionTwo = await attempt("syncPR after a second push", () =>
        provider.syncPR(context, prNumber, first),
      );

      violations.push(
        ...got.violations,
        ...revisionOne.violations,
        ...unchanged.violations,
        ...revisionTwo.violations,
        ...snapshotViolations(got.value, "getPR"),
      );

      if (got.value !== undefined) {
        const expected = expectedFiles(FIRST_PUSH);

        if (got.value.state !== "open" || got.value.headSha !== first) {
          violations.push("getPR must answer an open PR whose head is the pushed commit");
        }

        if (
          got.value.additions !== expected.reduce((sum, file) => sum + file.additions, 0) ||
          got.value.deletions !== expected.reduce((sum, file) => sum + file.deletions, 0) ||
          got.value.changedFiles !== expected.length
        ) {
          violations.push("getPR's additions, deletions and changedFiles must be the PR's totals");
        }

        if (got.value.baseBranch !== harness.base || got.value.headBranch !== branch) {
          violations.push("getPR must name the branches the PR was opened with");
        }
      }

      const one = revisionOne.value?.revision;

      if (one === null || one === undefined) {
        violations.push("syncPR holding no revision must answer revision 1");
      } else {
        if (one.headSha !== first) {
          violations.push("revision 1's head must be the first push");
        }

        violations.push(
          ...fileSnapshotViolations(one.files, expectedFiles(FIRST_PUSH), "revision 1"),
        );
      }

      if (unchanged.value !== undefined && unchanged.value.revision !== null) {
        violations.push("syncPR holding the current head must answer no revision");
      }

      const two = revisionTwo.value?.revision;

      if (two === null || two === undefined) {
        violations.push("syncPR after a second push must detect revision 2 by its head sha");
      } else {
        if (two.headSha !== second || revisionTwo.value?.pr.headSha !== second) {
          violations.push("revision 2's head must be the second push");
        }

        if (!(two.pushedAt instanceof Date) || Number.isNaN(two.pushedAt.getTime())) {
          violations.push("revision 2's pushedAt must be a valid Date");
        }

        if (two.diffExcerpt !== null && two.diffExcerpt.length > MAX_DIFF_EXCERPT) {
          violations.push(`a diff excerpt is at most ${String(MAX_DIFF_EXCERPT)} characters`);
        }

        violations.push(
          ...fileSnapshotViolations(
            two.files,
            expectedFiles(FIRST_PUSH, SECOND_PUSH),
            "revision 2",
          ),
        );
      }

      expect(violations).toEqual([]);
    });

    it("refuses a strategy the host does not advertise before any request is sent", async () => {
      const { provider, context, ledger } = build();
      const pr = prHost(provider);
      const advertised = pr.capabilities().pr.mergeStrategies;
      const unadvertised: readonly string[] = [
        ...MERGE_STRATEGIES.filter((strategy) => !advertised.includes(strategy)),
        "octopus",
      ];
      const violations: string[] = [];

      for (const strategy of unadvertised) {
        const before = ledger().requests;
        const refused = await settle(() =>
          pr.mergePR(context, 1, {
            strategy: strategy as MergeStrategy,
            message: "fix(can): order frames. Closes #482.",
            deleteBranch: true,
          }),
        );

        violations.push(
          ...writeFailureViolations(
            refused,
            "validation",
            context.credentials,
            `mergePR(${strategy})`,
          ),
        );

        if (ledger().requests !== before) {
          violations.push(`mergePR(${strategy}) sent a request before refusing the strategy`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("merges through the host with delete-branch, verifies Closes #N, reports a close that failed, and merges once however often it is asked", async () => {
      const harness = build();
      const { context, push, ledger, openIssue, foreignReference } = harness;
      const provider = prHost(harness.provider);
      const branch = "loop/482-canbus-flake";

      push(branch, FIRST_PUSH);

      const opened = await openedPR(harness, branch);
      const violations = [...opened.violations];

      if (opened.number === undefined) {
        expect([...violations, "a PR could not be opened"]).toEqual([]);

        return;
      }

      const prNumber = opened.number;
      const issue = openIssue();
      const input = {
        strategy: strategyOf(provider),
        message: `fix(can): order telemetry frames under ISR load\n\nCloses #${String(issue)}. Fixes ${foreignReference}.`,
        deleteBranch: true,
      };
      const merged = await attempt("mergePR", () => provider.mergePR(context, prNumber, input));
      const again = await attempt("mergePR again", () =>
        provider.mergePR(context, prNumber, input),
      );
      const after = await attempt("getPR after the merge", () => provider.getPR(context, prNumber));

      violations.push(...merged.violations, ...again.violations, ...after.violations);

      if (merged.value !== undefined) {
        if (merged.value.alreadyMerged) {
          violations.push("the first mergePR must not report the PR as already merged");
        }

        if (!merged.value.branchDeleted || ledger().branches.includes(branch)) {
          violations.push("mergePR with deleteBranch must leave the head branch gone");
        }

        const own = merged.value.closures.find(
          (closure) => closure.reference === `#${String(issue)}`,
        );
        const foreign = merged.value.closures.find(
          (closure) => closure.reference === foreignReference,
        );

        if (own?.closed !== true) {
          violations.push(`#${String(issue)} must be verified closed after the merge`);
        }

        if (foreign === undefined || foreign.closed || (foreign.detail ?? "").trim() === "") {
          violations.push(
            `${foreignReference} cannot be closed by this host, and the failure must be reported with a reason`,
          );
        }
      }

      if (again.value !== undefined && !again.value.alreadyMerged) {
        violations.push("a retried mergePR must report the PR already merged");
      }

      if (ledger().merged.filter((number) => number === prNumber).length !== 1) {
        violations.push("the host must hold the PR merged exactly once");
      }

      if (after.value !== undefined) {
        violations.push(...snapshotViolations(after.value, "getPR after the merge"));

        if (after.value.state !== "merged") {
          violations.push("getPR after the merge must answer merged");
        }
      }

      const blank = await settle(() =>
        provider.mergePR(context, prNumber, { ...input, message: "   " }),
      );

      violations.push(
        ...writeFailureViolations(
          blank,
          "validation",
          context.credentials,
          "mergePR with a blank message",
        ),
      );

      expect(violations).toEqual([]);
    });

    it("edits a comment on re-publish rather than posting a duplicate", async () => {
      const harness = build();
      const { context, push, ledger } = harness;
      const provider = prHost(harness.provider);

      push("loop/evidence", FIRST_PUSH);

      const opened = await openedPR(harness, "loop/evidence");
      const violations = [...opened.violations];

      if (opened.number === undefined) {
        expect([...violations, "a PR could not be opened"]).toEqual([]);

        return;
      }

      const prNumber = opened.number;
      const before = ledger().comments.length;
      const evidence = { key: "evidence", body: "**Verification** · 5 of 7 gates green" };
      const first = await attempt("commentPR", () =>
        provider.commentPR(context, prNumber, evidence),
      );
      const same = await attempt("commentPR, unchanged", () =>
        provider.commentPR(context, prNumber, evidence),
      );
      const edited = await attempt("commentPR, re-published", () =>
        provider.commentPR(context, prNumber, {
          ...evidence,
          body: "**Verification** · 7 of 7 gates green",
        }),
      );
      const other = await attempt("commentPR with another key", () =>
        provider.commentPR(context, prNumber, { key: "gate.flake", body: "Flake budget: 0.8%" }),
      );
      const comments = ledger().comments.filter(([number]) => number === prNumber);

      violations.push(
        ...first.violations,
        ...same.violations,
        ...edited.violations,
        ...other.violations,
      );

      if (
        first.value?.mode !== "created" ||
        same.value?.mode !== "unchanged" ||
        edited.value?.mode !== "edited"
      ) {
        violations.push("the three publishes must land created, unchanged, edited");
      }

      if (
        first.value !== undefined &&
        (same.value?.commentId !== first.value.commentId ||
          edited.value?.commentId !== first.value.commentId)
      ) {
        violations.push("every publish under one key must answer the same comment");
      }

      if (ledger().comments.length - before !== 2) {
        violations.push(
          `the host holds ${String(ledger().comments.length - before)} new comments — expected two, one per key`,
        );
      }

      const evidenceComment = comments.find(([, id]) => id === first.value?.commentId);

      if (evidenceComment === undefined || !evidenceComment[2].includes("7 of 7 gates green")) {
        violations.push("the evidence comment must hold the re-published body");
      }

      const blank = await settle(() =>
        provider.commentPR(context, prNumber, { key: "evidence", body: " " }),
      );

      violations.push(
        ...writeFailureViolations(
          blank,
          "validation",
          context.credentials,
          "commentPR with a blank body",
        ),
      );

      expect(violations).toEqual([]);
    });

    it("requests a review once however often it is asked — or answers null when it declares no reviews", async () => {
      const harness = build();
      const { context, push, reviewer } = harness;
      const provider = prHost(harness.provider);

      push("loop/review", FIRST_PUSH);

      const opened = await openedPR(harness, "loop/review");
      const violations = [...opened.violations];

      if (opened.number === undefined) {
        expect([...violations, "a PR could not be opened"]).toEqual([]);

        return;
      }

      const prNumber = opened.number;
      const first = await attempt("requestReview", () =>
        provider.requestReview(context, prNumber, reviewer),
      );
      const second = await attempt("requestReview again", () =>
        provider.requestReview(context, prNumber, reviewer),
      );

      violations.push(...first.violations, ...second.violations);

      if (!provider.capabilities().pr.reviews) {
        if (first.value !== null || second.value !== null) {
          violations.push("pr.reviews is false, so requestReview must answer null");
        }
      } else if (second.value?.requested.filter((login) => login === reviewer).length !== 1) {
        violations.push(`${reviewer} must be asked exactly once after two requests`);
      }

      expect(violations).toEqual([]);
    });

    it("polls events: a pushed PR is on the next poll, and every event names a PR the host has", async () => {
      const harness = build();
      const { context, push, ledger } = harness;
      const provider = prHost(harness.provider);

      push("loop/events", FIRST_PUSH);

      const opened = await openedPR(harness, "loop/events");
      const violations = [...opened.violations];

      /**
       * Poll until the provider runs dry.
       *
       * @param cursor - Where to start.
       * @returns Every event, and the last cursor.
       */
      const drain = async (
        cursor: string | null,
      ): Promise<{ numbers: number[]; cursor: string | null }> => {
        const numbers: number[] = [];
        let next = cursor;

        for (let page = 0; page < 20; page += 1) {
          const polled = await attempt("prEvents", () => provider.prEvents(context, next));

          violations.push(...polled.violations);

          if (polled.value === undefined) {
            break;
          }

          if (typeof polled.value.nextCursor !== "string" || polled.value.nextCursor === "") {
            violations.push("prEvents must answer a non-blank cursor");
          }

          numbers.push(...polled.value.events.map((event) => event.number));
          next = polled.value.nextCursor;

          if (!polled.value.hasMore) {
            break;
          }
        }

        return { numbers, cursor: next };
      };

      const cold = await drain(null);

      if (opened.number !== undefined && !cold.numbers.includes(opened.number)) {
        violations.push("a first poll must carry the opened PR");
      }

      push("loop/events", SECOND_PUSH);

      const warm = await drain(cold.cursor);

      if (opened.number !== undefined && !warm.numbers.includes(opened.number)) {
        violations.push("the poll after a push must carry the pushed PR");
      }

      for (const number of [...cold.numbers, ...warm.numbers]) {
        if (!ledger().prs.includes(number)) {
          violations.push(`prEvents named #${String(number)}, which the host does not hold`);
        }
      }

      expect(violations).toEqual([]);
    });

    for (const errorClass of TICKET_SOURCE_WRITE_ERROR_CLASSES) {
      it(`classifies its recorded ${errorClass} refusal of a PR operation as ${errorClass}`, async () => {
        const harness = build();
        const { context, push, refuse } = harness;
        const provider = prHost(harness.provider);

        push("loop/refused", FIRST_PUSH);

        const opened = await openedPR(harness, "loop/refused");

        if (opened.number === undefined) {
          expect([...opened.violations, "a PR could not be opened"]).toEqual([]);

          return;
        }

        const prNumber = opened.number;

        refuse[errorClass]();

        const violations = [
          ...writeFailureViolations(
            await settle(() => provider.getPR(context, prNumber)),
            errorClass,
            context.credentials,
            "getPR",
          ),
          ...writeFailureViolations(
            await settle(() => provider.syncPR(context, prNumber, null)),
            errorClass,
            context.credentials,
            "syncPR",
          ),
          ...writeFailureViolations(
            await settle(() =>
              provider.mergePR(context, prNumber, {
                strategy: strategyOf(provider),
                message: "fix: merge",
                deleteBranch: false,
              }),
            ),
            errorClass,
            context.credentials,
            "mergePR",
          ),
          ...writeFailureViolations(
            await settle(() =>
              provider.commentPR(context, prNumber, { key: "evidence", body: "x" }),
            ),
            errorClass,
            context.credentials,
            "commentPR",
          ),
          ...writeFailureViolations(
            await settle(() => provider.prEvents(context, null)),
            errorClass,
            context.credentials,
            "prEvents",
          ),
        ];

        expect(violations).toEqual([]);
      });
    }

    it("rolls back — a refused comment or merge leaves nothing behind, and the retry lands exactly once", async () => {
      const harness = build();
      const { context, push, ledger, refuse, recover } = harness;
      const provider = prHost(harness.provider);

      push("loop/rollback", FIRST_PUSH);

      const opened = await openedPR(harness, "loop/rollback");
      const violations = [...opened.violations];

      if (opened.number === undefined) {
        expect([...violations, "a PR could not be opened"]).toEqual([]);

        return;
      }

      const prNumber = opened.number;
      const before = ledger();

      refuse.upstream();

      await settle(() => provider.commentPR(context, prNumber, { key: "evidence", body: "x" }));
      await settle(() =>
        provider.mergePR(context, prNumber, {
          strategy: strategyOf(provider),
          message: "fix: merge",
          deleteBranch: true,
        }),
      );

      const refused = ledger();

      if (
        refused.comments.length !== before.comments.length ||
        refused.merged.length !== before.merged.length
      ) {
        violations.push("a refused comment or merge left something behind");
      }

      recover();

      const retried = await attempt("commentPR after recovery", () =>
        provider.commentPR(context, prNumber, { key: "evidence", body: "x" }),
      );

      violations.push(...retried.violations);

      if (ledger().comments.length - before.comments.length !== 1) {
        violations.push("the retried comment must land exactly once");
      }

      expect(violations).toEqual([]);
    });

    it("holds no credential once its PR operations have returned", async () => {
      const harness = build();
      const provider = prHost(harness.provider);

      harness.push("loop/secret", FIRST_PUSH);

      const opened = await openedPR(harness, "loop/secret");

      if (opened.number !== undefined) {
        const prNumber = opened.number;

        await settle(() => provider.syncPR(harness.context, prNumber, null));
        await settle(() => provider.commentPR(harness.context, prNumber, { key: "k", body: "b" }));
      }

      expect([
        ...opened.violations,
        ...retentionViolations(harness.provider, harness.context.credentials),
      ]).toEqual([]);
    });
  });
}

import {
  FIRST_PUSH,
  SECOND_PUSH,
  expectedFiles,
  fileSnapshotViolations,
  snapshotViolations,
} from "./conformance.pr.fixture";
import {
  IN_MEMORY_DEFAULT_BRANCH,
  InMemoryPrHost,
  InMemoryPrTicketSourceProvider,
  pullUrl,
} from "./providers/in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  InMemoryTracker,
} from "./providers/in-memory.provider.fixture";
import type { PrCommentInput, PrCommentResult, PullRequestSnapshot } from "./ticket-source.pr";
import type { TicketSyncContext } from "./ticket-source.provider";

/**
 * The PR kit's rules, each watched failing (AX.1, [#357](https://github.com/NobuData/ouroboros/issues/357)).
 *
 * `providers/in-memory.pr-conformance.spec.ts` shows the suites pass for a conforming fake; this is
 * the other half — a rule that has never been seen to fail passes everything. The scenario cases at
 * the bottom build providers that break the contract the ways a real host client would (a comment
 * re-posted on every publish, a sync that detects revisions by time) and show the host's ledger
 * and the rules catch each.
 */

/** The source every call runs against. */
const CONTEXT: TicketSyncContext = {
  sourceId: "s-357",
  organizationId: "o-357",
  config: { project: IN_MEMORY_PROJECT },
  credentials: IN_MEMORY_TOKEN,
};

/** A snapshot V052 accepts. */
const SNAPSHOT: PullRequestSnapshot = {
  number: 514,
  url: pullUrl(IN_MEMORY_PROJECT, 514),
  title: "can: fix flaky telemetry frame order under ISR load",
  body: null,
  state: "open",
  headBranch: "loop/482-canbus-flake",
  baseBranch: "main",
  headSha: "b7e41d0",
  additions: 68,
  deletions: 15,
  changedFiles: 3,
  mergedAt: null,
  mergedBy: null,
  updatedAt: new Date("2026-09-24T10:00:00.000Z"),
};

describe("expectedFiles", () => {
  it("sums pushes per path and sorts by path", () => {
    expect(expectedFiles(FIRST_PUSH, SECOND_PUSH)).toEqual([
      { path: "src/can/isr.h", additions: 6, deletions: 2 },
      { path: "src/can/telemetry.c", additions: 53, deletions: 13 },
      { path: "tests/can/test_frame_order.c", additions: 9, deletions: 0 },
    ]);
  });
});

describe("snapshotViolations", () => {
  it("passes a snapshot V052 accepts, open or merged", () => {
    expect(snapshotViolations(SNAPSHOT, "getPR")).toEqual([]);
    expect(
      snapshotViolations(
        { ...SNAPSHOT, state: "merged", mergedAt: new Date(), mergedBy: "mara-okafor" },
        "getPR",
      ),
    ).toEqual([]);
  });

  it("catches every column V052 would refuse", () => {
    expect(snapshotViolations(null, "getPR")).toEqual(["getPR: must answer a snapshot"]);
    expect(
      snapshotViolations(
        {
          ...SNAPSHOT,
          number: 0,
          url: "http://x",
          title: " ",
          headSha: "B7E41D0",
          additions: -1,
          state: "draft",
          mergedAt: new Date(),
          mergedBy: "mara-okafor",
          updatedAt: new Date("nope"),
        },
        "getPR",
      ),
    ).toEqual([
      "getPR: number must be a whole number ≥ 1",
      "getPR: url must be an https link with a host",
      "getPR: title must be non-blank — V052 refuses ''",
      "getPR: headSha must be 7–40 lowercase hex",
      "getPR: additions must be a whole number ≥ 0",
      "getPR: state must be open, closed or merged",
      "getPR: mergedAt must be set exactly when the PR is merged",
      "getPR: mergedBy is only ever set on a merged PR",
      "getPR: updatedAt must be a valid Date",
    ]);
  });
});

describe("fileSnapshotViolations", () => {
  it("passes the expected files in any order", () => {
    expect(
      fileSnapshotViolations([...FIRST_PUSH].reverse(), expectedFiles(FIRST_PUSH), "revision 1"),
    ).toEqual([]);
  });

  it("catches a wrong count, a missing path, and a shape the CHECK refuses", () => {
    expect(
      fileSnapshotViolations(
        [{ path: "src/can/telemetry.c", additions: 12, deletions: 4 }],
        expectedFiles(FIRST_PUSH),
        "revision 1",
      ),
    ).toHaveLength(1);
    expect(fileSnapshotViolations(undefined, [], "revision 1")).toEqual([
      "revision 1: files must be an array",
    ]);
  });
});

describe("the PR rules against providers that break the contract", () => {
  /**
   * A host with one open PR on a pushed branch.
   *
   * @returns The host and the PR's number.
   */
  function hosted(): { host: InMemoryPrHost; prNumber: number } {
    const host = new InMemoryPrHost();

    host.push("loop/evidence", FIRST_PUSH);

    return {
      host,
      prNumber: host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
        branch: "loop/evidence",
        base: IN_MEMORY_DEFAULT_BRANCH,
        title: "t",
        body: null,
      }).number,
    };
  }

  it("catch a comment re-posted on every publish — decision V9's fourteen comments", async () => {
    /** Posts every time, never looking for its marker. */
    class Reposter extends InMemoryPrTicketSourceProvider {
      /** @inheritdoc */
      override commentPR(
        context: TicketSyncContext,
        prNumber: number,
        comment: PrCommentInput,
      ): Promise<PrCommentResult> {
        return Promise.resolve({
          commentId: String(
            this.hostOf().comment(context.credentials, IN_MEMORY_PROJECT, prNumber, comment.body),
          ),
          mode: "created",
        });
      }

      /** @returns The host, for the override. */
      hostOf(): InMemoryPrHost {
        return (this as unknown as { host: InMemoryPrHost }).host;
      }
    }

    const { host, prNumber } = hosted();
    const provider = new Reposter(new InMemoryTracker(), host);

    await provider.commentPR(CONTEXT, prNumber, { key: "evidence", body: "5 of 7" });
    await provider.commentPR(CONTEXT, prNumber, { key: "evidence", body: "7 of 7" });

    // The kit's assertion — one comment per key — fails for this provider.
    expect(host.ledger().comments).toHaveLength(2);
  });

  it("catch a revision detected by time rather than head sha — a comment is not a push", async () => {
    const { host, prNumber } = hosted();
    const provider = new InMemoryPrTicketSourceProvider(new InMemoryTracker(), host);
    const first = await provider.syncPR(CONTEXT, prNumber, null);

    await provider.commentPR(CONTEXT, prNumber, { key: "evidence", body: "x" });

    const after = await provider.syncPR(CONTEXT, prNumber, first.pr.headSha);

    // The PR changed — its stamp moved — and there is still no revision, because the head did not.
    expect(after.pr.updatedAt.getTime()).toBeGreaterThan(first.pr.updatedAt.getTime());
    expect(after.revision).toBeNull();
  });
});

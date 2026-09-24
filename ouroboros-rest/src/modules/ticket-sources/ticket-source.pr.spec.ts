import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TicketSourceError } from "./ticket-source.errors";
import {
  MAX_DIFF_EXCERPT,
  NO_PR_CAPABILITIES,
  assertAdvertisedStrategy,
  closingReferences,
  diffExcerptOf,
  hasPrCommentMarker,
  prCapabilityViolations,
  prCommentMarker,
  prFileViolations,
  withPrCommentMarker,
  type TicketSourcePrCapabilities,
} from "./ticket-source.pr";
import {
  PR_MEMBERS,
  prMemberViolations,
  supportsPullRequests,
  type TicketSourceProvider,
} from "./ticket-source.provider";
import { NO_CAPABILITIES } from "./ticket-source.fixture";

/**
 * The PR family's pure rules (AX.1, [#357](https://github.com/NobuData/ouroboros/issues/357)) —
 * the declaration's coherence, the strategy gate, the V9 comment marker, closing-keyword parsing
 * and the files snapshot's shape. Each is watched failing as well as passing.
 */

/** A git host's full declaration. */
const EVERYTHING: TicketSourcePrCapabilities = {
  pullRequests: true,
  create: true,
  mergeStrategies: ["merge", "squash", "rebase"],
  reviews: true,
  events: "poll",
};

/**
 * Assert a call throws a classified `validation` refusal.
 *
 * @param run - The call.
 */
function expectValidation(run: () => unknown): void {
  let thrown: unknown;

  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(TicketSourceError.is(thrown)).toBe(true);
  expect((thrown as TicketSourceError).errorClass).toBe("validation");
}

describe("NO_PR_CAPABILITIES", () => {
  it("is coherent, says no to everything, and cannot be edited", () => {
    expect(prCapabilityViolations(NO_PR_CAPABILITIES)).toEqual([]);
    expect(NO_PR_CAPABILITIES).toStrictEqual({
      pullRequests: false,
      create: false,
      mergeStrategies: [],
      reviews: false,
      events: "none",
    });
    expect(Object.isFrozen(NO_PR_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(NO_PR_CAPABILITIES.mergeStrategies)).toBe(true);
  });
});

describe("prCapabilityViolations", () => {
  it("passes a full declaration and a narrow one", () => {
    expect(prCapabilityViolations(EVERYTHING)).toEqual([]);
    expect(
      prCapabilityViolations({
        ...EVERYTHING,
        create: false,
        reviews: false,
        mergeStrategies: ["squash"],
      }),
    ).toEqual([]);
  });

  it("catches a declaration that is not an object", () => {
    for (const bad of [undefined, null, [], "poll"]) {
      expect(prCapabilityViolations(bad)).toEqual([
        "capabilities().pr must be an object — NO_PR_CAPABILITIES says no",
      ]);
    }
  });

  it("catches a flag left out, a strategy nobody has, a strategy twice, and an unknown event mode", () => {
    expect(
      prCapabilityViolations({
        pullRequests: true,
        mergeStrategies: ["squash", "squash", "octopus"],
        reviews: true,
        events: "push",
      }),
    ).toEqual([
      "capabilities().pr.create must be a boolean — false is an answer",
      "capabilities().pr.mergeStrategies must list each of merge, squash, rebase at most once",
      "capabilities().pr.events must be one of poll, webhook, none",
    ]);
  });

  it("catches a host with PRs and no strategy, no events, or the reserved webhook slot", () => {
    expect(prCapabilityViolations({ ...EVERYTHING, mergeStrategies: [] })).toEqual([
      "capabilities().pr.mergeStrategies is empty — a host with PRs merges somehow",
    ]);
    expect(prCapabilityViolations({ ...EVERYTHING, events: "none" })).toEqual([
      "capabilities().pr.events is none but pullRequests is true — poll is the MVP's",
    ]);
    expect(prCapabilityViolations({ ...EVERYTHING, events: "webhook" })).toEqual([
      "capabilities().pr.events is webhook, which is reserved for the GitHub App (#122) — no delivery endpoint exists yet, so declare poll",
    ]);
  });

  it("catches anything switched on without pullRequests", () => {
    expect(prCapabilityViolations({ ...EVERYTHING, pullRequests: false })).toEqual([
      "capabilities().pr.create is true but pullRequests is false",
      "capabilities().pr.reviews is true but pullRequests is false",
      "capabilities().pr.mergeStrategies is non-empty but pullRequests is false",
      "capabilities().pr.events is poll but pullRequests is false — a provider without PRs watches none",
    ]);
  });
});

describe("assertAdvertisedStrategy", () => {
  it("answers an advertised strategy", () => {
    expect(assertAdvertisedStrategy(EVERYTHING, "squash")).toBe("squash");
  });

  it("refuses one the host does not advertise, naming what it does", () => {
    expect(() =>
      assertAdvertisedStrategy({ ...EVERYTHING, mergeStrategies: ["squash"] }, "rebase"),
    ).toThrow("the host does not advertise the rebase merge strategy — it offers squash");
    expectValidation(() => assertAdvertisedStrategy(EVERYTHING, "octopus"));
    expect(() => assertAdvertisedStrategy(NO_PR_CAPABILITIES, "merge")).toThrow("it offers none");
  });
});

describe("the V9 comment marker", () => {
  it("composes a marker line and finds it only as a whole line", () => {
    const body = withPrCommentMarker("**Verification** · 5 of 7 gates green\n", "evidence");

    expect(body).toBe(
      "**Verification** · 5 of 7 gates green\n\n<!-- ouroboros:pr-comment evidence -->",
    );
    expect(hasPrCommentMarker(body, "evidence")).toBe(true);
    expect(hasPrCommentMarker(body, "gate.flake")).toBe(false);
    expect(
      hasPrCommentMarker("quoting <!-- ouroboros:pr-comment evidence --> mid-line", "evidence"),
    ).toBe(false);
    expect(hasPrCommentMarker(null, "evidence")).toBe(false);
  });

  it("refuses a key that could close the comment early, and a blank body", () => {
    for (const key of ["", "a--b", "a>b", "has space", "x".repeat(129)]) {
      expectValidation(() => prCommentMarker(key));
    }

    expectValidation(() => withPrCommentMarker("  ", "evidence"));
  });
});

describe("closingReferences", () => {
  it("finds every keyword form, same-repository and across repositories, each once", () => {
    expect(
      closingReferences(
        "fix(can): order frames\n\nCloses #482. fixes acme/other#7, Resolved: #9",
        "Also closes #482 and FIXES #12",
      ),
    ).toEqual([
      { reference: "#482", owner: null, repo: null, number: 482 },
      { reference: "acme/other#7", owner: "acme", repo: "other", number: 7 },
      { reference: "#9", owner: null, repo: null, number: 9 },
      { reference: "#12", owner: null, repo: null, number: 12 },
    ]);
  });

  it("ignores a mention without a keyword, a keyword glued to a word, and null text", () => {
    expect(closingReferences("see #482; unfixes #3; prefix#4", null)).toEqual([]);
  });
});

describe("diffExcerptOf", () => {
  it("joins patches in file order and skips a binary", () => {
    expect(
      diffExcerptOf([
        { path: "a.c", patch: "@@ -1 +1 @@\n-x\n+y" },
        { path: "logo.png", patch: null },
      ]),
    ).toBe("--- a.c\n@@ -1 +1 @@\n-x\n+y");
  });

  it("answers null when there is no patch text, and cuts at the column's bound", () => {
    expect(diffExcerptOf([{ path: "logo.png", patch: null }])).toBeNull();
    expect(
      diffExcerptOf([{ path: "big.c", patch: "+".repeat(MAX_DIFF_EXCERPT * 2) }])?.length,
    ).toBe(MAX_DIFF_EXCERPT);
  });
});

describe("prFileViolations", () => {
  it("passes what pr_revision_files_valid accepts", () => {
    expect(
      prFileViolations([{ path: "src/can/isr.h", additions: 6, deletions: 0 }], "files"),
    ).toEqual([]);
  });

  it("catches what the CHECK would refuse", () => {
    expect(prFileViolations("nope", "files")).toEqual(["files: files must be an array"]);
    expect(
      prFileViolations(
        [
          { path: " ", additions: 1, deletions: 1 },
          { path: "a.c", additions: -1, deletions: 1.5 },
          { path: "a.c", additions: 1, deletions: 1 },
        ],
        "files",
      ),
    ).toEqual([
      "files: every file needs a non-blank path",
      "files: a.c's additions must be a whole number ≥ 0",
      "files: a.c's deletions must be a whole number ≥ 0",
      "files: a.c is listed twice — one entry per path",
    ]);
  });
});

describe("supportsPullRequests and prMemberViolations", () => {
  /**
   * A provider with only the read members, declaring what it is given.
   *
   * @param pr - The PR declaration.
   * @param members - Extra members to carry.
   * @returns The provider.
   */
  function provider(pr: unknown, members: Record<string, unknown> = {}): TicketSourceProvider {
    return {
      kind: "custom",
      capabilities: () => ({ ...NO_CAPABILITIES, pr }) as never,
      configSchema: () => ({}) as never,
      validateConfig: () => Promise.resolve({ status: "ok", detail: "" }),
      fullSync: () => Promise.resolve({ tickets: [], nextCursor: null, hasMore: false }),
      incrementalSync: () => Promise.resolve({ tickets: [], nextCursor: null, hasMore: false }),
      mapTicket: () => ({}) as never,
      ...members,
    };
  }

  const ALL_MEMBERS = Object.fromEntries(PR_MEMBERS.map((member) => [member, () => undefined]));

  it("narrows on the flag, and passes a provider whose flag and members agree", () => {
    expect(supportsPullRequests(provider(NO_PR_CAPABILITIES))).toBe(false);
    expect(supportsPullRequests(provider(EVERYTHING, ALL_MEMBERS))).toBe(true);
    expect(prMemberViolations(provider(NO_PR_CAPABILITIES))).toEqual([]);
    expect(prMemberViolations(provider(EVERYTHING, ALL_MEMBERS))).toEqual([]);
  });

  it("catches a flag with no members behind it, and members with no flag", () => {
    expect(prMemberViolations(provider(EVERYTHING, { getPR: () => undefined }))).toEqual([
      "pr.pullRequests is true but createPR, syncPR, mergePR, commentPR, requestReview, prEvents is absent",
    ]);
    expect(prMemberViolations(provider(NO_PR_CAPABILITIES, { mergePR: () => undefined }))).toEqual([
      "pr.pullRequests is false but mergePR is present — an unreachable PR member is a declaration somebody forgot to update",
    ]);
  });

  it("reports an incoherent declaration before judging the members", () => {
    expect(prMemberViolations(provider(undefined))).toEqual([
      "capabilities().pr must be an object — NO_PR_CAPABILITIES says no",
    ]);
  });
});

describe("ticket-source.pr.ts", () => {
  it("branches on no host kind and imports no host SDK — decision P5 on the PR path", () => {
    // Prose may cite GitHub's semantics (the header's per-host notes, the reserved #122 slot); the
    // code may not compare a kind or reach for a client.
    const source = readFileSync(join(__dirname, "ticket-source.pr.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const kind of ['"github"', '"gitlab"', "@octokit", "@gitbeaker", "providers/"]) {
      expect(code).not.toContain(kind);
    }
  });
});

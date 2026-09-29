import { describe, expect, it } from "vitest";

import {
  IDENTITY_LINE,
  TOKEN_IDENTITY,
  actionLabel,
  claimsBot,
  configuredActions,
  honestIdentity,
  identityFooter,
  receipt,
} from "@/app/prs/merge-receipt";

import { KEN, armedPlan, mergePlan, mergedPlan } from "../helpers/pull-requests";

/**
 * Who a merge is made as, and what one did (#369, decision V3): the footer shows the real
 * identity and never claims `[bot]` while merges are token-based, and the receipt lists the
 * actions that actually executed.
 */

describe("the identity footer", () => {
  it("names the configured token and notes the App upgrade", () => {
    expect(IDENTITY_LINE).toBe(
      "Merges as the workspace's configured token — bot identity arrives with the GitHub App (#374).",
    );
    expect(identityFooter(mergePlan())).toBe(IDENTITY_LINE);
  });

  it("never claims [bot] — the mockup's promise is not repeated", () => {
    for (const plan of [mergePlan(), armedPlan(), mergedPlan()]) {
      expect(claimsBot(identityFooter(plan))).toBe(false);
      expect(identityFooter(plan)).not.toContain("ouroboros-app");
    }
  });

  it("says who armed the plan, and makes no co-author claim", () => {
    expect(identityFooter(armedPlan())).toBe(`${IDENTITY_LINE} Armed by ${KEN.name}.`);
    expect(identityFooter(armedPlan())).not.toMatch(/co-?author/i);
    expect(IDENTITY_LINE).not.toMatch(/co-?author/i);
  });

  it("names nobody for a person who has gone, or a plan nobody armed", () => {
    expect(identityFooter(armedPlan({ armedByPerson: null }))).toBe(IDENTITY_LINE);
    expect(identityFooter(mergePlan({ armedByPerson: KEN }))).toBe(IDENTITY_LINE);
  });

  it("reads a plan from a service that does not send the person yet", () => {
    const older: Partial<ReturnType<typeof armedPlan>> = armedPlan();
    delete older.armedByPerson;

    expect(identityFooter(older as ReturnType<typeof armedPlan>)).toBe(IDENTITY_LINE);
  });
});

describe("honestIdentity", () => {
  it("draws the login the host recorded", () => {
    expect(honestIdentity("ken-s")).toBe("ken-s");
    expect(honestIdentity("  ken-s ")).toBe("ken-s");
  });

  it.each(["ouroboros-app[bot]", "OUROBOROS-APP[BOT]", "some-app[Bot]", "[bot]"])(
    "never repeats %j — a claim the schema forbids",
    (identity) => {
      expect(claimsBot(identity)).toBe(true);
      expect(honestIdentity(identity)).toBe(TOKEN_IDENTITY);
    },
  );

  it("names the token when the host named nobody", () => {
    expect(honestIdentity("")).toBe(TOKEN_IDENTITY);
    expect(honestIdentity("   ")).toBe(TOKEN_IDENTITY);
  });
});

describe("configuredActions", () => {
  it("lists what the seeded plan has switched on, in the card's order", () => {
    expect(configuredActions(mergePlan(), true)).toEqual([
      "close_ticket",
      "comment_evidence",
      "delete_branch",
    ]);
  });

  it("follows every switch", () => {
    expect(
      configuredActions(
        mergePlan({
          closeTicket: false,
          commentEvidence: false,
          backAnnotateEpic: true,
          deleteBranch: false,
        }),
        true,
      ),
    ).toEqual(["back_annotate_epic"]);
  });

  it("does not count closing a ticket the PR does not have", () => {
    expect(configuredActions(mergePlan(), false)).toEqual(["comment_evidence", "delete_branch"]);
  });
});

describe("actionLabel", () => {
  it("says an action as done, and as intended", () => {
    expect(actionLabel("close_ticket", "#482", true)).toBe("closed issue #482");
    expect(actionLabel("close_ticket", "#482", false)).toBe("close issue #482");
    expect(actionLabel("close_ticket", null, false)).toBe("close the ticket");
    expect(actionLabel("comment_evidence", "#482", true)).toBe("commented the evidence summary");
    expect(actionLabel("back_annotate_epic", "#482", true)).toBe("back-annotated the roadmap");
    expect(actionLabel("delete_branch", "#482", false)).toBe("delete the branch");
  });
});

describe("receipt", () => {
  it("is nothing for a plan that has not merged", () => {
    expect(receipt(mergePlan(), "#482", null)).toBeNull();
    expect(receipt(armedPlan(), "#482", null)).toBeNull();
  });

  it("shows the sha, the identity used and the actions that executed", () => {
    expect(receipt(mergedPlan(), "#482", null)).toEqual({
      sha: "9c4ab7f",
      identity: "ken-s",
      time: "14:45:02",
      at: "2026-09-27T14:45:02.000Z",
      ran: ["closed issue #482", "commented the evidence summary", "deleted the branch"],
      skipped: [],
    });
  });

  it("lists what was switched on and did not run, apart from what ran", () => {
    const plan = mergedPlan({
      backAnnotateEpic: true,
      epicId: "5eed001f-0000-4000-8000-000000000001",
      mergedResult: {
        sha: "9c4ab7f02d31",
        identityUsed: "ken-s",
        actionsExecuted: ["comment_evidence"],
        mergedAt: "2026-09-27T14:45:02.000Z",
      },
    });

    expect(receipt(plan, "#482", null)).toMatchObject({
      ran: ["commented the evidence summary"],
      skipped: [
        { action: "close_ticket", label: "close issue #482", detail: null },
        { action: "back_annotate_epic", label: "back-annotate the roadmap", detail: null },
        { action: "delete_branch", label: "delete the branch", detail: null },
      ],
    });
  });

  it("says why an action did not run while the merge's own answer is held", () => {
    const plan = mergedPlan({
      mergedResult: {
        sha: "9c4ab7f02d31",
        identityUsed: "ken-s",
        actionsExecuted: ["comment_evidence", "delete_branch"],
        mergedAt: "2026-09-27T14:45:02.000Z",
      },
    });
    const answer = {
      sha: "9c4ab7f02d31",
      failedActions: [
        { action: "close_ticket" as const, detail: "#482 is still open after the merge" },
      ],
    };

    expect(receipt(plan, "#482", answer)?.skipped).toEqual([
      {
        action: "close_ticket",
        label: "close issue #482",
        detail: "#482 is still open after the merge",
      },
    ]);
    // An answer about another merge explains nothing about this one.
    expect(receipt(plan, "#482", { ...answer, sha: "0000000" })?.skipped).toEqual([
      { action: "close_ticket", label: "close issue #482", detail: null },
    ]);
  });

  it("does not list closing a ticket the PR never had as something that did not run", () => {
    const plan = mergedPlan({
      mergedResult: {
        sha: "9c4ab7f02d31",
        identityUsed: "ken-s",
        actionsExecuted: ["comment_evidence", "delete_branch"],
        mergedAt: "2026-09-27T14:45:02.000Z",
      },
    });

    expect(receipt(plan, null, null)?.skipped).toEqual([]);
  });

  it("never draws a [bot] as who merged", () => {
    const plan = mergedPlan({
      mergedResult: {
        sha: "9c4ab7f02d31",
        identityUsed: "ouroboros-app[bot]",
        actionsExecuted: [],
        mergedAt: "2026-09-27T14:45:02.000Z",
      },
    });

    expect(receipt(plan, "#482", null)?.identity).toBe(TOKEN_IDENTITY);
  });

  it("draws no time for a moment that is not a date", () => {
    const plan = mergedPlan({
      mergedResult: {
        sha: "9c4ab7f02d31",
        identityUsed: "ken-s",
        actionsExecuted: [],
        mergedAt: "soon",
      },
    });

    expect(receipt(plan, "#482", null)?.time).toBeNull();
  });
});

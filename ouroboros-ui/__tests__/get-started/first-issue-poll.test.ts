import { describe, expect, it, vi } from "vitest";

import {
  FIRST_ISSUE_ENDPOINT,
  createFirstIssuePoll,
  firstIssueEndpoint,
  isFirstIssueCard,
} from "@/app/get-started/first-issue-poll";

import { REPO, candidate, emptyFirstIssue, firstIssueCard, seededAlternatives } from "../helpers/onboarding";

/** The first-issue card's poll (#393): one endpoint per repository, and a guard on what comes back. */

describe("the first-issue card's poll", () => {
  it("asks this origin, naming the repository", () => {
    expect(FIRST_ISSUE_ENDPOINT).toBe("/api/onboarding/first-issue");
    expect(firstIssueEndpoint(REPO)).toBe("/api/onboarding/first-issue?repo=acme-robotics%2Fhelios-firmware");
  });

  it("accepts the card — a cold one, an empty ranking and an unread policy included", () => {
    expect(isFirstIssueCard(firstIssueCard())).toBe(true);
    expect(
      isFirstIssueCard(
        firstIssueCard({
          firstIssue: emptyFirstIssue(),
          alternatives: seededAlternatives({ candidates: [] }),
          dryRun: { ok: false, reason: "busy" },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["a string", "card"],
    ["no pick answer", { ...firstIssueCard(), firstIssue: null }],
    ["a pick answer with no state", { ...firstIssueCard(), firstIssue: { ...firstIssueCard().firstIssue, state: 4 } }],
    ["a pick that is not a candidate", { ...firstIssueCard(), firstIssue: { ...firstIssueCard().firstIssue, pick: { number: 488 } } }],
    ["no ranking", { ...firstIssueCard(), alternatives: null }],
    ["a ranking that is not a list", { ...firstIssueCard(), alternatives: { ...seededAlternatives(), candidates: {} } }],
    ["a candidate with no reasoning", { ...firstIssueCard(), alternatives: { ...seededAlternatives(), candidates: [{ ...candidate(), reasoning: null }] } }],
    ["a policy that is not a reading", { ...firstIssueCard(), dryRun: { dryRun: true } }],
  ])("refuses %s", (_label, value) => {
    expect(isFirstIssueCard(value)).toBe(false);
  });

  it("reads its own endpoint", async () => {
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: firstIssueCard(), etag: null, pollAfterSeconds: null });
    const poll = createFirstIssuePoll(firstIssueEndpoint(REPO), { read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(firstIssueCard()));
    stop();

    expect(read).toHaveBeenCalledWith(firstIssueEndpoint(REPO), null);
  });
});

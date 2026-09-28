import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  ApprovalDecisionDto,
  ListPullRequestsQuery,
  MAX_APPROVAL_NOTE_LENGTH,
  MAX_LISTED_RUN_IDS,
  MAX_RETURNED_GATES,
  MAX_THREAD_REPLY_LENGTH,
  RequestReviewDto,
  ResolveThreadEntryDto,
  ReturnToLoopDto,
  ThreadEntryParams,
  queryBoolean,
} from "./page.dto";

/**
 * The shapes the PR page's routes accept (AX.5, [#361](https://github.com/NobuData/ouroboros/issues/361))
 * — checked the way the global pipe checks them.
 */

/**
 * The properties a body fails on.
 *
 * @param type - The DTO.
 * @param body - The body.
 * @returns The failing property names, sorted.
 */
async function failing<T extends object>(type: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errors.map((error) => error.property).sort();
}

describe("ListPullRequestsQuery", () => {
  it("reads states as a list, comma-separated or repeated, and refuses one that is not a state", async () => {
    expect(plainToInstance(ListPullRequestsQuery, { state: "verifying,blocked" }).state).toEqual([
      "verifying",
      "blocked",
    ]);
    expect(plainToInstance(ListPullRequestsQuery, { state: ["armed", "open"] }).state).toEqual([
      "armed",
      "open",
    ]);
    expect(await failing(ListPullRequestsQuery, { state: "verifying,shipped" })).toEqual(["state"]);
  });

  it("reads reviewRequested as true or false only", async () => {
    expect(
      plainToInstance(ListPullRequestsQuery, { reviewRequested: "true" }).reviewRequested,
    ).toBe(true);
    expect(await failing(ListPullRequestsQuery, { reviewRequested: "false" })).toEqual([]);
    expect(await failing(ListPullRequestsQuery, { reviewRequested: "yes" })).toEqual([
      "reviewRequested",
    ]);
    expect(queryBoolean(1)).toBe(1);
  });

  it("reads runId as a list of uuids, comma-separated or repeated (#363)", async () => {
    const one = "5eed0009-0000-4000-8000-000000000482";
    const two = "5eed0009-0000-4000-8000-000000000474";

    expect(plainToInstance(ListPullRequestsQuery, { runId: one }).runId).toEqual([one]);
    expect(plainToInstance(ListPullRequestsQuery, { runId: `${one},${two}` }).runId).toEqual([
      one,
      two,
    ]);
    expect(plainToInstance(ListPullRequestsQuery, { runId: [one, two] }).runId).toEqual([one, two]);
    expect(plainToInstance(ListPullRequestsQuery, { runId: "" }).runId).toBeUndefined();
    expect(await failing(ListPullRequestsQuery, { runId: `${one},${two}` })).toEqual([]);
    expect(await failing(ListPullRequestsQuery, { runId: "482" })).toEqual(["runId"]);
    expect(await failing(ListPullRequestsQuery, { runId: `${one},482` })).toEqual(["runId"]);
    expect(
      await failing(ListPullRequestsQuery, {
        runId: Array.from({ length: MAX_LISTED_RUN_IDS + 1 }, () => one),
      }),
    ).toEqual(["runId"]);
  });

  it("keeps the page window's rules", async () => {
    expect(await failing(ListPullRequestsQuery, { limit: "0" })).toEqual(["limit"]);
  });
});

describe("ReturnToLoopDto", () => {
  it("accepts the mockup's return — one red gate, and optionally a revision, a note and a key", async () => {
    expect(await failing(ReturnToLoopDto, { gates: ["physical_hil"] })).toEqual([]);
    expect(
      await failing(ReturnToLoopDto, {
        gates: ["physical_hil", "test_suite", "custom:bench.thermal"],
        revisionId: "5eed003b-0000-4000-8000-000000005141",
        note: "keep the PID loop on its own timer",
        idempotencyKey: "click-1",
      }),
    ).toEqual([]);
  });

  it("needs at least one gate key, each once, each a gate key", async () => {
    expect(await failing(ReturnToLoopDto, {})).toEqual(["gates"]);
    expect(await failing(ReturnToLoopDto, { gates: [] })).toEqual(["gates"]);
    expect(await failing(ReturnToLoopDto, { gates: ["build", "build"] })).toEqual(["gates"]);
    expect(await failing(ReturnToLoopDto, { gates: ["Build"] })).toEqual(["gates"]);
    expect(await failing(ReturnToLoopDto, { gates: ["custom:"] })).toEqual(["gates"]);
    expect(
      await failing(ReturnToLoopDto, {
        gates: Array.from({ length: MAX_RETURNED_GATES + 1 }, (_, n) => `custom:g${String(n)}`),
      }),
    ).toEqual(["gates"]);
  });

  it("refuses a padded note, a revision that is not a uuid, and unknown fields", async () => {
    expect(await failing(ReturnToLoopDto, { gates: ["build"], note: " padded" })).toEqual(["note"]);
    expect(await failing(ReturnToLoopDto, { gates: ["build"], revisionId: "rev-1" })).toEqual([
      "revisionId",
    ]);
    expect(await failing(ReturnToLoopDto, { gates: ["build"], payload: "x" })).toEqual(["payload"]);
  });
});

describe("RequestReviewDto", () => {
  it("takes an optional host login", async () => {
    expect(await failing(RequestReviewDto, {})).toEqual([]);
    expect(await failing(RequestReviewDto, { reviewer: "priya" })).toEqual([]);
    expect(await failing(RequestReviewDto, { reviewer: "" })).toEqual(["reviewer"]);
    expect(await failing(RequestReviewDto, { reviewer: "x".repeat(256) })).toEqual(["reviewer"]);
  });
});

describe("ApprovalDecisionDto", () => {
  it("takes approve or decline, with a bounded note", async () => {
    expect(await failing(ApprovalDecisionDto, { decision: "approve" })).toEqual([]);
    expect(await failing(ApprovalDecisionDto, { decision: "decline", note: "why" })).toEqual([]);
    expect(await failing(ApprovalDecisionDto, { decision: "merge" })).toEqual(["decision"]);
    expect(
      await failing(ApprovalDecisionDto, {
        decision: "approve",
        note: "x".repeat(MAX_APPROVAL_NOTE_LENGTH + 1),
      }),
    ).toEqual(["note"]);
  });
});

describe("ResolveThreadEntryDto (#368)", () => {
  it("takes a reply, a mirror, both or neither", async () => {
    expect(await failing(ResolveThreadEntryDto, {})).toEqual([]);
    expect(await failing(ResolveThreadEntryDto, { reply: "Addressed in attempt 4" })).toEqual([]);
    expect(
      await failing(ResolveThreadEntryDto, { reply: "line one\nline two", mirror: true }),
    ).toEqual([]);
  });

  it("refuses a reply that is empty, padded or over V057's bound", async () => {
    expect(await failing(ResolveThreadEntryDto, { reply: "" })).toEqual(["reply"]);
    expect(await failing(ResolveThreadEntryDto, { reply: " padded " })).toEqual(["reply"]);
    expect(
      await failing(ResolveThreadEntryDto, { reply: "x".repeat(MAX_THREAD_REPLY_LENGTH + 1) }),
    ).toEqual(["reply"]);
    expect(
      await failing(ResolveThreadEntryDto, { reply: "x".repeat(MAX_THREAD_REPLY_LENGTH) }),
    ).toEqual([]);
  });

  it("refuses a mirror that is not a boolean, and a field it does not know", async () => {
    expect(await failing(ResolveThreadEntryDto, { mirror: "yes" })).toEqual(["mirror"]);
    expect(await failing(ResolveThreadEntryDto, { authorKind: "model" })).toEqual(["authorKind"]);
  });
});

describe("ThreadEntryParams (#368)", () => {
  it("holds both ids to uuids", async () => {
    expect(
      await failing(ThreadEntryParams, {
        id: "5eed003a-0000-4000-8000-000000000514",
        entryId: "5eed0040-0000-4000-8000-000000005142",
      }),
    ).toEqual([]);
    expect(
      await failing(ThreadEntryParams, {
        id: "5eed003a-0000-4000-8000-000000000514",
        entryId: "2",
      }),
    ).toEqual(["entryId"]);
  });
});

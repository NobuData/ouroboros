import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { MAX_COMMIT_MESSAGE_LENGTH, UpdateMergePlanDto } from "./merge.dto";

/**
 * What `PATCH …/merge-plan` accepts (AY.7, [#369](https://github.com/NobuData/ouroboros/issues/369)),
 * checked the way the global pipe checks it.
 */

const EPIC = "5eed001f-0000-4000-8000-000000000001";

/**
 * The properties a body fails on.
 *
 * @param body - The body.
 * @returns The failing property names, sorted.
 */
async function failing(body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(UpdateMergePlanDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errors.map((error) => error.property).sort();
}

describe("UpdateMergePlanDto", () => {
  it("accepts each field on its own, and all of them together", async () => {
    for (const body of [
      { commitMessage: "fix(can): preserve ISR frame order\n\nCloses #482." },
      { closeTicket: false },
      { commentEvidence: false },
      { backAnnotateEpic: true },
      { epicId: EPIC },
      {
        commitMessage: "fix(can): reworded",
        closeTicket: true,
        commentEvidence: true,
        backAnnotateEpic: true,
        epicId: EPIC,
      },
    ]) {
      expect(await failing(body)).toEqual([]);
    }
  });

  it("accepts an empty body — an edit that changes nothing", async () => {
    expect(await failing({})).toEqual([]);
  });

  it("lets null clear the epic, and nothing else", async () => {
    expect(await failing({ epicId: null })).toEqual([]);
    expect(await failing({ commitMessage: null })).toEqual(["commitMessage"]);
    expect(await failing({ closeTicket: null })).toEqual(["closeTicket"]);
    expect(await failing({ commentEvidence: null })).toEqual(["commentEvidence"]);
    expect(await failing({ backAnnotateEpic: null })).toEqual(["backAnnotateEpic"]);
  });

  it("refuses a message that is blank, padded or too long", async () => {
    expect(await failing({ commitMessage: "" })).toEqual(["commitMessage"]);
    expect(await failing({ commitMessage: "  \n " })).toEqual(["commitMessage"]);
    expect(await failing({ commitMessage: " fix(can): padded" })).toEqual(["commitMessage"]);
    expect(await failing({ commitMessage: "fix(can): padded\n" })).toEqual(["commitMessage"]);
    expect(await failing({ commitMessage: "x".repeat(MAX_COMMIT_MESSAGE_LENGTH + 1) })).toEqual([
      "commitMessage",
    ]);
    expect(await failing({ commitMessage: "x".repeat(MAX_COMMIT_MESSAGE_LENGTH) })).toEqual([]);
  });

  it("refuses a toggle that is not a boolean, and an epic that is not a uuid", async () => {
    expect(await failing({ closeTicket: "true" })).toEqual(["closeTicket"]);
    expect(await failing({ commentEvidence: 1 })).toEqual(["commentEvidence"]);
    expect(await failing({ backAnnotateEpic: "on" })).toEqual(["backAnnotateEpic"]);
    expect(await failing({ epicId: "ota-hardening" })).toEqual(["epicId"]);
  });

  it("refuses the strategy, delete-branch and the arm — they are not edited here", async () => {
    expect(await failing({ strategy: "rebase" })).toEqual(["strategy"]);
    expect(await failing({ deleteBranch: false })).toEqual(["deleteBranch"]);
    expect(await failing({ armed: true, armedBy: "user-ken" })).toEqual(["armed", "armedBy"]);
    expect(await failing({ mergedResult: null })).toEqual(["mergedResult"]);
  });
});

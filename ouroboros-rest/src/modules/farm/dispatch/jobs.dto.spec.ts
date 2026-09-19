import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { COMMIT } from "./dispatch.fixture";
import { ARGV_ITEM_MAX_LENGTH, ARGV_MAX_ITEMS, SubmitBuildJobDto } from "./jobs.dto";

/** The body of `POST /api/v1/farm/jobs` (#252), held to its rules field by field. */

const VALID = {
  pool: "pool-a",
  repository: "acme-robotics/helios-firmware",
  ref: "refs/heads/main",
  commit: COMMIT,
};

/**
 * The properties a body fails on.
 *
 * @param body - The body.
 * @returns The failing properties.
 */
function failures(body: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(SubmitBuildJobDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);
}

describe("a build submission", () => {
  it("accepts the four required fields alone — the command falls back to the pool's", () => {
    expect(failures(VALID)).toEqual([]);
  });

  it("accepts argv, a title and a label", () => {
    expect(
      failures({
        ...VALID,
        command: ["sh", "-c", ""],
        title: "Add OTA rollback on failed checksum",
        label: "zephyr build",
      }),
    ).toEqual([]);
  });

  it.each([
    ["pool", { pool: "Pool A" }],
    ["repository", { repository: "helios-firmware" }],
    ["repository", { repository: "acme/robotics/helios" }],
    ["ref", { ref: "refs/heads/my branch" }],
    ["ref", { ref: "r".repeat(257) }],
    ["commit", { commit: "main" }],
    ["commit", { commit: COMMIT.toUpperCase() }],
    ["title", { title: "" }],
    ["label", { label: "l".repeat(65) }],
  ])("refuses a bad %s", (property, change) => {
    expect(failures({ ...VALID, ...change })).toEqual([property]);
  });

  it.each([
    ["a shell string", "make all"],
    ["an empty argv", []],
    ["an empty program", ["", "all"]],
    ["a word that is not a string", ["make", 8]],
    ["too many words", Array.from({ length: ARGV_MAX_ITEMS + 1 }, () => "x")],
    ["too long a word", ["make", "x".repeat(ARGV_ITEM_MAX_LENGTH + 1)]],
  ])("refuses %s as a command — argv, never a shell string", (_, command) => {
    expect(failures({ ...VALID, command })).toEqual(["command"]);
  });

  it("requires every one of the four, and names no workspace", () => {
    for (const field of Object.keys(VALID)) {
      const body: Record<string, unknown> = { ...VALID };
      delete body[field];
      expect(failures(body)).toEqual([field]);
    }
    expect(failures({ ...VALID, organizationId: "org-other" })).toEqual(["organizationId"]);
  });
});

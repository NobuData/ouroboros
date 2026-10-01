import { describe, expect, it } from "vitest";

import {
  COMMAND_BLANK,
  ENV_ADMIN_REASON,
  MAX_COMMAND_LENGTH,
  MAX_RECIPE_COMMANDS,
  PLATFORM_ABSENT,
  RECIPE_EMPTY,
  RECIPE_MANY,
  ROW_ABSENT,
  SNAPSHOT_HONEST,
  chooseProfileRepo,
  commandLine,
  lineProblem,
  parseRecipeText,
  profileChip,
  profileRows,
  profileTitle,
  protectedPathNote,
  recipeText,
  saveFailure,
  saveLabel,
  savedToast,
  versionLine,
} from "@/app/knowledge/profile";

import {
  READ_AT,
  SEEDED_REPO,
  detectionRow,
  enabledRepo,
  seededDetection,
  seededRecipe,
  seededRepos,
  unscannedDetection,
} from "../helpers/knowledge";

/**
 * The repo-profile card's decisions (#420): which repository, the honest pill, the rows composed
 * from detection with an absent Platform saying so, the environment block's version line and its
 * text round trip with every refusal before a round trip, and the snapshot row with no number.
 */

describe("which repository", () => {
  it("is the address's when it is enabled, else the first enabled one, else none", () => {
    const repos = seededRepos();

    expect(chooseProfileRepo(repos, "acme-robotics/helios-tools")).toEqual(repos[1]);
    expect(chooseProfileRepo(repos, "ACME-Robotics/Helios-Tools")).toEqual(repos[1]);
    expect(chooseProfileRepo(repos, "someone/else")).toEqual(repos[0]);
    expect(chooseProfileRepo(repos, undefined)).toEqual(repos[0]);
    expect(chooseProfileRepo([], undefined)).toBeNull();
  });

  it("titles the card for the repository", () => {
    expect(profileTitle(enabledRepo())).toBe("Repo profile — helios-firmware");
    expect(profileTitle(null)).toBe("Repo profile");
  });
});

describe("the pill", () => {
  it("is detected with a scan, not scanned without one, and not read when the read failed", () => {
    expect(profileChip({ ok: true, value: seededDetection() })).toEqual({ tone: "ok", text: "detected", dot: "filled" });
    expect(profileChip({ ok: true, value: unscannedDetection() })).toEqual({ tone: "warn", text: "not scanned", dot: "ring" });
    expect(profileChip({ ok: false, reason: "down" })).toEqual({ tone: "err", text: "not read", dot: "ring" });
  });
});

describe("the rows", () => {
  it("are the mockup's four, from detection's rows, the Platform honest about its missing pack", () => {
    expect(profileRows(seededDetection())).toEqual([
      { key: "language", label: "Language", value: "C 92% · CMake", tone: "ok", labelled: "detected" },
      { key: "custom:platform", label: "Platform", value: PLATFORM_ABSENT, tone: "absent", labelled: null },
      { key: "build", label: "Build", value: "west + twister (found west.yml)", tone: "ok", labelled: "detected" },
      { key: "devcontainer", label: "Devcontainer", value: "✓ .devcontainer.json", tone: "ok", labelled: "detected" },
    ]);
  });

  it("draws a custom platform row when a pack reports one, and a row's verdict as its tone", () => {
    const detection = seededDetection({
      rows: [
        detectionRow({ rowKey: "custom:platform", value: "Zephyr RTOS 4.1" }),
        detectionRow({ rowKey: "devcontainer", verdict: "missing", value: "no .devcontainer.json" }),
      ],
    });

    expect(profileRows(detection)).toEqual([
      { key: "language", label: "Language", value: ROW_ABSENT, tone: "absent", labelled: null },
      { key: "custom:platform", label: "Platform", value: "Zephyr RTOS 4.1", tone: "ok", labelled: "detected" },
      { key: "build", label: "Build", value: ROW_ABSENT, tone: "absent", labelled: null },
      { key: "devcontainer", label: "Devcontainer", value: "no .devcontainer.json", tone: "missing", labelled: "detected" },
    ]);
  });

  it("says where a protected path came from", () => {
    expect(protectedPathNote("suggested")).toBe("suggested by a scan");
    expect(protectedPathNote("edited")).toBe("edited by a person");
  });
});

describe("the environment block", () => {
  it("names the version in force, who saved it and when — the calendar's units", () => {
    expect(versionLine(seededRecipe(), new Date(READ_AT))).toBe("v3 · edited by Ken, 1w ago");
    expect(versionLine(seededRecipe({ version: 1, source: "detected", updatedBy: null }), new Date(READ_AT))).toBe(
      "v1 · detected, 1w ago",
    );
    expect(saveLabel(seededRecipe())).toBe("Save as v4");
    expect(saveLabel(null)).toBe("Save as v1");
  });

  it("writes a command as one line and the block as the editor's text, round-tripping", () => {
    expect(commandLine({ command: "west update", comment: null })).toBe("west update");
    expect(commandLine({ command: "west update", comment: "modules" })).toBe("west update # modules");

    const text = recipeText(seededRecipe());

    expect(text.split("\n")).toHaveLength(4);
    expect(text).toContain("ccache --set-config=max_size=8G # shared build cache");
    expect(parseRecipeText(text)).toEqual({
      ok: true,
      commands: seededRecipe().commands.map((one) => ({ command: one.command, comment: one.comment })),
    });
    expect(recipeText(null)).toBe("");
  });

  it("parses one command per line, skipping blank lines, a comment optional", () => {
    expect(parseRecipeText("\nwest update\n\n  make all # build it  \n")).toEqual({
      ok: true,
      commands: [{ command: "west update" }, { command: "make all", comment: "build it" }],
    });
  });

  it("refuses an empty block, too many lines, a comment with no command, and an overlong line", () => {
    expect(parseRecipeText("\n \n")).toEqual({ ok: false, problem: RECIPE_EMPTY });
    expect(parseRecipeText(Array.from({ length: MAX_RECIPE_COMMANDS + 1 }, () => "x").join("\n"))).toEqual({
      ok: false,
      problem: RECIPE_MANY,
    });
    expect(parseRecipeText("west update\n # orphan")).toEqual({ ok: false, problem: lineProblem(2, COMMAND_BLANK) });
    expect(parseRecipeText("x".repeat(MAX_COMMAND_LENGTH + 1))).toMatchObject({ ok: false, problem: expect.stringContaining("Line 1") });
  });

  it.each([
    ["forbidden", `Not saved: ${ENV_ADMIN_REASON}`],
    ["env_recipe_version_conflict", "Not saved: someone else saved the next version first — the page is re-reading it."],
    ["validation_failed", "Not saved: The block is malformed."],
  ])("says why a save was refused — %s", (code, sentence) => {
    expect(saveFailure({ code, message: "The block is malformed.", details: {} })).toBe(sentence);
  });

  it("leaves a toast naming the version and what consumes it", () => {
    expect(savedToast(seededRecipe({ version: 4 }))).toEqual({
      text: `Saved ${SEEDED_REPO}'s environment recipe as v4 — 4 commands. The farm and execution run it from the next workspace they prepare.`,
      links: [],
    });
  });
});

describe("the snapshot row", () => {
  it("names the tier it waits on and invents no boot time — decision K7", () => {
    expect(SNAPSHOT_HONEST).toContain("#399");
    expect(SNAPSHOT_HONEST).not.toMatch(/\d+\s*s\b/);
    expect(SNAPSHOT_HONEST).not.toContain("38");
  });
});

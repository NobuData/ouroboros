import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  GLOBS_MAX,
  GLOB_MAX_LENGTH,
  GLOB_PATTERN,
  GLOB_PROBLEMS,
  type GlobPreviewRepository,
  type GlobProblem,
  globChip,
  globProblem,
  matchLine,
  repositoryLine,
} from "@/app/globs/glob";

/**
 * The glob rules (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)): the grammar is
 * the workflow DSL's `path_glob`, verbatim, so what the browser accepts the service accepts; each
 * refusal has its own reason; and the preview's lines say what was checked.
 */

/** `schemas/workflow-dsl/v1.json`, from the repository root. */
const DSL = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "schemas", "workflow-dsl", "v1.json"), "utf8"),
) as { $defs: { path_glob: { pattern: string; maxLength: number } } };

/**
 * A listed repository's answer.
 *
 * @param overrides Fields to replace.
 * @returns The answer.
 */
function repository(overrides: Partial<GlobPreviewRepository> = {}): GlobPreviewRepository {
  return {
    repository: "acme/helios-firmware",
    status: "listed",
    reason: null,
    fileCount: 1234,
    truncated: false,
    globs: [],
    ...overrides,
  };
}

describe("the grammar", () => {
  it("is the DSL's path_glob pattern and length, verbatim", () => {
    expect(GLOB_PATTERN.source).toBe(new RegExp(DSL.$defs.path_glob.pattern).source);
    expect(GLOB_MAX_LENGTH).toBe(DSL.$defs.path_glob.maxLength);
  });

  it.each(["boot/**", ".github/**", "keys/**", "drivers/can/*.c", "a/**/b", "README.md", "..hidden/x", "src/", "./x"])(
    "accepts %s",
    (glob) => {
      expect(globProblem(glob)).toBeNull();
    },
  );

  it.each<[string, GlobProblem]>([
    ["", "empty"],
    ["a".repeat(GLOB_MAX_LENGTH + 1), "too_long"],
    ["boot /**", "whitespace"],
    [" boot/**", "whitespace"],
    ["boot/**\t", "whitespace"],
    ["/abs/path", "absolute"],
    ["a/../b", "parent"],
    ["../up", "parent"],
    ["a/..", "parent"],
    ["a/.hidden./..", "parent"],
  ])("refuses %j as %s", (glob, problem) => {
    expect(globProblem(glob)).toBe(problem);
  });

  it("accepts exactly the longest pattern", () => {
    expect(globProblem("a".repeat(GLOB_MAX_LENGTH))).toBeNull();
  });

  it("refuses a duplicate, and a pattern past the cap — in that order of specificity", () => {
    const full = Array.from({ length: GLOBS_MAX }, (_, index) => `dir${String(index)}/**`);

    expect(globProblem("boot/**", ["keys/**", "boot/**"])).toBe("duplicate");
    expect(globProblem("new/**", full)).toBe("full");
    expect(globProblem("new/**", full.slice(1))).toBeNull();
    expect(globProblem("dir0/**", full)).toBe("duplicate");
    // A malformed pattern is told about its grammar, not about the list.
    expect(globProblem("/abs", full)).toBe("absolute");
  });

  it("has a sentence for every problem", () => {
    for (const sentence of Object.values(GLOB_PROBLEMS)) {
      expect(sentence).toMatch(/\.$/);
    }
    expect(Object.keys(GLOB_PROBLEMS).sort()).toEqual(
      ["absolute", "duplicate", "empty", "full", "grammar", "parent", "too_long", "whitespace"].sort(),
    );
  });
});

describe("globChip", () => {
  it.each([
    ["boot/**", "boot/"],
    [".github/**", ".github/"],
    ["drivers/can/**", "drivers/can/"],
    ["drivers/*/**", "drivers/*/**"],
    ["**", "**"],
    ["src/*.c", "src/*.c"],
    ["a/**/b", "a/**/b"],
    ["boot/", "boot/"],
  ])("states %s as %s", (glob, chip) => {
    expect(globChip(glob)).toBe(chip);
  });
});

describe("matchLine", () => {
  it("counts files, and says plainly when there are none", () => {
    expect(matchLine(0)).toBe("matches no files");
    expect(matchLine(1)).toBe("matches 1 file");
    expect(matchLine(12)).toBe("matches 12 files");
    expect(matchLine(12345)).toBe("matches 12,345 files");
  });
});

describe("repositoryLine", () => {
  it("names the repository and the size of the tree checked", () => {
    expect(repositoryLine(repository())).toBe("acme/helios-firmware — 1,234 files checked");
  });

  it("says a truncated tree's counts are a minimum", () => {
    expect(repositoryLine(repository({ truncated: true }))).toBe(
      "acme/helios-firmware — first 1,234 files checked; the tree is larger, so counts are a minimum",
    );
  });

  it("says a tree could not be listed, and why when the service said", () => {
    expect(
      repositoryLine(
        repository({ status: "unavailable", reason: "The host refused the token.", fileCount: null }),
      ),
    ).toBe("acme/helios-firmware — could not be listed. The host refused the token.");
    expect(repositoryLine(repository({ status: "unavailable", reason: null, fileCount: null }))).toBe(
      "acme/helios-firmware — could not be listed.",
    );
  });
});

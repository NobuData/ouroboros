import { DomainError } from "../errors/error.envelope";
import { GlobSet } from "../guardrails/guardrails.glob";
import type { RepoTree } from "../ticket-sources/ticket-source.probe";
import {
  PATH_PREVIEW_GLOB_INVALID,
  PATH_PREVIEW_MAX_SAMPLES,
  assertPolicyPathGlobs,
  filesOf,
  isPolicyPathGlob,
  matchGlobs,
} from "./path-preview";
import { validPolicyDocument } from "./policy-publish.service";

/**
 * The match preview's rules (BS.4, #494): a glob is valid exactly when the publish would accept it,
 * and a path matches exactly when the guardrails' matcher says so.
 */

/** A document whose `protected_paths` holds one glob. */
function documentWith(glob: string): Record<string, unknown> {
  return {
    auto_merge: { enabled: false, conditions: { effort_lte: "m" } },
    human_review: { enabled: false, conditions: { label: "refactor" } },
    protected_paths: { enabled: true, conditions: { path_globs: [glob] } },
    spend_guard: { enabled: false, conditions: { per_run_cap_cents: 250 } },
    dry_run_new_repos: { enabled: false, conditions: { first_n_loops: 10 } },
  };
}

/** Whether the publish flow accepts a document holding the glob. */
function publishAccepts(glob: string): boolean {
  try {
    validPolicyDocument(documentWith(glob));

    return true;
  } catch {
    return false;
  }
}

const TREE: RepoTree = {
  truncated: false,
  entries: [
    { path: "boot", type: "dir" },
    { path: "boot/stage1.S", type: "file" },
    { path: "boot/loader/main.c", type: "file" },
    { path: "keys/prod.pem", type: "file" },
    { path: ".github/workflows/ci.yml", type: "file" },
    { path: "src/app.c", type: "file" },
    { path: "README.md", type: "file" },
  ],
};

describe("the path preview's rules", () => {
  it.each([
    ["boot/**"],
    ["keys/**"],
    [".github/**"],
    ["*.yml"],
    ["src/ci-?.c"],
    ["/boot/**"],
    ["boot/../keys/**"],
    ["../keys"],
    ["boot /**"],
    [""],
    ["a".repeat(257)],
  ])("judges %p exactly as the publish would", (glob) => {
    expect(isPolicyPathGlob(glob)).toBe(publishAccepts(glob));
  });

  it("accepts the mockup's globs and refuses a rooted one", () => {
    expect(isPolicyPathGlob("boot/**")).toBe(true);
    expect(isPolicyPathGlob("/boot/**")).toBe(false);
    expect(isPolicyPathGlob(7)).toBe(false);
  });

  it("refuses a list naming each bad glob and where it sits", () => {
    expect(() => {
      assertPolicyPathGlobs(["boot/**", "keys/**"]);
    }).not.toThrow();

    let refusal: unknown;

    try {
      assertPolicyPathGlobs(["boot/**", "/etc", "a/../b"]);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(DomainError);
    expect(refusal).toMatchObject({
      code: PATH_PREVIEW_GLOB_INVALID,
      details: {
        invalid: [
          { index: 1, glob: "/etc" },
          { index: 2, glob: "a/../b" },
        ],
      },
    });
    expect((refusal as DomainError).getStatus()).toBe(422);
  });

  it("lists files only, sorted", () => {
    expect(filesOf(TREE)).toEqual([
      ".github/workflows/ci.yml",
      "README.md",
      "boot/loader/main.c",
      "boot/stage1.S",
      "keys/prod.pem",
      "src/app.c",
    ]);
  });

  it("counts and samples what each glob covers, in the caller's order", () => {
    expect(matchGlobs(["boot/**", "*.md", "nothing/**"], filesOf(TREE))).toEqual([
      { glob: "boot/**", matchCount: 2, samples: ["boot/loader/main.c", "boot/stage1.S"] },
      { glob: "*.md", matchCount: 1, samples: ["README.md"] },
      { glob: "nothing/**", matchCount: 0, samples: [] },
    ]);
  });

  it("matches exactly the paths the guardrails' matcher admits", () => {
    const files = filesOf(TREE);

    for (const glob of ["boot/**", "keys/**", ".github/**", "*.md", "**/*.c", "src/app.?"]) {
      const enforced = new GlobSet([glob]);
      const [preview] = matchGlobs([glob], files);

      expect(preview.matchCount).toBe(files.filter((path) => enforced.matches(path)).length);
    }
  });

  it("caps the samples and keeps the count whole", () => {
    const files = Array.from(
      { length: 12 },
      (_, index) => `boot/f${String(index).padStart(2, "0")}.c`,
    );
    const [preview] = matchGlobs(["boot/**"], files);

    expect(preview.matchCount).toBe(12);
    expect(preview.samples).toEqual(files.slice(0, PATH_PREVIEW_MAX_SAMPLES));
  });
});

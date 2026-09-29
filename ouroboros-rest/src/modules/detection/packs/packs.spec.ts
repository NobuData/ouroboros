/**
 * The core packs' edges, one pack at a time ([#384](https://github.com/NobuData/ouroboros/issues/384))
 * — the cases the four golden fixtures do not reach.
 */

import { ProbeResults, probeKey, type ProbeOutcome, type ProbeSpec } from "../detection.pack";
import { treeOf, type FixtureRepo } from "../detection.fixture";
import { BUILD_PACK } from "./build.pack";
import { CONVENTIONS_PACK } from "./conventions.pack";
import { DEVCONTAINER_PACK } from "./devcontainer.pack";
import { LANGUAGE_PACK, zephyrVersion } from "./language.pack";
import { clampValue, parseJsonc, plural } from "./pack.helpers";
import { MAX_PROTECTED_DEPTH, PROTECTED_PATHS_PACK } from "./protected-paths.pack";
import { MAX_TEST_FILES, TESTS_PACK } from "./tests.pack";

/**
 * Every probe a repository answers, as the orchestrator would record it — enough to call a pack's
 * `conclude` directly.
 *
 * @param repo - The fixture.
 * @param probes - The probes to answer.
 * @returns The results.
 */
function seen(repo: FixtureRepo, probes: readonly ProbeSpec[]): ProbeResults {
  const outcomes = new Map<string, ProbeOutcome>();

  for (const probe of probes) {
    const value =
      probe.kind === "languages"
        ? { ...repo.languages }
        : probe.kind === "tree"
          ? treeOf(repo)
          : repo.files[probe.path] === undefined
            ? null
            : { path: probe.path, content: repo.files[probe.path] ?? "", size: 1 };

    outcomes.set(probeKey(probe), { status: "done", value });
  }

  return new ProbeResults(outcomes);
}

/**
 * Run a pack's rounds to completion over a fixture, as the orchestrator would, and conclude.
 *
 * @param pack - The pack.
 * @param repo - The fixture.
 * @returns The conclusion's first row.
 */
function conclude(
  pack: typeof BUILD_PACK,
  repo: FixtureRepo,
): ReturnType<typeof BUILD_PACK.conclude> {
  let results = seen(repo, []);

  for (let round = 0; round < 3; round += 1) {
    results = seen(repo, pack.probes(results));
  }

  return pack.conclude(results);
}

/** A repository with these files and one language. */
function repo(
  files: Record<string, string>,
  languages: Record<string, number> = { C: 1 },
): FixtureRepo {
  return { languages, files };
}

describe("the language pack", () => {
  it("names the language alone when no manifest hints a framework", () => {
    expect(
      conclude(LANGUAGE_PACK, repo({ "main.go": "" }, { Go: 3, Shell: 1 })).rows[0]?.value,
    ).toBe("Go 75%");
  });

  it("names Zephyr without a version when west.yml pins a branch", () => {
    const west = "manifest:\n  projects:\n    - name: zephyr\n      revision: main\n";

    expect(conclude(LANGUAGE_PACK, repo({ "west.yml": west })).rows[0]?.value).toBe(
      "C 100% · Zephyr RTOS",
    );
  });

  it("reads only the zephyr project's revision", () => {
    const west = [
      "  projects:",
      "    - name: hal_nordic",
      "      revision: v9.9.9",
      "    - name: zephyr",
      "      revision: 'v3.7.1'",
      "    - name: mcuboot",
      "      revision: v2.1.0",
    ].join("\n");

    expect(zephyrVersion(west)).toBe("3.7");
    expect(
      zephyrVersion("projects:\n  - name: zephyr-extras\n    revision: v1.0.0\n"),
    ).toBeUndefined();
  });
});

describe("the build pack", () => {
  it.each([
    [{ "Cargo.toml": "" }, "cargo build + cargo test (found Cargo.toml)"],
    [{ "go.mod": "" }, "go build + go test (found go.mod)"],
    [{ "package.json": "{}" }, "npm (found package.json)"],
    [
      { "package.json": '{"devDependencies":{"vitest":"1"}}', "pnpm-lock.yaml": "" },
      "pnpm + vitest (found package.json)",
    ],
    [{ "pyproject.toml": "[project]\n" }, "pip (found pyproject.toml)"],
    [
      { "pyproject.toml": "", "poetry.lock": "", "conftest.py": "" },
      "poetry + pytest (found pyproject.toml)",
    ],
    [{ "build.gradle.kts": "" }, "gradle (found build.gradle.kts)"],
    [{ "pom.xml": "" }, "maven (found pom.xml)"],
    [{ "MODULE.bazel": "" }, "bazel (found MODULE.bazel)"],
    [{ "CMakeLists.txt": "" }, "cmake + ctest (found CMakeLists.txt)"],
    [{ Makefile: "" }, "make (found Makefile)"],
  ])("reads %j as %s", (files, value) => {
    expect(conclude(BUILD_PACK, repo(files)).rows[0]?.value).toBe(value);
  });

  it("only counts a manifest at the root", () => {
    expect(conclude(BUILD_PACK, repo({ "sub/go.mod": "" })).rows[0]?.verdict).toBe("missing");
  });
});

describe("the devcontainer pack", () => {
  it("warns when the file does not parse", () => {
    expect(
      conclude(DEVCONTAINER_PACK, repo({ ".devcontainer.json": "{ nope" })).rows[0],
    ).toMatchObject({
      verdict: "warn",
      value: "found .devcontainer.json, but it does not parse",
    });
  });

  it("summarises a compose-based devcontainer, and one that names no environment", () => {
    expect(
      conclude(DEVCONTAINER_PACK, repo({ ".devcontainer.json": '{"dockerComposeFile":["a.yml"]}' }))
        .rows[0]?.value,
    ).toBe("found .devcontainer.json → docker compose");
    expect(conclude(DEVCONTAINER_PACK, repo({ ".devcontainer.json": "{}" })).rows[0]?.value).toBe(
      "found .devcontainer.json",
    );
  });

  it("prefers the root file, as the spec does", () => {
    const both = repo({
      ".devcontainer.json": '{"image":"root"}',
      ".devcontainer/devcontainer.json": '{"image":"nested"}',
    });

    expect(conclude(DEVCONTAINER_PACK, both).rows[0]?.value).toBe(
      "found .devcontainer.json → image root",
    );
  });
});

describe("the tests pack", () => {
  it(`samples at most ${String(MAX_TEST_FILES)} files and says the count is a floor`, () => {
    const files = Object.fromEntries(
      Array.from({ length: MAX_TEST_FILES + 3 }, (_, index) => [
        `pkg/t${String(index).padStart(2, "0")}_test.go`,
        "func TestA(t *testing.T) {}\nfunc TestB(t *testing.T) {}\n",
      ]),
    );
    const row = conclude(TESTS_PACK, repo(files)).rows[0];

    expect(row).toMatchObject({
      value: `15 suites, ≥ ${String(MAX_TEST_FILES * 2)} tests (detected)`,
      confidence: "low",
      evidence: { sampled: true, filesRead: MAX_TEST_FILES, filesTotal: 15, ecosystems: ["go"] },
    });
  });

  it("reads one file of each suite before a second of any", () => {
    const files: Record<string, string> = {};

    for (const suite of ["a", "b"]) {
      files[`tests/${suite}/testcase.yaml`] = "";

      for (let index = 0; index < 10; index += 1) {
        files[`tests/${suite}/src/f${String(index)}.c`] = "ZTEST(s, t) {}\n";
      }
    }

    const probes = TESTS_PACK.probes(seen(repo(files), [{ kind: "tree" }]));
    const paths = probes.flatMap((probe) => (probe.kind === "file" ? [probe.path] : []));

    expect(paths).toHaveLength(MAX_TEST_FILES);
    expect(paths.filter((path) => path.startsWith("tests/a/"))).toHaveLength(MAX_TEST_FILES / 2);
  });
});

describe("the protected-paths pack", () => {
  it(`suggests up to depth ${String(MAX_PROTECTED_DEPTH)}, case-insensitively, and not deeper`, () => {
    const conclusion = conclude(
      PROTECTED_PATHS_PACK,
      repo({ "fw/Secrets/a": "", "a/b/keys/k": "", "terraform/main.tf": "" }),
    );

    expect(conclusion.protectedPaths).toEqual(["fw/Secrets/**", "terraform/**"]);
  });
});

describe("the conventions pack", () => {
  it("finds a guide in docs/ and an owners file at the root", () => {
    expect(
      conclude(CONVENTIONS_PACK, repo({ "docs/contributing.rst": "", CODEOWNERS: "", ".czrc": "" }))
        .rows[0]?.value,
    ).toBe("found docs/contributing.rst · CODEOWNERS · .czrc");
  });

  it("does not take a guide from somewhere GitHub would not look", () => {
    expect(conclude(CONVENTIONS_PACK, repo({ "pkg/CONTRIBUTING.md": "" })).rows[0]?.verdict).toBe(
      "warn",
    );
  });
});

describe("the helpers", () => {
  it("parse JSON with comments and trailing commas, keeping // inside strings", () => {
    expect(parseJsonc('{ /* c */ "u": "https://x", // c\n "a": [1,2,], }')).toEqual({
      u: "https://x",
      a: [1, 2],
    });
    expect(parseJsonc('{"q": "a \\" // b"}')).toEqual({ q: 'a " // b' });
    expect(parseJsonc("{ /* unterminated")).toBeUndefined();
  });

  it("clamp a card line to 512 characters", () => {
    expect(clampValue("x".repeat(600))).toHaveLength(512);
    expect(clampValue("  short  ")).toBe("short");
  });

  it("agree in number", () => {
    expect(plural(1, "suite")).toBe("1 suite");
    expect(plural(2, "test", "≥ 2")).toBe("≥ 2 tests");
  });
});

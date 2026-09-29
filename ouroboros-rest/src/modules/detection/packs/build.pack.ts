/**
 * The `build` rule pack — `west + twister (found west.yml)`
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)).
 *
 * A **manifest probe table**: the root-level files that name a build system, most specific first,
 * checked against the tree for free. The found file is the evidence. Two manifests are read —
 * `package.json` and `pyproject.toml` — because the file alone does not name the test runner;
 * the lockfile beside them names the package manager.
 *
 * Adding Bazel or uv is a row in {@link MANIFESTS}, not a patch to the orchestrator.
 */

import type { PackConclusion, ProbeResults, ProbeSpec, RulePack } from "../detection.pack";
import { packageDependencies } from "./pack.helpers";

/** What a manifest says about the build, given the tree and the files read. */
type Describe = (paths: ReadonlySet<string>, seen: ProbeResults) => string;

/** One manifest the table recognises. */
interface Manifest {
  /** Root-level file names; the first present is the hit. */
  readonly files: readonly string[];
  /** The build and test tooling the hit supports. */
  readonly describe: Describe;
  /** Whether the pack reads the file to describe it. */
  readonly read?: boolean;
}

/** Node package managers, by the lockfile each writes. */
const NODE_LOCKFILES: readonly (readonly [lockfile: string, manager: string])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** Node test runners, in the order they are preferred when several are installed. */
const NODE_TEST_RUNNERS = ["vitest", "jest", "mocha", "ava", "@playwright/test"] as const;

/** Python project managers, by lockfile. */
const PYTHON_LOCKFILES: readonly (readonly [lockfile: string, manager: string])[] = [
  ["uv.lock", "uv"],
  ["poetry.lock", "poetry"],
  ["pdm.lock", "pdm"],
];

/** The table, most specific first — a Zephyr workspace also has a `CMakeLists.txt`. */
export const MANIFESTS: readonly Manifest[] = [
  { files: ["west.yml"], describe: () => "west + twister" },
  { files: ["Cargo.toml"], describe: () => "cargo build + cargo test" },
  { files: ["go.mod"], describe: () => "go build + go test" },
  { files: ["package.json"], describe: node, read: true },
  { files: ["pyproject.toml"], describe: python, read: true },
  { files: ["build.gradle.kts", "build.gradle"], describe: () => "gradle" },
  { files: ["pom.xml"], describe: () => "maven" },
  { files: ["BUILD.bazel", "WORKSPACE", "MODULE.bazel"], describe: () => "bazel" },
  { files: ["CMakeLists.txt"], describe: () => "cmake + ctest" },
  { files: ["Makefile"], describe: () => "make" },
];

/** Every file name the table checks, for the evidence. */
const CHECKED = MANIFESTS.flatMap((manifest) => manifest.files);

export const BUILD_PACK: RulePack = {
  key: "build",
  version: "1.0.0",
  rows: ["build"],

  probes(seen: ProbeResults): ProbeSpec[] {
    const hit = firstHit(seen.paths());

    return [
      { kind: "tree" },
      ...(hit?.manifest.read === true ? [{ kind: "file", path: hit.file } as const] : []),
    ];
  },

  conclude(seen: ProbeResults): PackConclusion {
    const paths = seen.paths();
    const hit = firstHit(paths);

    if (hit === undefined) {
      return {
        rows: [
          {
            rowKey: "build",
            verdict: "missing",
            value: "No build manifest found",
            evidence: { checked: CHECKED },
            confidence: "high",
          },
        ],
      };
    }

    const others = CHECKED.filter((file) => file !== hit.file && paths.has(file));

    return {
      rows: [
        {
          rowKey: "build",
          verdict: "ok",
          value: `${hit.manifest.describe(paths, seen)} (found ${hit.file})`,
          evidence: { hit: hit.file, alsoFound: others, checked: CHECKED },
          confidence: "high",
        },
      ],
    };
  },
};

/**
 * The first manifest of the table the tree holds at its root.
 *
 * @param paths - The tree's file paths.
 * @returns The manifest and the file that hit, or undefined.
 */
function firstHit(paths: ReadonlySet<string>): { manifest: Manifest; file: string } | undefined {
  for (const manifest of MANIFESTS) {
    const file = manifest.files.find((candidate) => paths.has(candidate));

    if (file !== undefined) {
      return { manifest, file };
    }
  }

  return undefined;
}

/**
 * `yarn + jest` — the package manager from the lockfile, the runner from the dependencies.
 *
 * @param paths - The tree's file paths.
 * @param seen - The outcomes, holding `package.json`.
 * @returns The line.
 */
function node(paths: ReadonlySet<string>, seen: ProbeResults): string {
  const manager = NODE_LOCKFILES.find(([lockfile]) => paths.has(lockfile))?.[1] ?? "npm";
  const dependencies = packageDependencies(seen.file("package.json")?.content);
  const runner = NODE_TEST_RUNNERS.find((candidate) => dependencies.has(candidate));

  return runner === undefined ? manager : `${manager} + ${runner}`;
}

/**
 * `uv + pytest` — the manager from the lockfile, pytest when the project or the tree names it.
 *
 * @param paths - The tree's file paths.
 * @param seen - The outcomes, holding `pyproject.toml`.
 * @returns The line.
 */
function python(paths: ReadonlySet<string>, seen: ProbeResults): string {
  const manager = PYTHON_LOCKFILES.find(([lockfile]) => paths.has(lockfile))?.[1] ?? "pip";
  const pytest =
    /\bpytest\b/.test(seen.file("pyproject.toml")?.content ?? "") ||
    paths.has("pytest.ini") ||
    paths.has("conftest.py");

  return pytest ? `${manager} + pytest` : manager;
}

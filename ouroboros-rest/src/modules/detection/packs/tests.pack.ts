/**
 * The `tests` rule pack — `5 suites, 63 tests (detected)`
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)).
 *
 * Per-ecosystem rules find the suites in the tree, then read up to {@link MAX_TEST_FILES} of their
 * source files and count test-case declarations. **This is an estimate and the row says so**: the
 * label is `detected`, and when the file cap left suites unread the count reads `≥ 63` and the
 * confidence drops. When the test-results plane (#324) has real results for the repository the
 * detection service replaces this row with the measured one — see `detection.reconcile.ts`.
 */

import type { PackConclusion, ProbeResults, ProbeSpec, RulePack } from "../detection.pack";
import { dirname, ownFiles, plural } from "./pack.helpers";

/** The most test files a scan reads — each is one host request. */
export const MAX_TEST_FILES = 12;

/** One suite: its name and the files its cases are declared in. */
interface Suite {
  readonly name: string;
  readonly files: readonly string[];
}

/** One ecosystem's rules. */
interface TestRule {
  /** Its name, for the evidence. */
  readonly ecosystem: string;
  /** The suites, from the repository's own files. */
  readonly suites: (files: readonly string[]) => Suite[];
  /** A test-case declaration. Global, so every occurrence counts. */
  readonly testCase: RegExp;
}

/**
 * Each file is its own suite.
 *
 * @param pattern - Which files are suites.
 * @returns The suite finder.
 */
function filesAsSuites(pattern: RegExp): TestRule["suites"] {
  return (files) =>
    files.filter((file) => pattern.test(file)).map((file) => ({ name: file, files: [file] }));
}

/** The ecosystems the pack knows. A new one is a row here. */
export const TEST_RULES: readonly TestRule[] = [
  {
    // Zephyr: a suite is a directory holding `testcase.yaml`; its cases are `ZTEST*(` in C.
    ecosystem: "zephyr",
    suites: (files) =>
      files
        .filter((file) => file === "testcase.yaml" || file.endsWith("/testcase.yaml"))
        .map((manifest) => {
          const root = dirname(manifest);
          const prefix = root === "" ? "" : `${root}/`;

          return {
            name: root === "" ? "." : root,
            files: files.filter((file) => file.startsWith(prefix) && /\.(c|cc|cpp)$/.test(file)),
          };
        }),
    testCase: /\bZTEST(?:_F|_USER|_USER_F)?\s*\(/g,
  },
  {
    ecosystem: "node",
    suites: filesAsSuites(/(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/),
    testCase: /(?:^|[^.\w])(?:it|test)(?:\.(?:only|concurrent|skip))?\s*\(/g,
  },
  {
    ecosystem: "python",
    suites: filesAsSuites(/(?:^|\/)test_[^/]*\.py$|_test\.py$/),
    testCase: /^\s*(?:async\s+)?def\s+test_\w*\s*\(/gm,
  },
  {
    ecosystem: "go",
    suites: filesAsSuites(/_test\.go$/),
    testCase: /^func\s+Test[A-Z_]\w*\s*\(/gm,
  },
];

/** Every suite of every ecosystem, with the rule that found it. */
function suitesOf(seen: ProbeResults): { rule: TestRule; suite: Suite }[] {
  const files = ownFiles(seen.tree()?.entries ?? []);

  return TEST_RULES.flatMap((rule) => rule.suites(files).map((suite) => ({ rule, suite })));
}

/**
 * The files the pack reads — the first {@link MAX_TEST_FILES}, round-robin across suites so a
 * large suite cannot starve the others.
 *
 * @param suites - The suites.
 * @returns The files, deduplicated.
 */
function filesToRead(suites: readonly { suite: Suite }[]): string[] {
  const chosen = new Set<string>();
  const longest = Math.max(0, ...suites.map(({ suite }) => suite.files.length));

  for (let index = 0; index < longest && chosen.size < MAX_TEST_FILES; index += 1) {
    for (const { suite } of suites) {
      const file = suite.files[index];

      if (file !== undefined && chosen.size < MAX_TEST_FILES) {
        chosen.add(file);
      }
    }
  }

  return [...chosen];
}

export const TESTS_PACK: RulePack = {
  key: "tests",
  version: "1.0.0",
  rows: ["tests"],

  probes(seen: ProbeResults): ProbeSpec[] {
    return [
      { kind: "tree" },
      ...filesToRead(suitesOf(seen)).map((path) => ({ kind: "file", path }) as const),
    ];
  },

  conclude(seen: ProbeResults): PackConclusion {
    const suites = suitesOf(seen);

    if (suites.length === 0) {
      return {
        rows: [
          {
            rowKey: "tests",
            verdict: "missing",
            value: "No tests found",
            evidence: { ecosystems: [], suites: 0 },
            confidence: "medium",
          },
        ],
      };
    }

    const read = new Set(filesToRead(suites));
    const counted = new Set<string>();
    let tests = 0;

    for (const { rule, suite } of suites) {
      for (const file of suite.files) {
        if (read.has(file) && !counted.has(file)) {
          counted.add(file);
          tests += (seen.file(file)?.content.match(rule.testCase) ?? []).length;
        }
      }
    }

    const total = new Set(suites.flatMap(({ suite }) => suite.files)).size;
    const sampled = counted.size < total || seen.tree()?.truncated === true;
    const count = sampled ? `≥ ${String(tests)}` : String(tests);

    return {
      rows: [
        {
          rowKey: "tests",
          verdict: "ok",
          value: `${plural(suites.length, "suite")}, ${plural(tests, "test", count)} (detected)`,
          evidence: {
            ecosystems: [...new Set(suites.map(({ rule }) => rule.ecosystem))],
            suites: suites.length,
            tests,
            filesRead: counted.size,
            filesTotal: total,
            sampled,
          },
          confidence: sampled ? "low" : "medium",
        },
      ],
    };
  },
};

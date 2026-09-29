/**
 * Four repositories and a prober over them — the detector's golden fixtures
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)).
 *
 * ```
 * ZEPHYR   helios-firmware — reproduces mockup 13's six rows, conventions warn included
 * NODE     a yarn + jest service with a devcontainer and a contributing guide
 * PYTHON   a uv + pytest FastAPI app with no devcontainer and nothing to protect
 * EMPTY    no commits — every row honestly missing
 * ```
 *
 * A repository is its languages and its files; the tree is derived (every parent directory
 * listed), exactly as GitHub's recursive trees listing would give it. The prober answers from the
 * fixture, counts its calls, and can be constrained: a `remaining` budget after which every call
 * is refused `rate_limit`, as a workspace at #101's floor would be.
 */

import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import type { RepoTree, RepoTreeEntry } from "../ticket-sources/ticket-source.probe";
import { probeKey, type ProbeSpec, type ProbeValue } from "./detection.pack";
import type { Prober } from "./detection.scan";

/** A repository, as a fixture. */
export interface FixtureRepo {
  readonly languages: Readonly<Record<string, number>>;
  readonly files: Readonly<Record<string, string>>;
}

/**
 * `n` Zephyr test cases in one C file.
 *
 * @param suite - The suite, for the names.
 * @param n - How many.
 * @returns The file.
 */
function ztests(suite: string, n: number): string {
  const cases = Array.from(
    { length: n },
    (_, index) => `ZTEST(${suite}, test_case_${String(index)})\n{\n\tzassert_true(true);\n}\n`,
  );

  return `#include <zephyr/ztest.h>\n\nZTEST_SUITE(${suite}, NULL, NULL, NULL, NULL, NULL);\n\n${cases.join("\n")}`;
}

/** The five suites of the Zephyr fixture and their case counts — 63 in all. */
export const ZEPHYR_SUITES: readonly (readonly [dir: string, cases: number])[] = [
  ["tests/kernel/timer", 15],
  ["tests/drivers/i2c", 14],
  ["tests/drivers/spi", 12],
  ["tests/lib/ring_buffer", 12],
  ["tests/app/helios", 10],
];

/** `acme-robotics/helios-firmware` — mockup 13's repository. */
export const ZEPHYR: FixtureRepo = {
  languages: { C: 920_000, CMake: 50_000, Python: 30_000 },
  files: {
    "west.yml": [
      "manifest:",
      "  remotes:",
      "    - name: zephyrproject-rtos",
      "      url-base: https://github.com/zephyrproject-rtos",
      "  projects:",
      "    - name: zephyr",
      "      remote: zephyrproject-rtos",
      "      revision: v4.1.0",
      "      import: true",
      "    - name: mcuboot",
      "      revision: v2.1.0",
      "  self:",
      "    path: helios-firmware",
      "",
    ].join("\n"),
    "CMakeLists.txt": "cmake_minimum_required(VERSION 3.20.0)\n",
    "prj.conf": "CONFIG_I2C=y\n",
    "README.md": "# helios-firmware\n",
    ".devcontainer.json": [
      "{",
      "  // The CI image, pinned.",
      '  "image": "ghcr.io/zephyrproject-rtos/ci:v0.27.4",',
      '  "postCreateCommand": "west update",',
      "}",
      "",
    ].join("\n"),
    "src/main.c": "int main(void) { return 0; }\n",
    "drivers/can/can_helios.c": "/* driver */\n",
    "boot/mcuboot.conf": "CONFIG_BOOT_SIGNATURE_TYPE_ECDSA_P256=y\n",
    "keys/root-ec-p256.pem": "-----BEGIN PUBLIC KEY-----\n",
    ...Object.fromEntries(
      ZEPHYR_SUITES.flatMap(([dir, cases]) => [
        [`${dir}/testcase.yaml`, "tests:\n  helios.test:\n    tags: helios\n"],
        [`${dir}/CMakeLists.txt`, "project(test)\n"],
        [`${dir}/src/main.c`, ztests(dir.split("/").pop() ?? "suite", cases)],
      ]),
    ),
  },
};

/** A Node service — yarn, jest, Express, a Dockerfile devcontainer, a contributing guide. */
export const NODE: FixtureRepo = {
  languages: { TypeScript: 80_000, JavaScript: 20_000 },
  files: {
    "package.json": JSON.stringify({
      name: "orders",
      dependencies: { express: "^5.0.0" },
      devDependencies: { jest: "^30.0.0", typescript: "^5.9.0" },
    }),
    "yarn.lock": "# yarn lockfile v1\n",
    "tsconfig.json": "{}\n",
    ".devcontainer/devcontainer.json": JSON.stringify({
      build: { dockerfile: "Dockerfile" },
      features: { "ghcr.io/devcontainers/features/node:1": {} },
    }),
    ".devcontainer/Dockerfile": "FROM node:24\n",
    "CONTRIBUTING.md": "# Contributing\n",
    ".github/CODEOWNERS": "* @acme/orders\n",
    "commitlint.config.js": "module.exports = {};\n",
    "infra/main.tf": 'resource "aws_s3_bucket" "orders" {}\n',
    "src/app.ts": "export const app = 1;\n",
    "src/util.ts": "export const util = 1;\n",
    "src/__tests__/app.test.ts": [
      'describe("app", () => {',
      '  it("starts", () => {});',
      '  it("stops", () => {});',
      '  test("restarts", () => {});',
      "});",
      "",
    ].join("\n"),
    "src/util.spec.ts": ['it("adds", () => {});', 'it.only("subtracts", () => {});', ""].join("\n"),
    "node_modules/left-pad/index.test.js": 'it("is vendored", () => {});\n',
  },
};

/** A Python app — uv, pytest, FastAPI, a guide under `.github/`. */
export const PYTHON: FixtureRepo = {
  languages: { Python: 100_000 },
  files: {
    "pyproject.toml": [
      "[project]",
      'name = "ledger"',
      'dependencies = ["fastapi>=0.115"]',
      "",
      "[dependency-groups]",
      'dev = ["pytest>=8"]',
      "",
    ].join("\n"),
    "uv.lock": "version = 1\n",
    ".github/CONTRIBUTING.md": "# Contributing\n",
    "ledger/__init__.py": "",
    "ledger/api.py": "app = None\n",
    "tests/test_api.py": [
      "def test_health():",
      "    pass",
      "",
      "async def test_create():",
      "    pass",
      "",
      "def test_list():",
      "    pass",
      "",
    ].join("\n"),
    "tests/test_models.py": [
      "def test_money():",
      "    pass",
      "",
      "def helper():",
      "    pass",
      "",
      "def test_round():",
      "    pass",
      "",
    ].join("\n"),
  },
};

/** A repository with no commits. */
export const EMPTY: FixtureRepo = { languages: {}, files: {} };

/**
 * The tree GitHub would list for a fixture: every file, and every directory above one.
 *
 * @param repo - The fixture.
 * @returns The tree.
 */
export function treeOf(repo: FixtureRepo): RepoTree {
  const dirs = new Set<string>();
  const files = Object.keys(repo.files).sort();

  for (const file of files) {
    const segments = file.split("/");

    for (let depth = 1; depth < segments.length; depth += 1) {
      dirs.add(segments.slice(0, depth).join("/"));
    }
  }

  const entries: RepoTreeEntry[] = [
    ...[...dirs].sort().map((path) => ({ path, type: "dir" as const })),
    ...files.map((path) => ({ path, type: "file" as const })),
  ];

  return { entries, truncated: false };
}

/** How a fixture prober behaves. */
export interface FixtureProberOptions {
  /** Calls answered before every further one is refused `rate_limit`. Unlimited when omitted. */
  readonly remaining?: number;
  /** Milliseconds each call takes. */
  readonly delayMs?: number;
  /** Probe keys that never answer — for the deadline. */
  readonly hang?: readonly string[];
  /** Probe keys that fail `upstream`. */
  readonly fail?: readonly string[];
}

/** A prober over a fixture, and what it was asked. */
export interface FixtureProber {
  readonly prober: Prober;
  /** Every probe key, in the order asked. */
  readonly calls: string[];
  /** The most calls that were in flight at once. */
  readonly peakInFlight: () => number;
}

/**
 * A prober answering from a fixture.
 *
 * @param repo - The fixture.
 * @param options - Constraints.
 * @returns The prober and its call log.
 */
export function fixtureProber(
  repo: FixtureRepo,
  options: FixtureProberOptions = {},
): FixtureProber {
  const calls: string[] = [];
  let inFlight = 0;
  let peak = 0;

  const answer = (probe: ProbeSpec): ProbeValue => {
    switch (probe.kind) {
      case "languages":
        return { ...repo.languages };
      case "tree":
        return treeOf(repo);
      case "file": {
        const content = repo.files[probe.path];

        return content === undefined
          ? null
          : { path: probe.path, content, size: Buffer.byteLength(content) };
      }
    }
  };

  const prober: Prober = async (probe) => {
    const key = probeKey(probe);

    calls.push(key);

    if (options.remaining !== undefined && calls.length > options.remaining) {
      throw new TicketSourceError("rate_limit", "the workspace's GitHub budget is at the floor");
    }

    inFlight += 1;
    peak = Math.max(peak, inFlight);

    try {
      if (options.hang?.includes(key) === true) {
        await new Promise(() => undefined);
      }

      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));

      if (options.fail?.includes(key) === true) {
        throw new TicketSourceError("upstream", "GitHub answered 502");
      }

      return answer(probe);
    } finally {
      inFlight -= 1;
    }
  };

  return { prober, calls, peakInFlight: () => peak };
}

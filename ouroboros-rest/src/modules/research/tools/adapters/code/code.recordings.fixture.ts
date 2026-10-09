/* eslint-disable @typescript-eslint/require-await -- in-memory stand-ins answer at once; async keeps the real services' signatures */
/**
 * Recorded engine answers for the code & git mining tool (CL.4, #617) — `/v0/code/*` over the
 * engine's seeded fixture repository (`ouroboros-engine/tests/code_fixtures.py`), exactly as the
 * engine's documented examples (`ouroboros-engine/openapi.yaml`) carry them. No socket is opened:
 * {@link recordedReader} answers from these.
 */

import {
  type BisectCommits,
  bisectCommitsSchema,
  type Blame,
  blameSchema,
  type ChangedBetween,
  changedBetweenSchema,
  type DepGraph,
  depGraphSchema,
  type History,
  historySchema,
} from "../../../../engine/engine.code.contract";
import { CodeRefusal, type CodeReader } from "../../../code/code.reader";
import type { EnabledRepository } from "../../../code/code.workspace";

/** The workspace the recordings were read for. */
export const ORG = "org-acme";

/** The fixture repository, as the workspace enables it. */
export const HELIOS: EnabledRepository = {
  id: "a7150011-0000-4000-8000-000000000001",
  slug: "acme-robotics/helios-firmware",
  name: "helios-firmware",
  defaultBranch: "main",
};

/** `POST /v0/code/blame`, on the wire. */
export const BLAME_WIRE = {
  clone: {
    repository: "acme-robotics/helios-firmware",
    fetched_at: "2026-10-09T06:00:00Z",
    stale: false,
  },
  ref: "nightly",
  sha: "5d610dcd6024306c6ada2831742a31522688badc",
  path: "src/dock/dock_ctrl.c",
  start: 213,
  end: 215,
  lines: [
    "static const float approach_gain_213 = 0.213;",
    "static const float approach_kp = 1.40f; /* tuned 2025-06 */",
    "static const float approach_gain_215 = 0.215;",
  ],
  hunks: [
    {
      start: 213,
      end: 215,
      commit: {
        sha: "7003ce0522ff737d756a8d6abd94101edcce41f7",
        committed_at: "2025-06-02T12:00:00Z",
        author: "Ana Ortiz",
        summary: "Tune approach controller gains",
      },
    },
  ],
  last_change: {
    sha: "7003ce0522ff737d756a8d6abd94101edcce41f7",
    committed_at: "2025-06-02T12:00:00Z",
    author: "Ana Ortiz",
    summary: "Tune approach controller gains",
  },
  as_of: "2026-08-15T12:00:00Z",
  unchanged: {
    months: 14,
    days: 439,
    phrase: "unchanged in 14 months",
  },
} as const;

/** The same, parsed. */
export const BLAME: Blame = blameSchema.parse(BLAME_WIRE);

/** `POST /v0/code/history`, on the wire. */
export const HISTORY_WIRE = {
  clone: {
    repository: "acme-robotics/helios-firmware",
    fetched_at: "2026-10-09T06:00:00Z",
    stale: false,
  },
  ref: "nightly",
  sha: "5d610dcd6024306c6ada2831742a31522688badc",
  path: "src/motor/pid.c",
  symbol: null,
  window_days: 180,
  since: "2026-02-16T12:00:00Z",
  until: "2026-08-15T12:00:00Z",
  commits: [
    {
      commit: {
        sha: "c196da80fcbec673f61da0fd13b950a1b9ec09fd",
        committed_at: "2026-07-09T12:00:00Z",
        author: "Ana Ortiz",
        summary: "Retune PID derivative",
      },
      added: 1,
      deleted: 1,
      files: ["src/motor/pid.c"],
    },
    {
      commit: {
        sha: "47cb090e9f655c09fddc53c6614f215381db90d5",
        committed_at: "2026-05-20T12:00:00Z",
        author: "Ana Ortiz",
        summary: "Gust feed-forward in PID",
      },
      added: 1,
      deleted: 0,
      files: ["src/motor/pid.c"],
    },
    {
      commit: {
        sha: "ec09cf6422bf42736baf00df475c9ded667a1afc",
        committed_at: "2026-03-04T12:00:00Z",
        author: "Bo Chen",
        summary: "Raise PID integral clamp",
      },
      added: 1,
      deleted: 0,
      files: ["src/motor/pid.c"],
    },
  ],
  total_commits: 3,
  truncated: false,
  added: 3,
  deleted: 1,
  authors: 2,
  per_month: 0.5,
} as const;

/** The same, parsed. */
export const HISTORY: History = historySchema.parse(HISTORY_WIRE);

/** `POST /v0/code/changed-between`, on the wire. */
export const CHANGED_BETWEEN_WIRE = {
  clone: {
    repository: "acme-robotics/helios-firmware",
    fetched_at: "2026-10-09T06:00:00Z",
    stale: false,
  },
  base: "v2.0.4",
  head: "nightly",
  base_sha: "f37e8886147061e46a3d448f2cffe491d57b7aaf",
  head_sha: "5d610dcd6024306c6ada2831742a31522688badc",
  scope: "src/motor",
  commits: [
    {
      commit: {
        sha: "c196da80fcbec673f61da0fd13b950a1b9ec09fd",
        committed_at: "2026-07-09T12:00:00Z",
        author: "Ana Ortiz",
        summary: "Retune PID derivative",
      },
      added: 1,
      deleted: 1,
      files: ["src/motor/pid.c"],
    },
    {
      commit: {
        sha: "47cb090e9f655c09fddc53c6614f215381db90d5",
        committed_at: "2026-05-20T12:00:00Z",
        author: "Ana Ortiz",
        summary: "Gust feed-forward in PID",
      },
      added: 1,
      deleted: 0,
      files: ["src/motor/pid.c"],
    },
    {
      commit: {
        sha: "ec09cf6422bf42736baf00df475c9ded667a1afc",
        committed_at: "2026-03-04T12:00:00Z",
        author: "Bo Chen",
        summary: "Raise PID integral clamp",
      },
      added: 1,
      deleted: 0,
      files: ["src/motor/pid.c"],
    },
  ],
  total_commits: 3,
  truncated: false,
  files: [
    {
      path: "src/motor/pid.c",
      commits: 3,
      added: 3,
      deleted: 1,
    },
  ],
  total_files: 1,
  added: 3,
  deleted: 1,
} as const;

/** The same, parsed. */
export const CHANGED_BETWEEN: ChangedBetween = changedBetweenSchema.parse(CHANGED_BETWEEN_WIRE);

/** `POST /v0/code/dep-graph`, on the wire. */
export const DEP_GRAPH_WIRE = {
  clone: {
    repository: "acme-robotics/helios-firmware",
    fetched_at: "2026-10-09T06:00:00Z",
    stale: false,
  },
  ref: "nightly",
  sha: "5d610dcd6024306c6ada2831742a31522688badc",
  module: "src/dock",
  stack: "c",
  status: "ok",
  reason: null,
  nodes: ["src/dock/dock_ctrl.c", "src/dock/dock_ctrl.h"],
  edges: [
    {
      source: "src/dock/dock_ctrl.c",
      target: "include/app/motor.h",
      weight: 1,
    },
    {
      source: "src/dock/dock_ctrl.c",
      target: "src/dock/dock_ctrl.h",
      weight: 1,
    },
    {
      source: "src/dock/dock_ctrl.h",
      target: "src/motor/pid.h",
      weight: 1,
    },
  ],
  module_edges: [
    {
      source: "src/dock",
      target: "include/app",
      weight: 1,
    },
    {
      source: "src/dock",
      target: "src/motor",
      weight: 1,
    },
  ],
  external: ["<zephyr/kernel.h>"],
  truncated: false,
} as const;

/** The same, parsed. */
export const DEP_GRAPH: DepGraph = depGraphSchema.parse(DEP_GRAPH_WIRE);

/** `POST /v0/code/bisect-commits`, on the wire. */
export const BISECT_COMMITS_WIRE = {
  clone: {
    repository: "acme-robotics/helios-firmware",
    fetched_at: "2026-10-09T06:00:00Z",
    stale: false,
  },
  good: "v2.0.4",
  bad: "nightly",
  good_sha: "f37e8886147061e46a3d448f2cffe491d57b7aaf",
  bad_sha: "5d610dcd6024306c6ada2831742a31522688badc",
  bad_ref_name: "refs/heads/nightly",
  commits: [
    "ecd512b0fd6bb45f7b54f4dc14148963247c9dc8",
    "ec09cf6422bf42736baf00df475c9ded667a1afc",
    "47cb090e9f655c09fddc53c6614f215381db90d5",
    "4f1fe54910885c92250b1a2e47709c7b2250eba6",
    "c196da80fcbec673f61da0fd13b950a1b9ec09fd",
    "5d610dcd6024306c6ada2831742a31522688badc",
  ],
  max_steps: 3,
} as const;

/** The same, parsed. */
export const BISECT_COMMITS: BisectCommits = bisectCommitsSchema.parse(BISECT_COMMITS_WIRE);

/** Every recorded answer, by engine route. */
const RECORDED: Readonly<Record<string, unknown>> = {
  blame: BLAME,
  history: HISTORY,
  "changed-between": CHANGED_BETWEEN,
  "dep-graph": DEP_GRAPH,
  "bisect-commits": BISECT_COMMITS,
};

/** A reader that answers from the recordings, and remembers what it was asked. */
export interface RecordedReader extends Pick<CodeReader, "repository" | "read"> {
  readonly calls: { operation: string; body: Record<string, unknown> }[];
}

/**
 * The recorded reader.
 *
 * @param overrides - Answers to use instead, by route.
 * @returns The reader; `helios-firmware` and `acme-robotics/helios-firmware` resolve, nothing else.
 */
export function recordedReader(overrides: Readonly<Record<string, unknown>> = {}): RecordedReader {
  const calls: { operation: string; body: Record<string, unknown> }[] = [];
  return {
    calls,
    repository: async (_org: string, name: string) => {
      if (name === HELIOS.name || name === HELIOS.slug) return HELIOS;
      throw new CodeRefusal(
        "unsupported",
        `${name} is not a repository this workspace has enabled for Ouroboros`,
      );
    },
    read: async (
      _org: string,
      _repository: EnabledRepository,
      operation: string,
      body: Record<string, unknown>,
    ) => {
      calls.push({ operation, body });
      const answer = overrides[operation] ?? RECORDED[operation];
      if (answer instanceof Error) throw answer;
      return answer as never;
    },
  };
}

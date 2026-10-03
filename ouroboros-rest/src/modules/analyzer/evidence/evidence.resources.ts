/**
 * An evidence reference as the API answers it (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517);
 * shared and widened by BW.3, [#518](https://github.com/NobuData/ouroboros/issues/518)) — what a
 * stored `{kind, id}` names, and the product surface it opens on:
 *
 * | kind | opens on |
 * |---|---|
 * | `build`, `runner_pool`, `runner` | the **farm** |
 * | `merge` | its mirrored **pull request**, else the farm that first built the commit |
 * | `workflow_version` | the **workflow** studio |
 * | `test_run`, `test_case` | the loop's **test results**, on that attempt (and that case) |
 * | `waiver` | the **pull request** it waived a criterion of, else the loop's test results |
 *
 * A reference whose row retention has removed keeps its kind and id and opens nothing — never a
 * guess at where it used to lead.
 */

import type { EvidenceIds, ResolvedEvidence } from "./evidence.repository";
import { objectOf } from "../stored.json";

/** The product surface an evidence reference opens on. */
export type EvidenceSurface = "farm" | "pull_request" | "workflow" | "test_results";

/** One evidence reference, with what it names and where it opens. */
export interface EvidenceResource {
  /** V081's kind — `build`, `merge`, `workflow_version`, `runner_pool`, `runner`, … */
  kind: string;
  /** A uuid, or a commit sha for a `merge`. */
  id: string;
  /**
   * What it names — `#412 · zephyr build`, a merge's title, `standard-fix v9`, a pool's or a
   * runner's name, `Build 3`, a test case's name, a waiver's reason. Null when the row is no
   * longer there.
   */
  label: string | null;
  /** Where it opens; null when it names nothing that can be opened. */
  surface: EvidenceSurface | null;
  /** The mirrored PR, exactly when `surface` is `pull_request`. */
  pullRequestId: string | null;
  /** The workflow's slug, exactly when `surface` is `workflow`. */
  workflowSlug: string | null;
  /** The loop whose test results it opens, exactly when `surface` is `test_results`. */
  runId: string | null;
  /** The attempt of that loop — its ordinal — when the reference names one. */
  attempt: number | null;
  /** The suite to select there, by name, for a `test_case`. */
  suiteName: string | null;
  /** The case to select there, by name, for a `test_case`. */
  caseName: string | null;
}

/** The longest a waiver's reason runs as a label before it is cut. */
export const WAIVER_LABEL_MAX = 96;

/**
 * A stored `{kind, id}` reference; V081 holds every one to that shape.
 *
 * @param value - The stored reference.
 * @returns Its kind and id, each empty when the value carries none.
 */
export function refOf(value: unknown): { kind: string; id: string } {
  const ref = objectOf(value);

  return {
    kind: typeof ref.kind === "string" ? ref.kind : "",
    id: typeof ref.id === "string" ? ref.id : "",
  };
}

/**
 * A finding's evidence references, in their stored order.
 *
 * @param finding - The finding, or anything carrying its `evidence_refs`.
 * @returns The references.
 */
export function refsOf(finding: { evidence_refs: unknown }): { kind: string; id: string }[] {
  return Array.isArray(finding.evidence_refs) ? finding.evidence_refs.map(refOf) : [];
}

/** Which resolving read each kind belongs to. */
const GROUPS: Readonly<Record<string, keyof EvidenceIds>> = {
  build: "builds",
  merge: "merges",
  workflow_version: "workflowVersions",
  runner_pool: "runnerPools",
  runner: "runners",
  test_run: "testRuns",
  test_case: "testCases",
  waiver: "waivers",
};

/**
 * A set of references, grouped for one resolving read.
 *
 * @param refs - The references.
 * @returns Each kind's distinct ids. A kind V081 does not know is left out.
 */
export function groupRefs(refs: readonly { kind: string; id: string }[]): EvidenceIds {
  const ids: Record<keyof EvidenceIds, Set<string>> = {
    builds: new Set(),
    merges: new Set(),
    workflowVersions: new Set(),
    runnerPools: new Set(),
    runners: new Set(),
    testRuns: new Set(),
    testCases: new Set(),
    waivers: new Set(),
  };

  for (const ref of refs) {
    const group = GROUPS[ref.kind];
    if (group !== undefined) {
      ids[group].add(ref.id);
    }
  }

  return {
    builds: [...ids.builds],
    merges: [...ids.merges],
    workflowVersions: [...ids.workflowVersions],
    runnerPools: [...ids.runnerPools],
    runners: [...ids.runners],
    testRuns: [...ids.testRuns],
    testCases: [...ids.testCases],
    waivers: [...ids.waivers],
  };
}

/**
 * The references a set of findings cite, grouped for one resolving read.
 *
 * @param findings - The findings.
 * @returns Each kind's distinct ids.
 */
export function evidenceIds(findings: readonly { evidence_refs: unknown }[]): EvidenceIds {
  return groupRefs(findings.flatMap(refsOf));
}

/** A reference that names nothing this read can open. */
function unresolved(ref: { kind: string; id: string }): EvidenceResource {
  return {
    ...ref,
    label: null,
    surface: null,
    pullRequestId: null,
    workflowSlug: null,
    runId: null,
    attempt: null,
    suiteName: null,
    caseName: null,
  };
}

/**
 * A waiver's reason as a one-line label.
 *
 * @param reason - The reason, as written.
 * @returns It on one line, cut to {@link WAIVER_LABEL_MAX} characters with an ellipsis.
 */
function waiverLabel(reason: string): string {
  const line = [...reason.replace(/\s+/g, " ").trim()];

  return line.length <= WAIVER_LABEL_MAX
    ? line.join("")
    : `${line
        .slice(0, WAIVER_LABEL_MAX - 1)
        .join("")
        .trimEnd()}…`;
}

/**
 * One reference, with what it names and where it opens.
 *
 * @param ref - The stored reference.
 * @param resolved - What the workspace's rows answered.
 * @returns The resource — see the file header for each kind's surface.
 */
export function evidenceResource(
  ref: { kind: string; id: string },
  resolved: ResolvedEvidence,
): EvidenceResource {
  const onFarm = (label: string): EvidenceResource => ({
    ...unresolved(ref),
    label,
    surface: "farm",
  });

  switch (ref.kind) {
    case "build": {
      const build = resolved.builds.find((row) => row.id === ref.id);

      return build === undefined
        ? unresolved(ref)
        : onFarm(`#${String(build.number)} · ${build.label}`);
    }
    case "merge": {
      const merge = resolved.merges.find((row) => row.sha === ref.id);
      if (merge === undefined) {
        return unresolved(ref);
      }
      if (merge.pull_request_id !== null) {
        return {
          ...unresolved(ref),
          label: merge.title,
          surface: "pull_request",
          pullRequestId: merge.pull_request_id,
        };
      }

      return merge.title === null ? unresolved(ref) : onFarm(merge.title);
    }
    case "workflow_version": {
      const version = resolved.workflowVersions.find((row) => row.id === ref.id);

      return version === undefined
        ? unresolved(ref)
        : {
            ...unresolved(ref),
            label: `${version.slug} ${version.version === null ? "draft" : `v${String(version.version)}`}`,
            surface: "workflow",
            workflowSlug: version.slug,
          };
    }
    case "runner_pool":
    case "runner": {
      const rows = ref.kind === "runner_pool" ? resolved.runnerPools : resolved.runners;
      const named = rows.find((row) => row.id === ref.id);

      return named === undefined ? unresolved(ref) : onFarm(named.name);
    }
    case "test_run": {
      const run = resolved.testRuns.find((row) => row.id === ref.id);

      return run === undefined
        ? unresolved(ref)
        : {
            ...unresolved(ref),
            label: `Build ${String(run.attempt_seq)}`,
            surface: "test_results",
            runId: run.run_id,
            attempt: run.attempt_seq,
          };
    }
    case "test_case": {
      const testCase = resolved.testCases.find((row) => row.id === ref.id);

      return testCase === undefined
        ? unresolved(ref)
        : {
            ...unresolved(ref),
            label: testCase.name,
            surface: "test_results",
            runId: testCase.run_id,
            attempt: testCase.attempt_seq,
            suiteName: testCase.suite,
            caseName: testCase.name,
          };
    }
    case "waiver": {
      const waiver = resolved.waivers.find((row) => row.id === ref.id);
      if (waiver === undefined) {
        return unresolved(ref);
      }

      return waiver.pull_request_id === null
        ? {
            ...unresolved(ref),
            label: waiverLabel(waiver.reason),
            surface: "test_results",
            runId: waiver.run_id,
          }
        : {
            ...unresolved(ref),
            label: waiverLabel(waiver.reason),
            surface: "pull_request",
            pullRequestId: waiver.pull_request_id,
          };
    }
    default:
      return unresolved(ref);
  }
}

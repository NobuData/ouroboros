/**
 * The dry run's wire shape — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * The engine's walk, relayed in this service's names, with two things added and one reshaped:
 *
 *   * **`ticket` is echoed**, because the studio's sheet is titled *Dry run with issue #485* and
 *     the facts the walk tested — the labels, the effort — are what a reader checks an explanation
 *     against.
 *   * **Findings take the publish gate's shape**, `source: "engine"` and all, so one clickable
 *     finding list serves the publish dialog and a dry run of a definition that does not validate.
 *   * **Everything else is the engine's own words.** A step's annotation and every edge's
 *     explanation are the simulator's sentences, relayed rather than recomposed — a second author
 *     of *why this branch was not taken* would be a second opinion about the same walk.
 */

import type {
  EngineDryRunStep,
  EngineDryRunTicket,
  EngineEdgeAnchor,
  EngineNodeVerdict,
  EngineWorkflowDryRun,
} from "../engine/engine.contract";
import type { DryRunIssue } from "./dry-run.repository";
import type { PublishFinding } from "./publish.gate";

/** What `POST /api/v1/workflows/{id}/dry-run` answers. */
export interface WorkflowDryRunResource {
  /** The ticket the walk was for, as it was sent. */
  readonly ticket: EngineDryRunTicket;
  /** The definition's errors — non-empty means nothing was walked. Node-anchored, like publish's. */
  readonly findings: readonly PublishFinding[];
  /** The ordered walk. */
  readonly steps: readonly EngineDryRunStep[];
  /** One verdict per stage, in document order. */
  readonly verdicts: readonly EngineNodeVerdict[];
  /** Every edge the walk took, in order — what the canvas paints in the accent treatment. */
  readonly highlightPath: readonly EngineEdgeAnchor[];
}

/**
 * The ticket a stored issue makes.
 *
 * `github` always, because an estimate hangs off a mirrored GitHub issue (V026) and nothing else
 * can be sized yet; the other three trackers join when their issues can carry an estimate.
 *
 * @param issue - The issue, as `dry-run.repository.ts` read it.
 * @returns The ticket, keyed `#<number>` as every explanation names it.
 */
export function dryRunTicket(issue: DryRunIssue): EngineDryRunTicket {
  return {
    externalKey: `#${issue.number}`,
    source: "github",
    labels: issue.labels,
    estimate: issue.effort === null ? null : { effort: issue.effort },
  };
}

/**
 * The answer, from the ticket and the engine's walk.
 *
 * @param ticket - The ticket the walk was asked for.
 * @param walk - The engine's answer.
 * @returns The resource.
 */
export function workflowDryRun(
  ticket: EngineDryRunTicket,
  walk: EngineWorkflowDryRun,
): WorkflowDryRunResource {
  return {
    ticket,
    findings: walk.findings.map((finding) => ({ source: "engine", ...finding })),
    steps: walk.steps,
    verdicts: walk.verdicts,
    highlightPath: walk.highlightPath,
  };
}

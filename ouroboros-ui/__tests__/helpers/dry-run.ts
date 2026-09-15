import type { WorkflowDryRunResult } from "@/app/api/workflows";
import type { TicketOption } from "@/app/workflows/dry-run";

import { MOCKUP_ACTIVE_PATH } from "./workflows";

/**
 * The dry run's fixtures (#152) — the seeded `#485` as the picker offers it, and a walk of the seeded
 * `standard-fix` for it, in the words the engine's documented example uses
 * (`ouroboros-engine/openapi.yaml`, `POST /v0/workflows/dry-run`).
 *
 * The walk is cut down to the three stages the sheet has something different to say about: the trigger
 * that fires, the decision with **both of its branches** — the one taken and the one not — and the gate
 * whose loop back to implement is reported with its retry bound and an assumed predicate. The path is
 * mockup 04's four accent edges, which is what the canvas is asked to paint.
 */

/** The seeded `#485`'s `github_issues.id`. */
export const ISSUE_485 = "5eed0018-0000-4000-8000-000000000485";

/**
 * The picker's options for the seeded workspace: two sized issues, `#485` second, so opening on it is a
 * decision rather than the list's first entry.
 *
 * @returns The options.
 */
export function dryRunTickets(): TicketOption[] {
  return [
    { id: "5eed0018-0000-4000-8000-000000000483", number: 483, title: "OTA update stalls at 99%", effort: "s" },
    { id: ISSUE_485, number: 485, title: "Watchdog reset on I²C bus lockup", effort: "m" },
  ];
}

/** The engine's explanation for the decision's branch that is taken. */
export const TAKEN_EXPLANATION = "Taken: #485 is effort M, and M ≤ M.";

/** …and for the branch that is not. */
export const NOT_TAKEN_EXPLANATION = "Not taken: #485 is effort M, and M is not > M.";

/** The gate's assumed predicate. */
export const ASSUMED_EXPLANATION = "A dry run has no check results, so it assumes every check passes.";

/**
 * The walk of the seeded `standard-fix` for `#485`.
 *
 * @returns A fresh result.
 */
export function dryRunWalk(): WorkflowDryRunResult {
  return {
    ticket: { externalKey: "#485", source: "github", labels: ["bug", "i2c"], estimate: { effort: "m" } },
    findings: [],
    steps: [
      {
        nodeId: "issue-queued",
        type: "trigger",
        title: "Issue queued",
        verdict: "matched",
        annotation: "Starts a run when a ticket is queued with effort ≤ M.",
        evaluation: { holds: true, assumed: false, explanation: "The trigger fires for #485: #485 is effort M, and M ≤ M." },
        edges: [
          {
            from: "issue-queued",
            to: "analyze",
            kind: "default",
            label: null,
            outcome: "taken",
            explanation: "Taken: a default edge is always followed.",
            evaluation: null,
            maxRetries: null,
          },
        ],
      },
      {
        nodeId: "effort-recheck",
        type: "flow",
        title: "Effort re-check",
        verdict: "reached",
        annotation: "A decision on: effort ≤ M. Every branch out of it is reported, taken or not.",
        evaluation: { holds: true, assumed: false, explanation: "#485 is effort M, and M ≤ M." },
        edges: [
          {
            from: "effort-recheck",
            to: "plan",
            kind: "branch",
            label: "≤ M ↓",
            outcome: "taken",
            explanation: TAKEN_EXPLANATION,
            evaluation: { holds: true, assumed: false, explanation: "#485 is effort M, and M ≤ M." },
            maxRetries: null,
          },
          {
            from: "effort-recheck",
            to: "split",
            kind: "branch",
            label: "> M ↘",
            outcome: "not_taken",
            explanation: NOT_TAKEN_EXPLANATION,
            evaluation: { holds: false, assumed: false, explanation: "#485 is effort M, and M is not > M." },
            maxRetries: null,
          },
        ],
      },
      {
        nodeId: "checks-green",
        type: "flow",
        title: "Checks green?",
        verdict: "reached",
        annotation: "A gate. Requires: every check passing.",
        evaluation: { holds: true, assumed: true, explanation: ASSUMED_EXPLANATION },
        edges: [
          {
            from: "checks-green",
            to: "implement",
            kind: "loop",
            label: "fail ↺",
            outcome: "loop",
            explanation: "A loop back to implement, reported and never walked.",
            evaluation: null,
            maxRetries: 2,
          },
        ],
      },
    ],
    verdicts: [],
    highlightPath: [...MOCKUP_ACTIVE_PATH],
  };
}

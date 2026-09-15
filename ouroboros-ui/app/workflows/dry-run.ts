/**
 * The dry run, decided — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * Mockup 04's **Dry run with issue #485** asks the engine's simulator (R.2,
 * [#144](https://github.com/NobuData/ouroboros/issues/144)) to walk the stored draft for one sized
 * issue, and brings the answer onto the canvas: the path it took in the accent treatment, and a side
 * sheet listing every stage it reached with **both branches of every decision** — the road taken and
 * the road not, each with the simulator's own reason — and the retry bound of every loop.
 *
 * Every explanation is the engine's sentence, printed as it arrives. What is decided here is only what
 * the reader is offered (sized, open issues, `#485` first when the workspace has it), how a verdict
 * and an outcome are named, and what a loop's bound says.
 *
 * **Framework-free and pure**, like `view.ts`. The types it names are erased imports.
 */

import type { BacklogRow } from "@/app/api/backlog";
import type { ErrorEnvelope } from "@/app/api/errors";
import type {
  WorkflowDryRunEdge,
  WorkflowDryRunResult,
  WorkflowDryRunStep,
  WorkflowDryRunTicket,
  WorkflowEdgeRef,
} from "@/app/api/workflows";
import type { ChipTone } from "@/app/ui";

/* ------------------------------------------------------------------ the picker */

/**
 * The issue the picker opens on when the workspace has it — mockup 03's `#485`, which the development
 * seed sizes at M and the engine's own documented example walks.
 */
export const SEEDED_TICKET_NUMBER = 485;

/** How many backlog rows the picker reads — the contract's ceiling for one page. */
export const TICKET_LIMIT = 100;

/** One issue the picker offers. */
export interface TicketOption {
  /** `github_issues.id` — what the dry run is asked about. */
  readonly id: string;
  /** The GitHub number, `485`. */
  readonly number: number;
  /** The issue's title. */
  readonly title: string;
  /** The effort of its estimate in force, `m`. */
  readonly effort: string;
}

/**
 * The issues a dry run can be asked about: open, and sized.
 *
 * Sized, because the ticket's own criterion is *a seeded sized ticket*, and because an unsized ticket
 * satisfies no effort comparison — the walk of one ends at the trigger of every workflow that has an
 * effort bound, which is a true answer to a question nobody meant to ask.
 *
 * @param rows A backlog page, as the service listed it.
 * @returns The options, in the listing's order.
 */
export function ticketOptions(rows: readonly BacklogRow[]): readonly TicketOption[] {
  return rows.flatMap((row): TicketOption[] =>
    row.state === "open" && row.sizingStatus === "sized" && row.estimate !== null
      ? [{ id: row.id, number: row.number, title: row.title, effort: row.estimate.effort }]
      : [],
  );
}

/**
 * The option the picker opens on.
 *
 * @param options What the picker offers.
 * @returns `#485` when it is offered, the first option otherwise, or `null` when there is none.
 */
export function defaultTicket(options: readonly TicketOption[]): TicketOption | null {
  return options.find((option) => option.number === SEEDED_TICKET_NUMBER) ?? options[0] ?? null;
}

/**
 * How an option reads in the picker.
 *
 * @param option The issue.
 * @returns *#485 · Watchdog reset on I²C bus lockup · effort M*.
 */
export function ticketLabel(option: TicketOption): string {
  return `#${option.number} · ${option.title} · effort ${option.effort.toUpperCase()}`;
}

/** The picker dialog's title. */
export const DRY_RUN_DIALOG_TITLE = "Dry run";

/** What the dialog says a dry run is, under its title. */
export const DRY_RUN_DIALOG_NOTE =
  "Pick a sized issue. The stored draft is walked for it — no model is called, nothing runs, and " +
  "nothing is recorded.";

/** The picker's label. */
export const TICKET_LABEL = "Issue";

/** …and its hint. */
export const TICKET_HINT = "Open, sized issues from this workspace's backlog.";

/** What the dialog says while the backlog is read. */
export const LOADING_TICKETS = "Reading the backlog…";

/** What the dialog says when nothing is sized. */
export const NO_SIZED_TICKETS =
  "No open issue in this workspace is sized yet, so there is nothing to walk. Estimate one from the backlog first.";

/** The dialog's primary action. */
export const RUN_LABEL = "Run dry run";

/** What the dialog says while the walk is asked for. */
export const RUNNING = "Walking the draft…";

/** The dialog's cancel. */
export const DRY_RUN_CANCEL = "Cancel";

/**
 * What the dialog says when the backlog could not be read.
 *
 * @param refusal The service's envelope.
 * @returns The sentence.
 */
export function ticketsFailure(refusal: ErrorEnvelope): string {
  return `The backlog could not be read, so there is no issue to pick — ${refusal.message}`;
}

/** What a dry run refused because the draft changed elsewhere says. */
export const DRY_RUN_CONFLICT_MESSAGE =
  "This draft changed somewhere else, so a dry run would walk a draft you are not looking at. Reload it first.";

/** What a dry run that could not start — the latest edit unsaved — says. */
export const DRY_RUN_UNSAVED_MESSAGE =
  "The latest edit could not be saved, so a dry run would walk an older draft. Try again once it saves.";

/**
 * What a refused dry run tells the reader.
 *
 * @param refusal The service's envelope.
 * @returns The sentence.
 */
export function dryRunFailure(refusal: ErrorEnvelope): string {
  switch (refusal.code) {
    case "workflow_dry_run_issue_not_found":
      return "That issue is no longer in this workspace's backlog. Pick another.";
    case "workflow_draft_absent":
      return "This workflow has neither a draft nor a published version, so there is nothing to walk.";
    case "engine_unavailable":
      return "The engine could not walk this draft. Try again in a moment.";
    default:
      return refusal.message;
  }
}

/* ------------------------------------------------------------------ the overlay */

/**
 * The path the canvas paints for a dry run.
 *
 * @param result The walk.
 * @returns Every edge the walk took, or `null` for a definition that did not validate — nothing was
 *   walked, and an empty accent path would say the opposite of the findings beside it.
 */
export function highlightOf(result: WorkflowDryRunResult): readonly WorkflowEdgeRef[] | null {
  return result.findings.length > 0 ? null : result.highlightPath;
}

/* ------------------------------------------------------------------ the side sheet */

/** The sheet's eyebrow. */
export const DRY_RUN_EYEBROW = "Dry run";

/**
 * The sheet's title — the mockup's action, for the ticket that was walked.
 *
 * @param externalKey The ticket's key, `#485`.
 * @returns *Dry run with issue #485*.
 */
export function dryRunTitle(externalKey: string): string {
  return `Dry run with issue ${externalKey}`;
}

/** The sheet's close. */
export const CLOSE_DRY_RUN = "Close dry run";

/** The step list's accessible name. */
export const STEPS_LABEL = "Stages the walk reached";

/** What the sheet says for a draft the engine would not walk. */
export const DRY_RUN_FINDINGS_MESSAGE =
  "This draft does not validate, so nothing was walked. Select a finding to go to the stage it is about.";

/** The sheet's last line: why the overlay will go away. */
export const CLEARS_NOTE = "This walk describes the draft as it was. Edit the graph and it clears.";

/** What a predicate the simulator could only assume says beside its explanation. */
export const ASSUMED_NOTE = "(assumed — a dry run has no check results)";

/** How each tracker is named. */
const SOURCE_WORDS: Readonly<Record<WorkflowDryRunTicket["source"], string>> = {
  github: "GitHub",
  gitlab: "GitLab",
  jira: "Jira",
  linear: "Linear",
};

/**
 * The facts the walk tested, under the sheet's title.
 *
 * @param ticket The ticket, as the service echoed it.
 * @returns *effort M · labels bug, i2c · GitHub*.
 */
export function ticketFacts(ticket: WorkflowDryRunTicket): string {
  const effort = ticket.estimate === null ? "unsized" : `effort ${ticket.estimate.effort.toUpperCase()}`;
  const labels = ticket.labels.length === 0 ? "no labels" : `labels ${ticket.labels.join(", ")}`;

  return [effort, labels, SOURCE_WORDS[ticket.source]].join(" · ");
}

/** How each step's verdict is named. */
export const VERDICT_WORDS: Readonly<Record<WorkflowDryRunStep["verdict"], string>> = {
  matched: "Trigger fires",
  not_matched: "Trigger does not fire",
  reached: "Reached",
  halted: "Halts here",
  ended: "Ends here",
};

/** The chip each verdict is drawn in: a fired trigger and an end are ok, a halt is err. */
export const VERDICT_TONES: Readonly<Record<WorkflowDryRunStep["verdict"], ChipTone>> = {
  matched: "ok",
  not_matched: "warn",
  reached: "accent",
  halted: "err",
  ended: "ok",
};

/** How each edge's outcome is named. */
export const OUTCOME_WORDS: Readonly<Record<WorkflowDryRunEdge["outcome"], string>> = {
  taken: "Taken",
  not_taken: "Not taken",
  loop: "Loop",
};

/** The class modifier each outcome is drawn with — kebab-case, so the sheet's BEM stays one spelling. */
export const OUTCOME_CLASS: Readonly<Record<WorkflowDryRunEdge["outcome"], string>> = {
  taken: "taken",
  not_taken: "skipped",
  loop: "loop",
};

/**
 * Where an edge goes, as the sheet names it.
 *
 * @param edge The edge.
 * @param titleOf A stage's title by its id.
 * @returns *→ Plan (≤ M ↓)*, or *→ Plan* for an edge with no label.
 */
export function edgeTarget(edge: WorkflowDryRunEdge, titleOf: (id: string) => string): string {
  return `→ ${titleOf(edge.to)}${edge.label === null ? "" : ` (${edge.label})`}`;
}

/**
 * What a loop's retry bound says — the ticket's *loop-bound notes*.
 *
 * @param maxRetries The bound of the model stage the loop returns to, or `null` when it declares none.
 * @returns The note.
 */
export function loopNote(maxRetries: number | null): string {
  if (maxRetries === null) {
    return "The stage this loop returns to declares no retry bound, so a run could repeat it until its budget ends.";
  }

  return `Loops back at most ${maxRetries} ${maxRetries === 1 ? "time" : "times"} — the retry bound of the stage it returns to. Reported, never walked.`;
}

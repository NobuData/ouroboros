/**
 * Every decision the epic editor sheet makes, and every sentence it says
 * (AM.4, [#286](https://github.com/NobuData/ouroboros/issues/286)).
 *
 * The sheet opens when a bar is clicked — name, tint, status, month range, the lane's linked tickets
 * and where it is mirrored — and from **Add epic**, where it creates a lane at the bottom of the
 * roadmap under the roadmap's own head. That second door is the head action's destination AM.1
 * ([#283](https://github.com/NobuData/ouroboros/issues/283)) named: **New roadmap** names a roadmap,
 * and every lane after its first is added here.
 *
 * **Framework-free and pure**, like `app/planning/create.ts`, whose name and range rules this reuses
 * rather than restates. The sheet is `app/planning/epic-editor.tsx`; its server hops are
 * `app/planning/gantt-actions.ts`.
 *
 * ### A save sends what changed, and nothing else
 *
 * The contract's `PATCH` leaves an absent field alone, so {@link patchBody} sends only the fields the
 * reader changed. Saving an untouched sheet sends nothing — and so cannot overwrite a drag another
 * admin made while it was open.
 *
 * ### Ticket links are writes of their own
 *
 * Linking and unlinking are separate endpoints that answer the lane with its chip recomputed, so they
 * act at once rather than waiting for **Save** — a link is not a draft field the reader could cancel.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
// Types only: `app/api/planning.ts` is server-only, and this module is imported by the sheet.
import type {
  PlanningEpic,
  PlanningEpicCreate,
  PlanningEpicMirror,
  PlanningEpicPatch,
  PlanningRoadmap,
  PlanningTicket,
} from "@/app/api/planning";

import {
  EPIC_MONTH_RANGE_INVALID_CODE,
  FORBIDDEN_CODE,
  type NameProblem,
  RANGE_BACKWARDS,
  type RangeProblem,
  VALIDATION_FAILED_CODE,
  nameProblem,
  rangeProblem,
} from "./create";
import { READ_ONLY_STEP_REASON } from "./gantt";

/* ------------------------------------------------------------------ the form */

/** A lane's tint, as the contract names it. */
export type EpicTint = PlanningEpic["tint"];

/** A lane's status, as the contract names it. */
export type EpicStatus = PlanningEpic["status"];

/** The tint options, in the mockup's lane order, with what each is called. */
export const TINT_OPTIONS: readonly { readonly value: EpicTint; readonly label: string }[] = [
  { value: "accent", label: "Accent" },
  { value: "model", label: "Violet" },
  { value: "warn", label: "Amber" },
  { value: "ok", label: "Green" },
  { value: "neutral", label: "Neutral (dashed)" },
];

/** The status options, with what each is called. */
export const STATUS_OPTIONS: readonly { readonly value: EpicStatus; readonly label: string }[] = [
  { value: "active", label: "Active" },
  { value: "proposed", label: "Proposed" },
  { value: "done", label: "Done" },
  { value: "unscoped", label: "Unscoped" },
];

/** What the sheet's form holds, as typed. */
export interface EpicDraft {
  /** The lane's name. Required. */
  readonly name: string;
  readonly tint: EpicTint;
  readonly status: EpicStatus;
  /** `YYYY-MM`, or `""`. */
  readonly startMonth: string;
  /** `YYYY-MM`, or `""`. */
  readonly endMonth: string;
}

/**
 * The form the sheet opens on.
 *
 * @param epic The lane clicked, or `null` for **Add epic** — which opens active and neutral, the
 *   service's own defaults for a lane nobody has decided about yet.
 * @returns The opening values.
 */
export function openingEpicDraft(epic: PlanningEpic | null): EpicDraft {
  if (epic === null) {
    return { name: "", tint: "neutral", status: "active", startMonth: "", endMonth: "" };
  }

  return {
    name: epic.name,
    tint: epic.tint,
    status: epic.status,
    startMonth: epic.startMonth ?? "",
    endMonth: epic.endMonth ?? "",
  };
}

/** Everything wrong with a draft. */
export interface EpicDraftProblems {
  readonly name: NameProblem;
  readonly range: RangeProblem;
}

/**
 * Every problem a draft has — `create.ts`'s rules, since a lane is the same row either way.
 *
 * @param draft The form.
 * @returns One entry per rule.
 */
export function epicDraftProblems(draft: EpicDraft): EpicDraftProblems {
  return { name: nameProblem(draft.name), range: rangeProblem(draft.startMonth, draft.endMonth) };
}

/** Why **Save** is inert while the lane has no usable name. */
export const NEEDS_NAME = "Name the epic.";

/** Why **Save** is inert while the months are not a forwards pair. */
export const NEEDS_MONTHS = "Give both months, the last on or after the first — or neither.";

/** Why **Save** is inert when nothing was changed. */
export const NOTHING_CHANGED = "Nothing has changed.";

/**
 * The body a lane edit sends — only what changed.
 *
 * @param epic The lane as the sheet opened on it.
 * @param draft The form.
 * @returns The fields that differ; `{}` when none do. Months are sent as a pair, `null` for none.
 */
export function patchBody(epic: PlanningEpic, draft: EpicDraft): PlanningEpicPatch {
  const body: PlanningEpicPatch = {};
  const name = draft.name.trim();
  const startMonth = draft.startMonth === "" ? null : draft.startMonth;
  const endMonth = draft.endMonth === "" ? null : draft.endMonth;

  if (name !== epic.name) body.name = name;
  if (draft.tint !== epic.tint) body.tint = draft.tint;
  if (draft.status !== epic.status) body.status = draft.status;

  // A pair: the service validates the merged range, so both ends travel whenever either moved.
  if (startMonth !== epic.startMonth || endMonth !== epic.endMonth) {
    body.startMonth = startMonth;
    body.endMonth = endMonth;
  }

  return body;
}

/**
 * The body **Add epic** sends — the lane under the roadmap's own head.
 *
 * @param draft The form.
 * @param roadmap The roadmap the lane joins; its name and window are carried so the lane belongs to it.
 * @returns The body.
 */
export function createLaneBody(draft: EpicDraft, roadmap: Pick<PlanningRoadmap, "name" | "window">): PlanningEpicCreate {
  return {
    name: draft.name.trim(),
    tint: draft.tint,
    status: draft.status,
    startMonth: draft.startMonth === "" ? null : draft.startMonth,
    endMonth: draft.endMonth === "" ? null : draft.endMonth,
    roadmapName: roadmap.name,
    roadmapWindow: roadmap.window,
  };
}

/**
 * Why **Save** cannot act yet, if it cannot.
 *
 * @param problems What {@link epicDraftProblems} found.
 * @param changes The body a save would send, or `null` in create mode, where there is always something
 *   to send.
 * @param mayEdit Whether this reader may change the roadmap.
 * @returns The sentence, or `undefined` when ready.
 */
export function saveReason(
  problems: EpicDraftProblems,
  changes: PlanningEpicPatch | null,
  mayEdit: boolean,
): string | undefined {
  if (!mayEdit) return READ_ONLY_STEP_REASON;
  if (problems.name !== null) return NEEDS_NAME;
  if (problems.range !== null) return NEEDS_MONTHS;
  if (changes !== null && Object.keys(changes).length === 0) return NOTHING_CHANGED;

  return undefined;
}

/* ------------------------------------------------------------------ what a refusal says */

/** What the sheet draws for a refused write: one sentence, and whether it is about the months. */
export interface EditorFailure {
  readonly message: string;
  /** The line under the months, when the refusal was about them. */
  readonly range?: string;
}

/**
 * A refusal, as the sheet draws it.
 *
 * @param refusal The service's envelope.
 * @param nothingSaved The clause the sentence ends on — what did not happen.
 * @returns What to draw.
 */
export function editorFailure(refusal: ErrorEnvelope, nothingSaved: string): EditorFailure {
  switch (refusal.code) {
    case FORBIDDEN_CODE:
      return { message: `${READ_ONLY_STEP_REASON} ${nothingSaved}` };
    case EPIC_MONTH_RANGE_INVALID_CODE:
      return { message: `The months are not a forwards pair. ${nothingSaved}`, range: RANGE_BACKWARDS };
    case VALIDATION_FAILED_CODE:
      return { message: `That could not be saved as it stands. ${nothingSaved}` };
    case "planning_epic_not_found":
      return { message: `This epic no longer exists. ${nothingSaved}` };
    case "planning_tickets_not_found":
      return { message: `That ticket is no longer in this workspace. ${nothingSaved}` };
    default:
      return { message: `${nothingSaved} ${refusal.message}` };
  }
}

/** The clause a refused save ends on. */
export const NOTHING_SAVED = "Nothing was saved.";

/** The clause a refused create ends on. */
export const NOTHING_ADDED = "No epic was added.";

/** The clause a refused link or unlink ends on. */
export const LINKS_UNCHANGED = "The links are unchanged.";

/* ------------------------------------------------------------------ tickets and mirrors */

/**
 * The link picker's matches, without the tickets the lane already has.
 *
 * @param found What the search answered.
 * @param linked What the lane links now.
 * @returns The candidates, in the search's order.
 */
export function linkCandidates(
  found: readonly PlanningTicket[],
  linked: readonly PlanningTicket[],
): PlanningTicket[] {
  const have = new Set(linked.map((ticket) => ticket.id));

  return found.filter((ticket) => !have.has(ticket.id));
}

/** The contract's ceiling on a search term. */
export const MAX_SEARCH_LENGTH = 200;

/** How long the picker waits after the last keystroke before it searches. */
export const SEARCH_DEBOUNCE_MS = 250;

/** What each mirror kind is called. */
export const MIRROR_KIND_LABEL: Record<PlanningEpicMirror["kind"], string> = {
  milestone: "milestone",
  parent_issue: "parent issue",
  jira_epic: "Jira epic",
};

/**
 * One mirror, as a line.
 *
 * @param mirror The mirror.
 * @returns `GitHub · acme-robotics — parent issue #612`.
 */
export function mirrorLine(mirror: PlanningEpicMirror): string {
  return `${mirror.sourceName} — ${MIRROR_KIND_LABEL[mirror.kind]} ${mirror.externalRef}`;
}

/**
 * The tickets heading, with the chip's count.
 *
 * @param tickets The linked tickets.
 * @returns `Linked tickets · 3 · 1 done`.
 */
export function ticketsHeading(tickets: readonly PlanningTicket[]): string {
  const done = tickets.filter((ticket) => ticket.state === "closed").length;

  return `${TICKETS_HEADING} · ${String(tickets.length)} · ${String(done)} done`;
}

/* ------------------------------------------------------------------ what the sheet says */

/** The heading for an existing lane. */
export const EDIT_TITLE = "Edit epic";

/** The heading for **Add epic**. */
export const ADD_TITLE = "Add epic";

/** The note under the heading when adding. */
export const ADD_NOTE =
  "A lane at the bottom of the roadmap. Leave both months empty for an unscoped epic — it draws dashed.";

/** The note under the heading when a reader may only look. */
export const READ_ONLY_NOTE = `You can read this epic. ${READ_ONLY_STEP_REASON}`;

/** The name field's label. */
export const NAME_LABEL = "Name";
/** The tint select's label. */
export const TINT_LABEL = "Tint";
/** The status select's label. */
export const STATUS_LABEL = "Status";
/** The first month's label. */
export const START_LABEL = "First month";
/** The last month's label. */
export const END_LABEL = "Last month";
/** The hint under the months. */
export const MONTHS_HINT = "leave both empty for an unscoped epic";
/** The edit form's submit. */
export const SAVE_LABEL = "Save";
/** The add form's submit. */
export const ADD_LABEL = "Add epic";
/** The way out. */
export const CLOSE_LABEL = "Close";
/** What a save in flight says. */
export const SAVING = "Saving…";
/** What an add in flight says. */
export const ADDING = "Adding the epic…";

/** The tickets section's heading. */
export const TICKETS_HEADING = "Linked tickets";

/** What the tickets section says while the lane's links are read. */
export const TICKETS_LOADING = "Reading the linked tickets…";

/** What it says when the lane links nothing. */
export const TICKETS_NONE = "No tickets are linked. The chip counts only linked tickets.";

/** What it says when the read was refused. */
export const TICKETS_UNREAD = "The linked tickets could not be read.";

/** What it says in create mode. */
export const TICKETS_AFTER_ADD = "Link tickets once the epic exists.";

/** An unlink button's visible text. */
export const UNLINK_LABEL = "Unlink";
/** A link button's visible text. */
export const LINK_LABEL = "Link";
/** The link picker's label. */
export const SEARCH_LABEL = "Find a ticket to link";
/** The link picker's hint. */
export const SEARCH_HINT = "title or key — e.g. #548";
/** What the picker says when nothing unlinked matches. */
export const SEARCH_NONE = "No unlinked tickets match.";
/** What the picker says while a search is in flight. */
export const SEARCHING = "Searching…";

/** What each synced ticket state is called. */
export const TICKET_STATE_LABEL: Record<PlanningTicket["state"], string> = {
  open: "open",
  closed: "done",
};

/** The mirrors section's heading. */
export const MIRRORS_HEADING = "Tracker mirrors";

/** What it says when a lane has not been pushed anywhere. */
export const MIRRORS_NONE = "Not mirrored yet — pushing a batch filed under this epic creates one.";

/**
 * An unlink button's accessible name.
 *
 * @param ticket The ticket.
 * @returns `Unlink #548`.
 */
export function unlinkLabel(ticket: PlanningTicket): string {
  return `${UNLINK_LABEL} ${ticket.externalKey}`;
}

/**
 * A link button's accessible name.
 *
 * @param ticket The ticket.
 * @returns `Link #548`.
 */
export function linkLabel(ticket: PlanningTicket): string {
  return `${LINK_LABEL} ${ticket.externalKey}`;
}

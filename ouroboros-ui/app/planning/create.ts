/**
 * Every decision the **New roadmap** dialog makes, and every sentence it says
 * (AM.1, [#283](https://github.com/NobuData/ouroboros/issues/283)).
 *
 * **Framework-free and pure**, like `app/planning/view.ts` beside it. The dialog is
 * `app/planning/new-roadmap.tsx` and its server hop is `app/planning/create-actions.ts`.
 *
 * ---------------------------------------------------------------------------
 * ### A new roadmap is its first epic, named
 *
 * AK.3 ([#274](https://github.com/NobuData/ouroboros/issues/274)) stores the roadmap's name and
 * window **on each lane**, and the roadmap head is the top named lane's. There is nothing else to
 * create, so the dialog asks for exactly what that one write needs: the roadmap's name, its
 * optional window (`Q3–Q4 2026`), and its first epic — a name and, optionally, a month range. This
 * is the head action's destination until the gantt's epic editor (AM.4,
 * [#286](https://github.com/NobuData/ouroboros/issues/286)) takes the flow over.
 *
 * ### Months are a pair, and an epic with neither is unscoped
 *
 * The service's rule, restated so the submit is refused before a round trip: both months or
 * neither, and the range runs forwards. An epic created with no range is sent as `unscoped` — the
 * dashed lane — rather than as an `active` bar with no months to draw it across.
 *
 * ### One write, so nothing is half-created
 *
 * A refusal leaves every value where the reader left it, and the sentence under the form says
 * nothing was created — which is true, because there is only one `POST`.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
// Types only: `app/api/planning.ts` is server-only, and this module is imported by the dialog.
import type { PlanningEpicCreate, PlanningRoadmap } from "@/app/api/planning";

import { NEW_ROADMAP_ROLE_REASON } from "./view";

/* ------------------------------------------------------------------ the form */

/** The contract's ceiling on a roadmap's name and an epic's name. */
export const MAX_NAME_LENGTH = 200;

/** The contract's ceiling on a roadmap window. */
export const MAX_WINDOW_LENGTH = 64;

/** How a month travels — `YYYY-MM`, the contract's pattern. */
export const MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** What the dialog holds: five boxes, as typed. */
export interface RoadmapDraft {
  /** The roadmap's name — `Helios 2.1`. Required. */
  readonly roadmapName: string;
  /** The roadmap's window — `Q3–Q4 2026`. Optional. */
  readonly roadmapWindow: string;
  /** The first epic's name — `OTA hardening`. Required. */
  readonly epicName: string;
  /** The first epic's first month, `YYYY-MM`, or `""`. */
  readonly startMonth: string;
  /** The first epic's last month, `YYYY-MM`, or `""`. */
  readonly endMonth: string;
}

/**
 * The form a dialog opens on.
 *
 * A workspace plans under **one** roadmap head — the top named lane's — so when one already exists
 * its name and window are filled in: a different name typed here would be stored on a lane at the
 * bottom and never become the head, which would read as a create that did nothing.
 *
 * @param roadmap The roadmap the page read, or `null` when it could not be read.
 * @returns The opening values.
 */
export function openingDraft(roadmap: PlanningRoadmap | null): RoadmapDraft {
  return {
    roadmapName: roadmap?.name ?? "",
    roadmapWindow: roadmap?.window ?? "",
    epicName: "",
    startMonth: "",
    endMonth: "",
  };
}

/** What is wrong with a required name box. */
export type NameProblem = "empty" | "long" | null;

/** What is wrong with the optional window box. */
export type WindowProblem = "long" | null;

/** What is wrong with the month pair. */
export type RangeProblem =
  /** One month and not the other. */
  | "half"
  /** A value that is not `YYYY-MM`. */
  | "shape"
  /** The last month is before the first. */
  | "backwards"
  /** Both empty, or both set and forwards. */
  | null;

/** Everything wrong with a draft, per box. */
export interface DraftProblems {
  readonly roadmapName: NameProblem;
  readonly roadmapWindow: WindowProblem;
  readonly epicName: NameProblem;
  readonly range: RangeProblem;
}

/**
 * What is wrong with a required name.
 *
 * @param value What is in the box. This trims.
 * @returns The problem, or `null`.
 */
export function nameProblem(value: string): NameProblem {
  const trimmed = value.trim();

  if (trimmed === "") return "empty";
  if (trimmed.length > MAX_NAME_LENGTH) return "long";

  return null;
}

/**
 * What is wrong with the window. Empty is fine — the window is optional.
 *
 * @param value What is in the box. This trims.
 * @returns The problem, or `null`.
 */
export function windowProblem(value: string): WindowProblem {
  return value.trim().length > MAX_WINDOW_LENGTH ? "long" : null;
}

/**
 * What is wrong with a month range.
 *
 * `YYYY-MM` strings order the way the months do, so the comparison is a string comparison.
 *
 * @param start The first month, or `""`.
 * @param end The last month, or `""`.
 * @returns The problem, or `null`.
 */
export function rangeProblem(start: string, end: string): RangeProblem {
  if (start === "" && end === "") return null;
  if (start === "" || end === "") return "half";
  if (!MONTH_PATTERN.test(start) || !MONTH_PATTERN.test(end)) return "shape";
  if (end < start) return "backwards";

  return null;
}

/**
 * Every problem a draft has.
 *
 * @param draft The form.
 * @returns One entry per box.
 */
export function draftProblems(draft: RoadmapDraft): DraftProblems {
  return {
    roadmapName: nameProblem(draft.roadmapName),
    roadmapWindow: windowProblem(draft.roadmapWindow),
    epicName: nameProblem(draft.epicName),
    range: rangeProblem(draft.startMonth, draft.endMonth),
  };
}

/** Why the submit is inert while the roadmap has no usable name. */
export const NEEDS_ROADMAP_NAME = "Name the roadmap first.";

/** Why the submit is inert while the window is too long. */
export const NEEDS_SHORT_WINDOW = `Keep the window to ${MAX_WINDOW_LENGTH} characters.`;

/** Why the submit is inert while the epic has no usable name. */
export const NEEDS_EPIC_NAME = "Name its first epic.";

/** Why the submit is inert while the months are not a forwards pair. */
export const NEEDS_RANGE = "Give both months, the last on or after the first — or neither.";

/**
 * Why the submit cannot act yet, if it cannot.
 *
 * @param problems What {@link draftProblems} found.
 * @returns The first sentence that applies, top of the form first, or `undefined` when ready.
 */
export function submitReason(problems: DraftProblems): string | undefined {
  if (problems.roadmapName !== null) return NEEDS_ROADMAP_NAME;
  if (problems.roadmapWindow !== null) return NEEDS_SHORT_WINDOW;
  if (problems.epicName !== null) return NEEDS_EPIC_NAME;
  if (problems.range !== null) return NEEDS_RANGE;

  return undefined;
}

/** What a name that is too long is told, under its box. */
export const NAME_TOO_LONG = `Keep it to ${MAX_NAME_LENGTH} characters.`;

/**
 * The line a required name box draws, if any. An empty box draws nothing: the submit's reason
 * already says what is missing, and a form that shouts before anything was typed is noise.
 *
 * @param problem What {@link nameProblem} found.
 * @returns The sentence, or `undefined`.
 */
export function nameError(problem: NameProblem): string | undefined {
  return problem === "long" ? NAME_TOO_LONG : undefined;
}

/** What a backwards range is told, under the last month. */
export const RANGE_BACKWARDS = "The last month is before the first.";

/** What half a range is told, under the months. */
export const RANGE_HALF = "Give both months, or neither for an unscoped epic.";

/**
 * The line the month pair draws, if any.
 *
 * @param problem What {@link rangeProblem} found.
 * @returns The sentence, or `undefined`.
 */
export function rangeError(problem: RangeProblem): string | undefined {
  if (problem === "backwards") return RANGE_BACKWARDS;
  if (problem === "half" || problem === "shape") return RANGE_HALF;

  return undefined;
}

/**
 * The request body for a draft that {@link submitReason} passed.
 *
 * Trimmed; an empty window is left out rather than sent as `""`, which the contract refuses; no
 * range sends both months as `null` with status `unscoped`, and a range leaves status to the
 * service's `active` default.
 *
 * @param draft The form.
 * @returns The body.
 */
export function createBody(draft: RoadmapDraft): PlanningEpicCreate {
  const window = draft.roadmapWindow.trim();
  const scoped = draft.startMonth !== "" && draft.endMonth !== "";

  return {
    name: draft.epicName.trim(),
    roadmapName: draft.roadmapName.trim(),
    ...(window === "" ? {} : { roadmapWindow: window }),
    ...(scoped
      ? { startMonth: draft.startMonth, endMonth: draft.endMonth }
      : { startMonth: null, endMonth: null, status: "unscoped" as const }),
  };
}

/* ------------------------------------------------------------------ what a refusal says */

/** What the dialog draws for a refused create: one sentence, and the box it is about. */
export interface CreateFailure {
  /** The sentence under the form. */
  readonly message: string;
  /** What is wrong with the months, if the refusal was about them. */
  readonly range?: string;
}

/** The `code` for a role that may read planning and not change it. */
export const FORBIDDEN_CODE = "forbidden";

/** The `code` the service answers a half or backwards month range with. */
export const EPIC_MONTH_RANGE_INVALID_CODE = "epic_month_range_invalid";

/** The `code` for a body whose own shape is wrong. */
export const VALIDATION_FAILED_CODE = "validation_failed";

/** The clause every refusal ends on, because it is the fact a reader most needs. */
export const NOTHING_CREATED = "Nothing was created.";

/** What a member who reached the write anyway is told. */
export const CREATE_READ_ONLY = `${NEW_ROADMAP_ROLE_REASON} ${NOTHING_CREATED}`;

/** What a refused range is told. */
export const CREATE_RANGE_INVALID = `The months are not a forwards pair. ${NOTHING_CREATED}`;

/** What a body the service found malformed is told. */
export const CREATE_INVALID = `That could not be saved as it stands. ${NOTHING_CREATED}`;

/** What any other refusal is told, with the service's own sentence after it. */
export const CREATE_FAILED = `The roadmap could not be created. ${NOTHING_CREATED}`;

/**
 * The service's refusal, as the dialog draws it.
 *
 * @param refusal The service's envelope, as `create-actions.ts` handed it back.
 * @returns What to draw.
 */
export function createFailure(refusal: ErrorEnvelope): CreateFailure {
  switch (refusal.code) {
    case FORBIDDEN_CODE:
      return { message: CREATE_READ_ONLY };
    case EPIC_MONTH_RANGE_INVALID_CODE:
      return { message: CREATE_RANGE_INVALID, range: RANGE_BACKWARDS };
    case VALIDATION_FAILED_CODE:
      return { message: CREATE_INVALID };
    default:
      // The service's sentence is written for a caller rather than a reader, so it follows the
      // product's line rather than replacing it.
      return { message: `${CREATE_FAILED} ${refusal.message}` };
  }
}

/* ------------------------------------------------------------------ what the dialog says */

/** The dialog's heading, and its accessible name. */
export const CREATE_TITLE = "New roadmap";

/** The note under the heading — what the dialog makes. */
export const CREATE_NOTE =
  "A roadmap is named on its epics: this names it and creates its first epic, which the roadmap " +
  "below then lists.";

/** The extra line when the workspace already has a roadmap head. */
export const EXISTING_ROADMAP_NOTE =
  "This workspace already plans under the name filled in below — the roadmap is headed by its " +
  "top epic, so the new epic joins it at the bottom.";

/** The roadmap name box. */
export const ROADMAP_NAME_LABEL = "Roadmap name";

/** …and its hint. */
export const ROADMAP_NAME_HINT = "e.g. Helios 2.1";

/** The window box. */
export const ROADMAP_WINDOW_LABEL = "Window";

/** …and its hint. */
export const ROADMAP_WINDOW_HINT = "optional · e.g. Q3–Q4 2026";

/** The first epic's name box. */
export const EPIC_NAME_LABEL = "First epic";

/** …and its hint. */
export const EPIC_NAME_HINT = "e.g. OTA hardening";

/** The first month box. */
export const START_MONTH_LABEL = "First month";

/** The last month box. */
export const END_MONTH_LABEL = "Last month";

/** …and the hint the pair carries. */
export const RANGE_HINT = "optional · leave both empty for an unscoped epic";

/** The dialog's primary control. */
export const CREATE_SUBMIT = "Create roadmap";

/** …and what it says while the write is in flight. */
export const CREATING = "Creating the roadmap…";

/** The way out without writing anything. */
export const CREATE_CANCEL = "Cancel";

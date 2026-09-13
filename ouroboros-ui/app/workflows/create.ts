/**
 * Every decision the **+ New workflow** dialog makes, and every sentence it says
 * (S.1, [#147](https://github.com/NobuData/ouroboros/issues/147)).
 *
 * **Framework-free and pure**, like `app/workflows/view.ts` beside it: nothing here imports
 * React, `next/*` or the server-only client. The dialog is `app/workflows/new-workflow.tsx`
 * and its server hop is `app/workflows/create-actions.ts`.
 *
 * ---------------------------------------------------------------------------
 * ### Two fields, because the slug is the one thing that cannot be changed later
 *
 * The contract derives a slug from the name when none is sent, and the dialog could have
 * asked for a name alone. It asks for both because the slug is what a stored
 * `runs.workflow_tag` resolves through and `PATCH` carries no `slug`, deliberately — so the
 * one moment the identifier can be chosen is this dialog, and a dialog that chose it silently
 * would be choosing something permanent on the reader's behalf. The slug **follows the name**
 * as it is typed, by the same rule the service uses ({@link deriveSlug}), until the reader
 * edits it; then it is theirs.
 *
 * ### The uniqueness check is live, and it is not the authority
 *
 * A slug already taken is a designed `409` (`workflow_slug_taken`) and there is no
 * *is-this-free* endpoint. What {@link slugProblem} does instead is check the slug against
 * the rail the reader is already looking at, as they type, so the ordinary collision is
 * caught before a round trip; the service is what decides, and {@link createFailure} puts its
 * refusal back on the same field.
 *
 * ### Nothing is created until the whole body is acceptable
 *
 * One `POST`, one workflow and its draft in one transaction: there is no partial state to
 * report. A refusal leaves the dialog open with every value where the reader left it, the
 * offending field marked, and nothing stored — which is what the sentence under the form says.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import type { CreateWorkflowRequest } from "@/app/api/workflows";

/* ------------------------------------------------------------------ the slug */

/**
 * How a slug may be spelled — `ouroboros-rest`'s rule, restated: lower-case kebab.
 *
 * Restating it here is what makes the refusal immediate; the column's `CHECK` is what makes
 * it true.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** V029's ceiling on a slug, restated for the input's `maxLength`. */
export const MAX_SLUG_LENGTH = 64;

/** V029's ceiling on a name (`workflows_name_present`), restated for the input's `maxLength`. */
export const MAX_NAME_LENGTH = 120;

/**
 * The slug the service would derive from a name — lower-cased, with every run of characters
 * the format does not admit collapsed to a single hyphen, and no hyphen at either end.
 *
 * The same rule as `ouroboros-rest/src/modules/workflows/slug.ts`, restated so the slug box
 * can follow the name box as it is typed rather than waiting for the answer to a request. A
 * name holding no ASCII letter or digit yields `""`, which is the service's own refusal
 * (`workflow_slug_required`) met before the request is made.
 *
 * @param name The name, as typed.
 * @returns The slug, possibly empty.
 */
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** What is wrong with the name in the box, or that nothing is. */
export type NameProblem =
  /** Nothing has been typed yet. Not an error to shout about — the submit is simply not ready. */
  | "empty"
  /** Longer than the column admits. */
  | "long"
  /** Typed, and acceptable. */
  | null;

/**
 * What is wrong with a name, as the reader types it.
 *
 * @param name What is in the box. This trims.
 * @returns The problem, or `null` when there is none.
 */
export function nameProblem(name: string): NameProblem {
  const trimmed = name.trim();

  if (trimmed === "") return "empty";
  if (trimmed.length > MAX_NAME_LENGTH) return "long";

  return null;
}

/** What is wrong with the slug in the box, or that nothing is. */
export type SlugProblem =
  /** Nothing has been typed yet, or the name yields nothing. */
  | "empty"
  /** Typed, and not lower-case kebab — or too long. */
  | "shape"
  /** Typed, well-formed, and already the slug of a workflow on the rail. */
  | "taken"
  /** Typed, well-formed, and free as far as this page can see. */
  | null;

/**
 * What is wrong with a slug, as the reader types it.
 *
 * The order is the judgement: shape before uniqueness, because *that is not a valid slug* and
 * *that slug is taken* are different problems and a malformed slug is not taken by anybody.
 *
 * @param slug What is in the box. This trims.
 * @param existing Every slug this workspace has, as the rail read them.
 * @returns The problem, or `null` when there is none.
 */
export function slugProblem(slug: string, existing: readonly string[]): SlugProblem {
  const trimmed = slug.trim();

  if (trimmed === "") return "empty";
  if (!SLUG_PATTERN.test(trimmed) || trimmed.length > MAX_SLUG_LENGTH) return "shape";

  return existing.includes(trimmed) ? "taken" : null;
}

/**
 * The sentence under the name box for a problem, or nothing for the state that is not worth
 * a line.
 *
 * `empty` says nothing deliberately: a dialog that opened already telling the reader off for
 * not having typed anything is a dialog that shouts first and asks second. The submit is inert
 * with its own reason instead.
 *
 * @param problem What {@link nameProblem} found.
 * @returns The sentence, or `undefined` when there is none to draw.
 */
export function nameError(problem: NameProblem): string | undefined {
  return problem === "long" ? NAME_LONG : undefined;
}

/**
 * The sentence under the slug box for a problem, or nothing.
 *
 * @param problem What {@link slugProblem} found.
 * @returns The sentence, or `undefined` when there is none to draw.
 */
export function slugError(problem: SlugProblem): string | undefined {
  if (problem === "shape") return SLUG_SHAPE;
  if (problem === "taken") return SLUG_TAKEN;

  return undefined;
}

/** What a name past the column's ceiling is told. */
export const NAME_LONG = `Keep the name to ${MAX_NAME_LENGTH} characters.`;

/** What a slug that is not lower-case kebab is told — the service's own rule, restated. */
export const SLUG_SHAPE =
  `Use lower-case letters, digits and single hyphens, like standard-fix — at most ` +
  `${MAX_SLUG_LENGTH} characters.`;

/** What a slug this workspace already has is told. */
export const SLUG_TAKEN =
  "This workspace already has a workflow with that slug. Slugs are unique per workspace.";

/* ------------------------------------------------------------------ what gets sent */

/** What the dialog holds when the reader presses **Create workflow**. */
export interface CreateDraft {
  /** The name, as typed. Trimmed on the way out. */
  readonly name: string;
  /** The slug, as it follows the name or as the reader edited it. Trimmed on the way out. */
  readonly slug: string;
}

/**
 * The body P.3 is sent.
 *
 * **The slug is always sent.** The contract derives one when it is omitted, and the dialog
 * could omit it; it does not, because the dialog *showed* the slug and a body that left it
 * out would let the service and the screen derive two different answers from one name. No
 * `definition` travels: the blank canvas is the contract's own default, and a client restating
 * it would be a second place for the shape of *blank* to drift.
 *
 * @param draft What the dialog holds.
 * @returns The body to POST.
 */
export function createBody(draft: CreateDraft): CreateWorkflowRequest {
  return { name: draft.name.trim(), slug: draft.slug.trim() };
}

/**
 * Why **Create workflow** cannot be pressed yet, or `undefined` when it can.
 *
 * Checked in the order the form is filled in, so the control never points past a blank field
 * at a later one.
 *
 * @param name What {@link nameProblem} makes of the name.
 * @param slug What {@link slugProblem} makes of the slug.
 * @returns The sentence, or `undefined` when the form is ready.
 */
export function submitReason(name: NameProblem, slug: SlugProblem): string | undefined {
  if (name !== null) return NEEDS_NAME;
  if (slug !== null) return NEEDS_SLUG;

  return undefined;
}

/** Why the submit is inert while the name is missing or wrong. */
export const NEEDS_NAME = "Give the workflow a name first.";

/** Why the submit is inert while the slug is missing or wrong. */
export const NEEDS_SLUG = "Give it a slug that is free and lower-case kebab.";

/* ------------------------------------------------------------------ what a refusal says */

/** What the dialog draws for a refused create: one sentence, and the fields it is about. */
export interface CreateFailure {
  /** The sentence under the form. */
  readonly message: string;
  /** What is wrong with the name box, if the refusal was about it. */
  readonly name?: string;
  /** What is wrong with the slug box, if it was about that. */
  readonly slug?: string;
}

/** The `code` for a slug this workspace already has. */
export const SLUG_TAKEN_CODE = "workflow_slug_taken";

/** The `code` for a name that yields no slug — met here only if the live check was skipped. */
export const SLUG_REQUIRED_CODE = "workflow_slug_required";

/** The `code` for a body whose own shape is wrong. */
export const VALIDATION_FAILED_CODE = "validation_failed";

/** The `code` for a role that may read the studio and not write to it. */
export const FORBIDDEN_CODE = "forbidden";

/** The clause every refusal ends on, because it is the fact a reader most needs. */
export const NOTHING_CREATED = "Nothing was created.";

/** What a refused create says when the body's own shape was wrong. */
export const CREATE_INVALID = `That could not be saved as it stands. ${NOTHING_CREATED}`;

/** What a member who reached the write anyway is told. */
export const CREATE_READ_ONLY =
  `Creating a workflow is for workspace owners and admins. ${NOTHING_CREATED}`;

/** What a refusal this module has no sentence for is told, with the service's own beside it. */
export const CREATE_FAILED = `The workflow could not be created. ${NOTHING_CREATED}`;

/**
 * The service's refusal, as the dialog draws it.
 *
 * Each code is mapped to a sentence *and* to the field it is about, because the two together
 * are what makes a refusal actionable: a line under the form says what happened, and a line
 * under the box says where. A code with no field — a role refusal — gets the sentence alone,
 * which is honest: there is nothing in the form to correct.
 *
 * @param refusal The service's envelope, as `create-actions.ts` handed it back — the
 *   contract's own `{code, message, details}` (`app/api/errors.ts`).
 * @returns What to draw.
 */
export function createFailure(refusal: ErrorEnvelope): CreateFailure {
  const { code, details } = refusal;

  if (code === SLUG_TAKEN_CODE) {
    return { message: `${SLUG_TAKEN} ${NOTHING_CREATED}`, slug: SLUG_TAKEN };
  }

  if (code === SLUG_REQUIRED_CODE) {
    return { message: `${SLUG_SHAPE} ${NOTHING_CREATED}`, slug: SLUG_SHAPE };
  }

  if (code === VALIDATION_FAILED_CODE) {
    return {
      message: CREATE_INVALID,
      name: fieldSentence(details.name),
      slug: fieldSentence(details.slug),
    };
  }

  if (code === FORBIDDEN_CODE) return { message: CREATE_READ_ONLY };

  // An unrecognised code still carries the service's own sentence, which is written for a
  // caller rather than for a reader — so it goes *after* the product's line rather than
  // instead of it, and the reader is told what state the workspace is in either way.
  return { message: `${CREATE_FAILED} ${refusal.message}` };
}

/**
 * One field's messages from a `validation_failed`, as the one line the field draws.
 *
 * @param value Whatever `details` carried under that field's key.
 * @returns The sentence, or `undefined` when the refusal said nothing about this field —
 *   which is what keeps `aria-invalid` off a box that is fine.
 */
function fieldSentence(value: unknown): string | undefined {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    const sentences = value.filter((entry): entry is string => typeof entry === "string");

    return sentences.length === 0 ? undefined : sentences.join(" ");
  }

  return undefined;
}

/* ------------------------------------------------------------------ what the dialog says */

/** The dialog's heading, and its accessible name. */
export const CREATE_TITLE = "New workflow";

/**
 * The note under the heading — what the dialog makes, and the one thing about it that is
 * permanent.
 */
export const CREATE_NOTE =
  "A blank canvas, as a draft: nothing runs until the first publish. The slug is what a " +
  "queued issue is tagged with, and it cannot be changed afterwards.";

/** The name field's label. */
export const NAME_LABEL = "Name";

/** …and its hint. */
export const NAME_HINT = "The title the rail and the page head print.";

/** The slug field's label. */
export const SLUG_LABEL = "Slug";

/** …and its hint: what it is for, and that it is fixed. */
export const SLUG_HINT = "lower-case kebab · unique in this workspace · fixed once created";

/** The dialog's primary control. */
export const CREATE_SUBMIT = "Create workflow";

/** …and what it says while the write is in flight. */
export const CREATING = "Creating the workflow…";

/** The way out without writing anything. */
export const CREATE_CANCEL = "Cancel";

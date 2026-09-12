/**
 * What a workflow request may contain — the path parameters, the query strings and the bodies
 * of every P.3 route ([#134](https://github.com/NobuData/ouroboros/issues/134)), as
 * `class-validator` classes.
 *
 * One file, per `tenancy.dto.ts`'s argument: the bounds below restate constraints V029
 * declares — `workflows_slug_format`, `workflows_name_present`,
 * `workflow_versions_change_note_present` — and the pairing has to be readable in one look.
 * The pairing is deliberate in both directions:
 *
 *   * **The database is the authority.** A DTO that admitted something a constraint refuses
 *     would produce a `500` where the caller deserved a `422`, and one that admits *less* is
 *     merely stricter than it has to be.
 *   * **The DTO is the message.** A constraint's failure is a SQLSTATE and a name; a
 *     decorator's is a sentence naming the field, and it arrives before a connection is taken
 *     from the pool.
 *
 * **A definition is validated as an object here and as a document at publish.** `@IsObject()`
 * is `workflow_versions_definition_object` and nothing more, which is V029's deliberate
 * position: *"an empty `{}` is the legal state of a canvas with nothing on it yet"*. The
 * grammar has one owner (P.2) and one moment — `publish.gate.ts`, when the document is about to
 * become immutable. A draft autosave that refused a half-built canvas would be an autosave
 * nobody could use.
 *
 * Every property is `!`-asserted or optional rather than initialised, for `tenancy.dto.ts`'
 * reason: `class-transformer` constructs these objects and assigns to them, so a default
 * written here would be a value the pipe then overwrote.
 */

import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from "class-validator";

import { WORKFLOW_STATUSES, type WorkflowStatus } from "../db/schema";
import { CHANGE_NOTE_MAX_LENGTH, NAME_MAX_LENGTH, SLUG_MAX_LENGTH, SLUG_PATTERN } from "./slug";

/**
 * The statuses a request may ask for.
 *
 * All three, including `archived` — the soft delete is a status change rather than a `DELETE`,
 * which is V029's design: *"its version history stays readable, and it is off the rail and out
 * of the vocabulary"*. A `DELETE` would have to mean one of *hide this* or *destroy the runs'
 * provenance*, and only the first is something a person can want.
 */
export const SETTABLE_WORKFLOW_STATUSES = WORKFLOW_STATUSES;

/** The path of every `/api/v1/workflows/{id}` route. */
export class WorkflowParams {
  /** The workflow — `workflows.id`, a uuid (V029). Anything else is a `422`, not a probe's `404`. */
  @IsUUID()
  id!: string;
}

/** The query string of `GET /api/v1/workflows/{id}`. */
export class ReadWorkflowQuery {
  /**
   * Read a historical version instead of the one in force.
   *
   * An `integer` rather than a string, transformed by the pipe — a version number is what the
   * `v14` chip prints, and `?version=abc` is a `422` naming the field rather than a query that
   * matches nothing. `Min(1)` is `workflow_versions_version_positive`.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

/** The body of `POST /api/v1/workflows`. */
export class CreateWorkflowBody {
  /** The human title. `workflows_name_present` — non-blank, at most 120 characters. */
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  name!: string;

  /**
   * The slug, when the caller has one in mind.
   *
   * Omitted, it is derived from {@link name} by `slug.ts`. Sent, it is used verbatim — because
   * the slug is what a `workflow_tag` resolves through and what an assign menu sends, so a
   * workspace migrating from the built-in vocabulary needs to be able to say `standard-fix`
   * rather than accept whatever a title happens to fold to.
   */
  @IsOptional()
  @IsString()
  @Length(1, SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, {
    message: "slug must be lower-case words separated by single hyphens",
  })
  slug?: string;

  /**
   * The document the canvas opens on — a template stub, or nothing at all.
   *
   * Omitted, the draft is created holding `{}`: the blank canvas, which V029 names as a legal
   * stored state. Sent, it is stored as-is and validated at publish like any other draft, which
   * is what lets **Browse templates** (#159) create from a starter without this route needing
   * to know what a template is.
   */
  @IsOptional()
  @IsObject()
  definition?: Record<string, unknown>;
}

/**
 * The body of `PATCH /api/v1/workflows/{id}`.
 *
 * **Both fields are optional, and a body with neither is not an error.** `forbidNonWhitelisted`
 * already refuses a property no field here declares, so `{}` is a request that genuinely asks
 * for nothing — and the honest answer to it is the workflow as it stands, which is what the
 * service returns without issuing an `update`. Refusing it would buy nothing a mistyped field
 * does not already get.
 */
export class UpdateWorkflowBody {
  /** The new title. `workflows_name_present`. */
  @IsOptional()
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  name?: string;

  /**
   * The new status.
   *
   * `paused` is the mockup's err-dot and the caption that reads `5 stages · paused`; `archived`
   * takes the workflow off the rail and out of the assign-workflow vocabulary while leaving its
   * history readable. The slug is deliberately **not** changeable: it is the bridge a stored
   * `workflow_tag` resolves through, and renaming it would silently re-point every closed run
   * that carried it.
   */
  @IsOptional()
  @IsIn(SETTABLE_WORKFLOW_STATUSES)
  status?: WorkflowStatus;
}

/** The body of `PUT /api/v1/workflows/{id}/draft`. */
export class SaveDraftBody {
  /**
   * The whole document, as the canvas holds it.
   *
   * A `PUT` and a whole document rather than a patch, because autosave is a *replacement*: the
   * studio holds the canvas in memory and writes what it has. A partial update would need a
   * merge rule for a graph, and two clients merging concurrently is the clobber the `If-Match`
   * guard exists to refuse.
   */
  @IsObject()
  definition!: Record<string, unknown>;
}

/** The body of `POST /api/v1/workflows/{id}/publish`. */
export class PublishWorkflowBody {
  /**
   * What changed, in the publisher's words.
   *
   * Optional — V029: *"a publish with nothing to say is ordinary"* — but never blank, because
   * an empty string is a note that lost its text rather than one that was never written. That
   * is `workflow_versions_change_note_present`, restated.
   */
  @IsOptional()
  @IsString()
  @Length(1, CHANGE_NOTE_MAX_LENGTH)
  changeNote?: string;
}

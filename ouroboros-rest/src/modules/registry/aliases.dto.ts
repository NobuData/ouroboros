/**
 * The bodies, params and queries of `/api/v1/registry/aliases` — mockup 21's alias lifecycle
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)).
 *
 * **Shape here, meaning in the service.** These classes refuse what is malformed — a name that
 * is not lower-case kebab, a `params` that is an array, a `connectionId` that is not a uuid —
 * and say nothing about whether the write is *allowed*: whether the name is taken, whether the
 * params suit the bound model, whether an unbound alias may be enabled. Those refusals are
 * decisions the registry makes, with designed codes of their own (`aliases.errors.ts`), and
 * they need rows to make them. The pipe is configured `forbidNonWhitelisted`, so a body
 * carrying a field none of these declare is a `422 validation_failed` naming it rather than a
 * value the service quietly discards.
 *
 * **Two documents, validated twice.** `params` and `restrictions` are checked here only to be
 * JSON objects; what they may *contain* is CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585))
 * `ParamSchemaService`, which validates them against the bound model's capability schema and
 * answers `422 model_alias_params_invalid` naming the field. A DTO that re-stated V019's
 * vocabulary here would be a third copy of a rule the adapter and the database already own.
 *
 * **`null` means *unset*, and it is accepted only where unsetting means something.** A `PATCH`
 * with `connectionId: null` unbinds the alias and one with `notes: null` clears the note;
 * `@ValidateIf` rather than `@IsOptional()` is what lets a null through to the service for
 * those two while still refusing it for everything else — `@IsOptional()` skips validation
 * for `null` as well as for absence, which would let `alias: null` reach a not-null column.
 */

import {
  IsBoolean,
  IsString,
  IsUUID,
  Length,
  Matches,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";

import { MAX_MODEL_ID_LENGTH, MODEL_ID_MESSAGE, MODEL_ID_PATTERN } from "./params.dto";

/**
 * The shape of a name — V015's CHECK, restated for the message.
 *
 * Lower-case kebab, which V015 argues is a correctness rule rather than a style one:
 * uniqueness is enforced on the stored text, so admitting `Coder-Max` beside `coder-max` would
 * give one name two resolutions.
 */
export const ALIAS_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** V015's ceiling on a name. */
export const MAX_ALIAS_LENGTH = 64;

/** What a name that fails {@link ALIAS_NAME_PATTERN} is told. */
export const ALIAS_NAME_MESSAGE =
  "alias must be lower-case letters, digits and single hyphens, like coder-max";

/** V019's ceiling on a note. */
export const MAX_NOTES_LENGTH = 2000;

/**
 * A note is trimmed and non-empty — V019's `model_aliases_notes_present`, restated so the
 * refusal is a field message rather than a constraint name. Multi-line, unlike a model id.
 */
export const NOTES_PATTERN = /^\S(?:[\s\S]*\S)?$/;

/** What a note that fails {@link NOTES_PATTERN} is told. */
export const NOTES_MESSAGE = "notes must not be empty or padded with whitespace";

/**
 * A JSON object — not an array, not null, not a scalar.
 *
 * The only shape check `params` and `restrictions` get here; see the file header for where
 * their contents are validated.
 */
@ValidatorConstraint({ name: "isJsonObject" })
export class IsJsonObject implements ValidatorConstraintInterface {
  /**
   * @param value - Whatever the body carried.
   * @returns Whether it is a plain object.
   */
  validate(value: unknown): boolean {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * @returns The field message.
   */
  defaultMessage(): string {
    return "$property must be a JSON object";
  }
}

/** The one path parameter every per-alias route takes. */
export class AliasParams {
  /** `model_aliases.id`. */
  @IsUUID()
  id!: string;
}

/** `GET /registry/aliases/model-options?connection=` — whose models to list. */
export class ModelOptionsQuery {
  /** `provider_connections.id`, in this workspace. */
  @IsUUID()
  connection!: string;
}

/**
 * `POST /registry/aliases` — the **+ New alias** dialog, in either of its two modes.
 *
 * **Bound** carries a `connectionId`; **unbound** omits it (or sends `null`) and names only a
 * model — mockup 21's `gpt5-experiments`, a name created ahead of its key. An unbound alias
 * is stored `enabled: false` whatever the body says, because V019 refuses the other thing and
 * the service owes the client a designed answer rather than a constraint violation.
 */
export class CreateAliasDto {
  /** The name routes will use. Unique per workspace; lower-case kebab. */
  @Matches(ALIAS_NAME_PATTERN, { message: ALIAS_NAME_MESSAGE })
  @Length(1, MAX_ALIAS_LENGTH)
  @IsString()
  alias!: string;

  /** The connection to bind to, or absent/`null` for an unbound alias. */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID()
  connectionId?: string | null;

  /** The provider's model id — the only raw model string in the schema (decision **M1**). */
  @Matches(MODEL_ID_PATTERN, { message: MODEL_ID_MESSAGE })
  @Length(1, MAX_MODEL_ID_LENGTH)
  @IsString()
  modelId!: string;

  /** Per-alias invocation defaults. Absent means `{}`. */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(IsJsonObject)
  params?: Record<string, unknown>;

  /** Registry policy flags. Absent means `{}`. */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(IsJsonObject)
  restrictions?: Record<string, unknown>;

  /** An operator's note. Absent means none. */
  @ValidateIf((_object, value) => value !== undefined)
  @Matches(NOTES_PATTERN, { message: NOTES_MESSAGE })
  @Length(1, MAX_NOTES_LENGTH)
  @IsString()
  notes?: string;

  /** The **On** switch. Defaults to on for a bound alias; forced off for an unbound one. */
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;
}

/**
 * `PATCH /registry/aliases/{id}` — **Save alias**, the **On** switch, a rename, or a rebind.
 *
 * Every field is optional and only the fields present are written. Two accept `null`:
 * `connectionId: null` unbinds the alias, and `notes: null` clears the note. A body with
 * nothing in it, or nothing that differs from the row, is a `200` that changed nothing and
 * recorded nothing — see the service.
 */
export class UpdateAliasDto {
  /** A new name — a **rename**, which the service guards like a delete (decision **R5**). */
  @ValidateIf((_object, value) => value !== undefined)
  @Matches(ALIAS_NAME_PATTERN, { message: ALIAS_NAME_MESSAGE })
  @Length(1, MAX_ALIAS_LENGTH)
  @IsString()
  alias?: string;

  /** A new connection — a **rebind** — or `null` to unbind. */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID()
  connectionId?: string | null;

  /** A new model — also a rebind, and validated against discovery the same way. */
  @ValidateIf((_object, value) => value !== undefined)
  @Matches(MODEL_ID_PATTERN, { message: MODEL_ID_MESSAGE })
  @Length(1, MAX_MODEL_ID_LENGTH)
  @IsString()
  modelId?: string;

  /** The whole params document, replacing the stored one. */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(IsJsonObject)
  params?: Record<string, unknown>;

  /** The whole restrictions document, replacing the stored one. */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(IsJsonObject)
  restrictions?: Record<string, unknown>;

  /** A new note, or `null` to clear it. */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Matches(NOTES_PATTERN, { message: NOTES_MESSAGE })
  @Length(1, MAX_NOTES_LENGTH)
  @IsString()
  notes?: string | null;

  /** The **On** switch. Enabling an unbound alias is refused with a designed `422`. */
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;
}

/**
 * The params and body of `/api/v1/registry/import` — CH.4's wizard
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * **Shape here, meaning in the service**, which is `aliases.dto.ts`'s rule and holds for the
 * same reason: whether a name is taken, whether a model was discovered and whether the params
 * suit it are decisions that need rows, and they are answered itemized by
 * `import.errors.ts` rather than by the pipe. What these classes refuse is a body that could
 * not be acted on at all — a name that is not lower-case kebab, an `items` that is empty, a
 * `params` that is an array.
 *
 * **Every field is one the alias lifecycle already declares**, and deliberately so: an import
 * item is a `CreateAliasDto` with the connection hoisted out of it and `enabled` removed. The
 * two constraints on `alias` and `modelId` are re-stated from the same constants
 * (`aliases.dto.ts`, `params.dto.ts`) rather than re-invented, so a name this endpoint accepts
 * is one `POST /registry/aliases` would have accepted too — a wizard that could create a name
 * the create dialog refuses is a wizard whose rows fail on the way back.
 *
 * **There is no `enabled`.** Import creates *enabled* aliases and says so in one place, which
 * is the service; a field here would invite a client to ask for the other thing and then have
 * to be told no. See `import.service.ts` for why the default is the opposite of duplicate's.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  Length,
  Matches,
  Validate,
  ValidateIf,
  ValidateNested,
} from "class-validator";

import {
  ALIAS_NAME_MESSAGE,
  ALIAS_NAME_PATTERN,
  IsJsonObject,
  MAX_ALIAS_LENGTH,
} from "./aliases.dto";
import { MAX_MODEL_ID_LENGTH, MODEL_ID_MESSAGE, MODEL_ID_PATTERN } from "./params.dto";

/**
 * The most models one request may import.
 *
 * A bound rather than a product decision: the whole batch is one transaction, and a
 * transaction whose size a client chooses is a lock somebody else waits behind. Two hundred is
 * comfortably past the largest catalog any provider in this build lists, so no honest wizard
 * meets it — which is the shape a limit should have.
 */
export const MAX_IMPORT_ITEMS = 200;

/** The one path parameter the candidates read takes. */
export class ImportConnectionParams {
  /** `provider_connections.id`, in this workspace. */
  @IsUUID()
  connectionId!: string;
}

/** One row of the wizard the operator left ticked. */
export class ImportItemDto {
  /**
   * The provider's model id, **as discovery reported it**.
   *
   * Checked against `provider_models` by the service, not here: this only refuses a string
   * that could not be a model id at all.
   */
  @Matches(MODEL_ID_PATTERN, { message: MODEL_ID_MESSAGE })
  @Length(1, MAX_MODEL_ID_LENGTH)
  @IsString()
  modelId!: string;

  /** What to call it — the suggestion the candidates read offered, or whatever was typed over it. */
  @Matches(ALIAS_NAME_PATTERN, { message: ALIAS_NAME_MESSAGE })
  @Length(1, MAX_ALIAS_LENGTH)
  @IsString()
  alias!: string;

  /** Per-alias invocation defaults. Absent means `{}`, which is what an untouched row sends. */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(IsJsonObject)
  params?: Record<string, unknown>;
}

/** `POST /registry/import` — the ticked rows of one connection's wizard. */
export class ImportAliasesDto {
  /** The connection every item is bound to. One per request; two connections are two imports. */
  @IsUUID()
  connectionId!: string;

  /**
   * The rows to create, in the order the wizard drew them.
   *
   * At least one: an import of nothing is a request nobody meant to send, and answering it
   * `200` with an empty report would let a broken client believe it had done something.
   */
  @ValidateNested({ each: true })
  @Type(() => ImportItemDto)
  @ArrayMaxSize(MAX_IMPORT_ITEMS)
  @ArrayMinSize(1)
  @IsArray()
  items!: ImportItemDto[];
}

/**
 * What `GET /api/v1/registry/param-schema` may be asked
 * ([#585](https://github.com/NobuData/ouroboros/issues/585)).
 *
 * Two query parameters and one rule between them: `model` is required and `connection` is not,
 * because an alias with no provider bound is a state mockup 21 draws — `gpt5-experiments`, a
 * name created ahead of its key — and the endpoint has an honest answer for it. Omitting
 * `connection` is therefore *asking about an unbound alias*, not a malformed request.
 *
 * **The pair is in the query string rather than in the path** for `pricing.dto.ts`'s reason: a
 * model identifier is a vendor's string — `qwen3-coder:32b`, `openai/gpt-oss-120b` — and half
 * of those would need escaping to survive a path segment.
 *
 * The decorators restate the columns' own limits so a value the database could not hold is a
 * `422` naming the field rather than a lookup that quietly matches nothing.
 */

import { IsOptional, IsUUID, Matches, MaxLength } from "class-validator";

/**
 * The longest model identifier V015 and V017 will store — `model_aliases_model_id_present` and
 * `provider_models_model_id_present`.
 *
 * Bounded here so a caller sending a kilobyte is refused at the edge rather than after two
 * index lookups that could not have matched.
 */
export const MAX_MODEL_ID_LENGTH = 200;

/**
 * How a model identifier may be spelled: anything not blank and not surrounded by whitespace.
 *
 * Deliberately permissive, and unfolded. The column stores the vendor's own string, vendors
 * disagree about case and punctuation, and a pattern tighter than the column's would refuse a
 * model this workspace has an alias for. What is refused is a shape no lookup could match — an
 * empty string, or one whose padding means it was not the identifier that was sent.
 */
export const MODEL_ID_PATTERN = /^\S(?:.*\S)?$/;

/** What a client is told when {@link MODEL_ID_PATTERN} refuses their model identifier. */
export const MODEL_ID_MESSAGE =
  "model must be a model identifier, with no leading or trailing whitespace";

/**
 * `GET /registry/param-schema` — which model, on which connection.
 *
 * `whitelist` and `forbidNonWhitelisted` are on globally (`errors/validation.ts`), so a third
 * parameter is refused rather than ignored — which is what stops a client from believing a
 * `?tier=priority` it invented is being honoured.
 */
export class ParamSchemaQuery {
  /**
   * The connection the alias is bound to, or absent for an unbound alias.
   *
   * A uuid, checked here so a caller that sent a display name is told which field was wrong
   * rather than being answered `404` for a connection that does exist under another spelling.
   *
   * Any version, which is the convention every other `@IsUUID()` in this service follows: V015
   * generates v4 and a row imported or seeded from elsewhere may not be, so pinning the version
   * would refuse an id this workspace really has — a rule the column does not have.
   */
  @IsOptional()
  @IsUUID(undefined, { message: "connection must be the uuid of a provider connection" })
  readonly connection?: string;

  /**
   * The model the alias names — `claude-fable-5`, `qwen3-coder:32b`.
   *
   * Required even when `connection` is absent, and that is the point of the unbound answer:
   * `gpt5-experiments` has a model id and no provider, so the question *what can this be tuned
   * with* is still well formed and still has an answer, which is *nothing, and here is why*.
   */
  @Matches(MODEL_ID_PATTERN, { message: MODEL_ID_MESSAGE })
  @MaxLength(MAX_MODEL_ID_LENGTH, {
    message: `model must be at most ${MAX_MODEL_ID_LENGTH} characters`,
  })
  readonly model!: string;
}

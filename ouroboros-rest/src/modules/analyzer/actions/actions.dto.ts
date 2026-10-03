/**
 * What the suggestion action routes accept (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514)).
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";

/** `:id` — a suggestion. */
export class SuggestionIdParams {
  @IsUUID()
  id!: string;
}

/** `:id` — a planning batch. */
export class BatchIdParams {
  @IsUUID()
  id!: string;
}

/** `POST …/suggestions/{id}/apply`. */
export class ApplySuggestionBody {
  /**
   * The preview's `fingerprint`, when the caller wants the apply refused unless it does exactly
   * what that preview said. Recommended: it is how a confirmed preview stays the truth.
   */
  @IsOptional()
  @Matches(/^sha256:[0-9a-f]{64}$/, { message: "fingerprint must be a preview's sha256:<hex>" })
  fingerprint?: string;
}

/** `POST …/suggestions/{id}/dismiss`. */
export class DismissSuggestionBody {
  /** Why — optional; a dismissal without one is recorded as such. */
  @IsOptional()
  @IsString()
  @Length(1, 4096)
  @Matches(/\S/, { message: "reason must not be blank" })
  reason?: string;
}

/** `POST /api/v1/analyzer/suggestions/draft`. */
export class DraftSuggestionsBody {
  /** The ticket and spike suggestions to draft, in the order the batch lists them. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  suggestionIds!: string[];

  /** The write-capable ticket source the batch will push to. */
  @IsUUID()
  targetSourceId!: string;
}

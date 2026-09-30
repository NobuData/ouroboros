/**
 * The shapes the fact routes accept (BF.2,
 * [#411](https://github.com/NobuData/ouroboros/issues/411)).
 *
 * Only what `class-validator` can say is said here: types, lengths and closed vocabularies — each
 * bound copied from V071's constraints so a request is refused with a `400` naming the field rather
 * than by a CHECK. Whether a path glob stays inside the repository is `anchorValueProblem`'s
 * (`facts.anchors.ts`), and whether a provenance reference names this workspace's row is the
 * database's (`fact_provenance_unresolved`).
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";

import {
  FACT_ANCHOR_KINDS,
  FACT_STATUSES,
  type FactAnchorKind,
  type FactStatus,
} from "../db/schema";
import { REPO_REF_MAX_LENGTH, REPO_REF_PATTERN } from "../onboarding/onboarding.dto";

/** `facts_text_present` — the longest a fact may be. */
export const FACT_TEXT_MAX_LENGTH = 500;

/** `fact_provenance_typed` — the longest provenance line. */
export const PROVENANCE_LINE_MAX_LENGTH = 200;

/** `fact_provenance_typed` — the most references a provenance may carry. */
export const PROVENANCE_REFS_MAX = 16;

/** `facts_expired_reason` — the longest expiry reason. */
export const EXPIRED_REASON_MAX_LENGTH = 200;

/** `facts_status_reason_present` — the longest note beside a transition. */
export const STATUS_REASON_MAX_LENGTH = 500;

/** `fact_anchors_value_present` — the longest anchor value. */
export const ANCHOR_VALUE_MAX_LENGTH = 512;

/** How many anchors a manual proposal may bring with it. */
export const PROPOSAL_ANCHORS_MAX = 16;

/** The reference kinds a person may cite by hand — imports are BF.4's (#413). */
export const MANUAL_REF_KINDS = ["run", "pull_request", "ticket"] as const;

/** `:factId` of every `/api/v1/facts/{factId}…` route. */
export class FactIdParams {
  @IsUUID()
  factId!: string;
}

/** `:factId/anchors/:anchorId`. */
export class FactAnchorParams {
  @IsUUID()
  factId!: string;

  @IsUUID()
  anchorId!: string;
}

/** `GET /api/v1/facts?status=` — one status, or every fact when absent. */
export class ListFactsQuery {
  @IsOptional()
  @IsIn(FACT_STATUSES)
  status?: FactStatus;
}

/** One provenance reference a person cites — a run, a pull request or a ticket, by id. */
export class FactRefBody {
  @IsIn(MANUAL_REF_KINDS)
  kind!: (typeof MANUAL_REF_KINDS)[number];

  @IsUUID()
  id!: string;
}

/** `POST /api/v1/facts/{factId}/anchors`, and each of a proposal's `anchors`. */
export class CreateAnchorBody {
  @IsIn(FACT_ANCHOR_KINDS)
  kind!: FactAnchorKind;

  @IsString()
  @Length(1, ANCHOR_VALUE_MAX_LENGTH)
  value!: string;
}

/** `POST /api/v1/facts` — a fact written by hand. It is born `proposed`, like every fact. */
export class ProposeFactBody {
  @IsString()
  @Length(1, FACT_TEXT_MAX_LENGTH)
  @Matches(/\S/, { message: "text must not be blank" })
  text!: string;

  /** `owner/name`; absent is the whole workspace. */
  @IsOptional()
  @IsString()
  @Length(1, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: "repoRef must be owner/name, with no . or .. segment" })
  repoRef?: string;

  /** The line the card renders under the fact; `added by hand` when absent. */
  @IsOptional()
  @IsString()
  @Length(1, PROVENANCE_LINE_MAX_LENGTH)
  @Matches(/\S/, { message: "provenanceLine must not be blank" })
  provenanceLine?: string;

  /** What the fact was learned from. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROVENANCE_REFS_MAX)
  @ValidateNested({ each: true })
  @Type(() => FactRefBody)
  refs?: FactRefBody[];

  /** Why it can expire. None is valid, and is never swept. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROPOSAL_ANCHORS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CreateAnchorBody)
  anchors?: CreateAnchorBody[];
}

/** `POST …/confirm`, `…/reject`, `…/reconfirm` — an optional note beside the transition. */
export class TransitionFactBody {
  @IsOptional()
  @IsString()
  @Length(1, STATUS_REASON_MAX_LENGTH)
  @Matches(/\S/, { message: "reason must not be blank" })
  reason?: string;
}

/** `POST …/expire` — the reason is required: *"Zephyr 4.1 migration"*. */
export class ExpireFactBody {
  @IsString()
  @Length(1, EXPIRED_REASON_MAX_LENGTH)
  @Matches(/\S/, { message: "reason must not be blank" })
  reason!: string;
}

/** `POST …/relearn` — the new proposal's text; the expired fact's text when absent. */
export class RelearnFactBody {
  @IsOptional()
  @IsString()
  @Length(1, FACT_TEXT_MAX_LENGTH)
  @Matches(/\S/, { message: "text must not be blank" })
  text?: string;
}

/**
 * The audit plane's query strings (BR.2, [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * ```
 * GET /settings/audit             AuditPlaneQuery    filters · cursor · limit
 * GET /settings/audit/today       AuditTodayQuery    tz · limit
 * GET /settings/audit/export.csv  AuditExportQuery   filters, from and to required
 * ```
 *
 * The filters are one class shared by the list and the export, so the two cannot accept the same
 * parameter in two spellings. Shape is checked here; what needs the whole request — a range whose
 * end is before its start, a cursor this service did not mint — is the service's `422`.
 *
 * **`action` is a grammar, not the vocabulary** — unlike the credential trail's filter. The plane
 * shows rows SQL triggers write (`pr_merge_plan.*`) and rows a later release adds, which no list in
 * this process names; an unknown action is a well-formed question with an empty answer.
 */

import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsTimeZone,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

import { MAX_ACTOR_ID_LENGTH } from "../audit/audit.dto";
import { AUDIT_ACTOR_KINDS, type AuditActorKind } from "../db/schema";
import { SERVICE_ACCOUNT_NAME_PATTERN } from "../service-accounts/service-accounts.dto";
import { ACTION_FILTER_PATTERN, REFERENCE_PATTERN } from "./audit-plane.filter";

/** The list's default page. */
export const AUDIT_PAGE_DEFAULT = 50;

/** The list's largest page. */
export const AUDIT_PAGE_MAX = 200;

/** The today view's default number of lines — the card's five. */
export const AUDIT_TODAY_DEFAULT = 5;

/** The today view's most lines. */
export const AUDIT_TODAY_MAX = 50;

/** The zone *today* is taken in when the client names none. */
export const AUDIT_TODAY_DEFAULT_ZONE = "UTC";

/** The longest cursor accepted — the encoded JSON of a timestamp and a uuid, with room. */
const MAX_CURSOR_LENGTH = 256;

/** The filters — every one optional on the list. */
export class AuditPlaneFilterQuery {
  /** Events at or after this instant — ISO-8601 with a zone. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: "from must be an ISO-8601 instant" })
  from?: string;

  /** Events strictly before this instant — ISO-8601 with a zone. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: "to must be an ISO-8601 instant" })
  to?: string;

  /** One actor kind. */
  @IsOptional()
  @IsIn(AUDIT_ACTOR_KINDS, { message: `actorKind must be one of ${AUDIT_ACTOR_KINDS.join(", ")}` })
  actorKind?: AuditActorKind;

  /** One person — `"user".id`. */
  @IsOptional()
  @IsString({ message: "actorId must be text" })
  @Length(1, MAX_ACTOR_ID_LENGTH, { message: "actorId must be 1–128 characters" })
  actorId?: string;

  /** One service account, or the bot — `devops-bot`, `ouroboros-app`. */
  @IsOptional()
  @Matches(SERVICE_ACCOUNT_NAME_PATTERN, { message: "actorService must be a service account name" })
  actorService?: string;

  /** A plane (`policy.*`) or one action (`policy.published`). */
  @IsOptional()
  @Matches(ACTION_FILTER_PATTERN, {
    message: "action must be a plane like policy.* or an action like policy.published",
  })
  action?: string;

  /** A reference — `pr:509`, `run:<id>`, `repo:<ref>`, `key:<id>`, `subject:<id>`. */
  @IsOptional()
  @Matches(REFERENCE_PATTERN, {
    message: "ref must be pr:<number>, run:<id>, repo:<ref>, key:<id> or subject:<id>",
  })
  ref?: string;
}

/** `GET /settings/audit`. */
export class AuditPlaneQuery extends AuditPlaneFilterQuery {
  /** Where the previous page ended — its `nextCursor`. */
  @IsOptional()
  @IsString({ message: "cursor must be text" })
  @Length(1, MAX_CURSOR_LENGTH, { message: "cursor is not one this service issued" })
  cursor?: string;

  /** Page size, 1–200; 50 by default. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "limit must be a whole number" })
  @Min(1, { message: "limit must be at least 1" })
  @Max(AUDIT_PAGE_MAX, { message: `limit must be at most ${String(AUDIT_PAGE_MAX)}` })
  limit?: number;
}

/** `GET /settings/audit/today`. */
export class AuditTodayQuery {
  /** The IANA zone *today* and each line's time are taken in — `UTC` by default. */
  @IsOptional()
  @IsTimeZone({ message: "tz must be an IANA time zone, e.g. Europe/Berlin" })
  tz?: string;

  /** Lines, 1–50; the card's 5 by default. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "limit must be a whole number" })
  @Min(1, { message: "limit must be at least 1" })
  @Max(AUDIT_TODAY_MAX, { message: `limit must be at most ${String(AUDIT_TODAY_MAX)}` })
  limit?: number;
}

/**
 * `GET /settings/audit/export.csv` — the same filters as the list.
 *
 * `from` and `to` are **required** here, but they are optional on the class this extends, and
 * class-validator inherits a parent's `@IsOptional` — so the requirement is the service's
 * (`422 audit_export_range_required`), next to the span check it belongs with.
 */
export class AuditExportQuery extends AuditPlaneFilterQuery {}

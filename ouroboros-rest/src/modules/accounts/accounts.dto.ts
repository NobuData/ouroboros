/**
 * The account-approval admin routes' inputs.
 *
 * Validation restates V149's constraints so a bad request is a `422` naming the field rather than
 * a `500` from the CHECK behind it: a bare address (no display name, no spaces), a note of at most
 * 200 characters, a status from the three the column holds.
 */

import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";

import { ACCOUNT_STATUSES } from "../../auth/account.approval";
import type { AccountStatus } from "../db/schema";

/** A bare address — V149's `app_preapproved_emails_email_format`, before lower-casing. */
export const BARE_EMAIL = /^[^\s@<>]+@[^\s@<>]+$/;

/** The longest address accepted — RFC 5321's path limit. */
export const MAX_EMAIL_LENGTH = 320;

/** The longest note — V149's `app_preapproved_emails_note_length`. */
export const MAX_NOTE_LENGTH = 200;

/** `GET /api/v1/admin/accounts?status=` — which list. */
export class ListAccountsQuery {
  /** `pending` (the default), `denied` or `approved`. */
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES, { message: `status must be one of ${ACCOUNT_STATUSES.join(", ")}` })
  status?: AccountStatus;
}

/** `POST /api/v1/admin/preapproved-emails`. */
export class AddPreapprovedEmailDto {
  /** The address. Trimmed and lower-cased before it is validated and stored. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsString({ message: "email must be an email address" })
  @MaxLength(MAX_EMAIL_LENGTH, { message: `email must be at most ${MAX_EMAIL_LENGTH} characters` })
  @Matches(BARE_EMAIL, { message: "email must be an email address" })
  email!: string;

  /** Why, in the administrator's words. Optional; blank is stored as none. */
  @IsOptional()
  @IsString({ message: "note must be text" })
  @MaxLength(MAX_NOTE_LENGTH, { message: `note must be at most ${MAX_NOTE_LENGTH} characters` })
  note?: string | null;
}

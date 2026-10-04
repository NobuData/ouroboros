/**
 * The webhook management routes' request bodies and query (BR.3,
 * [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * **No body carries a secret.** The server mints every signing secret; there is no field a caller
 * could set one through, so a secret never arrives in a request log either.
 *
 * Shape is checked here; what needs the registry or the network — whether a subscription names a
 * registered type, whether the URL's host resolves inward — is the service's, because the answer
 * depends on the registry version and on DNS.
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

import { PageQuery } from "../tenancy/pagination";

/** The most characters an endpoint's name may have — V094's bound. */
export const WEBHOOK_NAME_MAX_LENGTH = 80;

/** The most characters a description may have — V098's bound. */
export const WEBHOOK_DESCRIPTION_MAX_LENGTH = 280;

/** The longest URL — V094's bound. */
export const WEBHOOK_URL_MAX_LENGTH = 2048;

/** The most subscription entries — V098's bound. */
export const WEBHOOK_SUBSCRIPTIONS_MAX = 64;

/** Text with no leading or trailing space and no control character — the name and description rule. */
const TRIMMED_TEXT = /^[^\s\p{Cc}](?:[^\p{Cc}]*[^\s\p{Cc}])?$/u;

/** https, a host, no user-info — V094's CHECK, refused here with a sentence instead. */
const HTTPS_URL = /^https:\/\/[^\s/?#@]+(\/[^\s]*)?$/;

/** A family wildcard or a dotted event type of a registered family — V098's grammar. */
const SUBSCRIPTION_ENTRY =
  /^(?:(audit|decision|run|pr)\.\*|(audit|decision|run|pr)(\.[a-z][a-z0-9_]*)+)$/;

/** The statuses the delivery log can be filtered by. */
export const DELIVERY_STATUSES = ["pending", "succeeded", "failed", "dead_lettered"] as const;

/** `POST /settings/webhooks`. */
export class CreateWebhookDto {
  @IsString({ message: "name must be text" })
  @MaxLength(WEBHOOK_NAME_MAX_LENGTH, {
    message: `name must be at most ${WEBHOOK_NAME_MAX_LENGTH} characters`,
  })
  @Matches(TRIMMED_TEXT, {
    message: "name must not be empty, start or end with a space, or contain control characters",
  })
  name!: string;

  @IsOptional()
  @IsString({ message: "description must be text" })
  @MaxLength(WEBHOOK_DESCRIPTION_MAX_LENGTH, {
    message: `description must be at most ${WEBHOOK_DESCRIPTION_MAX_LENGTH} characters`,
  })
  @Matches(TRIMMED_TEXT, {
    message:
      "description must not be empty, start or end with a space, or contain control characters",
  })
  description?: string | null;

  @IsString({ message: "url must be text" })
  @MaxLength(WEBHOOK_URL_MAX_LENGTH, {
    message: `url must be at most ${WEBHOOK_URL_MAX_LENGTH} characters`,
  })
  @Matches(HTTPS_URL, { message: "url must be an https:// URL with no user name or password" })
  url!: string;

  @IsArray({ message: "eventFamilies must be a list" })
  @ArrayMinSize(1, { message: "eventFamilies must name at least one family or event type" })
  @ArrayMaxSize(WEBHOOK_SUBSCRIPTIONS_MAX, {
    message: `eventFamilies may name at most ${WEBHOOK_SUBSCRIPTIONS_MAX} entries`,
  })
  @ArrayUnique({ message: "eventFamilies must not repeat" })
  @IsString({ each: true, message: "each eventFamilies entry must be text" })
  @Matches(SUBSCRIPTION_ENTRY, {
    each: true,
    message: "each eventFamilies entry must be audit.*, decision.*, run.*, pr.* or one event type",
  })
  eventFamilies!: string[];

  @IsOptional()
  @IsBoolean({ message: "siem must be true or false" })
  siem?: boolean;

  @IsOptional()
  @IsBoolean({ message: "active must be true or false" })
  active?: boolean;
}

/** `PATCH /settings/webhooks/:id` — every field optional; `description` may be cleared with `null`. */
export class UpdateWebhookDto {
  @ValidateIf((body: UpdateWebhookDto) => body.name !== undefined)
  @IsString({ message: "name must be text" })
  @MaxLength(WEBHOOK_NAME_MAX_LENGTH, {
    message: `name must be at most ${WEBHOOK_NAME_MAX_LENGTH} characters`,
  })
  @Matches(TRIMMED_TEXT, {
    message: "name must not be empty, start or end with a space, or contain control characters",
  })
  name?: string;

  @ValidateIf(
    (body: UpdateWebhookDto) => body.description !== undefined && body.description !== null,
  )
  @IsString({ message: "description must be text" })
  @MaxLength(WEBHOOK_DESCRIPTION_MAX_LENGTH, {
    message: `description must be at most ${WEBHOOK_DESCRIPTION_MAX_LENGTH} characters`,
  })
  @Matches(TRIMMED_TEXT, {
    message:
      "description must not be empty, start or end with a space, or contain control characters",
  })
  description?: string | null;

  @ValidateIf((body: UpdateWebhookDto) => body.url !== undefined)
  @IsString({ message: "url must be text" })
  @MaxLength(WEBHOOK_URL_MAX_LENGTH, {
    message: `url must be at most ${WEBHOOK_URL_MAX_LENGTH} characters`,
  })
  @Matches(HTTPS_URL, { message: "url must be an https:// URL with no user name or password" })
  url?: string;

  @ValidateIf((body: UpdateWebhookDto) => body.eventFamilies !== undefined)
  @IsArray({ message: "eventFamilies must be a list" })
  @ArrayMinSize(1, { message: "eventFamilies must name at least one family or event type" })
  @ArrayMaxSize(WEBHOOK_SUBSCRIPTIONS_MAX, {
    message: `eventFamilies may name at most ${WEBHOOK_SUBSCRIPTIONS_MAX} entries`,
  })
  @ArrayUnique({ message: "eventFamilies must not repeat" })
  @IsString({ each: true, message: "each eventFamilies entry must be text" })
  @Matches(SUBSCRIPTION_ENTRY, {
    each: true,
    message: "each eventFamilies entry must be audit.*, decision.*, run.*, pr.* or one event type",
  })
  eventFamilies?: string[];

  @ValidateIf((body: UpdateWebhookDto) => body.siem !== undefined)
  @IsBoolean({ message: "siem must be true or false" })
  siem?: boolean;

  @ValidateIf((body: UpdateWebhookDto) => body.active !== undefined)
  @IsBoolean({ message: "active must be true or false" })
  active?: boolean;

  @ValidateIf((body: UpdateWebhookDto) => body.registryVersion !== undefined)
  @IsInt({ message: "registryVersion must be a whole number" })
  @Min(1, { message: "registryVersion must be at least 1" })
  @Max(10_000, { message: "registryVersion is not a registry version" })
  registryVersion?: number;
}

/** `GET /settings/webhooks/:id/deliveries`. */
export class ListDeliveriesQuery extends PageQuery {
  @IsOptional()
  @IsIn(DELIVERY_STATUSES, { message: `status must be one of ${DELIVERY_STATUSES.join(", ")}` })
  status?: (typeof DELIVERY_STATUSES)[number];
}

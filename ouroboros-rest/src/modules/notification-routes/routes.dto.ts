/**
 * The body of `PATCH /api/v1/settings/notifications/{kind}` (BR.4,
 * [#488](https://github.com/NobuData/ouroboros/issues/488)).
 *
 * Every field is optional, and a body carrying none reads back the route — what PATCH means
 * everywhere in this service. `config` **replaces** the stored config when present (a form sends
 * the whole thing), and its keys are checked by the service, whose refusal names the field
 * (`422 notification_route_config_invalid`). Enabling a route on a channel that cannot deliver is
 * the service's `409 notification_route_locked`, never a silent store.
 */

import { IsBoolean, IsIn, IsObject, ValidateIf } from "class-validator";

import type { NotificationRouteChannel } from "../db/schema";
import { ROUTE_CHANNELS } from "./routes.catalog";

/** `PATCH /api/v1/settings/notifications/{kind}`. */
export class PatchNotificationRouteDto {
  /** Where the route delivers: `email`, `slack` or `pagerduty`. */
  @ValidateIf((body: PatchNotificationRouteDto) => body.channel !== undefined)
  @IsIn(ROUTE_CHANNELS, { message: "channel must be email, slack or pagerduty" })
  channel?: NotificationRouteChannel;

  /** `{ time?: "HH:MM", weekday?: "monday", recipients?: ["…@…"] }` — replaces the stored config. */
  @ValidateIf((body: PatchNotificationRouteDto) => body.config !== undefined)
  @IsObject({ message: "config must be an object" })
  config?: Record<string, unknown>;

  /** Whether the workspace wants the route. */
  @ValidateIf((body: PatchNotificationRouteDto) => body.enabled !== undefined)
  @IsBoolean({ message: "enabled must be true or false" })
  enabled?: boolean;
}

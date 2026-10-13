/**
 * The body of `PUT /api/v1/slack/channels/{id}/binding` (CA.1,
 * [#541](https://github.com/NobuData/ouroboros/issues/541)).
 *
 * One field: what the channel is for. Which routes that switches on is the service's
 * (`PURPOSE_ROUTES`); editing them one by one is #543.
 */

import { IsIn } from "class-validator";

import { CHANNEL_PURPOSES, type SlackChannelPurpose } from "./slack.resources";

/** `PUT /api/v1/slack/channels/{id}/binding`. */
export class PutSlackChannelBindingDto {
  /** What the channel is for: `loops`, `alerts` or `leads`. */
  @IsIn(CHANNEL_PURPOSES, { message: "purpose must be loops, alerts or leads" })
  purpose!: SlackChannelPurpose;
}

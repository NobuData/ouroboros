/**
 * The request shapes of live-run admission's member routes (DI.4, #1312).
 */

import { IsInt, IsUUID, Max, Min } from "class-validator";

import { MAX_LIVE_RUN_CEILING_MAX } from "../config/configuration";

/** `POST /api/v1/queue/{id}/confirm` — the queue item. */
export class QueueItemIdParams {
  @IsUUID("all", { message: "id must be a queue item id" })
  id!: string;
}

/** `PATCH /api/v1/settings/live-execution`. */
export class PatchLiveExecutionDto {
  /**
   * How many live runs may execute at once in the workspace. At least 1; at most the
   * deployment's `OURO_LIVE_RUN_CEILING_MAX`, which the service checks — the bound here is only
   * the absolute one V146 enforces.
   */
  @Max(MAX_LIVE_RUN_CEILING_MAX, {
    message: `ceiling must be at most ${MAX_LIVE_RUN_CEILING_MAX}`,
  })
  @Min(1, { message: "ceiling must be at least 1" })
  @IsInt({ message: "ceiling must be a whole number" })
  ceiling!: number;
}

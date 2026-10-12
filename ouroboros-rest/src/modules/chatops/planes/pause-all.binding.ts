/**
 * `/ouro pause all confirm` — the big red button (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * One call: `LifecycleService.pause`, which is what the Danger zone's *Pause all loops*
 * (`POST /api/v1/settings/lifecycle/pause`) calls. The dispatcher only reaches this binding once
 * `confirm` was typed, and that is the `confirm: true` the service requires.
 *
 * The reply is the service's own banner sentence for the paused state, so chat and the app-wide
 * banner describe the pause in the same words.
 */

import { Injectable } from "@nestjs/common";

import { LifecycleService } from "../../lifecycle/lifecycle.service";
import type { BindingResult, CommandBinding, CommandContext } from "../grammar.types";

/** What is said when the service answers a state with no banner. */
const PAUSED = "All loops are paused.";

@Injectable()
export class PauseAllBinding implements CommandBinding {
  readonly command = "pause all";

  /** @param lifecycle - The workspace lifecycle. */
  constructor(private readonly lifecycle: LifecycleService) {}

  /**
   * Pause the workspace.
   *
   * @param context - The invocation.
   * @returns The paused banner's sentence, and where to resume.
   * @throws {ConflictError} `workspace_state_conflict` when the workspace is not active —
   *   already paused, or scheduled for deletion.
   */
  async run(context: CommandContext): Promise<BindingResult> {
    const lifecycle = await this.lifecycle.pause(context.organizationId, context.invoker.userId, {
      confirm: true,
    });
    const banner = lifecycle.banner;

    return {
      kind: "done",
      reply: {
        text: banner?.message ?? PAUSED,
        ...(banner === null
          ? {}
          : { link: { label: banner.actionLabel, url: `${context.appUrl}${banner.actionPath}` } }),
      },
      ref: { state: lifecycle.state },
    };
  }
}

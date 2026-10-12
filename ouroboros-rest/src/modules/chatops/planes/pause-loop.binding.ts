/**
 * `/ouro pause loop <n>` — hold a loop mid-flight (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)). `loop-control.ts` holds the call.
 */

import { Injectable } from "@nestjs/common";

import { ControlsService } from "../../controls/controls.service";
import type { BindingResult, CommandBinding, CommandContext } from "../grammar.types";
import { requestLoopControl } from "./loop-control";

@Injectable()
export class PauseLoopBinding implements CommandBinding {
  readonly command = "pause loop";

  /** @param controls - The control queue (AP.4, #306). */
  constructor(private readonly controls: ControlsService) {}

  /**
   * Ask the control queue for the pause.
   *
   * @param context - The invocation.
   * @returns The acknowledgement, or the plane's reason when the run has already finished.
   * @throws {DomainError} The control queue's own refusals.
   */
  run(context: CommandContext): Promise<BindingResult> {
    return requestLoopControl(this.controls, "pause", context);
  }
}

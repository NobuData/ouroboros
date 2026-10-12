/**
 * `/ouro abort loop <n>` — stop a loop; the first attempt, without `confirm`, never reaches this binding (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)). `loop-control.ts` holds the call.
 */

import { Injectable } from "@nestjs/common";

import { ControlsService } from "../../controls/controls.service";
import type { BindingResult, CommandBinding, CommandContext } from "../grammar.types";
import { requestLoopControl } from "./loop-control";

@Injectable()
export class AbortLoopBinding implements CommandBinding {
  readonly command = "abort loop";

  /** @param controls - The control queue (AP.4, #306). */
  constructor(private readonly controls: ControlsService) {}

  /**
   * Ask the control queue for the abort.
   *
   * @param context - The invocation.
   * @returns The acknowledgement, or the plane's reason when the run has already finished.
   * @throws {DomainError} The control queue's own refusals.
   */
  run(context: CommandContext): Promise<BindingResult> {
    return requestLoopControl(this.controls, "abort", context);
  }
}

/**
 * The one call behind `/ouro pause loop`, `resume loop` and `abort loop` (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * All three are `ControlsService.submit` — what `POST /api/v1/runs/:id/controls` calls when the
 * run console's button is pressed. So a control typed in chat lands in the same durable queue,
 * under the same role policy, with the same TTL, and is audited by the same trigger; there is no
 * second way to reach the executor.
 *
 * **The sentences say what the control does, from `controls.service.ts`' contract**: a pause
 * takes effect at the next safe boundary, never mid-write; a resume continues from where the loop
 * stopped; an abort ends the run as canceled and **keeps its branch** — nothing is reverted or
 * deleted. A control is *requested* here, not done: the executor acknowledges it later.
 *
 * **A finished run is not an error to the plane.** `submit` records the control as `rejected`
 * and answers with the reason rather than throwing, so the reply relays that reason instead of
 * claiming the loop was paused.
 */

import type { ControlsService } from "../../controls/controls.service";
import type { BindingResult, CommandContext } from "../grammar.types";
import { argument, requesterOf } from "./binding.arguments";

/** The three controls a command can ask for. */
export type LoopControlKind = "pause" | "resume" | "abort";

/** What each control is called once asked for, and what it will do. */
const REQUESTED: Readonly<Record<LoopControlKind, { title: string; effect: string }>> = {
  pause: { title: "Pause", effect: "it stops at its next safe boundary, never mid-write" },
  resume: { title: "Resume", effect: "it continues from where it stopped" },
  abort: {
    title: "Abort",
    effect: "the run ends as canceled once the runner acknowledges, and its branch is kept",
  },
};

/** What was not done, for a refused control. */
const NOT_DONE: Readonly<Record<LoopControlKind, string>> = {
  pause: "paused",
  resume: "resumed",
  abort: "aborted",
};

/**
 * Ask for a control on the loop the command named.
 *
 * @param controls - The control queue.
 * @param kind - Which control.
 * @param context - The invocation; its `loop` argument names the run.
 * @returns The acknowledgement — or, for a run that has finished, the plane's reason.
 * @throws {DomainError} The queue's own refusals: `forbidden`, `run_not_found`,
 *   `abort_confirmation_invalid`.
 */
export async function requestLoopControl(
  controls: ControlsService,
  kind: LoopControlKind,
  context: CommandContext,
): Promise<BindingResult> {
  const loop = argument(context, "loop", "loop");
  const control = await controls.submit(
    context.organizationId,
    loop.runId,
    requesterOf(context.invoker),
    // An abort carries the loop number — exactly what the console's dialog has a person type.
    kind === "abort" ? { kind, confirmation: String(loop.loopSeq) } : { kind },
  );
  const name = `loop ${String(loop.loopSeq)}`;
  const ref = { runId: loop.runId, loopSeq: loop.loopSeq, controlId: control.id };

  if (control.state === "rejected") {
    return {
      kind: "done",
      reply: {
        text: `Loop ${String(loop.loopSeq)} was not ${NOT_DONE[kind]}: ${
          control.detail ?? "the control was rejected."
        }`,
      },
      ref,
    };
  }

  const { title, effect } = REQUESTED[kind];

  return {
    kind: "done",
    reply: { text: `${title} requested for ${name} — ${effect}.` },
    ref,
  };
}

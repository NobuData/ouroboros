"use server";

/**
 * The server hop for the run controls ([#310](https://github.com/NobuData/ouroboros/issues/310)):
 * *Pause loop*, *Resume* and *Abort run*, queued on #306's control queue.
 *
 * `app/providers/card-actions.ts` states the rule this exists under: the browser cannot reach
 * `ouroboros-rest`, so a Client Component that needs to write calls a Server Action that calls
 * it. A Server Action is a POST endpoint anybody holding the page can reach with any arguments,
 * so this carries three facts:
 *
 * - **The role gate is the service's.** `pause`, `resume` and `abort` are `owner` or `admin`,
 *   checked before the run is read. The page hides the buttons from a member; a member who
 *   calls this anyway gets the service's `403`, handed back as a refusal. A hidden button is
 *   not a permission model.
 * - **The abort's confirmation is the service's to judge.** The dialog only enables its button
 *   for the right number; what is typed is sent as typed and re-checked against the run, so a
 *   forged confirmation is `422 abort_confirmation_invalid`.
 * - **The run id is checked before it is put in a path**: a uuid, or nothing is sent.
 * - **Steering is not here.** It has its own box and its own issue (#311); this accepts the
 *   three head controls and refuses anything else before calling out.
 *
 * A refusal is a value, because the page is one the reader is still entitled to be on.
 */

import { isApiError } from "@/app/api/errors";
import { RUN_ID_INVALID, RUN_ID_INVALID_CODE, type RunControl, isRunId, runs } from "@/app/api/runs";

import {
  CONTROL_NOT_ALLOWED,
  CONTROL_NOT_ALLOWED_CODE,
  CONTROL_UNREACHABLE_CODE,
  SUBMIT_UNREACHABLE,
} from "./controls";

/** The controls the head may send. */
export type HeadControl =
  | { readonly kind: "pause" | "resume"; readonly idempotencyKey?: string }
  | { readonly kind: "abort"; readonly confirmation: string; readonly idempotencyKey?: string };

/** What became of a submission. */
export type SubmitOutcome =
  | { readonly ok: true; readonly control: RunControl }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly reason: string };

/**
 * Queue one of the head's controls on a run.
 *
 * @param runId The run.
 * @param control The control — its kind, the abort's typed confirmation, and a key for this
 *   press.
 * @returns The control as the queue holds it (a `rejected` one included — the run had already
 *   finished), or the reason nothing was queued.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal for an ended session above
 *   all.
 */
export async function submitRunControl(
  runId: string,
  control: HeadControl,
): Promise<SubmitOutcome> {
  if (!isRunId(runId)) {
    return { ok: false, status: 422, code: RUN_ID_INVALID_CODE, reason: RUN_ID_INVALID };
  }

  const kind: unknown = control?.kind;
  if (kind !== "pause" && kind !== "resume" && kind !== "abort") {
    return { ok: false, status: 422, code: CONTROL_NOT_ALLOWED_CODE, reason: CONTROL_NOT_ALLOWED };
  }

  const key =
    typeof control.idempotencyKey === "string" && control.idempotencyKey.trim() !== ""
      ? control.idempotencyKey
      : undefined;

  try {
    const queued = await runs.submitControl(runId, {
      kind,
      ...(kind === "abort"
        ? { confirmation: String((control as { confirmation?: unknown }).confirmation ?? "") }
        : {}),
      ...(key === undefined ? {} : { idempotencyKey: key }),
    });

    return { ok: true, control: queued };
  } catch (error) {
    if (!isApiError(error)) {
      // A dropped connection says the same thing as any other failure to reach the service.
      if (error instanceof TypeError) {
        return { ok: false, status: 502, code: CONTROL_UNREACHABLE_CODE, reason: SUBMIT_UNREACHABLE };
      }
      throw error;
    }

    return { ok: false, status: error.status, code: error.code, reason: error.message };
  }
}

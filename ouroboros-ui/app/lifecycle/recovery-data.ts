import "server-only";

/**
 * What the recovery screen reads
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * One read — where the workspace stands — made through **the client that redirects nowhere**
 * (`anonymousApi()`): the server-side client turns the frozen refusal into this very screen
 * (`app/api/server.ts`), and a screen that read through it would be sent to itself.
 *
 * The refusal is half of the answer here. While a workspace is pending deletion an **owner** may
 * still read its lifecycle; anybody else is refused it with `403 workspace_pending_delete`, whose
 * details say what this screen needs: that they cannot restore, and when the window closes.
 */

import { isApiError, isWorkspaceFrozen } from "@/app/api/errors";
import { anonymousApi } from "@/app/api/server";
import { type WorkspaceLifecycle, settingsLifecycle } from "@/app/api/settings-lifecycle";

/** Where the screen's reader ends up. */
export type RecoveryReading =
  /** The workspace is pending deletion. */
  | { readonly state: "frozen"; readonly purgeAfter: string | null; readonly restorable: boolean }
  /** The workspace is not pending deletion: this is not its screen. */
  | { readonly state: "open" }
  /** The session is gone. */
  | { readonly state: "signed-out" };

/**
 * Read where the workspace stands, for the recovery screen.
 *
 * @param read The read. Defaults to the lifecycle read over the non-redirecting client.
 * @returns What the screen should do — draw itself (and for whom), or send the reader on.
 * @throws {ApiError} Any refusal that is neither the frozen one nor a `401`.
 */
export async function readRecovery(
  read: () => Promise<WorkspaceLifecycle> = () => settingsLifecycle.read(anonymousApi()),
): Promise<RecoveryReading> {
  try {
    const lifecycle = await read();

    // Only an owner is answered while the workspace is pending deletion.
    return lifecycle.state === "pending_delete"
      ? { state: "frozen", purgeAfter: lifecycle.purgeAfter, restorable: true }
      : { state: "open" };
  } catch (error) {
    if (isWorkspaceFrozen(error)) {
      const { purgeAfter, restorable } = error.details as {
        purgeAfter?: unknown;
        restorable?: unknown;
      };

      return {
        state: "frozen",
        purgeAfter: typeof purgeAfter === "string" ? purgeAfter : null,
        restorable: restorable === true,
      };
    }

    if (isApiError(error) && error.isUnauthenticated) return { state: "signed-out" };

    throw error;
  }
}

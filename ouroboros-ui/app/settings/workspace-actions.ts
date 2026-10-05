"use server";

/**
 * The Workspace card's write, as a Server Action
 * (BS.2, [#492](https://github.com/NobuData/ouroboros/issues/492)).
 *
 * The card is one section of the save model and two resources of the service, so its one commit
 * is up to two requests, sent in this order:
 *
 * 1. **`PATCH /api/v1/settings/workspace`** — name and domain. It is the write another workspace
 *    can refuse (`409 domain_taken`), which no check in the browser can foresee, so it goes
 *    first: refused, nothing on the card is written at all.
 * 2. **`PATCH /api/v1/settings/retention`** — the tiers. Every bound it enforces is in the read
 *    the card validated against, so after the browser's check it is refused only by something
 *    that changed underneath the page (a role, a race).
 *
 * Each request is all-or-nothing on its own. When the second is refused after the first landed,
 * the answer says so in words rather than claiming nothing changed, and the page is re-read
 * (`refresh()`): the landed name and domain become the baseline, so only the tiers stay unsaved
 * and a retry sends only them. Both writes are idempotent — a body carrying current values writes
 * nothing — so a retry can never write anything twice.
 *
 * **The role gate is the service's.** A Server Action is a POST anybody can reach; both routes
 * are `owner` or `admin` only.
 */

import { refresh } from "next/cache";

import { isApiError } from "@/app/api/errors";
import { settingsWorkspace } from "@/app/api/settings-workspace";

import type { SectionCommitResult } from "./save-model";
import {
  SAVE_FAILED,
  WORKSPACE_NOT_SAVED,
  type WorkspacePatches,
  retentionFieldErrors,
  retentionNotSaved,
  workspaceFieldErrors,
} from "./workspace";

/**
 * Save the Workspace card.
 *
 * @param patches The section's changes, split by {@link workspacePatches}.
 * @returns `{ok: true}` when everything sent landed; otherwise why, with errors per field.
 * @throws Anything that is not the service refusing — a redirect to sign in keeps travelling.
 */
export async function saveWorkspaceCard(patches: WorkspacePatches): Promise<SectionCommitResult> {
  let landed = false;

  if (patches.workspace !== undefined) {
    try {
      await settingsWorkspace.update(patches.workspace);
      landed = true;
    } catch (error) {
      if (!isApiError(error)) throw error;

      return {
        ok: false,
        reason: `${WORKSPACE_NOT_SAVED} ${error.message || SAVE_FAILED}`,
        fields: workspaceFieldErrors(error.details),
      };
    }
  }

  if (patches.retention !== undefined) {
    try {
      await settingsWorkspace.updateRetention(patches.retention);
    } catch (error) {
      if (!isApiError(error)) throw error;

      const message = error.message || SAVE_FAILED;
      // What landed is re-read, so the card stops offering the name and domain as unsaved.
      if (landed) refresh();

      return {
        ok: false,
        reason: landed ? retentionNotSaved(message) : `${WORKSPACE_NOT_SAVED} ${message}`,
        fields: retentionFieldErrors(error.details, patches.retentionFields),
      };
    }
  }

  return { ok: true };
}

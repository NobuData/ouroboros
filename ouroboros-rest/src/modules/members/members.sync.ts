/**
 * Directory sync status — the footer's *"Roles sync from Okta group `ouroboros-*` nightly ✓"*
 * ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 *
 * **Absent until SCIM exists.** Group sync is BT.1, and it does not exist yet. Rendering the line
 * before it does would tell an administrator their offboarding is automated when it is manual —
 * the most consequential possible lie on the page. So this seam answers `null`, always, and the
 * members resource carries `directorySync: null` until BT.1 replaces this binding with one that
 * reads a real, syncing SCIM connection.
 */

import { Injectable } from "@nestjs/common";

/** What the footer's sync line will say once BT.1 exists. */
export interface DirectorySyncResource {
  /** The identity provider, e.g. `Okta`. */
  provider: string;
  /** The group pattern roles sync from, e.g. `ouroboros-*`. */
  groupPattern: string;
  /** How often, e.g. `nightly`. */
  cadence: string;
  /** When the last successful sync finished. */
  lastSyncedAt: string;
}

@Injectable()
export class DirectorySyncStatus {
  /**
   * The workspace's directory sync, if it really syncs.
   *
   * @param _organizationId - The workspace.
   * @returns `null` — SCIM (BT.1) does not exist yet.
   */
  current(_organizationId: string): Promise<DirectorySyncResource | null> {
    return Promise.resolve(null);
  }
}

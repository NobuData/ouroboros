/**
 * The rules of the preferences surface ([#649](https://github.com/NobuData/ouroboros/issues/649)),
 * which are three:
 *
 *   * **The person is the session's, never the request's.** There is no `userId` parameter
 *     anywhere on this surface — `/me/preferences` reads and writes the caller's own row,
 *     resolved through `currentUser()`, so "whose preferences" is a question a request
 *     cannot even ask wrongly.
 *   * **Absence is the defaults.** A person who has never chosen has no row, and reads back
 *     `fontScale: '100'` synthesized by `resources.ts` — never a 404, because a preference
 *     always has a value, and never a written-on-read row, because the table holds choices.
 *   * **A write is an upsert.** "Set my scale" is the same request whether it is the first
 *     choice or the fortieth, and the repository lets the database arbitrate the difference.
 */

import { Injectable } from "@nestjs/common";

import { currentUser } from "../tenancy/tenant.context";
import type { PatchPreferencesDto } from "./preferences.dto";
import { PreferencesRepository } from "./preferences.repository";
import { preferencesResource, type PreferencesResource } from "./resources";

@Injectable()
export class PreferencesService {
  constructor(private readonly preferences: PreferencesRepository) {}

  /**
   * The caller's preferences, defaults included.
   *
   * @returns The resource — stored choices where they exist, defaults where none do.
   */
  async read(): Promise<PreferencesResource> {
    return preferencesResource(await this.preferences.findFor(this.caller()));
  }

  /**
   * Apply what the caller changed, and answer with the whole surface as it now stands.
   *
   * A body carrying nothing is legal and changes nothing — PATCH means "what is present
   * changed", and the honest answer to an empty change is the current state, not an error
   * a client writing `{...(scale && {fontScale: scale})}` would then have to defend against.
   *
   * @param patch - The validated body.
   * @returns The resource after the write, read back from what the database returned rather
   *   than from what was sent — the row is the truth, and the trigger has already stamped it.
   */
  async update(patch: PatchPreferencesDto): Promise<PreferencesResource> {
    const userId = this.caller();

    if (patch.fontScale === undefined) {
      return preferencesResource(await this.preferences.findFor(userId));
    }

    return preferencesResource(await this.preferences.upsertFontScale(userId, patch.fontScale));
  }

  /**
   * The signed-in person, or a loud failure.
   *
   * @returns Their id.
   * @throws {Error} When there is no signed-in person — unreachable through the pipeline,
   *   because the routes are authenticated and only tenant-optional; the same posture as
   *   `orgs.service.ts`, and for the same reason: a preferences row scoped to nobody would
   *   be one everybody shares.
   */
  private caller(): string {
    const user = currentUser();

    if (user === undefined) {
      throw new Error(
        "/api/v1/me/preferences was reached with no signed-in person. The routes are " +
          "@TenantOptional(), not @AllowAnonymous() — preferences belong to somebody.",
      );
    }

    return user.id;
  }
}

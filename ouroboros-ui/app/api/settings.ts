/**
 * The workspace's settings — today, the one switch mockup 02 can flip.
 *
 * `/api/v1/settings/auto-merge` ([#74](https://github.com/NobuData/ouroboros/issues/74)) is
 * decision F6 of `docs/ROADMAP_MOCKUP_02_DASHBOARD.md`: **auto-merge is a real workspace
 * setting**, org-scoped and owner/admin-writable, and it is the dashboard's only mutation.
 *
 * ### Why this exists beside `app/api/dashboard.ts`, which already carries the same boolean
 *
 * The aggregate reports the switch's *position* (`pulse.autoMerge`) because the page paints
 * in one round trip and the pulse card has to draw the switch on that first paint. This
 * module is the operation that **changes** it — and the one that reads it back with its
 * attribution, which the aggregate does not carry. So the card reads through the aggregate
 * and writes through here, and the two never disagree for longer than one poll: the
 * aggregate's `ETag` fingerprints the settings table, so a persisted flip turns the next
 * poll's `304` back into a `200`.
 *
 * ### The write is role-gated, and this module does not enforce that
 *
 * `owner` or `admin`, and nobody else — a `member` or a `viewer` gets the API's `403` with
 * `code: "forbidden_role"`. The gate is the service's, deliberately: a Server Action is a
 * POST endpoint anybody can reach, so a check made only in the browser would be a check
 * anybody could skip. What the UI does with the role is *presentation* — the switch renders
 * read-only with its reason, which is the design system's § 3.3 permission-limited state —
 * and `app/dashboard/pulse-actions.ts` is where the two meet.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * The position of the **Auto-merge when checks pass** switch, with its attribution.
 *
 * The stamps are nullable **together**: both are null exactly when the workspace has never
 * written a settings row, which is how a client tells a chosen `false` from a default one.
 */
export type AutoMergeSetting = components["schemas"]["AutoMergeSetting"];

/** The `code` the contract answers when a role may read the setting but not write it. */
export const FORBIDDEN_ROLE_CODE = "forbidden_role";

/**
 * The auto-merge setting, as `ouroboros-rest` keeps it.
 */
export const autoMerge = {
  /**
   * Where the switch stands, and who last moved it.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass
   *   one over a stub `fetch`.
   * @returns The setting. Never a `404` and never empty: a workspace that has never chosen
   *   reads `false` with both stamps null.
   * @throws {ApiError} What the service answered.
   */
  async read(client: ApiClient = api()): Promise<AutoMergeSetting> {
    return unwrap(await client.GET("/api/v1/settings/auto-merge", {}));
  },

  /**
   * Move the switch, and answer with where it now stands.
   *
   * @param enabled The position to move to — the state to *be in*, not a request to
   *   invert whatever the row currently holds. Two administrators pressing at once
   *   therefore agree on an outcome rather than racing to swap it twice.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The setting after the write, read back from the row rather than echoed from
   *   the request.
   * @throws {ApiError} What the service answered — {@link FORBIDDEN_ROLE_CODE} for a role
   *   that may look at this switch and not flip it.
   */
  async set(enabled: boolean, client: ApiClient = api()): Promise<AutoMergeSetting> {
    return unwrap(
      await client.PATCH("/api/v1/settings/auto-merge", { body: { enabled } }),
    );
  },
};

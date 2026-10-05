"use server";

/**
 * The Notifications card's write, as a Server Action
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * The card is one section of the save model and one resource per route, so its one commit is one
 * `PATCH /api/v1/settings/notifications/{kind}` per changed route, **in the card's order,
 * stopping at the first refusal**. Each request is all-or-nothing on its own. When a later one is
 * refused after earlier ones landed, the answer says which were saved and which was not, and the
 * page is re-read (`refresh()`): the landed routes become the baseline, so only what is still
 * unsaved stays unsaved. Every write is idempotent — a body carrying current values changes
 * nothing — so a retry writes nothing twice.
 *
 * **The role gate and the locked-row rule are the service's.** A Server Action is a POST anybody
 * can reach: the route is `owner` or `admin` only, and a save that would leave a route enabled on
 * a channel that cannot deliver is refused `409 notification_route_locked` whatever this card
 * offered.
 */

import { refresh } from "next/cache";

import { isApiError } from "@/app/api/errors";
import { settingsIntegrations } from "@/app/api/settings-integrations";
import type { SectionCommitResult } from "@/app/settings/save-model";

import { type RoutePatch, routeFieldErrors, routeRefusal, routesNotSaved } from "./routes";

/**
 * Save the Notifications card.
 *
 * @param patches The changed routes, in the card's order ({@link routePatches}).
 * @returns `{ok: true}` when every route landed; otherwise what landed, what did not and why,
 *   with errors for the refused route's fields.
 * @throws Anything that is not the service refusing — a redirect to sign in keeps travelling.
 */
export async function saveRoutes(patches: readonly RoutePatch[]): Promise<SectionCommitResult> {
  const landed: string[] = [];

  for (const { kind, name, patch } of patches) {
    try {
      await settingsIntegrations.updateRoute(kind, patch);
      landed.push(name);
    } catch (error) {
      if (!isApiError(error)) throw error;

      // What landed is re-read, so the card stops offering those routes as unsaved.
      if (landed.length > 0) refresh();

      return {
        ok: false,
        reason: routesNotSaved(landed, name, routeRefusal(error.code, error.message, error.details)),
        fields: routeFieldErrors(kind, error.details),
      };
    }
  }

  return { ok: true };
}

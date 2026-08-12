import { redirect } from "next/navigation";

import { DASHBOARD_PATH } from "@/app/paths";

/**
 * The product's root, which is now a signpost rather than a screen.
 *
 * `/` was the scaffold's placeholder and then, briefly, where a signed-in request landed.
 * #45 moves the dashboard to its own segment, because a page needs a route of its own before
 * anything can link to it, highlight it in the sidebar, or replace it — and `/` is the one
 * route in the product that belongs to no module.
 *
 * It redirects rather than 404s so that everything already pointing here still arrives:
 * bookmarks, the OAuth callback's landing, and any link written while this was the
 * dashboard. {@link DASHBOARD_PATH} is that target, from `app/paths.ts`, so this file and
 * the login screen that redirects to the same place cannot drift apart.
 *
 * **No session check here, deliberately.** There is nothing on this route to protect — it
 * renders nothing and reads nothing — and the gate a visitor actually needs is the one on
 * the page they are being sent to. Checking here as well would cost every request to `/` an
 * extra `GET /auth/me` to reach the same outcome one redirect later.
 *
 * Temporary rather than permanent (`redirect`, not `permanentRedirect`): a `308` is cached
 * by the browser indefinitely, which would make `/` unusable for anything else for as long
 * as anyone who visited it today still has a profile.
 *
 * @returns Never. `redirect` signals by throwing.
 */
export default function Page(): never {
  redirect(DASHBOARD_PATH);
}

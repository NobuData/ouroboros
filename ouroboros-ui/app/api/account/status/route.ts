import { readAppAdmin } from "@/app/accounts/admin-data";

/** Nothing here may be cached by anything between the browser and this origin. */
const CACHE_CONTROL = "private, no-cache";

/**
 * `GET /api/account/status` — whether the reader is an application administrator (account
 * approval), for the sidebar's **Accounts** entry (`app/accounts/admin-nav.tsx`).
 *
 * Answers only the one flag the browser needs, never the rest of the service's status body, and
 * answers `false` for every failure — see `readAppAdmin` for why that is the safe direction.
 *
 * @returns `200 { "appAdmin": boolean }`.
 */
export async function GET(): Promise<Response> {
  return Response.json(
    { appAdmin: await readAppAdmin() },
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}

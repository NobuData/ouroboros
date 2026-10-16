import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { PENDING_PAGE_TITLE } from "@/app/accounts/pending";
import { readAccountStanding } from "@/app/accounts/pending-data";
import { PendingScreen } from "@/app/accounts/pending-screen";
import { DASHBOARD_PATH, LOGIN_PATH } from "@/app/paths";

/** The tab's title. */
export const metadata: Metadata = {
  title: PENDING_PAGE_TITLE,
};

/**
 * `/account-pending` — where a person whose account is on hold is sent (account approval).
 *
 * `app/api/server.ts` and `app/api/auth-server.ts` turn the service's `403
 * account_pending_approval` / `account_denied` into this address, so every product page — and
 * the login screen after a sign-in — lands a held person here. It lives in the `(auth)` group,
 * without the shell, and it reads `GET /api/v1/account/status` rather than the session: the
 * session read is what redirects here, so reading it would send the page to itself.
 *
 * An approved account has no business here and goes to the dashboard; nobody signed in goes to
 * the login screen.
 *
 * @returns The waiting page, pending or denied.
 */
export default async function AccountPendingPage() {
  // Per-request by definition, and said before the read so `next build` never reaches
  // `restUrl()` while prerendering.
  await connection();

  const standing = await readAccountStanding();

  if (standing.state === "signed-out") redirect(LOGIN_PATH);
  if (standing.state === "approved") redirect(DASHBOARD_PATH);

  return <PendingScreen email={standing.email} status={standing.status} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ADMIN_PAGE_TITLE } from "@/app/accounts/admin";
import { readAdminAccounts, readAppAdmin } from "@/app/accounts/admin-data";
import { AdminAccountsScreen } from "@/app/accounts/admin-screen";
import { requireWorkspace } from "@/app/api/access";

/** The tab's title. */
export const metadata: Metadata = {
  title: ADMIN_PAGE_TITLE,
};

/**
 * `/admin/accounts` — the application administrators' approval page (account approval).
 *
 * In the shell, so it goes through the shell's gate first (`requireWorkspace`: a session and a
 * workspace, else the login screen; a held account never gets past the session read). Then the
 * one question this page asks of its own: is the reader an application administrator? Anyone
 * else is answered **not-found** — the page does not admit to existing — and the service would
 * refuse every read below with `403 app_admin_required` anyway.
 *
 * @returns The accounts page.
 * @throws Next.js's not-found signal, for a reader who is not an application administrator.
 */
export default async function AdminAccountsPage() {
  await requireWorkspace();

  if (!(await readAppAdmin())) notFound();

  const reading = await readAdminAccounts();

  return (
    <AdminAccountsScreen
      denied={reading.denied}
      pending={reading.pending}
      preapproved={reading.preapproved}
      readAt={new Date().toISOString()}
    />
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { currentAccess } from "@/app/api/access";
import { readRecovery } from "@/app/lifecycle/recovery-data";
import { RecoveryScreen } from "@/app/lifecycle/recovery-screen";
import { DASHBOARD_PATH, LOGIN_PATH } from "@/app/paths";

/**
 * `/workspace-recovery` — the pending-delete lockout screen
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * Where every request acting in a workspace that is pending deletion is sent
 * (`app/api/server.ts` turns the service's `403 workspace_pending_delete` into this address, and
 * the shell's lifecycle poll leaves for it). It lives in the `(auth)` group because that group
 * has no shell: the shell's own reads are among what is frozen.
 *
 * Thin, the shape every page here takes: the session says who is asking and for which
 * workspace, one read says whether that workspace is frozen and whether this reader may restore
 * it (`app/lifecycle/recovery-data.ts`), and a component draws it. A workspace that is **not**
 * pending deletion has no recovery screen — the reader is sent to the dashboard — and a request
 * with no session, or no workspace, to sign in.
 *
 * @returns The recovery screen for the session's workspace.
 */
export const metadata: Metadata = {
  title: "Workspace pending deletion · Ouroboros",
};

export default async function RecoveryPage() {
  const { session, membership } = await currentAccess();

  if (session === null || membership === undefined) redirect(LOGIN_PATH);

  const reading = await readRecovery();

  if (reading.state === "signed-out") redirect(LOGIN_PATH);
  if (reading.state === "open") redirect(DASHBOARD_PATH);

  return (
    <RecoveryScreen
      others={session.memberships
        .filter((other) => other.id !== membership.id)
        .map((other) => ({ id: other.id, name: other.name }))}
      purgeAfter={reading.purgeAfter}
      restorable={reading.restorable}
      workspaceName={membership.name}
    />
  );
}

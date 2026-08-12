import "server-only";

/**
 * Everything the dashboard reads, in one pass.
 *
 * The composition lives here rather than in the route for the reason `app/api/enablement.ts`
 * gives: the contract has no operation that answers "the dashboard", so somebody has to
 * issue four calls and hand back one object, and a screen is not the place to do it. What
 * this adds beyond issuing them is the property the screen is built on — **one failed read
 * is one degraded card, never a blank page**.
 *
 * ### The reads are independent, and so are their failures
 *
 * All four go out together and each is wrapped by {@link attempt}, so a members listing
 * that fails leaves the enablement counts, the status pills and the page head intact. The
 * alternative — one `await` chain, or a bare `Promise.all` — makes every card depend on the
 * unluckiest of them, which on a screen whose whole job is reporting the system's health is
 * exactly backwards.
 *
 * ### What is *not* caught
 *
 * {@link attempt} catches an `ApiError` and nothing else, deliberately. A `401` reaches this
 * layer as Next.js's redirect signal rather than as an error (`app/api/server.ts`), and a
 * `catch` wide enough to hold it would swallow the navigation to the login screen and draw
 * a dashboard captioned with the framework's internal message. Everything that is not the
 * service refusing a request keeps travelling.
 */

import type { Workspace } from "@/app/api/access";
import { readEnablement } from "@/app/api/enablement";
import { engine } from "@/app/api/engine";
import { isApiError } from "@/app/api/errors";
import { readReadiness } from "@/app/api/health";
import { members } from "@/app/api/members";

import type { DashboardReadings, Reading } from "./view";

/**
 * How many members to ask for.
 *
 * The contract's maximum rather than its default of 25, so the role breakdown under the
 * count describes as much of the workspace as one request can. The count itself is the
 * service's own `total` and does not depend on this at all; what it bounds is how much of
 * the breakdown is real, which the card says out loud when the two differ
 * (`app/dashboard/view.ts`).
 */
export const MEMBER_LIMIT = 100;

/**
 * Read the dashboard.
 *
 * @param access The session and workspace the gate returned. Taken as an argument rather
 *   than re-read here so that the page's authorization and the page's data are one
 *   decision: the caller has already been sent to the login screen if it had no business
 *   asking.
 * @returns Everything the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how
 *   a session that expired between the gate and these calls still reaches the login screen.
 */
export async function readDashboard(access: Workspace): Promise<DashboardReadings> {
  const tenantId = access.membership.tenantId;

  const [memberPage, enablement, readiness, engineStatus] = await Promise.all([
    attempt(() => members.list(tenantId, { limit: MEMBER_LIMIT })),
    attempt(() => readEnablement(tenantId)),
    readReadiness(),
    attempt(() => engine.status()),
  ]);

  return {
    workspace: access.membership,
    user: access.session.user,
    members: memberPage,
    enablement,
    readiness,
    engine: engineStatus,
  };
}

/**
 * Run one read, keeping its failure as a value instead of as a throw.
 *
 * @param read The call to make.
 * @returns What it returned, or the message the service gave for refusing. That message is
 *   safe to render: every one in the contract's envelope is written for a person and names
 *   nothing about the service's internals (`app/api/errors.ts`).
 * @throws Anything that is not an `ApiError`, unchanged — see this file's own note.
 */
async function attempt<T>(read: () => Promise<T>): Promise<Reading<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return { ok: false, reason: error.message };
  }
}

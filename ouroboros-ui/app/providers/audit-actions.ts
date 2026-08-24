"use server";

/**
 * The server hop for the **Audit log** sheet
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)) — the one call the sheet cannot
 * make itself.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/dashboard/pulse-actions.ts`
 * is the same seam for the pulse switch: the browser cannot reach REST — `OURO_REST_URL` has
 * no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so a Client Component that
 * needs something from the API calls a Server Action that calls it.
 *
 * ### Why the sheet reads on open rather than being handed its rows
 *
 * The alternative was for the providers page to read the trail server-side and pass it down,
 * which is what `app/models/data.ts` does for the health strip. It is rejected here for a
 * reason specific to this surface: **the sheet is behind a button most visits never press**,
 * and a page-load read would make every provider page view pay for an audit query — one that
 * a `viewer` or a `member` is not even allowed to make, so most of those queries would be
 * `403`s discarded before render.
 *
 * The cost is a spinner the first time somebody opens it, which is the honest trade for a
 * surface whose whole job is to be available when it is wanted.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * The paragraph every action module in this product carries:
 *
 * - **There is no workspace in the call and no person.** The trail belongs to *the workspace
 *   the caller's own session is acting in*, resolved by `ouroboros-rest` from the cookie this
 *   request carries. There is nothing to forge and no way to point the read at somebody
 *   else's history.
 * - **The role gate is the service's, not this module's** — `owner` or `admin`, and nobody
 *   else (AD.4). A `member` who calls this action directly gets the service's `403` and reads
 *   nothing; the sheet renders the sentence rather than the code, which is presentation, not
 *   enforcement. Duplicating the rule here would create a second copy of it to drift.
 *
 * ### Failure posture: a sentence, not a throw
 *
 * A refusal comes back as a value. The sheet is opened *over* a page the reader is still
 * entitled to be on, and a rejected action would replace it with an error screen — which is
 * the wrong outcome for "the thing behind this button could not be read".
 */

import { isApiError } from "@/app/api/errors";
import { audit } from "@/app/api/audit";

import { AUDIT_FORBIDDEN, AUDIT_PAGE_SIZE, AUDIT_UNAVAILABLE, type AuditReading } from "./view";

/**
 * **Every value this module needs is imported rather than declared.** A `"use server"` module
 * may export nothing but async functions — a `const` beside them is a build error, and the
 * whole module is treated as exporting nothing — so the sentences, the page size and the
 * result type live in `app/providers/view.ts` with the rest of this sheet's copy.
 */

/** The `code` the contract answers when a role may see the providers page and not its trail. */
const FORBIDDEN = "forbidden";

/**
 * Read the most recent credential events for the caller's own workspace.
 *
 * @returns The page, or the sentence to show instead. A workspace where nothing has happened
 *   yet reads successfully and answers an empty list — an empty trail and a trail nobody
 *   could read are different facts, and the sheet says something different for each.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how a
 *   session that expired since the page rendered still reaches the login screen.
 */
export async function readAuditTrail(): Promise<AuditReading> {
  try {
    const page = await audit.events({ limit: AUDIT_PAGE_SIZE });

    return { ok: true, events: page.items, total: page.total };
  } catch (error) {
    if (!isApiError(error)) throw error;

    // The service's own `403` message is written for an API caller. This answers with the
    // sentence a person opening a sheet should read, and says who to ask.
    return { ok: false, reason: error.code === FORBIDDEN ? AUDIT_FORBIDDEN : AUDIT_UNAVAILABLE };
  }
}

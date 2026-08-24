import "server-only";

/**
 * Everything the dashboard reads, in one pass.
 *
 * The composition lives here rather than in the route for the reason `app/api/enablement.ts`
 * gives: no single operation answers "the dashboard", so somebody has to issue three calls
 * and hand back one object, and a screen is not the place to do it. What this adds beyond
 * issuing them is the property the screen is built on — **one failed read is one degraded
 * card, never a blank page**.
 *
 * ### One of the three is the aggregate, and it is one call by design
 *
 * `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) answers
 * every number, list and switch mockup 02 draws in a single payload — decision F5, so the
 * page paints in one round trip rather than in eight. This is its **first** read, made here
 * so the page arrives rendered; [#87](https://github.com/NobuData/ouroboros/issues/87)'s
 * polling hook is what keeps it fresh afterwards, with the `ETag` this call ignores.
 *
 * The other two are #45's and they stay: the readiness probe and the engine's build answer
 * the system card's question, which the aggregate does not ask.
 *
 * **The members listing and the enablement lists were read here until
 * [#81](https://github.com/NobuData/ouroboros/issues/81)**, because #45's stat row counted
 * people, organisations and repositories while nothing could report on a loop. The row it
 * drew is now the mockup's own four figures, all of them the aggregate's, so those two
 * reads had no card left to fill — and a page that fetched them anyway would be paying for
 * two round trips per render, and per poll, to draw nothing. Both operations are unchanged
 * and still read elsewhere (`app/shell/`); what went is this page's use of them.
 *
 * ### The page is measured from one clock reading
 *
 * The dashboard draws durations that are still running — a run's *Elapsed*
 * ([#82](https://github.com/NobuData/ouroboros/issues/82)) — and `now` is therefore an input
 * to the render rather than something a component may go and look up. It is read here, once,
 * beside the reads it belongs with: two cards reading their own clocks would be two cards
 * able to disagree about what time it is, and a clock read inside a component is a clock no
 * test can pin.
 *
 * ### The reads are independent, and so are their failures
 *
 * All three go out together and each of the two that can refuse is wrapped by
 * {@link attempt}, so an aggregate that fails leaves the status pills and the greeting
 * intact. The alternative — one `await` chain, or a bare `Promise.all` — makes every card
 * depend on the unluckiest of them, which on a screen whose whole job is reporting the
 * system's health is exactly backwards.
 *
 * ### What is *not* caught
 *
 * {@link attempt} catches an `ApiError` and nothing else, deliberately. A `401` reaches this
 * layer as Next.js's redirect signal rather than as an error (`app/api/server.ts`), and a
 * `catch` wide enough to hold it would swallow the navigation to the login screen and draw
 * a dashboard captioned with the framework's internal message. Everything that is not the
 * service refusing a request keeps travelling.
 *
 * It was this module's own function until
 * [#200](https://github.com/NobuData/ouroboros/issues/200), which is when a second screen
 * needed the same rule; it lives in `app/api/reading.ts` now, with the argument above kept
 * beside it. Two readers deciding separately what counts as a catchable failure is how one
 * of them ends up swallowing a redirect.
 */

import type { Workspace } from "@/app/api/access";
import { dashboard } from "@/app/api/dashboard";
import { engine } from "@/app/api/engine";
import { readReadiness } from "@/app/api/health";
import { attempt } from "@/app/api/reading";

import type { DashboardReadings } from "./view";

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
  const [aggregate, readiness, engineStatus] = await Promise.all([
    attempt(() => dashboard.read()),
    readReadiness(),
    attempt(() => engine.status()),
  ]);

  return {
    workspace: access.membership,
    user: access.session.user,
    // Taken after the reads rather than before them, so a slow round trip is not counted as
    // part of a run's elapsed time. One reading for the whole page: see `DashboardReadings`.
    readAt: Date.now(),
    aggregate,
    readiness,
    engine: engineStatus,
  };
}

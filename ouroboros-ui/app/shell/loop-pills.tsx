"use client";

import { useDashboardSummary } from "@/app/dashboard/summary-store";

/**
 * The two pills that say what the loop is doing, from real counts
 * ([#78](https://github.com/NobuData/ouroboros/issues/78)).
 *
 * ```
 * [● 3 loops live]  [● Needs you · 2]
 * ```
 *
 * They are what `docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.1 puts between the search pill and the
 * notifications bell, and what mockup 02 draws in the topbar. CP.1
 * ([#643](https://github.com/NobuData/ouroboros/issues/643)) shipped them as em dashes
 * because there was no count to show and *a placeholder that looks like a count is worse than
 * no count at all*; this is the issue that fills them.
 *
 * ### No request of their own
 *
 * Both read the shared store ([#87](https://github.com/NobuData/ouroboros/issues/87)) —
 * decision F4, and the reason `useDashboardSummary()` is provided at the `(app)` layout
 * rather than inside the dashboard route. The pills are chrome on *every* signed-in screen,
 * so a poll of their own would be a second loop that could disagree with the page's on how
 * many loops are live, at the same moment, in the same window.
 *
 * ### Hidden at zero, and hidden before the first answer
 *
 * A pill is drawn only for a count above zero. That is the specification's own rule — *an
 * empty organization shows neither pill, not a zero* — and it holds for the same reason the
 * em dashes did: `0 loops live` is a claim, and a workspace with nothing in it is better
 * described by the absence of the claim than by a row of noughts. Before the first poll
 * lands there is no `data` at all, which draws nothing by the same branch, so the header
 * never shows a number nobody has computed.
 *
 * ### The live region is the container, not the pills
 *
 * `aria-live="polite"` sits on the wrapper, which is **always rendered**, because a live
 * region has to be in the accessibility tree *before* the content that changes inside it —
 * a region inserted along with its own first announcement is a region a screen reader may
 * never read. So the wrapper stays and its children come and go, which makes every count
 * change an update to an existing region: `3 loops live` becoming `4 loops live` is
 * announced without the reader having gone looking for it, and without interrupting what
 * they were reading, which is what *polite* buys.
 */

/**
 * How the needs-you pill explains itself.
 *
 * Two things it has to say, and § 3.5's honesty rule is why both are here rather than
 * neither. **What the number counts** — the endpoint's `interventions7d`, which is runs that
 * stopped for a human in the trailing seven days, not a live queue — because *Needs you · 2*
 * beside a two-day-old workspace would otherwise read as two things waiting right now.
 * **Why it does not go anywhere**: the inbox is mockup 16's screen and its placeholder route
 * is [#49](https://github.com/NobuData/ouroboros/issues/49), so linking now would be a link
 * to a `404` — which is precisely what the sidebar's own *Needs You* entry declines to be.
 */
export const NEEDS_YOU_NOTE =
  "Runs that stopped for a human in the last seven days. The needs-you inbox itself " +
  "arrives with its own roadmap (mockup 16); its placeholder route is #49.";

/**
 * The pills.
 *
 * @returns The live region, holding whichever of the two pills has something to report.
 */
export function LoopPills() {
  const { data } = useDashboardSummary();

  const live = data?.stats.loopsLive.total ?? 0;
  const needsYou = data?.pulse.interventions7d ?? 0;

  return (
    <div className="shell-pills" aria-live="polite">
      {live > 0 && (
        <span className="shell-pill">
          {/* Decoration: the sentence beside it already says the loop is live, and a dot a
              screen reader announced would be a bullet read before every count. */}
          <span className="shell-pill__dot shell-pill__dot--live" aria-hidden />
          <span className="shell-pill__count">{live}</span> loops live
        </span>
      )}

      {needsYou > 0 && (
        <span className="shell-pill shell-pill--warn" title={NEEDS_YOU_NOTE}>
          <span className="shell-pill__dot shell-pill__dot--warn" aria-hidden />
          Needs you <span aria-hidden>·</span>{" "}
          <span className="shell-pill__count">{needsYou}</span>
        </span>
      )}
    </div>
  );
}

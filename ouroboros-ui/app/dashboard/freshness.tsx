"use client";

import { type ReactNode, useState } from "react";

import { StaleBanner } from "./stale-banner";

/**
 * What keeps the dashboard on screen when a read fails
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)).
 *
 * The page is server-rendered from three reads, and any of them can start failing while
 * somebody is looking at it — a service restarted, a network dropped, a session that lost its
 * workspace. Without this, the next render replaces a page full of real figures with a page
 * full of em dashes: the reader loses the data they were reading *because a refresh failed*,
 * which is the wrong trade in every case. So this remembers the last render that worked and
 * puts it back, under a banner saying how old it is and offering a retry.
 *
 * ### It holds the rendered tree, not the payload
 *
 * `children` is the route's Server Component output — the whole page, already rendered. Held
 * in state and rendered again, it is the same markup the reader was looking at, with **no
 * card moved into the browser bundle**: the cards stay Server Components, the aggregate stays
 * on the server, and this file is the only client code the arrangement costs. Holding the
 * *payload* instead would mean every card that draws it had to become a Client Component,
 * which is a large change to the shape of this screen for no visible difference.
 *
 * That also settles what happens on a hard reload while the service is down: nothing is held,
 * because nothing in this browser has ever been read, so the page renders its unread state
 * honestly rather than resurrecting something from storage.
 *
 * ### Why the state is adjusted during the render
 *
 * The rule React documents for "adjust state when a prop changes" is to set it **while
 * rendering**, guarded on the value that changed, rather than in an effect. An effect would
 * render the stale tree once and correct it in a second pass — a visible flash of the wrong
 * page — and it is what `react-hooks/set-state-in-effect` reports. `app/shell/client-value.ts`
 * makes the same argument for the same reason.
 *
 * ### What a retry does, and why the held tree survives it
 *
 * `router.refresh()` re-runs the route on the server and merges the result "without losing
 * unaffected client-side React (e.g. `useState`)" — Next.js's own words for it. This
 * component's state is exactly that: a retry that fails again arrives as another `ok={false}`
 * render, and the tree held here is still the one from before the failures started. The
 * auto-merge switch is built on the same property.
 *
 * **[#87](https://github.com/NobuData/ouroboros/issues/87) is the other half.** Its polling
 * hook replaces the manual retry with an `ETag`-aware timer; what it will drive is this same
 * boundary, so the freshness rule is written once and lands here rather than in the hook.
 */

/** What the boundary takes. */
export interface FreshnessProps {
  /**
   * Whether the render being handed over actually read the dashboard — the aggregate's
   * `ok`. It is a boolean rather than the reading itself because this component never looks
   * at the data: the route has already rendered it, and all this decides is *which* render
   * the reader sees.
   */
  readonly ok: boolean;
  /**
   * Why the read failed, when it did. Shown by the banner, and by nothing else on the page.
   */
  readonly reason: string | null;
  /** When this render read the dashboard, in milliseconds since the epoch. */
  readonly readAt: number;
  /** The page, as the route rendered it. */
  readonly children: ReactNode;
}

/** One render worth keeping: the page as it was, and when it was read. */
interface Snapshot {
  /** The rendered page. */
  readonly tree: ReactNode;
  /** When it was read — what the banner's *"showing data from 14:02"* is drawn from. */
  readonly readAt: number;
}

/**
 * The boundary.
 *
 * @param props See {@link FreshnessProps}.
 * @returns The current page when the read worked; otherwise the last one that did, under a
 *   banner — or, when nothing has ever been read here, the page's own unread state under the
 *   same banner. Either way the reason appears exactly once, beside the only retry.
 */
export function Freshness({ ok, reason, readAt, children }: FreshnessProps) {
  const [held, setHeld] = useState<Snapshot | null>(null);

  // The render-time adjustment. Guarded on the tree's identity, so it runs once per render
  // that arrives from the server rather than on every re-render this component makes for
  // itself — a retry's pending state, for one.
  if (ok && held?.tree !== children) {
    setHeld({ tree: children, readAt });
  }

  if (ok) return <>{children}</>;

  return (
    <>
      <StaleBanner reason={reason ?? UNEXPLAINED} readAt={held?.readAt ?? null} />
      {/*
        The held page when there is one, and this render's own otherwise. The second case is
        not a fallback so much as the honest first-paint failure: the cards say what they
        could not read, and the banner above says why.
      */}
      {held?.tree ?? children}
    </>
  );
}

/**
 * What the banner says when the read failed without saying why.
 *
 * Every refusal in the contract's envelope carries a message, so this is the guard rather
 * than the expected case — but a banner explaining nothing is worse than a banner admitting
 * it has nothing to explain, and *"could not be read"* with an empty line under it would look
 * like a rendering bug rather than an outage.
 */
const UNEXPLAINED = "The service gave no reason.";

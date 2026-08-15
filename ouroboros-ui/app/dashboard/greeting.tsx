"use client";

import type { DashboardActivity } from "@/app/api/dashboard";
import { useClientValue } from "@/app/shell/client-value";

import { type Daypart, daypartAt, greeting } from "./view";

/**
 * The dashboard's heading — *"Good afternoon, Ken — the loop is turning."*
 *
 * **The one client component on this page, and decision F7 is the whole reason.** The
 * greeting names a part of *the reader's* day, and the only clock that knows which part
 * that is is the one in front of them: a server rendering "good afternoon" is rendering its
 * own afternoon, which for a workspace with people in two hemispheres is wrong for half of
 * them on every request. Everything else in the page head is server data and stays there.
 *
 * ### Why it does not read the clock during render
 *
 * A `new Date()` in a render body produces one value on the server and another in the
 * browser, and React resolves that disagreement by throwing the server's markup away.
 * `useClientValue` (`app/shell/client-value.ts`) is the shell's answer to exactly this
 * shape of problem: React's own `useSyncExternalStore` with a server snapshot and a client
 * snapshot, so the hydration pass matches by construction and the correction lands in the
 * same commit rather than in a cascading second render.
 *
 * The server snapshot is `null`, which {@link greeting} renders as *"Hello, Ken"*. The
 * heading is complete and correctly named from the first paint — it just does not claim to
 * know the time until something does.
 *
 * The daypart is read once and never re-subscribed, like every other value that store
 * carries. A page left open across noon keeps the greeting it was opened with, which is the
 * right trade: the alternative is a timer per dashboard for a word.
 */

/**
 * The heading.
 *
 * @param props.displayName The signed-in person's name, as the session reports it.
 * @param props.activity The aggregate's activity, or `null` when it could not be read — the
 *   source of the closing clause, which is a fact about the loop rather than a flourish.
 * @returns The page's one `h1`.
 */
export function Greeting({
  displayName,
  activity,
}: Readonly<{ displayName: string; activity: DashboardActivity | null }>) {
  // Typed wider than the reader returns so the server snapshot can be `null` — "no clock
  // has answered yet" is not a fourth daypart, and giving it one would put a wrong word in
  // the heading rather than a neutral one.
  const daypart = useClientValue<Daypart | null>(
    () => daypartAt(new Date().getHours()),
    null,
  );

  return <h1 className="dash__title">{greeting(daypart, displayName, activity)}</h1>;
}

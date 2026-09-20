import type { FarmReadings } from "./data";
import { FarmBanner } from "./farm-banner";
import { FarmHead } from "./farm-head";
import type { FarmPollOptions } from "./farm-poll";
import { FarmStatRow } from "./farm-stat-row";
import { FarmProvider } from "./farm-store";
import { RunnersCard } from "./runners-card";

import "./farm.css";

/**
 * The build farm (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)) —
 * `docs/mockups/08-build-farm.html`'s page head and stat row, and the frame the rest of the
 * page arrives in.
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no chrome
 * of its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2): the shell's content pane is the scroll
 * container — the header and the sidebar do not move — and the sidebar's **Build Farm** entry is
 * how a reader arrives. The mockup's topbar is superseded by the shell.
 *
 * ### One store, and every region under it
 *
 * The page is one observation (`app/api/farm.ts`), so it is provided once, here, and the head,
 * the stat row and the runners table (AI.2, [#257](https://github.com/NobuData/ouroboros/issues/257))
 * all read it (`app/farm/farm-store.tsx`) — which is what keeps `4/5` and the table it counts on
 * one answer. The regions still to come — the enroll card (AI.3, #258), the pools card (AI.4,
 * #259) and the live log (AI.6, #261) — mount in {@link FarmScreen}'s grid beside and beneath the
 * table and read the same store.
 *
 * The banner sits above the head rather than in the grid, for the dashboard's reason: it is a
 * fact about the whole page, and a reader handed old data should be told before they read it.
 * It is **inside the frame**, so it takes the page's gutters and lines up with the head under it
 * by construction rather than by a margin kept in step with `.farm`'s padding.
 *
 * @param props.readings What the route read for the first paint.
 * @param props.poll Test seams for the poll; the route passes none.
 * @returns The screen.
 */
export function FarmScreen({
  readings,
  poll,
}: Readonly<{ readings: FarmReadings; poll?: FarmPollOptions }>) {
  return (
    <FarmProvider initial={readings.page} poll={poll} readAt={readings.readAt}>
      <main className="farm">
        <FarmBanner />
        <FarmHead />
        <div className="farm__grid">
          <FarmStatRow />
          <RunnersCard />
        </div>
      </main>
    </FarmProvider>
  );
}

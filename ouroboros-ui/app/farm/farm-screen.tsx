import type { FarmReadings } from "./data";
import { EnrollCard } from "./enroll-card";
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
 * one answer. The enroll card (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258))
 * sits beside the table in the mockup's four columns and reads the same store for its pools. The
 * regions still to come — the pools card (AI.4, #259) and the live log (AI.6, #261) — mount in
 * {@link FarmScreen}'s grid beside and beneath them.
 *
 * ### One role decision, made by the route
 *
 * Everything on the page may be read by every member. What a role changes is the enroll flow —
 * minting a token is `owner` or `admin` — so the route hands down one boolean
 * ({@link FarmReader}) and the head's **+ Enroll runner** and the card both draw from it. The
 * gate that **enforces** is the service's.
 *
 * The banner sits above the head rather than in the grid, for the dashboard's reason: it is a
 * fact about the whole page, and a reader handed old data should be told before they read it.
 * It is **inside the frame**, so it takes the page's gutters and lines up with the head under it
 * by construction rather than by a margin kept in step with `.farm`'s padding.
 *
 * @param props.readings What the route read for the first paint.
 * @param props.reader Who is reading — see {@link FarmReader}.
 * @param props.poll Test seams for the poll; the route passes none.
 * @returns The screen.
 */
export function FarmScreen({
  readings,
  reader,
  poll,
}: Readonly<{ readings: FarmReadings; reader: FarmReader; poll?: FarmPollOptions }>) {
  return (
    <FarmProvider initial={readings.page} poll={poll} readAt={readings.readAt}>
      <main className="farm">
        <FarmBanner />
        <FarmHead mayAdminister={reader.mayAdminister} />
        <div className="farm__grid">
          <FarmStatRow />
          <RunnersCard />
          <EnrollCard mayAdminister={reader.mayAdminister} tenant={reader.tenant} />
        </div>
      </main>
    </FarmProvider>
  );
}

/** Who is reading the farm, as far as the page needs to know. */
export interface FarmReader {
  /**
   * Whether this reader may mint and revoke enrollment tokens — `app/api/membership.ts`'s
   * `mayAdminister`, decided once by the route. A boolean rather than a role, so there is one
   * place deciding what a role may do.
   */
  readonly mayAdminister: boolean;
  /** The active workspace's slug — the enroll command's `--tenant`. */
  readonly tenant: string;
}

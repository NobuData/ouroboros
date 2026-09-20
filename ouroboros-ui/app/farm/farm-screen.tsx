import type { FarmReadings } from "./data";
import { EnrollCard } from "./enroll-card";
import { FarmBanner } from "./farm-banner";
import { FarmHead } from "./farm-head";
import type { FarmPollOptions } from "./farm-poll";
import { FarmStatRow } from "./farm-stat-row";
import { FarmProvider } from "./farm-store";
import { LiveCard } from "./live-card";
import type { LogStreamOptions } from "./log-stream";
import { PoolProvider } from "./pool-store";
import { PoolsCard } from "./pools-card";
import { RunnersCard } from "./runners-card";
import { SelectionProvider } from "./selection-store";
import { SubmitDialog } from "./submit-dialog";
import { SubmitProvider } from "./submit-store";
import { SubmitToast } from "./submit-toast";

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
 * sits beside the table in the mockup's four columns and reads the same store for its pools, and
 * the pools card (AI.4, [#259](https://github.com/NobuData/ouroboros/issues/259)) sits under it in
 * the same column — the mockup's `c-4 col`. The pools and their one configuration sheet are
 * provided here too (`app/farm/pool-store.tsx`), because the sheet has two doors: the card's
 * `Configure →` and the head's **Pool settings**. The live log card (AI.6,
 * [#261](https://github.com/NobuData/ouroboros/issues/261)) takes the full measure beneath them —
 * the mockup's `c-12`. It reads the store for *which* build is running and a stream of its own
 * for what that build printed (`app/farm/log-stream.ts`), and it follows the runner selected in
 * the table, which is why the selection is provided here too (`app/farm/selection-store.tsx`).
 * The submit-build dialog (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)) has
 * two doors as well — the head's **Submit build** and each pool's row — so its state and the
 * toast it leaves are provided here (`app/farm/submit-store.tsx`), and the dialog is mounted
 * once, beside the grid rather than inside any one card.
 *
 * ### One role decision, made by the route
 *
 * Everything on the page may be read by every member. What a role changes is what may be
 * written — minting a token, changing a pool, and draining or removing a runner are `owner` or
 * `admin` — so the route hands down one boolean ({@link FarmReader}) and the head, the runners
 * table's `⋯` menus, the enroll card and the pools card all draw from it. **Submit build** draws
 * from it too: the service admits a `member` there, and the issue gates the page's control to
 * administrators, so the page is the stricter of the two. The gate that **enforces** is the
 * service's.
 *
 * The banner sits above the head rather than in the grid, for the dashboard's reason: it is a
 * fact about the whole page, and a reader handed old data should be told before they read it.
 * It is **inside the frame**, so it takes the page's gutters and lines up with the head under it
 * by construction rather than by a margin kept in step with `.farm`'s padding.
 *
 * @param props.readings What the route read for the first paint.
 * @param props.reader Who is reading — see {@link FarmReader}.
 * @param props.poll Test seams for the poll; the route passes none.
 * @param props.log Test seams for the live card's log streams; the route passes none.
 * @returns The screen.
 */
export function FarmScreen({
  readings,
  reader,
  poll,
  log,
}: Readonly<{
  readings: FarmReadings;
  reader: FarmReader;
  poll?: FarmPollOptions;
  log?: LogStreamOptions;
}>) {
  return (
    <FarmProvider initial={readings.page} poll={poll} readAt={readings.readAt}>
      <PoolProvider>
        <SelectionProvider>
          <SubmitProvider>
            <main className="farm">
              <FarmBanner />
              <FarmHead mayAdminister={reader.mayAdminister} />
              <SubmitToast />
              <div className="farm__grid">
                <FarmStatRow />
                <RunnersCard mayAdminister={reader.mayAdminister} />
                <div className="farm-col--4 farm__side">
                  <EnrollCard mayAdminister={reader.mayAdminister} tenant={reader.tenant} />
                  <PoolsCard mayAdminister={reader.mayAdminister} />
                </div>
                <LiveCard log={log} />
              </div>
              <SubmitDialog />
            </main>
          </SubmitProvider>
        </SelectionProvider>
      </PoolProvider>
    </FarmProvider>
  );
}

/** Who is reading the farm, as far as the page needs to know. */
export interface FarmReader {
  /**
   * Whether this reader may mint and revoke enrollment tokens, change pools, drain, undrain and
   * remove runners, and — on this page — submit a build:
   * `app/api/membership.ts`'s `mayAdminister`, decided once by the route. A boolean rather than a
   * role, so there is one place deciding what a role may do.
   */
  readonly mayAdminister: boolean;
  /** The active workspace's slug — the enroll command's `--tenant`. */
  readonly tenant: string;
}

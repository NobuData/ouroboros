"use client";

import { useFarm } from "./farm-store";
import { fleetWarning } from "./states";

/**
 * The offline-heavy strip — when much of the fleet is down, said at the top of the page rather
 * than left to be inferred from dimmed rows (AI.7,
 * [#262](https://github.com/NobuData/ouroboros/issues/262)).
 *
 * It reads the farm's one store (`app/farm/farm-store.tsx`), so it is the same answer as the
 * `1/5` under it and arrives and leaves on a poll with nobody pressing anything. *When* it is
 * drawn and what it says is `fleetWarning`'s (`app/farm/states.ts`).
 *
 * **A polite live region that is always mounted**, for the enroll toast's reason: a region
 * inserted together with its text is one a screen reader may never announce, so the seat exists
 * before it has something to say and takes no room while empty. `status` rather than `alert`: a
 * fleet thinning out is worth hearing about and is not worth interrupting for — nothing the
 * reader is doing has failed.
 *
 * It is not the stale-data banner and does not replace it (`app/farm/farm-banner.tsx`): that one
 * says the *page* could not be refreshed; this one says the page is current and the *fleet* is
 * not well. Both can be true at once, and each says its own thing.
 *
 * @returns The seat, holding the strip while most of the fleet is away.
 */
export function FarmFleetWarning() {
  const { page } = useFarm();
  const warning = page === null ? null : fleetWarning(page.stats.runnersOnline);

  return (
    <div className="farm-fleet-seat" role="status">
      {warning !== null && (
        <p className="farm-fleet">
          <span className="farm-fleet__headline">{warning.headline}</span> {warning.body}
        </p>
      )}
    </div>
  );
}

"use client";

import { type ReactNode, useState } from "react";

import { RegistryFailedBanner } from "./registry-banner";

/**
 * What keeps the densest table in the product on screen when a refresh of it fails (CI.6,
 * [#596](https://github.com/NobuData/ouroboros/issues/596)).
 *
 * The technique is the dashboard's (`app/dashboard/freshness.tsx`, DASH-I.7
 * [#86](https://github.com/NobuData/ouroboros/issues/86)): remember the last render whose read
 * worked, and when a later one arrives failed — a retry, a save's `router.refresh()`, a switch
 * press — put the remembered one back under the banner rather than replacing eight rows of
 * real data with a sentence. **The page never blanks on refresh.**
 *
 * It holds the **rendered tree**, not the payload: `children` is what the screen already drew
 * for a working read, so nothing about the table moves into this component, and a hard reload
 * while the service is down holds nothing — nothing in this browser has ever been read, so the
 * failed seat renders honestly under the same banner.
 *
 * The held tree is adjusted **during render**, guarded on the tree's identity, for the reason
 * that file gives: an effect would paint the wrong page for a frame first.
 */

/** What the boundary takes. */
export interface RegistryFreshnessProps {
  /**
   * Why this render's registry read failed, or `null` when it worked — `registryFailure` in
   * `app/registry/view.ts`. The only thing this component looks at.
   */
  readonly failure: string | null;
  /** The region below the tabs, as the screen drew it for this render. */
  readonly children: ReactNode;
}

/**
 * The boundary.
 *
 * @param props See {@link RegistryFreshnessProps}.
 * @returns This render's region when the read worked; otherwise the banner over the last region
 *   that worked, or over this render's own failed seat when none ever has.
 */
export function RegistryFreshness({ failure, children }: RegistryFreshnessProps) {
  const [held, setHeld] = useState<ReactNode>(null);

  if (failure === null && held !== children) setHeld(children);

  // The region always renders in the same slot, banner or not: a tree that moved position when
  // the banner appeared would remount, and the table's selection and the inspector's unsaved
  // drafts would be lost to exactly the refresh this component exists to survive.
  return (
    <>
      {failure !== null && <RegistryFailedBanner reason={failure} />}
      {failure === null ? children : (held ?? children)}
    </>
  );
}

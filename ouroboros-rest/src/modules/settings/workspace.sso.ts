/**
 * Whether a workspace enforces SSO on its tenant domain — the source of the card's `SSO enforced`
 * tag (BQ.4, [#483](https://github.com/NobuData/ouroboros/issues/483)).
 *
 * **The answer today is always `false`, because nothing in this deployment can enforce SSO.**
 * BetterAuth's SSO state (BA-E) is [#722](https://github.com/NobuData/ouroboros/issues/722), a v2
 * issue; until it lands there is no provider, no enforcement and so no fact to report. Mockup 17
 * draws the tag as a static badge — rendering it here would claim a sign-in rule the product does
 * not apply. With SSO not enforced the tag is **absent**, never shown as "false".
 *
 * A provider rather than a constant so #722 replaces one method body, and so the service's specs
 * can drive the enforced branch the card must already handle.
 */

import { Injectable } from "@nestjs/common";

@Injectable()
export class SsoEnforcement {
  /**
   * Does this workspace require SSO for sign-ins on this domain?
   *
   * @param _organizationId - The workspace. Unread until #722.
   * @param _domain - The tenant domain. Unread until #722.
   * @returns `false` — no SSO provider exists in this release.
   */
  isEnforced(_organizationId: string, _domain: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}

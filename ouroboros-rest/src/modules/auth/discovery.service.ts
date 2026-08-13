/**
 * Domain discovery — *is there a workspace at this domain, and does it use SSO?*
 *
 * Two questions, one answer, and in MVP the answer to the second is always no
 * (decision A7 in `docs/ROADMAP_MOCKUP_01_BETTERAUTH.md`: SAML and OIDC are
 * [#722](https://github.com/NobuData/ouroboros/issues/722)). What makes this more than a
 * constant is the first question, and the two properties that follow from *who is allowed to
 * ask it*.
 *
 * **The caller has no session, and cannot have one.** This is what mockup 01's *Company
 * domain* box calls before anybody has signed in, so the endpoint is `@AllowAnonymous()` —
 * which means whatever it tells one caller it tells every caller. A public endpoint that
 * answers *does this company use Ouroboros* is a tenant-enumeration oracle unless it is
 * built not to be, and it is built not to be in two places:
 *
 *   * **The shape.** {@link DiscoveryService.discover} composes its answer without reading
 *     the lookup, so a known domain and an unknown one produce the same object, field for
 *     field. Not *similar* — the same. There is no organisation name in it, no member count,
 *     no id, and nothing conditional for a caller to diff.
 *   * **The timing.** `discovery.timing.ts`, and the whole of the argument is there.
 *
 * **So why look the domain up at all?** Because the lookup is the endpoint, and this is the
 * one release where that is not visible. #722 fills in the `ssoAvailable: true` branch, and
 * what it needs is the workspace behind the domain — so the query, the index it uses, the
 * normalisation that makes it match and the timing floor that hides it all have to be right
 * *now*, while the answer is uniform and a mistake is invisible. An MVP that returned the
 * constant without the query would be an MVP that had tested none of it, and #718 would meet
 * the first real failure of any of them on the day SSO shipped.
 *
 * The contract is shaped for that day rather than for this one. {@link DiscoveryResource}
 * already carries `redirectUrl`, `openapi.yaml` already publishes it, and the issue's last
 * acceptance criterion is the test of whether that was done properly: *#718 consumes it
 * without changes when #722 lands — if the card needs restructuring later, this contract was
 * wrong.*
 */

import { Injectable } from "@nestjs/common";

import type { DiscoverBody } from "./discovery.dto";
import { DiscoveryRepository } from "./discovery.repository";
import { DISCOVERY_FLOOR_MS, withFloor } from "./discovery.timing";

/**
 * What `POST /api/v1/auth/discover` answers — everything the sign-in card needs to decide
 * what to do next, and nothing else.
 *
 * Three fields, and the two optional ones are the two halves of the same choice: an answer
 * either sends the browser somewhere or explains why it cannot. `ssoAvailable` is which.
 */
export interface DiscoveryResource {
  /**
   * Whether this domain signs in through an identity provider.
   *
   * `false` in every answer this release sends, for every domain, whether or not a workspace
   * holds it — see this file's header. #722 is what makes it ever `true`.
   */
  ssoAvailable: boolean;

  /**
   * A sentence the card can render, always present.
   *
   * Required rather than optional so #718 has something to show in **both** branches without
   * inventing copy of its own — which is what "consumed without changes when #722 lands"
   * costs if the field can be absent. When `ssoAvailable` is false it says why; when #722
   * makes it true it is what the card says while the browser is on its way.
   */
  message: string;

  /**
   * Where to send the browser, when there is somewhere to send it.
   *
   * Absent in this release, and published in the contract anyway: it is the field #722 fills
   * and the reason #718 can be written once. A client reads it as *follow this if it is
   * here*, which is true in both releases — in this one it is simply never here.
   */
  redirectUrl?: string;
}

/**
 * What every answer says today.
 *
 * Word for word `ouroboros-ui`'s own `SSO_UNAVAILABLE`
 * (`app/login/sign-in-card.tsx`), which is the sentence already beside the disabled button
 * on the login page. One voice: the copy a person reads before they type a domain and the
 * copy they read after should not be two different apologies, and #718 replaces the
 * hard-coded constant with this field rather than choosing between them.
 */
export const NO_SSO_MESSAGE = "Enterprise SSO is not configured yet — sign in with GitHub for now.";

@Injectable()
export class DiscoveryService {
  constructor(private readonly domains: DiscoveryRepository) {}

  /**
   * Answer the company-domain field.
   *
   * @param body - The validated request. Its `domain` is already normalised — lower-cased,
   *   trimmed, scheme and path removed — by `discovery.dto.ts`, which is what makes it
   *   comparable with the stored column.
   * @returns The same object for every domain in this release: no SSO, and the sentence
   *   saying so. Never sooner than {@link DISCOVERY_FLOOR_MS} after it was called.
   */
  async discover(body: DiscoverBody): Promise<DiscoveryResource> {
    return withFloor(DISCOVERY_FLOOR_MS, async () => {
      // The result is deliberately not read, and that is the contract rather than an
      // oversight — this file's header is the whole argument. Reading it could only produce
      // an answer that differs between a domain we hold and one we do not, which is the
      // thing the endpoint must not do until there is an identity provider to redirect to.
      await this.domains.exists(body.domain);

      return { ssoAvailable: false, message: NO_SSO_MESSAGE };
    });
  }
}

/**
 * `/api/v1/farm` — the operator's surface: mint a token, list them, revoke one, read the CA,
 * and cut a machine off.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). Mockup 08's enroll card
 * and its token-management panel (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258))
 * are what these five routes are for.
 *
 * **The workspace is the session's, never the request's** — the same sentence every
 * controller in this service opens with, because it is the same property: no `{orgId}` in the
 * path, the tenant guard resolves and membership-checks the active organization, and these
 * handlers read what it established.
 *
 * ---------------------------------------------------------------------------
 * **Four of the five are `@Roles(...ADMINISTRATORS)`, and the fifth is deliberately not.**
 *
 * Minting a token is issuing a credential that lets an unknown machine join the fleet;
 * revoking one, and revoking a certificate, are the immediate kills. Those are `owner`/`admin`
 * without argument.
 *
 * Reading the **CA certificate** is every member's, and that is a decision rather than an
 * oversight: it is a public certificate — it crosses the network in the clear at every
 * handshake — and the person who needs it is whoever is configuring the reverse proxy in
 * front of this service. Requiring an administrator to fetch a public key in order to write
 * an nginx block would be a gate with no secret behind it. `farm.resources.ts` is what makes
 * "public" true of the payload: there is no field on `AuthorityResource` a private key could
 * occupy.
 *
 * **Listing tokens is an administrator's**, though, even though what comes back is masked.
 * The mask hides the value; the *list* still says how many machines a workspace is about to
 * admit and when the window closes, which is operational detail about the fleet rather than
 * about the product.
 */

import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";

import { Session } from "@thallesp/nestjs-better-auth";

import type { Organization } from "../db/schema";
import type { Principal } from "../auth/principal";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { EnrollmentService } from "./enrollment.service";
import { RegistrationService } from "./registration.service";
import { MintEnrollmentTokenDto } from "./farm.dto";
import type {
  AuthorityResource,
  EnrollmentTokenResource,
  MintedTokenResource,
  RunnerCertificateResource,
} from "./farm.resources";

@Controller("farm")
export class EnrollmentController {
  /**
   * @param enrollment - The token lifecycle.
   * @param registration - The certificate lifecycle, which owns revocation and the CA read.
   */
  constructor(
    private readonly enrollment: EnrollmentService,
    private readonly registration: RegistrationService,
  ) {}

  /**
   * The workspace's certificate authority — public, and every member's to read.
   *
   * Creates the authority if this workspace has never had one, which is the same lazy
   * creation an enrollment performs: a person setting up a proxy before the first machine
   * arrives should get the certificate they are about to need rather than a `404` telling
   * them to enrol something first.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @returns The CA certificate, its fingerprint and its window.
   */
  @Get("authority")
  authority(@CurrentTenant() tenant: Organization): Promise<AuthorityResource> {
    return this.registration.authorityOf(tenant.id);
  }

  /**
   * Mint an enrollment token.
   *
   * @param tenant - The workspace.
   * @param principal - Who is minting it.
   * @param request - The pool, the TTL and the use count.
   * @returns The token — **with its full value, once**. Every later read is masked, and
   *   `farm.resources.ts` is where that is made structural rather than remembered.
   */
  @Post("enrollment-tokens")
  @Roles(...ADMINISTRATORS)
  mint(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() request: MintEnrollmentTokenDto,
  ): Promise<MintedTokenResource> {
    return this.enrollment.mint(tenant.id, principal.user.id, request);
  }

  /**
   * The workspace's enrollment tokens, newest first, every one of them masked.
   *
   * @param tenant - The workspace.
   * @returns The tokens.
   */
  @Get("enrollment-tokens")
  @Roles(...ADMINISTRATORS)
  list(@CurrentTenant() tenant: Organization): Promise<EnrollmentTokenResource[]> {
    return this.enrollment.list(tenant.id);
  }

  /**
   * Revoke an enrollment token.
   *
   * `DELETE` for an operation that keeps the row, which is worth a word: what the caller is
   * deleting is the token's *usefulness*, and the row survives because *this token let four
   * machines in before it was killed* is the question an incident actually asks.
   *
   * @param tenant - The workspace.
   * @param principal - Who is revoking it.
   * @param id - The token.
   * @returns The token as it now stands — revoked, with the time and the use count an
   *   operator has to account for.
   */
  @Delete("enrollment-tokens/:id")
  @Roles(...ADMINISTRATORS)
  revoke(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<EnrollmentTokenResource> {
    return this.enrollment.revoke(tenant.id, principal.user.id, id);
  }

  /**
   * Revoke a runner's certificate — the immediate kill for one machine.
   *
   * The next handshake refuses it (`runner.identity.ts`), and the runner cannot renew its way
   * back in: renewal is authenticated by the certificate this request just killed.
   *
   * It does **not** remove the runner. Removal is AH.6's
   * ([#254](https://github.com/NobuData/ouroboros/issues/254)) lifecycle action and means
   * something different — *this machine is retired* rather than *this machine's identity is
   * suspect* — and only one of the two is an incident.
   *
   * @param tenant - The workspace.
   * @param principal - Who is revoking it.
   * @param runnerId - The runner.
   * @returns The certificate as it now stands.
   */
  @Delete("runners/:runnerId/certificate")
  @Roles(...ADMINISTRATORS)
  revokeCertificate(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("runnerId", ParseUUIDPipe) runnerId: string,
  ): Promise<RunnerCertificateResource> {
    return this.registration.revokeCertificate(tenant.id, principal.user.id, runnerId);
  }
}

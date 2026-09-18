/**
 * `/api/v1/farm/registrations` — the two routes a machine calls, and the only routes in this
 * service reachable by something that holds no session.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). Mockup 08's enroll card
 * renders a one-liner; this is what the one-liner talks to.
 *
 * ```
 * POST /farm/registrations           @AllowAnonymous   authenticated by an enrollment token
 * POST /farm/registrations/renewal   @AllowAnonymous   authenticated by the CLIENT CERTIFICATE
 * ```
 *
 * ---------------------------------------------------------------------------
 * **`@AllowAnonymous()` is not "public", and the distinction is the same one AD.3's internal
 * surface draws** (`auth/route.table.fixture.ts` names three categories for this reason). The
 * session guard has to step aside — the caller is a machine with no cookie, and there is no
 * session for it to hold — and what authenticates each route is named in its own handler:
 * an enrollment token for the first, a TLS client certificate for the second. Neither is
 * reachable by an unauthenticated caller in any useful sense; both are reachable by an
 * *unsessioned* one, which is what the decorator actually means.
 *
 * `SHIPPED_PUBLIC_SURFACE` in `route.table.fixture.ts` is the list both guard suites hold
 * this service to, and these two routes are added to it with the argument above beside them.
 *
 * ---------------------------------------------------------------------------
 * **Neither route names a workspace, and neither could.** The registration's workspace is the
 * token's; the renewal's is the certificate's, after it has been verified against that
 * workspace's own CA. There is no `{orgId}` and no body field, so the organization-isolation
 * criterion is a property of the shape rather than a check somebody has to remember —
 * `farm.dto.ts` says the same thing from the other side.
 *
 * ---------------------------------------------------------------------------
 * **The renewal reads the client certificate from the request, and that is the one piece of
 * transport this module touches.** `client.certificate.ts` is where the socket and the
 * forwarded header are reconciled, and where the argument for the header being off by default
 * lives. This controller does the reading because a certificate is a property of the
 * connection, and a service that took one as an argument would be a service that could be
 * handed somebody else's.
 */

import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { Body, Controller, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { AppConfigService } from "../config/config.service";
import { TenantOptional } from "../tenancy/tenant.decorators";
import { clientCertificate } from "./client.certificate";
import { RegisterRunnerDto, RenewCertificateDto } from "./farm.dto";
import { clientCertificateRequired, identityRefused } from "./farm.errors";
import { RegistrationService } from "./registration.service";
import { RunnerIdentityService } from "./runner.identity";
import type { EnrollmentResource, RenewalResource } from "./farm.resources";

@Controller("farm/registrations")
export class RegistrationController {
  /**
   * @param registration - The enrollment and renewal logic.
   * @param identity - The handshake check AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251))
   *   will share. Its first caller is the renewal below, which is what lets the revocation
   *   criterion be tested end to end before the gateway exists.
   * @param config - For the one setting this module reads at request time: which header, if
   *   any, a trusted proxy forwards a client certificate in.
   */
  constructor(
    private readonly registration: RegistrationService,
    private readonly identity: RunnerIdentityService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Enrol a machine.
   *
   * @param request - The token, the machine's name and architecture, and its certificate
   *   request.
   * @returns The runner's id, its signed certificate and the CA to pin — or, where a
   *   workspace permits the fallback, a bearer secret in place of the certificate.
   */
  @Post()
  @AllowAnonymous()
  @TenantOptional()
  register(@Body() request: RegisterRunnerDto): Promise<EnrollmentResource> {
    return this.registration.register(request);
  }

  /**
   * Replace a runner's certificate, over the channel that certificate already authenticates.
   *
   * **No enrollment token appears here.** That is the issue's *renewal over the
   * already-authenticated channel*: a runner that has been enrolled once never needs a second
   * token, and — the half that matters more — a runner whose certificate was revoked cannot
   * renew its way back in, because the thing it would have to present is the thing that was
   * killed.
   *
   * @param http - The request, for the certificate the peer presented.
   * @param request - The new certificate request.
   * @returns The new certificate and the CA.
   * @throws {UnauthenticatedError} If no client certificate was presented — most often a
   *   proxy that terminates TLS and does not pass it through, which is what the message says
   *   — or if the one presented is not a live identity of this farm.
   */
  @Post("renewal")
  @AllowAnonymous()
  @TenantOptional()
  async renew(
    @Req() http: Request,
    @Body() request: RenewCertificateDto,
  ): Promise<RenewalResource> {
    const presented = clientCertificate(http, this.config.farmClientCertHeader);
    if (!presented) throw clientCertificateRequired();

    const identity = await this.identity.authenticate(presented);
    if (!identity) throw identityRefused();

    return this.registration.renew(identity, request);
  }
}

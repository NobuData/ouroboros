/**
 * The scoped lease — the one exception to *workers never hold credentials*, and the reason
 * it is not an exception at all.
 *
 * Decision **P3** ([#224](https://github.com/NobuData/ouroboros/issues/224)) says a worker
 * gets proxied invocation rather than a key. Mockup 07's own subline promises something
 * weaker — *"workers only ever see short-lived tokens"* — and this module is where the
 * stronger promise is kept, including in its one exception: an engine worker calling an
 * Ollama daemon on the same box gains nothing from proxying its traffic through this
 * service, because there is no key on that path to protect. So it is told the address and
 * nothing else.
 *
 * ```
 * lease {ollama, run}     ─▶ 200 {baseUrl, expiresAt}  ✓ audited
 * lease {anthropic, run}  ─▶ 403 provider_not_leasable  — policy, before any lookup
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Three properties, and where each one comes from.**
 *
 *   * **No secret can be returned, structurally.** {@link Lease} has nowhere to put one:
 *     every field is an identifier, an address or a time. A future field that could carry
 *     key material would have to be added to this interface, which is what
 *     `no-secret-responses.mjs` refuses. The criterion — *no secret, verified by payload
 *     inspection* — is therefore a property of the type rather than of a test that happens
 *     to look.
 *   * **The refusal is first and is unconditional.** A cloud provider is refused before the
 *     database is touched and before the deployment's configuration is consulted, so no
 *     amount of either can produce a grant. `configuration.ts` refuses the same kinds at
 *     boot; the two halves are deliberate duplication, because a policy that lived only in
 *     the service could be walked around by an operator, and one that lived only in
 *     configuration would miss a kind added to that variable by a later ticket.
 *   * **The scope is a run, and the run is real.** The workspace is *resolved from* the run
 *     rather than taken from the request — a worker naming its own workspace would be a
 *     worker choosing which workspace to be audited against.
 *
 * ---------------------------------------------------------------------------
 * **A lease is not a bearer token, which is why nothing stores it.** It carries no secret,
 * so possessing one grants nothing that knowing the address would not; there is nothing to
 * revoke and no table of outstanding grants to keep. What the TTL bounds is how long a
 * worker should go on believing the answer before asking again — which matters exactly when
 * Y.1's connections arrive and an address can change under a long-running run. Anything
 * stronger would be theatre: a fifteen-minute expiry on a hostname is not a security
 * control, and calling it one is the kind of claim AD.5 ([#226](https://github.com/NobuData/ouroboros/issues/226))
 * exists to keep out of the product.
 */

import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { localProviderNotConfigured, providerNotLeasable, runNotFound } from "./internal.errors";
import { InternalRepository } from "./internal.repository";
import { LeaseAudit } from "./lease.audit";
import { LocalProviders } from "./local.providers";
import { isLeasable, type LocalProviderKind, type ProviderKind } from "./providers";

/**
 * How long a lease is current — fifteen minutes, as the mockup's own copy says.
 *
 * A constant rather than a variable, because it is not a knob an operator has any basis for
 * turning: it bounds staleness, not exposure (see this file's header), and a deployment that
 * wanted a different number would be expressing a preference about a fact nobody has
 * measured. AF.2 may find that a long-running invocation wants a different bound, and that
 * is a decision with evidence behind it rather than an environment variable shipped hopefully.
 */
export const LEASE_TTL_SECONDS = 900;

/** Milliseconds in a second — so the arithmetic below reads as what it is. */
const MILLISECONDS = 1000;

/** What a worker asked for. */
export interface LeaseRequest {
  /** Which provider kind. Any of the five; the policy is applied here, not by the validator. */
  readonly provider: ProviderKind;
  /** The run the work belongs to. */
  readonly run: string;
}

/**
 * A granted lease.
 *
 * **Every field is an identifier, an address or a time.** That is the shape the acceptance
 * criterion asks for, stated as a type: there is no `secret`, no `token`, no `apiKey` and
 * nowhere for one to be added quietly.
 */
export interface Lease {
  /** This grant's own id — what ties the answer to its line in the audit trail. */
  readonly id: string;
  /** The provider kind that was granted. */
  readonly provider: LocalProviderKind;
  /** The run it is scoped to. */
  readonly run: string;
  /** The workspace that run belongs to, resolved rather than supplied. */
  readonly organizationId: string;
  /** Where the provider is — the whole of what a worker is given. */
  readonly baseUrl: string;
  /** When it was granted. */
  readonly grantedAt: Date;
  /** When the worker should ask again. */
  readonly expiresAt: Date;
  /** {@link LEASE_TTL_SECONDS}, carried so a client need not derive it from two timestamps. */
  readonly ttlSeconds: number;
}

@Injectable()
export class LeaseService {
  /**
   * @param providers - Where this deployment's local providers are. The seam Y.1 replaces.
   * @param runs - The workspace lookup.
   * @param audit - The trail. Injected so the spec can prove exactly one event per grant and
   *   none per refusal.
   */
  constructor(
    private readonly providers: LocalProviders,
    private readonly runs: InternalRepository,
    private readonly audit: LeaseAudit,
  ) {}

  /**
   * Grant a lease, or refuse it.
   *
   * The order of the three refusals is deliberate and is asserted:
   *
   *   1. **Policy.** A cloud kind is refused knowing nothing else about the request.
   *   2. **The deployment.** A leasable kind nobody has declared an address for is a `404`
   *      an operator fixes, and it is answered without a database round trip.
   *   3. **The run.** Last, because it is the only one that costs a query, and because a
   *      caller that got either of the first two wrong has a problem the run cannot fix.
   *
   * @param request - The provider kind and the run, already validated as *shapes*.
   * @returns The lease, already audited.
   * @throws {ForbiddenError} `403 provider_not_leasable` for a cloud provider kind.
   * @throws {NotFoundError} `404 local_provider_not_configured` when this deployment has no
   *   provider of that kind, or `404 run_not_found` when the run does not exist.
   */
  async grant(request: LeaseRequest): Promise<Lease> {
    if (!isLeasable(request.provider)) {
      throw providerNotLeasable(request.provider);
    }

    const baseUrl = this.providers.addressOf(request.provider);

    if (baseUrl === undefined) {
      throw localProviderNotConfigured(request.provider);
    }

    const organizationId = await this.runs.organizationOfRun(request.run);

    if (organizationId === undefined) {
      throw runNotFound(request.run);
    }

    const grantedAt = new Date();
    const lease: Lease = {
      id: randomUUID(),
      provider: request.provider,
      run: request.run,
      organizationId,
      baseUrl,
      grantedAt,
      expiresAt: new Date(grantedAt.getTime() + LEASE_TTL_SECONDS * MILLISECONDS),
      ttlSeconds: LEASE_TTL_SECONDS,
    };

    // Audited before it is returned, and synchronously: a grant that reached a worker
    // without leaving a trace is the failure this criterion is about, and an emission
    // scheduled for later is one a crash can lose.
    await this.audit.granted(lease);

    return lease;
  }
}

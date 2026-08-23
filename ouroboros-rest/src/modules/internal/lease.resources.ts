/**
 * Lease → resource — the shape a worker actually receives, and the file the payload-inspection
 * criterion is really about.
 *
 * `Lease` is this service's own record of a grant; {@link LeaseResource} is what crosses the
 * boundary. Keeping them separate costs one mapping function and buys the thing
 * [#224](https://github.com/NobuData/ouroboros/issues/224)'s first acceptance criterion asks
 * for — *a lease for a local provider returns host/base-URL details only, no secret, verified
 * by payload inspection* — as a property of a type rather than as a test that inspects a
 * payload and hopes it saw everything. Every field below is an identifier, an address or a
 * timestamp. There is nowhere to put a secret, so none can arrive by accident, and the lint
 * rule beside this file refuses one added on purpose.
 *
 * **`baseUrl` and no `host`.** The issue's own words are *"base URL or host"*, and a surface
 * that published both would be publishing one fact twice — in two spellings that can
 * disagree, and where the lossier one (`localhost:11434`, no scheme) is the one a client
 * would have to reassemble a URL from. A worker that wants the host parses the URL, which is
 * the operation it was going to do anyway.
 *
 * **Times are ISO 8601 strings**, as everywhere else in this service's contracts — the
 * `Date`s stay on this side of the boundary.
 */

import type { Lease } from "./lease";
import type { LocalProviderKind } from "./providers";

/** A granted lease, as `POST /internal/credentials/lease` answers with it. */
export interface LeaseResource {
  /** This grant's id — the same value that appears in the `credential.lease_granted` event. */
  readonly id: string;
  /** The provider kind that was granted. */
  readonly provider: LocalProviderKind;
  /** The run it is scoped to, echoed so an answer can be matched to its request. */
  readonly run: string;
  /**
   * The workspace that run belongs to.
   *
   * Published because the worker has to attribute what it does next — usage rows, telemetry —
   * to the same workspace this grant was audited against, and deriving that a second way
   * would be two answers to one question. It is an identifier the caller is already entitled
   * to: it was resolved *from* the run the caller named.
   */
  readonly organizationId: string;
  /** Where the provider is. The whole of what is handed over. */
  readonly baseUrl: string;
  /** When the grant happened, ISO 8601. */
  readonly grantedAt: string;
  /** When the worker should ask again, ISO 8601. */
  readonly expiresAt: string;
  /** How long that is, in seconds — so a client need not subtract two timestamps. */
  readonly ttlSeconds: number;
}

/**
 * One lease, as the contract publishes it.
 *
 * Written field by field rather than by spreading the lease and overwriting the dates. A
 * spread would carry every future field of `Lease` across this boundary automatically, which
 * is precisely the mistake this file exists to make impossible: the next field added to the
 * internal record would be published without anybody deciding that it should be.
 *
 * @param lease - The granted lease.
 * @returns The resource to answer with.
 */
export function leaseResource(lease: Lease): LeaseResource {
  return {
    id: lease.id,
    provider: lease.provider,
    run: lease.run,
    organizationId: lease.organizationId,
    baseUrl: lease.baseUrl,
    grantedAt: lease.grantedAt.toISOString(),
    expiresAt: lease.expiresAt.toISOString(),
    ttlSeconds: lease.ttlSeconds,
  };
}

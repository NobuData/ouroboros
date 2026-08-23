/**
 * What a lease request may contain — `{provider, run}`, as a `class-validator` class.
 *
 * Two fields and one decision, which is the whole reason this file has a header.
 *
 * **`provider` validates against all five kinds, not the two leasable ones.** A cloud kind
 * has to reach the policy and be refused by it with `403 provider_not_leasable`
 * ([#224](https://github.com/NobuData/ouroboros/issues/224)'s second acceptance criterion,
 * which asks for that answer *for each cloud adapter kind*). A validator that rejected them
 * would answer `422 validation_failed` instead — a different statement, and an untrue one:
 * it would say *there is no such provider* about a provider the product supports, and the
 * refusal would come from the pipe rather than from the policy the ticket is about.
 *
 * The whitelist in `src/application.ts`'s validation pipe still applies, so a body carrying
 * anything beyond these two fields is refused rather than quietly ignored. That matters
 * more here than on a browser route: a worker sending a field this surface does not know is
 * a worker built against a different version of the contract, and finding out immediately is
 * cheaper than finding out through behaviour.
 */

import { IsIn, IsUUID } from "class-validator";

import { PROVIDER_KINDS, type ProviderKind } from "./providers";

/** The body of `POST /internal/credentials/lease`. */
export class LeaseRequestDto {
  /**
   * Which provider kind the worker needs to reach.
   *
   * A *kind*, not a connection id, because there are no connections yet — Y.1
   * ([#189](https://github.com/NobuData/ouroboros/issues/189)) brings them, and this is the
   * request shape the issue specifies. When a connection id becomes meaningful it is an
   * additional field with its own argument, not a reinterpretation of this one.
   */
  @IsIn(PROVIDER_KINDS)
  provider!: ProviderKind;

  /**
   * The run this work belongs to — `runs.id`, a uuid (V008).
   *
   * Required, and it is what *scoped* means in "scoped lease": the workspace a grant is
   * audited against is resolved from this run rather than named by the caller. A malformed
   * value is a `422` from the pipe naming the field; a well-formed one that names no run is
   * the surface's `404 run_not_found`.
   */
  @IsUUID()
  run!: string;
}

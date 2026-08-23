/**
 * Where this deployment's local model providers are — the one seam Y.1 replaces.
 *
 * A class over a configuration map, which is more than it sounds like: it is the place the
 * answer to *where is the Ollama daemon* comes from, and the answer is going to move. Today
 * it is `OURO_LOCAL_PROVIDER_URLS`, because there is nowhere else it could be — Y.1
 * ([#189](https://github.com/NobuData/ouroboros/issues/189)) brings `provider_connections`
 * and AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)) brings the API that
 * fills it, and neither has landed. When they do, this class reads a row instead of a
 * variable and nothing above it changes: `lease.ts` asks a question and gets an address or
 * nothing.
 *
 * That is why it exists as a provider rather than as `config.localProviderUrls[kind]` at the
 * one call site. The call site would be the thing that had to change, and it is the one
 * place in this module where the security argument lives.
 *
 * ---------------------------------------------------------------------------
 * **What it will *not* grow into.** A `provider_connections` row carries a sealed secret for
 * the kinds that have one, and this class must never learn to open it — `VaultService` is
 * for the invocation path, which runs inside the control plane. The lint rule beside this
 * file (`no-secret-responses.mjs`) is what keeps the answer's *shape* honest as the source
 * of the address changes underneath it.
 */

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import type { LocalProviderKind } from "./providers";

@Injectable()
export class LocalProviders {
  /**
   * @param config - The typed configuration. Read per call rather than copied at
   *   construction: `AppConfigService` is a getter over a frozen object, so a copy would buy
   *   nothing and would be a second thing to keep in step.
   */
  constructor(private readonly config: AppConfigService) {}

  /**
   * Where a local provider of this kind is, if this deployment has one.
   *
   * @param kind - A leasable provider kind — the caller has already refused the others.
   * @returns Its base URL, or `undefined` when nothing has declared one. `undefined` is the
   *   common answer and is not an error here: most installations run no local model server,
   *   and turning that into an exception in this class would put the decision about *what a
   *   worker is told* somewhere other than the surface that tells it.
   */
  addressOf(kind: LocalProviderKind): string | undefined {
    return this.config.localProviderUrls[kind];
  }

  /**
   * Which kinds this deployment has declared, in the order the schema produced them.
   *
   * Not read by the lease surface, which only ever asks about one kind. It is here for the
   * boot log and for the tests that assert an operator's list arrived intact — a lease that
   * answers `404` is indistinguishable from a variable that failed to parse until something
   * can say what was actually configured.
   *
   * @returns The declared kinds. Empty for a deployment with no local providers.
   */
  declared(): LocalProviderKind[] {
    return Object.keys(this.config.localProviderUrls) as LocalProviderKind[];
  }
}

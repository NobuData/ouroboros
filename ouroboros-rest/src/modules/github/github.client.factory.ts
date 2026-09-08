/**
 * How a caller gets a `GithubClient` for one workspace.
 *
 * K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)). Three things happen here
 * and nowhere else, which is the reason the factory exists rather than callers constructing
 * clients:
 *
 *   * **The token is opened per call.** Nothing caches a decrypted credential — see
 *     `github.credentials.service.ts` on why that is what makes *"rotate → the old token is
 *     never used again"* structural rather than intended. The cost is one vault round trip
 *     per sync tick, against a poll that then makes many HTTP requests.
 *   * **A workspace with no token is refused here**, as a `not_configured` reason rather
 *     than a client that would fail on its first call with something less specific. That is
 *     the first acceptance criterion's *"clear → sync pauses with a designed status (not a
 *     crash)"*, and it is refused before any network is touched.
 *   * **The rate guard is shared.** Every client for a workspace is handed the same
 *     {@link GithubRateLimiter}, because the budget belongs to the token and two clients are
 *     spending one allowance.
 *
 * **The library is injected, not imported.** {@link OCTOKIT_FACTORY} is a Nest token bound in
 * `github.module.ts` to `createOctokit`, which is the one file allowed to name
 * `@octokit/rest`. So this file — like `github.client.ts` — is unit-testable with a plain
 * object, and the ES module the library ships never has to be transformed for its suite.
 */

import { Inject, Injectable } from "@nestjs/common";

import { GithubClient, type OctokitLike } from "./github.client";
import { GithubCredentialsService } from "./github.credentials.service";
import { GithubRateLimiter } from "./github.rate-limit";

/** The Nest token the configured Octokit constructor is bound under. */
export const OCTOKIT_FACTORY = "OCTOKIT_FACTORY";

/**
 * Build a client for one token.
 *
 * The whole of what this module needs from the library: a token in, something shaped like
 * {@link OctokitLike} out. Everything else — the deadline, the user agent, the base URL — is
 * `github.octokit.ts`'s to decide, because those are properties of *how this product talks to
 * GitHub* rather than of any one call.
 */
export type OctokitFactory = (token: string) => OctokitLike;

@Injectable()
export class GithubClientFactory {
  /**
   * @param credentials - Where the token comes from.
   * @param limiter - The shared rate guard.
   * @param octokitFactory - The configured client constructor, injected by token.
   */
  constructor(
    private readonly credentials: GithubCredentialsService,
    private readonly limiter: GithubRateLimiter,
    @Inject(OCTOKIT_FACTORY) private readonly octokitFactory: OctokitFactory,
  ) {}

  /**
   * A client authenticated as one workspace.
   *
   * @param organizationId - The workspace, from the tenant context or from the sync's own
   *   loop over enabled repositories.
   * @returns The client. Holds the token only inside the library's auth strategy; nothing
   *   returned from here exposes it.
   * @throws {GithubApiError} `not_configured` when the workspace has no token.
   */
  async forOrganization(organizationId: string): Promise<GithubClient> {
    const token = await this.credentials.tokenFor(organizationId);

    return new GithubClient(organizationId, this.octokitFactory(token), this.limiter);
  }
}

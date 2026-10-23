/**
 * Repository access — one read on the provider SPI, for the live-loop readiness preflight (DK.1,
 * [#1318](https://github.com/NobuData/ouroboros/issues/1318)).
 *
 * ```
 * repositoryAccess(ctx) → { repository: "owner/name", push: true | false | null }
 * ```
 *
 * The preflight must say whether a source's token can open a pull request **without writing**,
 * so it asks the host what the token's account may do on the push target — a permission lookup.
 * `push: null` is the host's silence: an answer with no permission document, which the preflight
 * reports as *could not be confirmed* rather than guessing either way.
 *
 * **The guard is by member**, as for repository documents (`ticket-source.repo-doc.ts`): it is
 * asked of a provider only after it has said it can open pull requests, and a host without the
 * member simply cannot be probed. {@link supportsRepositoryAccess} checks both.
 *
 * The member throws `TicketSourceError` on a refusal, classified the write-side way — `auth` or
 * `not_found` for a token that cannot see the repository.
 */

import type { TicketSyncContext } from "./ticket-source.provider";
import { supportsPullRequests, type PrCapableProvider } from "./ticket-source.provider";
import type { TicketSourceProvider } from "./ticket-source.provider";

/** What the host says a source's token may do on its push target. */
export interface RepositoryAccess {
  /** The push target, `owner/name`. */
  readonly repository: string;
  /** Whether the token's account may push there; `null` when the host's answer did not say. */
  readonly push: boolean | null;
}

/** The member a host that can be probed adds. */
export interface RepositoryAccessProvider extends PrCapableProvider {
  /**
   * @param context - The source, opened.
   * @returns What the token may do on the push target. Reads only.
   * @throws {TicketSourceError} On a refusal; `auth` or `not_found` when the token cannot see it.
   */
  repositoryAccess(context: TicketSyncContext): Promise<RepositoryAccess>;
}

/**
 * Whether a provider opens pull requests and can say what its token may do.
 *
 * @param provider - A registered provider.
 * @returns True when it has the PR family and {@link RepositoryAccessProvider.repositoryAccess}.
 */
export function supportsRepositoryAccess(
  provider: TicketSourceProvider,
): provider is RepositoryAccessProvider {
  const members = provider as unknown as Record<string, unknown>;

  return supportsPullRequests(provider) && typeof members.repositoryAccess === "function";
}

import "server-only";

import type { Workspace } from "@/app/api/access";
import { type SyncStatus, backlog } from "@/app/api/backlog";
import { type Enablement, readEnablement } from "@/app/api/enablement";
import { type GithubToken, githubToken } from "@/app/api/github-token";
import { mayAdminister } from "@/app/api/membership";
import { type Reading, attempt } from "@/app/api/reading";
import { type TicketSource, sources } from "@/app/api/sources";

/** Everything Settings → Repositories draws, each part either read or explained. */
export interface RepositoriesReadings {
  /** The workspace's GitHub accounts and repositories, with their switches. */
  readonly enablement: Reading<Enablement>;
  /** The ticket sources — which GitHub source names each repository. */
  readonly sources: Reading<readonly TicketSource[]>;
  /** The Issues backlog's scanning status. */
  readonly scanning: Reading<SyncStatus>;
  /** The backlog token, for an Owner or Admin; `null` for anyone else, who may not read it. */
  readonly backlogToken: Reading<GithubToken> | null;
  /** The instant the page was read, ISO 8601 — what every relative time is measured from. */
  readonly now: string;
}

/**
 * Read the tab's four parts at once.
 *
 * @param access The caller's workspace and membership.
 * @returns The readings.
 */
export async function readRepositories(access: Workspace): Promise<RepositoriesReadings> {
  const [enablement, listing, scanning, backlogToken] = await Promise.all([
    attempt(() => readEnablement(access.membership.id)),
    attempt(async () => (await sources.list()).items),
    attempt(() => backlog.status()),
    mayAdminister(access.membership.roles) ? attempt(() => githubToken.read()) : null,
  ]);

  return { enablement, sources: listing, scanning, backlogToken, now: new Date().toISOString() };
}

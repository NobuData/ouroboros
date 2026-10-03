import "server-only";

/**
 * What the Build Analyzer page reads on the server (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)).
 *
 * Only what the server can know: the workspace's enabled repositories and the reader's role. The
 * repository the page analyses is the tenant chip's choice, which lives in the browser, so the
 * run and the schedule are read by the page's poll once it has chosen (`analyzer-store.tsx`).
 */

import type { Workspace } from "@/app/api/access";
import { enabledRepos, readEnablement } from "@/app/api/enablement";
import { mayAdminister } from "@/app/api/membership";
import { type Reading, attempt } from "@/app/api/reading";

import { type AnalyzerRepo, analyzerRepos } from "./repo";

/** Everything the page's first paint is drawn from. */
export interface AnalyzerReadings {
  /** The repositories the page may analyse, or why they could not be read. */
  readonly repos: Reading<readonly AnalyzerRepo[]>;
  /** The workspace's id — what the chip's focus repository is keyed by. */
  readonly workspaceId: string;
  /**
   * Whether this person may run an analysis and save the schedule — `owner` or `admin`. It
   * decides only what the page draws; the service refuses anyone else's call whatever this says.
   */
  readonly mayAdminister: boolean;
  /** When the read was made, in epoch milliseconds — the strip's clock until the first poll. */
  readonly readAt: number;
}

/**
 * Read what the page needs before it can choose a repository.
 *
 * @param access The workspace the gate returned.
 * @param now The clock. A suite passes one to hold `readAt` still.
 * @returns The readings.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readAnalyzer(access: Workspace, now: () => number = Date.now): Promise<AnalyzerReadings> {
  const { membership } = access;
  const repos = await attempt(async () => analyzerRepos(enabledRepos(await readEnablement(membership.id))));

  return {
    repos,
    workspaceId: membership.id,
    mayAdminister: mayAdminister(membership.roles),
    readAt: now(),
  };
}

import "server-only";

/**
 * What the Build Analyzer page reads on the server (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)).
 *
 * Only what the server can know: the workspace's enabled repositories, the reader's roles, and
 * the workspace's trackers (BW.4, [#519](https://github.com/NobuData/ouroboros/issues/519)) — what
 * a drafted batch is pushed to, and what a new one may be drafted for. The repository the page
 * analyses is the tenant chip's choice, which lives in the browser, so the run and the schedule
 * are read by the page's poll once it has chosen (`analyzer-store.tsx`).
 */

import type { Workspace } from "@/app/api/access";
import { enabledRepos, readEnablement } from "@/app/api/enablement";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import { type Reading, attempt } from "@/app/api/reading";
import { sources } from "@/app/api/sources";
import { type TrackerOption, trackerOptions } from "@/app/planning/generator";

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
  /**
   * Whether this person may dismiss a suggestion — `owner`, `admin` or `member` (BW.3,
   * [#518](https://github.com/NobuData/ouroboros/issues/518)). Like `mayAdminister`, it decides
   * only what the page draws.
   */
  readonly mayDismiss: boolean;
  /**
   * Whether this person may select and deselect a drafted ticket — `owner`, `admin` or `member`,
   * the planning page's rule for the same checkbox (BW.4,
   * [#519](https://github.com/NobuData/ouroboros/issues/519)).
   */
  readonly mayContribute: boolean;
  /**
   * The workspace's trackers as the planning page's segment draws them — each connected source,
   * and why one cannot be written to — or why they could not be read.
   */
  readonly trackers: Reading<readonly TrackerOption[]>;
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
  const [repos, connected, catalog] = await Promise.all([
    attempt(async () => analyzerRepos(enabledRepos(await readEnablement(membership.id)))),
    attempt(() => sources.list()),
    attempt(() => sources.catalog()),
  ]);

  return {
    repos,
    workspaceId: membership.id,
    mayAdminister: mayAdminister(membership.roles),
    mayDismiss: mayContribute(membership.roles),
    mayContribute: mayContribute(membership.roles),
    trackers: connected.ok ? { ok: true, value: trackerOptions(connected.value.items, catalog) } : connected,
    readAt: now(),
  };
}

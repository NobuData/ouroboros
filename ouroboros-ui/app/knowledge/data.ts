import "server-only";

/**
 * What the knowledge frame reads before it renders
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417); the stats since BG.2,
 * [#418](https://github.com/NobuData/ouroboros/issues/418)).
 *
 * Three reads, in parallel, each kept as a `Reading` so a refusal degrades one concern and not the
 * page: the skills list, which is the table's rows and what **+ New skill** checks a typed slug
 * against before sending; the Used-by stats, which is the one column the list cannot supply
 * (counted from injection records, never stored); and the enabled repositories, which is what
 * **Import** offers to choose from and what a repo-scoped skill names.
 *
 * There is no operation for *the enabled repositories* — `app/api/enablement.ts` composes it as
 * `1 + n` requests, bounded, and `enabledRepos` applies the both-flags rule; `app/issues/data.ts`
 * reads it the same way for its repository select, and for the same reason: a `<select>` needs
 * its options before it is opened, and the page arrives rendered.
 */

import type { Workspace } from "@/app/api/access";
import { enabledRepos, readEnablement } from "@/app/api/enablement";
import { attempt } from "@/app/api/reading";
import { skills } from "@/app/api/skills";

import type { KnowledgeReadings } from "./view";

/**
 * Read what the frame draws, for the workspace the gate returned.
 *
 * @param access The workspace this request may render — `requireWorkspace()`'s answer.
 * @param now The instant of the read, which every relative age on the page is measured from.
 *   Defaults to the clock; a suite passes one so the figures hold still.
 * @returns The three readings, each `ok` or carrying the service's reason, and the instant.
 * @throws Anything that is not the service refusing — the redirect signal above all
 *   (`app/api/reading.ts`).
 */
export async function readKnowledge(access: Workspace, now: Date = new Date()): Promise<KnowledgeReadings> {
  const [list, stats, repos] = await Promise.all([
    attempt(() => skills.list()),
    attempt(() => skills.stats()),
    attempt(async () => enabledRepos(await readEnablement(access.membership.id))),
  ]);

  return { skills: list, stats, repos, readAt: now.toISOString() };
}

import "server-only";

/**
 * What the knowledge frame reads before it renders
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)).
 *
 * Two reads, in parallel, each kept as a `Reading` so a refusal degrades one concern and not the
 * page: the skills list, which is what **+ New skill** checks a typed slug against before sending
 * (a collision the reader is told about *before* creation, as the issue asks), and the enabled
 * repositories, which is what **Import** offers to choose from and what a repo-scoped skill names.
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
 * @returns Both readings, each `ok` or carrying the service's reason.
 * @throws Anything that is not the service refusing — the redirect signal above all
 *   (`app/api/reading.ts`).
 */
export async function readKnowledge(access: Workspace): Promise<KnowledgeReadings> {
  const [list, repos] = await Promise.all([
    attempt(() => skills.list()),
    attempt(async () => enabledRepos(await readEnablement(access.membership.id))),
  ]);

  return { skills: list, repos };
}

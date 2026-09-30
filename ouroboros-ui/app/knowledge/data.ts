import "server-only";

/**
 * What the knowledge frame reads before it renders
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417); the stats since BG.2,
 * [#418](https://github.com/NobuData/ouroboros/issues/418); the facts since BG.3,
 * [#419](https://github.com/NobuData/ouroboros/issues/419)).
 *
 * Four reads, in parallel, each kept as a `Reading` so a refusal degrades one concern and not the
 * page: the skills list, which is the table's rows and what **+ New skill** checks a typed slug
 * against before sending; the Used-by stats, which is the one column the list cannot supply; the
 * facts, which are the learned-facts card's rows; and the enabled repositories, which is what
 * **Import** offers to choose from and what a repo-scoped skill or a manual fact names.
 *
 * ### Provenance links resolve, or they are not links
 *
 * A fact's provenance cites runs, pull requests and tickets by id. Runs and pull requests have
 * pages of their own (`runPath`, `prPath`), so their links are built from the id alone. A ticket
 * has no page here — the backlog opens one by selection — so its link is its tracker page, which
 * takes the ticket's number and repository: {@link readKnowledge} reads each cited ticket once
 * (`GET /api/v1/backlog/{id}`, bounded by the refs the facts carry) and hands the card the link,
 * or nothing for a ticket it could not read, which the card then draws as text. A provenance
 * line pointing nowhere is worse than none — the issue's own rule.
 *
 * There is no operation for *the enabled repositories* — `app/api/enablement.ts` composes it as
 * `1 + n` requests, bounded, and `enabledRepos` applies the both-flags rule; `app/issues/data.ts`
 * reads it the same way for its repository select, and for the same reason: a `<select>` needs
 * its options before it is opened, and the page arrives rendered.
 */

import type { Workspace } from "@/app/api/access";
import { backlog } from "@/app/api/backlog";
import { enabledRepos, readEnablement } from "@/app/api/enablement";
import type { FactList } from "@/app/api/facts";
import { facts } from "@/app/api/facts";
import { attempt } from "@/app/api/reading";
import { skills } from "@/app/api/skills";

import { ticketTrackerUrl } from "./facts";
import type { KnowledgeReadings, TicketLink } from "./view";

/**
 * Read what the frame draws, for the workspace the gate returned.
 *
 * @param access The workspace this request may render — `requireWorkspace()`'s answer.
 * @param now The instant of the read, which every relative age on the page is measured from.
 *   Defaults to the clock; a suite passes one so the figures hold still.
 * @returns The readings, each `ok` or carrying the service's reason, the resolved tickets, and
 *   the instant.
 * @throws Anything that is not the service refusing — the redirect signal above all
 *   (`app/api/reading.ts`).
 */
export async function readKnowledge(access: Workspace, now: Date = new Date()): Promise<KnowledgeReadings> {
  const [list, stats, learned, repos] = await Promise.all([
    attempt(() => skills.list()),
    attempt(() => skills.stats()),
    attempt(() => facts.list()),
    attempt(async () => enabledRepos(await readEnablement(access.membership.id))),
  ]);

  const tickets = learned.ok ? await resolveTickets(learned.value) : {};

  return { skills: list, stats, facts: learned, tickets, repos, readAt: now.toISOString() };
}

/**
 * Resolve every ticket the facts cite to its tracker page.
 *
 * Each distinct ticket is read once, in parallel; a ticket the service refuses — gone, or another
 * workspace's — is left out rather than failing the page, and the card says so in its place.
 *
 * @param list The facts.
 * @returns The links, keyed by ticket id.
 */
async function resolveTickets(list: FactList): Promise<Readonly<Record<string, TicketLink>>> {
  const ids = new Set<string>();

  for (const fact of list.items) {
    for (const ref of fact.provenance.refs) {
      if (ref.kind === "ticket" && ref.id !== undefined) ids.add(ref.id);
    }
  }

  const resolved = await Promise.all(
    [...ids].map(async (id): Promise<readonly [string, TicketLink] | null> => {
      const reading = await attempt(() => backlog.detail(id));
      if (!reading.ok) return null;

      const { number, repository } = reading.value.issue;
      const href = ticketTrackerUrl(repository, number);

      return href === null ? null : [id, { label: `#${String(number)}`, href }];
    }),
  );

  return Object.fromEntries(resolved.filter((entry): entry is readonly [string, TicketLink] => entry !== null));
}

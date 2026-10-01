import "server-only";

/**
 * What the knowledge frame reads before it renders
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417); the stats since BG.2,
 * [#418](https://github.com/NobuData/ouroboros/issues/418); the facts since BG.3,
 * [#419](https://github.com/NobuData/ouroboros/issues/419); the playbooks and the profile since
 * BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420); the repo-map status since BG.6,
 * [#422](https://github.com/NobuData/ouroboros/issues/422)).
 *
 * Six reads, in parallel, each kept as a `Reading` so a refusal degrades one concern and not the
 * page: the skills list, which is the table's rows and what **+ New skill** checks a typed slug
 * against before sending; the Used-by stats, which is the one column the list cannot supply; the
 * facts, which are the learned-facts card's rows; the playbooks, which are the playbooks card's
 * rows; the enabled repositories, which is what **Import** offers to choose from, what a
 * repo-scoped skill or a manual fact names, and what the profile card draws one of; and where each
 * repository's `repo-map` stands, which is what lets the skills card say *pending* rather than
 * leave a map that never generated looking like one that failed.
 *
 * ### The profile card reads for one repository, chosen before the reads
 *
 * The card composes detection (#384, #380) and the environment recipe (#408) for **one**
 * repository — the one `?repo=` names when it is enabled, else the first enabled one
 * (`chooseProfileRepo`). Those two reads therefore follow the enablement read rather than run
 * beside it. A repository with no recipe answers `404 env_recipe_not_found`, which is a state the
 * card draws with an add action, so it is kept as `ok` with `null` rather than as a failed read.
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
import { detection } from "@/app/api/detection";
import { type EnabledRepo, enabledRepos, readEnablement } from "@/app/api/enablement";
import { ENV_RECIPE_NOT_FOUND_CODE, type EnvRecipe, envRecipes } from "@/app/api/env-recipes";
import { isApiError } from "@/app/api/errors";
import type { FactList } from "@/app/api/facts";
import { facts } from "@/app/api/facts";
import { playbooks } from "@/app/api/playbooks";
import { type Reading, attempt } from "@/app/api/reading";
import { repoMap } from "@/app/api/repo-map";
import { skills } from "@/app/api/skills";

import { repoRef } from "./create";
import { ticketTrackerUrl } from "./facts";
import { NO_REPOS_TITLE, chooseProfileRepo } from "./profile";
import type { KnowledgeReadings, ProfileReadings, TicketLink } from "./view";

/**
 * Read what the frame draws, for the workspace the gate returned.
 *
 * @param access The workspace this request may render — `requireWorkspace()`'s answer.
 * @param now The instant of the read, which every relative age on the page is measured from.
 *   Defaults to the clock; a suite passes one so the figures hold still.
 * @param requestedRepo What the address's `?repo=` named for the profile card, or nothing.
 * @returns The readings, each `ok` or carrying the service's reason, the resolved tickets, and
 *   the instant.
 * @throws Anything that is not the service refusing — the redirect signal above all
 *   (`app/api/reading.ts`).
 */
export async function readKnowledge(
  access: Workspace,
  now: Date = new Date(),
  requestedRepo?: string,
): Promise<KnowledgeReadings> {
  const [list, stats, learned, recipes, repos, maps] = await Promise.all([
    attempt(() => skills.list()),
    attempt(() => skills.stats()),
    attempt(() => facts.list()),
    attempt(() => playbooks.list()),
    attempt(async () => enabledRepos(await readEnablement(access.membership.id))),
    attempt(() => repoMap.status()),
  ]);

  const [tickets, profile] = await Promise.all([
    learned.ok ? resolveTickets(learned.value) : Promise.resolve({}),
    readProfile(repos, requestedRepo),
  ]);

  return { skills: list, stats, facts: learned, tickets, repos, playbooks: recipes, profile, maps, readAt: now.toISOString() };
}

/**
 * Read what the profile card composes, for the repository it draws.
 *
 * @param repos The enabled repositories, or why they could not be read.
 * @param requestedRepo What `?repo=` named, or nothing.
 * @returns The repository and its two readings — both carrying the reason when there is no
 *   repository to read for.
 */
async function readProfile(
  repos: Reading<readonly EnabledRepo[]>,
  requestedRepo: string | undefined,
): Promise<ProfileReadings> {
  const repo = repos.ok ? chooseProfileRepo(repos.value, requestedRepo) : null;

  if (repo === null) {
    const reason = repos.ok ? NO_REPOS_TITLE : repos.reason;

    return { repo: null, detection: { ok: false, reason }, recipe: { ok: false, reason } };
  }

  const ref = repoRef(repo);
  const [scan, recipe] = await Promise.all([attempt(() => detection.read(ref)), readRecipe(ref)]);

  return { repo, detection: scan, recipe };
}

/**
 * Read a repository's recipe, keeping *none yet* as a state.
 *
 * @param repo The repository, `owner/name`.
 * @returns The recipe, `null` for a repository with none, or why it could not be read.
 * @throws Anything that is not the service refusing.
 */
async function readRecipe(repo: string): Promise<Reading<EnvRecipe | null>> {
  try {
    return { ok: true, value: await envRecipes.read(repo) };
  } catch (error) {
    if (!isApiError(error)) throw error;
    if (error.code === ENV_RECIPE_NOT_FOUND_CODE) return { ok: true, value: null };

    return { ok: false, reason: error.message };
  }
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

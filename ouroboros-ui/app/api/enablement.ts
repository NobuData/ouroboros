import "server-only";

/**
 * What the enablement step reads: a workspace's organisations, each with its repositories.
 *
 * The contract has no operation for this — organisations and repositories are two resources
 * and one is nested under the other — so the composition happens here rather than in the
 * screen. Nothing is reshaped on the way through: an {@link OrgEnablement} carries the
 * contract's own `Org` and `Repo` objects and the service's own `total`, so this is a
 * *grouping*, not a second contract (the rule `app/api/tenants.ts` sets out).
 *
 * ### The request fan-out is deliberate and bounded
 *
 * One listing for the organisations, then one per organisation for its repositories, issued
 * together. That is `1 + n` requests, and the alternative — an operation that returns both —
 * does not exist to call. `n` is bounded by {@link ENABLEMENT_LIMIT}, which is the contract's
 * own ceiling on a page, so a workspace with a thousand organisations costs a hundred
 * requests rather than a thousand and the screen says how many it left out.
 *
 * ### Nothing is silently truncated
 *
 * Both totals travel with the data, because the screen has to be able to say "showing 100 of
 * 340" rather than presenting a hundred rows as the whole truth. Paging through the rest is
 * the workspace-settings screen's job (#491), not the first-run one's.
 */

import type { ApiClient } from "@/app/api/client";
import { type Org, orgs } from "@/app/api/orgs";
import { type Repo, repos } from "@/app/api/repos";
import { api } from "@/app/api/server";

/**
 * How many rows either listing asks for.
 *
 * The contract's maximum, not its default of 25: this is a first-run screen and a workspace
 * with thirty organisations should see thirty rows rather than a page control. The ceiling
 * is the service's and is not negotiable from here — "without it, a `limit` of a million is
 * a client's way of asking this service to hold a table in memory".
 */
export const ENABLEMENT_LIMIT = 100;

/** One organisation, with the repositories recorded under it. */
export interface OrgEnablement {
  /** The organisation, as the contract describes it. */
  readonly org: Org;
  /** Its repositories, enabled or not, up to {@link ENABLEMENT_LIMIT} of them. */
  readonly repos: readonly Repo[];
  /** How many it has in total, which may exceed what {@link OrgEnablement.repos} holds. */
  readonly repoTotal: number;
}

/** A workspace's enablement list: its organisations, each with its repositories. */
export interface Enablement {
  /** The organisations, in the order the service returned them. */
  readonly orgs: readonly OrgEnablement[];
  /** How many it has in total, which may exceed what {@link Enablement.orgs} holds. */
  readonly orgTotal: number;
}

/**
 * One repository Ouroboros may actually work in — what {@link enabledRepos} answers with.
 *
 * Narrower than the contract's `Repo` on purpose: this is the row a *chooser* draws
 * ([#77](https://github.com/NobuData/ouroboros/issues/77)), and the timestamps and the
 * default branch beside it are noise in a menu. It carries the organisation's `login`
 * because a repository name is unique only within one, so a workspace with two
 * organisations can hold two repositories called `docs` and the menu has to be able to say
 * which is which.
 */
export interface EnabledRepo {
  /**
   * `github_repos.id`. The `repo` query parameter `GET /api/v1/runs` (#71) and
   * `GET /api/v1/queue` (#73) accept, and what the focus-repo preference holds.
   */
  readonly id: string;
  /** Its name within its organisation. */
  readonly name: string;
  /** The GitHub organisation it hangs from, lower-cased. */
  readonly login: string;
}

/**
 * The repositories in an enablement list that Ouroboros may operate in.
 *
 * **Both flags, which is the whole of this function.** The module's own opening rule is that
 * a repository is in scope only when its `enabled` *and* its organisation's are both true,
 * and that the reads do not apply it — so somebody has to, and a chooser offering a
 * repository under a switched-off organisation would be offering a filter that narrows every
 * listing to nothing.
 *
 * A pure derivation over an already-read list rather than a second read: the caller has the
 * list, and this is a rule about it.
 *
 * @param list What {@link readEnablement} answered.
 * @returns The repositories, in the order the service listed them — organisations first,
 *   repositories within each. Empty when nothing is enabled, which is a state to draw.
 */
export function enabledRepos(list: Enablement): EnabledRepo[] {
  return list.orgs
    .filter(({ org }) => org.enabled)
    .flatMap(({ org, repos: under }) =>
      under
        .filter((one) => one.enabled)
        .map((one) => ({ id: one.id, name: one.name, login: org.login })),
    );
}

/**
 * Read a workspace's organisations and their repositories.
 *
 * @param tenantId The workspace's uuid.
 * @param client The client to call through. Defaults to the server-side one; tests pass one
 *   over a stub `fetch`.
 * @returns The list. A workspace with nothing recorded gets `{orgs: [], orgTotal: 0}`, which
 *   is an empty state for the screen to draw rather than a failure.
 * @throws {ApiError} What the service answered. One failed repository listing fails the
 *   whole read, deliberately: a list with one organisation silently missing its repositories
 *   would show every switch under it as off.
 */
export async function readEnablement(
  tenantId: string,
  client: ApiClient = api(),
): Promise<Enablement> {
  const page = await orgs.list(tenantId, { limit: ENABLEMENT_LIMIT }, client);

  return {
    orgTotal: page.total,
    orgs: await Promise.all(
      page.items.map(async (org) => {
        const under = await repos.list(
          tenantId,
          org.login,
          { limit: ENABLEMENT_LIMIT },
          client,
        );
        return { org, repos: under.items, repoTotal: under.total };
      }),
    ),
  };
}

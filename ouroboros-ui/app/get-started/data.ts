import "server-only";

/**
 * `/get-started`'s first paint (BC.1, [#390](https://github.com/NobuData/ouroboros/issues/390)):
 * which repository the wizard is for, its rail as BB.2 (#385) derives it, its detection card as
 * BB.1 (#384) stored it (BC.2, #391), and what the person may do.
 *
 * **Which repository.** The request names it (`?repo=owner/name`); otherwise the wizard opens on
 * the workspace's first mirrored repository — an enabled one first ({@link defaultRepo}). With
 * nothing mirrored there is nothing to ask the service about, and the page says so rather than
 * drawing a rail of its own (the user's decision on the ticket).
 */

import type { Workspace } from "@/app/api/access";
import { type RepoDetection, detection } from "@/app/api/detection";
import { readEnablement } from "@/app/api/enablement";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import { type Onboarding, onboarding } from "@/app/api/onboarding";
import { type Reading, attempt } from "@/app/api/reading";

import { type Abilities, type GetStartedOffer, defaultRepo, parseRepo } from "./view";

/** Everything the first paint is drawn from. */
export interface GetStartedReadings {
  /** The repository the wizard is for, or null when the workspace has mirrored none. */
  readonly repo: string | null;
  /** Its wizard, or null when there is no repository — or why it could not be read. */
  readonly wizard: Reading<Onboarding> | null;
  /** Its detection card (BC.2, #391), or null when there is no repository. */
  readonly detection: Reading<RepoDetection> | null;
  /** Why the repository list could not be read, when the request named none and it failed. */
  readonly reposFailure: string | null;
  /** What the person may do. */
  readonly abilities: Abilities;
}

/**
 * The repository the wizard opens on when the request names none.
 *
 * @param tenantId The workspace.
 * @returns The repository (or null when nothing is mirrored), or why the list could not be read.
 */
export async function openingRepo(tenantId: string): Promise<Reading<string | null>> {
  const listed = await attempt(() => readEnablement(tenantId));

  if (!listed.ok) return listed;

  return {
    ok: true,
    value: defaultRepo(
      listed.value.orgs.flatMap(({ org, repos }) =>
        repos.map((repo) => ({ login: org.login, name: repo.name, enabled: org.enabled && repo.enabled })),
      ),
    ),
  };
}

/**
 * Read the frame.
 *
 * @param access The workspace this request renders.
 * @param asked What `?repo=` named, unvalidated.
 * @returns The readings.
 */
export async function readGetStarted(access: Workspace, asked: string | string[] | undefined): Promise<GetStartedReadings> {
  const abilities: Abilities = {
    contribute: mayContribute(access.membership.roles),
    administer: mayAdminister(access.membership.roles),
  };
  const named = parseRepo(asked);
  const chosen: Reading<string | null> = named === null ? await openingRepo(access.membership.id) : { ok: true, value: named };

  if (!chosen.ok) {
    return { repo: null, wizard: null, detection: null, reposFailure: chosen.reason, abilities };
  }

  if (chosen.value === null) {
    return { repo: null, wizard: null, detection: null, reposFailure: null, abilities };
  }

  const repo = chosen.value;

  const [wizard, card] = await Promise.all([
    attempt(() => onboarding.read(repo)),
    attempt(() => detection.read(repo)),
  ]);

  return { repo, wizard, detection: card, reposFailure: null, abilities };
}

/**
 * Whether the dashboard should offer the wizard (BB.2's fresh-org rule, read with no repository
 * named), and on which repository.
 *
 * Best-effort: a failed read is no banner — the dashboard is not degraded by an offer it could not
 * check.
 *
 * @param tenantId The workspace.
 * @returns The offer, or null when the rule does not offer the wizard or could not be read.
 */
export async function readGetStartedOffer(tenantId: string): Promise<GetStartedOffer | null> {
  const decided = await attempt(() => onboarding.surfacing());

  if (!decided.ok || !decided.value.offer) return null;

  const repo = await openingRepo(tenantId);

  return { repo: repo.ok ? repo.value : null };
}

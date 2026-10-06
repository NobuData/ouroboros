import "server-only";

/**
 * `/get-started`'s first paint (BC.1, [#390](https://github.com/NobuData/ouroboros/issues/390)):
 * which repository the wizard is for, its rail as BB.2 (#385) derives it, its detection card as
 * BB.1 (#384) stored it (BC.2, #391), its template tiles as BB.3 (#386) evaluates them (BC.3,
 * #392), its first-issue card as BB.4 (#387) scores it with the dry-run policy (BA.3, #382) its
 * safety rows state (BC.4, #393), its right column as BB.5 (#388) selects it for this deployment
 * (BC.5, #394), the workspace's ticket sources and GitHub mirror that steps 1–2's embedded flows
 * draw (BC.6, #395), and what the person may do.
 *
 * **Which repository.** The request names it (`?repo=owner/name`); otherwise the wizard opens on
 * the workspace's first mirrored repository — an enabled one first ({@link defaultRepo}). With
 * nothing mirrored there is nothing to ask the service about, and the page says so rather than
 * drawing a rail of its own (the user's decision on the ticket) — and draws step 1's connect
 * flow and step 2's picker in its place, so a workspace starts from zero on this page.
 *
 * **One listing of the mirror.** The repository the wizard opens on, step 2's picker and the
 * completion card's re-enter list all read the same `1 + n` listing (`readEnablement`), so it is
 * read once per paint and handed down.
 */

import type { Workspace } from "@/app/api/access";
import { type RepoDetection, detection } from "@/app/api/detection";
import { type Enablement, readEnablement } from "@/app/api/enablement";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import {
  type FirstIssueCard,
  type Onboarding,
  type OnboardingDefaults,
  type OnboardingTemplateTiles,
  onboarding,
  readFirstIssueCard,
} from "@/app/api/onboarding";
import { type Reading, attempt } from "@/app/api/reading";
import { type SourcesReadings, readSources } from "@/app/sources/data";

import { type Abilities, type GetStartedOffer, defaultRepo, parseRepo } from "./view";

/** Everything the first paint is drawn from. */
export interface GetStartedReadings {
  /** The repository the wizard is for, or null when the workspace has mirrored none. */
  readonly repo: string | null;
  /** Its wizard, or null when there is no repository — or why it could not be read. */
  readonly wizard: Reading<Onboarding> | null;
  /** Its detection card (BC.2, #391), or null when there is no repository. */
  readonly detection: Reading<RepoDetection> | null;
  /** Its template tiles (BC.3, #392), or null when there is no repository. */
  readonly templates: Reading<OnboardingTemplateTiles> | null;
  /** Its first-issue card (BC.4, #393), or null when there is no repository. */
  readonly firstIssue: Reading<FirstIssueCard> | null;
  /** Its right column — defaults, timeline, reassure (BC.5, #394) — or null when there is no repository. */
  readonly defaults: Reading<OnboardingDefaults> | null;
  /** The workspace's ticket sources, as Settings → Sources reads them — step 1's flow (BC.6, #395). */
  readonly sources: Reading<SourcesReadings>;
  /** The workspace's GitHub mirror — step 2's picker and the completion card's re-enter list (BC.6, #395). */
  readonly enablement: Reading<Enablement>;
  /** Why the repository list could not be read, when the request named none and it failed. */
  readonly reposFailure: string | null;
  /** What the person may do. */
  readonly abilities: Abilities;
}

/**
 * The repository the wizard opens on when the request names none, from one listing.
 *
 * @param listed The mirror, or why it could not be read.
 * @returns The repository (or null when nothing is mirrored), or why the list could not be read.
 */
function defaultRepoOf(listed: Reading<Enablement>): Reading<string | null> {
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
 * The repository the wizard opens on when the request names none.
 *
 * @param tenantId The workspace.
 * @returns The repository (or null when nothing is mirrored), or why the list could not be read.
 */
export async function openingRepo(tenantId: string): Promise<Reading<string | null>> {
  return defaultRepoOf(await attempt(() => readEnablement(tenantId)));
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
  const [enablement, sources] = await Promise.all([
    attempt(() => readEnablement(access.membership.id)),
    attempt(() => readSources(access)),
  ]);
  const chosen: Reading<string | null> = named === null ? defaultRepoOf(enablement) : { ok: true, value: named };

  if (!chosen.ok || chosen.value === null) {
    return {
      repo: null,
      wizard: null,
      detection: null,
      templates: null,
      firstIssue: null,
      defaults: null,
      sources,
      enablement,
      reposFailure: chosen.ok ? null : chosen.reason,
      abilities,
    };
  }

  const repo = chosen.value;

  const [wizard, card, templates, firstIssue, defaults] = await Promise.all([
    attempt(() => onboarding.read(repo)),
    attempt(() => detection.read(repo)),
    attempt(() => onboarding.templates(repo)),
    attempt(() => readFirstIssueCard(repo)),
    attempt(() => onboarding.defaults(repo)),
  ]);

  return { repo, wizard, detection: card, templates, firstIssue, defaults, sources, enablement, reposFailure: null, abilities };
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

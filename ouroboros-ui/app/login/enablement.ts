/**
 * Step 2's own vocabulary: the two field names its forms carry, and the line of prose it
 * writes under each workspace.
 *
 * The mockup's row carries "4 repos enabled · incl. helios-firmware" — a count and an
 * example, which together tell somebody at a glance whether the workspace is doing anything
 * and what. Both come from the service's own row model (`OrgRow.repoCounts`,
 * `OrgRow.featuredRepo`), so the sentence and the switch beside it cannot disagree; what is
 * decided here is only how they are said.
 *
 * The field names are here for the reason `app/login/sso.ts` holds `DOMAIN_FIELD`: a
 * `"use server"` module may export nothing but async functions, so a constant the actions
 * and the components must agree about cannot live in `actions.ts` and has to live somewhere
 * both may import.
 *
 * Framework-free and type-only in its imports, so the sentences can be tested as sentences.
 */

import type { Membership } from "@/app/api/membership";

/**
 * The field naming which workspace a submission is about.
 *
 * Every form on the card carries it — each switch, and **Enter mission control →** — because
 * the card lists every workspace at once and none of them is implied by the request.
 */
export const WORKSPACE_FIELD = "workspace";

/** The field carrying the state a switch is moving to, as `"true"` or `"false"`. */
export const ENABLED_FIELD = "enabled";

/**
 * The mockup's repository line for one workspace.
 *
 * Three facts, in the order the mockup puts them and only when each is true: how many
 * repositories are enabled, one of them by name, and that the workspace's organisations are
 * switched off so none of them is in scope. The last is the one the mockup does not have and
 * the contract demands — a repository is in scope only when its flag **and** its
 * organisation's are both true (`app/api/repos.ts`), so a count of enabled repositories under
 * a switched-off workspace would otherwise read as work that is about to happen.
 *
 * @param membership The workspace, as the service's row model describes it.
 * @returns The line, ready to render. Never empty: a workspace with nothing enabled says so.
 */
export function repoSummary(membership: Membership): string {
  const { enabled } = membership.repoCounts;

  const parts: string[] = [`${enabled} ${enabled === 1 ? "repo" : "repos"} enabled`];

  if (membership.featuredRepo !== null) {
    parts.push(`incl. ${membership.featuredRepo}`);
  }

  if (!membership.enabled && enabled > 0) {
    parts.push("org off — none in scope");
  }

  return parts.join(" · ");
}

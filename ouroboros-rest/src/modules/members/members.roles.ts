/**
 * The Members card's role vocabulary — decision **S3**'s display mapping
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1).
 *
 * **Roles are the organization plugin's, and only the plugin's.** `owner | admin | member |
 * viewer` live in `member.role` and are what every permission check in the product reads. The
 * mockup's *Owner / Maintainer / Viewer* is a display concern, mapped here, so the card speaks the
 * language it was designed in without a second role table that could fork every check.
 *
 * One table, {@link DISPLAY_ROLE_TIERS}, drives both the per-member label and the card's footer
 * line, so the sentence *"Owner > Maintainer (approve/merge) > Viewer (read-only)"* cannot drift
 * from what the API does.
 */

import type { OrganizationRole } from "../db/schema";
import { defaultCanApproveLoops } from "../tenancy/capabilities";

/** What the card calls a role. `Service` is a service account's, which holds no plugin role. */
export type DisplayRole = "Owner" | "Maintainer" | "Viewer" | "Service";

/** One tier of the hierarchy, highest first. */
export interface DisplayRoleTier {
  /** The card's label. */
  readonly label: Exclude<DisplayRole, "Service">;
  /** The plugin roles shown under it. */
  readonly roles: readonly OrganizationRole[];
}

/** S3: `owner → Owner`, `admin → Maintainer`, `member`/`viewer → Viewer` — highest first. */
export const DISPLAY_ROLE_TIERS: readonly DisplayRoleTier[] = [
  { label: "Owner", roles: ["owner"] },
  { label: "Maintainer", roles: ["admin"] },
  { label: "Viewer", roles: ["member", "viewer"] },
];

/**
 * The label for a member holding `roles` — the highest tier any of them falls in.
 *
 * @param roles - The member's plugin roles (a member may hold several).
 * @returns The display role; `Viewer` for a member holding no role this service recognises.
 */
export function displayRoleOf(roles: readonly string[]): Exclude<DisplayRole, "Service"> {
  const tier = DISPLAY_ROLE_TIERS.find((candidate) =>
    candidate.roles.some((role) => roles.includes(role)),
  );

  return tier?.label ?? "Viewer";
}

/**
 * The footer line: each tier, highest first, annotated with what it may do by default —
 * `approve/merge` where the tier's roles hold `can_approve_loops` by default, `read-only` for the
 * lowest tier, nothing for the top (it may do everything).
 *
 * @returns `Owner > Maintainer (approve/merge) > Viewer (read-only)`.
 */
export function roleHierarchyLine(): string {
  return DISPLAY_ROLE_TIERS.map((tier, index) => {
    if (index === 0) return tier.label;
    if (index === DISPLAY_ROLE_TIERS.length - 1) return `${tier.label} (read-only)`;

    return defaultCanApproveLoops(tier.roles) ? `${tier.label} (approve/merge)` : tier.label;
  }).join(" > ");
}

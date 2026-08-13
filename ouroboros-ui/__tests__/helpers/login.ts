import type { Enablement, OrgEnablement } from "@/app/api/enablement";
import type { Membership } from "@/app/api/membership";
import type { Org } from "@/app/api/orgs";
import type { Repo } from "@/app/api/repos";
import type { SessionUser } from "@/app/api/identity";

/**
 * The seeded workspace, as the development seed and every mockup draw it.
 *
 * The login screen's suites all describe the same world — `acme-robotics`, Ken Suenobu, the
 * `helios-firmware` repository — because that is the world the acceptance criteria are
 * written against (`ouroboros-db/migrations/R__dev_seed.sql`). Building it once here keeps
 * each case to the one field it is actually about.
 *
 * Every factory takes a partial and fills the rest, so a case that cares about `role` says
 * `membership({ role: "viewer" })` and nothing else.
 */

/** The seeded workspace's uuid. */
export const TENANT_ID = "5eed0001-0000-4000-8000-000000000001";

/**
 * One workspace this person belongs to — `GET /api/v1/orgs`'s row, as the seed writes it.
 *
 * The defaults are the mockup's first row and the seed's first workspace: `acme-robotics`,
 * owned, switched on, four repositories enabled including `helios-firmware`. A case that is
 * about a `member`'s greyed-out switch says `membership({ roles: ["member"] })` and nothing
 * else.
 *
 * @param over The fields this case is about.
 * @returns A complete membership.
 */
export function membership(over: Partial<Membership> = {}): Membership {
  return {
    id: TENANT_ID,
    slug: "acme-robotics",
    name: "Acme Robotics",
    monogram: "AR",
    personal: false,
    roles: ["owner"],
    enabled: true,
    repoCounts: { enabled: 4, total: 4 },
    featuredRepo: "helios-firmware",
    githubOrgs: [{ login: "acme-robotics", enabled: true, repoCounts: { enabled: 4, total: 4 } }],
    createdAt: "2026-08-11T10:20:23.114Z",
    ...over,
  };
}

/**
 * The mockup's three rows, exactly as `docs/mockups/01-login.html` draws them and the
 * development seed (#709) writes them.
 *
 * The acceptance criterion this exists for is *"seeded data reproduces the mockup's three
 * rows exactly — counts, pill, switch states"*, and a suite asserting that should be able to
 * say which drawing it is asserting against rather than rebuilding it row by row.
 *
 * @returns The three workspaces, oldest first — the listing's own order.
 */
export function seededWorkspaces(): Membership[] {
  return [
    membership(),
    membership({
      id: "5eed0001-0000-4000-8000-000000000002",
      slug: "acme-labs",
      name: "Acme Labs",
      monogram: "AL",
      roles: ["member"],
      enabled: false,
      repoCounts: { enabled: 0, total: 0 },
      featuredRepo: null,
      githubOrgs: [
        { login: "acme-labs", enabled: false, repoCounts: { enabled: 0, total: 0 } },
      ],
      createdAt: "2026-08-11T10:20:24.221Z",
    }),
    membership({
      id: "5eed0001-0000-4000-8000-000000000003",
      slug: "kensuenobu",
      name: "Ken Suenobu",
      monogram: "KS",
      personal: true,
      repoCounts: { enabled: 2, total: 2 },
      featuredRepo: "dotfiles",
      githubOrgs: [
        { login: "kensuenobu", enabled: true, repoCounts: { enabled: 2, total: 2 } },
      ],
      createdAt: "2026-08-11T10:20:25.007Z",
    }),
  ];
}

/**
 * The signed-in person.
 *
 * @param over The fields this case is about.
 * @returns A complete session user.
 */
export function sessionUser(over: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "5eed0003-0000-4000-8000-000000000001",
    email: "ken@acme-robotics.dev",
    displayName: "Ken Suenobu",
    avatarUrl: null,
    createdAt: "2026-08-11T10:20:23.114Z",
    updatedAt: "2026-08-11T10:20:23.114Z",
    ...over,
  };
}

/**
 * One GitHub organisation recorded in the workspace.
 *
 * @param over The fields this case is about.
 * @returns A complete organisation.
 */
export function org(over: Partial<Org> = {}): Org {
  return {
    id: "5eed0005-0000-4000-8000-000000000001",
    orgId: TENANT_ID,
    login: "acme-robotics",
    enabled: true,
    installedAt: null,
    createdAt: "2026-08-11T10:20:23.114Z",
    updatedAt: "2026-08-11T10:20:23.114Z",
    ...over,
  };
}

/**
 * One repository under that organisation.
 *
 * @param over The fields this case is about.
 * @returns A complete repository.
 */
export function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: "5eed0006-0000-4000-8000-000000000001",
    githubOrgId: "5eed0005-0000-4000-8000-000000000001",
    name: "helios-firmware",
    enabled: true,
    defaultBranch: "main",
    createdAt: "2026-08-11T10:20:23.114Z",
    updatedAt: "2026-08-11T10:20:23.114Z",
    ...over,
  };
}

/**
 * The enablement list, from organisations paired with their repositories.
 *
 * @param entries Each organisation and the repositories under it.
 * @param orgTotal How many organisations exist in total. Defaults to the number given.
 * @returns The list.
 */
export function enablement(
  entries: readonly (readonly [Org, readonly Repo[]])[],
  orgTotal?: number,
): Enablement {
  const orgs: OrgEnablement[] = entries.map(([one, under]) => ({
    org: one,
    repos: under,
    repoTotal: under.length,
  }));

  return { orgs, orgTotal: orgTotal ?? orgs.length };
}

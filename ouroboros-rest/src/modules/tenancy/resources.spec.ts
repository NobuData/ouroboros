import type { GithubOrg, GithubRepo, Organization, TenantDomain } from "../db/schema";
import { FIXTURE_ORGANIZATION } from "./organization.fixture";
import {
  domainResource,
  githubOrgResource,
  isPersonal,
  monogramOf,
  orgRowResource,
  repoResource,
  type GithubOrgSummary,
} from "./resources";

/**
 * The translation between the database's names and the API's.
 *
 * Three things are being checked, and the last is the one that matters most. The first is that
 * every column arrives under the right key — an `isPrimary` that silently read `is_primary`
 * from the wrong row would be caught by nothing else. The second is the *derived* fields the
 * Step 2 row carries, which exist here rather than in a browser precisely so they can be
 * asserted. The third is that a column the migrations add later does *not* arrive at all:
 * these functions name every field they return, so a new column reaches the wire only when
 * somebody decides it should.
 */

/** A GitHub organisation's counts, as a Step 2 row carries them. */
function summary(login: string, enabled: number, total: number, on = true): GithubOrgSummary {
  return { login, enabled: on, repoCounts: { enabled, total } };
}

describe("a workspace's monogram", () => {
  it.each([
    ["Acme Robotics", "AR"],
    ["Ken Suenobu", "KS"],
    ["Acme Labs", "AL"],
  ])("takes the initials of %s", (name, expected) => {
    // The three the mockup draws, against the three names the development seed stores.
    expect(monogramOf(name)).toBe(expected);
  });

  it("takes two letters from a single-word name", () => {
    expect(monogramOf("Globex")).toBe("GL");
  });

  it("ignores punctuation rather than rendering it", () => {
    // `Acme, Inc.` split on whitespace alone would give `A,` — a comma in an avatar.
    expect(monogramOf("Acme, Inc.")).toBe("AI");
  });

  it("upper-cases what it finds", () => {
    expect(monogramOf("ken suenobu")).toBe("KS");
  });

  it("handles a name outside the Latin alphabet", () => {
    // `Ü` is a letter and is not `[A-Z]`, which is why the split is Unicode-aware.
    expect(monogramOf("Ürün Ekibi")).toBe("ÜE");
  });

  it("is empty rather than a crash for a name with nothing to take", () => {
    // A state the plugin should not create; the UI draws an empty circle for it.
    expect(monogramOf("—")).toBe("");
    expect(monogramOf("")).toBe("");
  });
});

describe("the personal flag", () => {
  it("is set by the metadata `active.organization.ts` writes", () => {
    expect(isPersonal('{"personal": true}')).toBe(true);
  });

  it("is false for a workspace with no metadata at all", () => {
    expect(isPersonal(null)).toBe(false);
  });

  it("is false for metadata that carries other keys", () => {
    expect(isPersonal('{"status": "suspended"}')).toBe(false);
  });

  it("insists on the boolean rather than accepting anything truthy", () => {
    // The pill claims a fact about how the workspace came into being. `"true"` is what a
    // client that could set the key would send, and the plugin strips the key for that reason.
    expect(isPersonal('{"personal": "true"}')).toBe(false);
    expect(isPersonal('{"personal": 1}')).toBe(false);
  });

  it("is false for a JSON scalar, which is JSON and is not an object", () => {
    expect(isPersonal("true")).toBe(false);
    expect(isPersonal("null")).toBe(false);
  });

  it("survives metadata that will not parse", () => {
    // `organization_metadata_is_json` should make this unreachable. If it ever is reachable,
    // a missing pill is a worse screen and a thrown error is a workspace nobody can see.
    expect(isPersonal("{not json")).toBe(false);
  });
});

describe("a workspace row", () => {
  it("is the mockup's row, field for field", () => {
    const row = orgRowResource({
      organization: {
        ...FIXTURE_ORGANIZATION,
        name: "Acme Robotics",
        slug: "acme-robotics",
      },
      roles: ["owner"],
      githubOrgs: [summary("acme-robotics", 4, 4)],
      featuredRepo: "helios-firmware",
    });

    expect(row).toEqual({
      id: FIXTURE_ORGANIZATION.id,
      slug: "acme-robotics",
      name: "Acme Robotics",
      monogram: "AR",
      personal: false,
      roles: ["owner"],
      enabled: true,
      repoCounts: { enabled: 4, total: 4 },
      featuredRepo: "helios-firmware",
      githubOrgs: [summary("acme-robotics", 4, 4)],
      createdAt: FIXTURE_ORGANIZATION.createdAt.toISOString(),
    });
  });

  it("is switched off when none of its organisations is on", () => {
    // The mockup's `acme-labs` row: recorded, and the switch is off.
    const row = orgRowResource({
      organization: { ...FIXTURE_ORGANIZATION, name: "Acme Labs", slug: "acme-labs" },
      roles: ["member"],
      githubOrgs: [summary("acme-labs", 0, 0, false)],
      featuredRepo: null,
    });

    expect(row.enabled).toBe(false);
    expect(row.repoCounts).toEqual({ enabled: 0, total: 0 });
    expect(row.featuredRepo).toBeNull();
  });

  it("is switched on when any of them is", () => {
    // "Any" rather than "all": the row's switch summarises the ones underneath it, and a
    // workspace with one organisation on is a workspace the loop can run in.
    const row = orgRowResource({
      organization: FIXTURE_ORGANIZATION,
      roles: ["admin"],
      githubOrgs: [summary("off-one", 0, 3, false), summary("on-one", 1, 1)],
      featuredRepo: "helios",
    });

    expect(row.enabled).toBe(true);
  });

  it("sums the counts across every organisation in it", () => {
    const row = orgRowResource({
      organization: FIXTURE_ORGANIZATION,
      roles: ["owner"],
      githubOrgs: [summary("first", 2, 5), summary("second", 3, 4, false)],
      featuredRepo: "helios",
    });

    // Counted on each repository's own flag, without regard to its organisation's — the two
    // are independent, and folding them would make turning an organisation off look like
    // losing the choices underneath it.
    expect(row.repoCounts).toEqual({ enabled: 5, total: 9 });
  });

  it("is empty and off for a workspace with nothing recorded", () => {
    const row = orgRowResource({
      organization: FIXTURE_ORGANIZATION,
      roles: [],
      githubOrgs: [],
      featuredRepo: null,
    });

    expect(row.enabled).toBe(false);
    expect(row.githubOrgs).toEqual([]);
    expect(row.repoCounts).toEqual({ enabled: 0, total: 0 });
  });

  it("carries the personal pill from the workspace's own metadata", () => {
    const row = orgRowResource({
      organization: {
        ...FIXTURE_ORGANIZATION,
        name: "Ken Suenobu",
        slug: "kensuenobu",
        metadata: '{"personal": true}',
      },
      roles: ["owner"],
      githubOrgs: [summary("kensuenobu", 2, 2)],
      featuredRepo: "dotfiles",
    });

    expect(row.personal).toBe(true);
    expect(row.monogram).toBe("KS");
  });

  it("carries every role a membership holds, not one of them", () => {
    // `member.role` is a comma-separated list where somebody holds more than one (V005), and
    // a screen decides whether to enable the switch from what is here.
    const row = orgRowResource({
      organization: FIXTURE_ORGANIZATION,
      roles: ["admin", "member"],
      githubOrgs: [],
      featuredRepo: null,
    });

    expect(row.roles).toEqual(["admin", "member"]);
  });

  it("publishes nothing a migration adds later", () => {
    const withSecret = {
      ...FIXTURE_ORGANIZATION,
      internal_note: "not for the wire",
    } as Organization;

    expect(
      Object.keys(
        orgRowResource({
          organization: withSecret,
          roles: [],
          githubOrgs: [],
          featuredRepo: null,
        }),
      ).toSorted(),
    ).toEqual(
      [
        "id",
        "slug",
        "name",
        "monogram",
        "personal",
        "roles",
        "enabled",
        "repoCounts",
        "featuredRepo",
        "githubOrgs",
        "createdAt",
      ].toSorted(),
    );
  });
});

describe("a domain", () => {
  it("is rendered under the API's names", () => {
    const row: TenantDomain = {
      id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
      domain: "acme.example",
      is_primary: true,
      created_at: new Date("2026-08-11T10:20:23.114Z"),
      updated_at: new Date("2026-08-11T10:20:23.114Z"),
      organization_id: FIXTURE_ORGANIZATION.id,
    };

    expect(domainResource(row)).toEqual({
      id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
      orgId: FIXTURE_ORGANIZATION.id,
      domain: "acme.example",
      isPrimary: true,
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    });
  });
});

describe("a GitHub organisation", () => {
  const row: GithubOrg = {
    id: "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
    login: "nobudata",
    enabled: true,
    installed_at: null,
    created_at: new Date("2026-08-11T10:20:23.114Z"),
    updated_at: new Date("2026-08-11T10:20:23.114Z"),
    organization_id: FIXTURE_ORGANIZATION.id,
  };

  it("is rendered under the API's names", () => {
    expect(githubOrgResource(row)).toEqual({
      id: "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
      orgId: FIXTURE_ORGANIZATION.id,
      login: "nobudata",
      enabled: true,
      installedAt: null,
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    });
  });

  it("names its workspace `orgId`, which is what addresses one", () => {
    // The collision, resolved: `orgId` is always the workspace and a GitHub organisation is
    // always addressed by `login`. A resource that published `tenantId` would be naming a
    // column V006 dropped.
    expect(githubOrgResource(row)).not.toHaveProperty("tenantId");
  });

  it("renders an installation once there is one", () => {
    const installed = githubOrgResource({
      ...row,
      installed_at: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(installed.installedAt).toBe("2026-08-11T12:00:00.000Z");
  });
});

describe("a repository", () => {
  const row: GithubRepo = {
    id: "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
    org_id: "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
    name: "ouroboros",
    enabled: true,
    default_branch: "main",
    created_at: new Date("2026-08-11T10:20:23.114Z"),
    updated_at: new Date("2026-08-11T10:20:23.114Z"),
  };

  it("is rendered under the API's names", () => {
    expect(repoResource(row)).toEqual({
      id: "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
      githubOrgId: "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
      name: "ouroboros",
      enabled: true,
      defaultBranch: "main",
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    });
  });

  it("names its parent `githubOrgId`, and carries no workspace id", () => {
    // V003 hangs a repository off its GitHub organisation rather than off the workspace, so a
    // second copy of that fact here could disagree with the organisation's — which is also
    // why V006 had no reason to touch this table. `githubOrgId` rather than `orgId` because
    // `orgId` is the workspace everywhere else in this contract.
    expect(repoResource(row)).not.toHaveProperty("orgId");
    expect(repoResource(row)).not.toHaveProperty("tenantId");
  });

  it("keeps an undiscovered branch null", () => {
    expect(repoResource({ ...row, default_branch: null }).defaultBranch).toBeNull();
  });
});

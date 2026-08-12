import { describe, expect, it } from "vitest";

import type { OrgEnablement } from "@/app/api/enablement";
import { enabledRepos, repoSummary } from "@/app/login/enablement";

/**
 * The sentence under each organisation row — the mockup's "4 repos enabled · incl.
 * helios-firmware", plus the two facts the mockup has no way to know it needs.
 */

/**
 * One repository.
 *
 * @param name Its name.
 * @param enabled Whether its own flag is on.
 * @returns The row.
 */
function repo(name: string, enabled: boolean) {
  return {
    id: `repo-${name}`,
    orgId: "org",
    name,
    enabled,
    defaultBranch: "main",
    createdAt: "2026-08-11T10:20:23.114Z",
    updatedAt: "2026-08-11T10:20:23.114Z",
  };
}

/**
 * One organisation with its repositories.
 *
 * @param over The parts a case is about: the organisation's flag, its repositories, its total.
 * @returns The entry.
 */
function entry(over: {
  enabled?: boolean;
  repos?: ReturnType<typeof repo>[];
  repoTotal?: number;
}): OrgEnablement {
  const repos = over.repos ?? [];
  return {
    org: {
      id: "org",
      tenantId: "tenant",
      login: "acme-robotics",
      enabled: over.enabled ?? true,
      installedAt: null,
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    },
    repos,
    repoTotal: over.repoTotal ?? repos.length,
  };
}

describe("enabledRepos", () => {
  it("keeps only the repositories whose own flag is on, in order", () => {
    const list = [repo("a", true), repo("b", false), repo("c", true)];

    expect(enabledRepos(list).map((one) => one.name)).toEqual(["a", "c"]);
  });

  it("returns nothing for an organisation with nothing switched on", () => {
    expect(enabledRepos([repo("a", false)])).toEqual([]);
  });
});

describe("repoSummary", () => {
  it("counts the enabled repositories and names one, as the mockup does", () => {
    const line = repoSummary(
      entry({ repos: [repo("helios-firmware", true), repo("orbital-sim", true)] }),
    );

    expect(line).toBe("2 repos enabled · incl. helios-firmware");
  });

  it("says nothing about an example when there is nothing enabled to name", () => {
    expect(repoSummary(entry({ repos: [repo("helios-firmware", false)] }))).toBe(
      "0 repos enabled",
    );
  });

  it("is never empty, even for an organisation with no repositories at all", () => {
    expect(repoSummary(entry({}))).toBe("0 repos enabled");
  });

  it("gets the singular right, because a row that says '1 repos' is a row nobody proofread", () => {
    expect(repoSummary(entry({ repos: [repo("helios-firmware", true)] }))).toBe(
      "1 repo enabled · incl. helios-firmware",
    );
  });

  it("admits when it is showing fewer rows than the service has", () => {
    // No silent truncation: presenting a hundred rows as all of them is a claim, not a page.
    const line = repoSummary(entry({ repos: [repo("a", true)], repoTotal: 900 }));

    expect(line).toBe("1 repo enabled · incl. a · showing 1 of 900");
  });

  it("says the organisation is off, which is the fact the two flags together decide", () => {
    // A repository is in scope only when its own flag *and* its organisation's are both
    // true, so enabled repositories under a disabled organisation are not work about to
    // happen — and the row must not read as if they were.
    const line = repoSummary(entry({ enabled: false, repos: [repo("a", true)] }));

    expect(line).toBe("1 repo enabled · incl. a · org off — none in scope");
  });

  it("does not add that note when nothing is enabled under the disabled organisation", () => {
    // There is nothing out of scope to warn about, and the count already says so.
    expect(repoSummary(entry({ enabled: false, repos: [repo("a", false)] }))).toBe(
      "0 repos enabled",
    );
  });
});

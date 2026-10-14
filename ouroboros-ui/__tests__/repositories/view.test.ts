import { describe, expect, it } from "vitest";

import type { Enablement } from "@/app/api/enablement";
import {
  FIRST_SCAN_PENDING,
  NOT_SCANNED,
  PAUSE_PHRASES,
  SWITCH_NOT_COVERED,
  SWITCH_READ_ONLY,
  repoScanLine,
  repositoryGroups,
  scanningLine,
  switchReason,
} from "@/app/repositories/view";

import { source } from "../helpers/sources";

/**
 * Settings → Repositories' rules: every repository a workspace has recorded or a GitHub
 * source names, which source names it, and when its switch may be pressed.
 */

/**
 * An enablement list.
 *
 * @param orgs Each account with its flag and its repositories' flags.
 * @returns The list.
 */
function enablement(
  orgs: { login: string; enabled: boolean; repos: [string, boolean][] }[],
): Enablement {
  return {
    orgTotal: orgs.length,
    orgs: orgs.map(({ login, enabled, repos }) => ({
      org: { id: `org-${login}`, login, enabled },
      repos: repos.map(([name, on]) => ({ id: `repo-${name}`, name, enabled: on })),
      repoTotal: repos.length,
    })),
  } as unknown as Enablement;
}

describe("repositoryGroups", () => {
  it("draws each recorded repository with the source that names it and its switch", () => {
    const groups = repositoryGroups(
      enablement([{ login: "acme-robotics", enabled: true, repos: [["helios-firmware", true]] }]),
      [source()],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.repos[0]).toEqual({
      repo: "acme-robotics/helios-firmware",
      name: "helios-firmware",
      enabled: true,
      sources: ["GitHub · acme-robotics"],
    });
    // The source's three other repositories are not recorded yet: drawn after it, off.
    expect(groups[0]?.repos.slice(1).map((row) => [row.name, row.enabled])).toEqual([
      ["helios-console", false],
      ["helios-telemetry", false],
      ["atlas-scheduler", false],
    ]);
  });

  it("draws a repository a source names but nobody has turned on, as off", () => {
    const groups = repositoryGroups(
      enablement([]),
      [source({ config: { login: "kensuenobu", repos: ["dotfiles"] } })],
    );

    expect(groups).toEqual([
      {
        login: "kensuenobu",
        repos: [
          {
            repo: "kensuenobu/dotfiles",
            name: "dotfiles",
            enabled: false,
            sources: ["GitHub · acme-robotics"],
          },
        ],
      },
    ]);
  });

  it("keeps a recorded repository no source names, so it can still be switched off", () => {
    const [group] = repositoryGroups(
      enablement([{ login: "acme", enabled: true, repos: [["orphan", true]] }]),
      [],
    );

    expect(group?.repos).toEqual([
      { repo: "acme/orphan", name: "orphan", enabled: true, sources: [] },
    ]);
  });

  it("draws a repository under a switched-off account as off", () => {
    const [group] = repositoryGroups(
      enablement([{ login: "acme", enabled: false, repos: [["firmware", true]] }]),
      [],
    );

    expect(group?.repos[0]?.enabled).toBe(false);
  });

  it("matches a source to a recorded repository regardless of case, once", () => {
    const [group] = repositoryGroups(
      enablement([{ login: "Acme", enabled: true, repos: [["Firmware", true]] }]),
      [source({ config: { login: "acme", repos: ["firmware"] } })],
    );

    expect(group?.repos).toHaveLength(1);
    expect(group?.repos[0]?.sources).toEqual(["GitHub · acme-robotics"]);
  });

  it("names every source that names a repository", () => {
    const [group] = repositoryGroups(enablement([]), [
      source({ id: "a", displayName: "One", config: { login: "acme", repos: ["firmware"] } }),
      source({ id: "b", displayName: "Two", config: { login: "acme", repos: ["firmware"] } }),
    ]);

    expect(group?.repos[0]?.sources).toEqual(["One", "Two"]);
  });

  it("ignores sources that are not GitHub", () => {
    expect(
      repositoryGroups(enablement([]), [
        source({ kind: "jira" as never, config: { login: "acme", repos: ["firmware"] } }),
      ]),
    ).toEqual([]);
  });
});

describe("switchReason", () => {
  const row = { repo: "acme/firmware", name: "firmware", enabled: false, sources: ["GitHub"] };

  it("leaves the switch pressable for an Owner or Admin when a source names it", () => {
    expect(switchReason(row, true)).toBeUndefined();
  });

  it("is read-only below Owner or Admin", () => {
    expect(switchReason(row, false)).toBe(SWITCH_READ_ONLY);
  });

  it("will not turn on a repository no source names", () => {
    expect(switchReason({ ...row, sources: [] }, true)).toBe(SWITCH_NOT_COVERED);
  });

  it("still turns off a repository no source names", () => {
    expect(switchReason({ ...row, enabled: true, sources: [] }, true)).toBeUndefined();
  });
});

describe("scanningLine", () => {
  const status = {
    syncedAt: "2026-10-14T10:00:00.000Z",
    state: "ok" as const,
    pause: null,
    message: null,
    retryAfterSeconds: null,
    running: false,
    repositories: [],
  };

  it("says how recently the least recently read repository was read", () => {
    expect(scanningLine(status, "4m ago")).toBe(
      "Scanning — the least recently read repository was read 4m ago.",
    );
  });

  it("gives the service's own sentence while scanning is paused", () => {
    expect(
      scanningLine(
        { ...status, state: "paused", pause: "rate_limited", message: "GitHub is rate limiting." },
        null,
      ),
    ).toBe("GitHub is rate limiting.");
  });

  it("leaves a missing token to the card's own warning", () => {
    expect(
      scanningLine({ ...status, state: "paused", pause: "not_configured", message: "x" }, null),
    ).toBeNull();
  });

  it("says a scan is running", () => {
    expect(scanningLine({ ...status, running: true }, "4m ago")).toBe("A scan is running now.");
  });

  it("says when the first pass has not finished", () => {
    expect(scanningLine({ ...status, syncedAt: null }, null)).toBe(
      "Scanning — the first pass has not finished yet.",
    );
  });
});

describe("repoScanLine", () => {
  const now = new Date("2026-10-14T10:05:00.000Z");
  const scan = {
    githubRepoId: "repo-fw",
    repository: "acme-robotics/helios-firmware",
    syncedAt: "2026-10-14T10:00:00.000Z",
    cursor: null,
    state: "ok" as const,
    pause: null,
    message: null,
  } as Parameters<typeof repoScanLine>[1];

  it("says when the repository's issues were last read", () => {
    expect(repoScanLine(true, scan, now)).toBe("Issues read 5m ago");
  });

  it("says a repository that is off is not scanned", () => {
    expect(repoScanLine(false, scan, now)).toBe(NOT_SCANNED);
  });

  it("says a repository just turned on is waiting for its first scan", () => {
    expect(repoScanLine(true, undefined, now)).toBe(FIRST_SCAN_PENDING);
  });

  it("gives the reason a repository is not being scanned", () => {
    expect(
      repoScanLine(
        true,
        { ...scan!, state: "paused", pause: "not_found", message: "A long workspace sentence." },
        now,
      ),
    ).toBe(PAUSE_PHRASES.not_found);
  });
});

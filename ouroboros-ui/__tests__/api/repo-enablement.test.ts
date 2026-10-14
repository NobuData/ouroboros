import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

const api = vi.hoisted(() => ({
  readEnablement: vi.fn(),
  recordOrg: vi.fn(),
  setOrgEnabled: vi.fn(),
  setRepoEnabled: vi.fn(),
  scan: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/enablement", () => ({
  readEnablement: (tenantId: string) => api.readEnablement(tenantId),
}));
vi.mock("@/app/api/orgs", () => ({
  orgs: {
    record: (...args: unknown[]) => api.recordOrg(...args),
    setEnabled: (...args: unknown[]) => api.setOrgEnabled(...args),
  },
}));
vi.mock("@/app/api/repos", () => ({
  repos: { setEnabled: (...args: unknown[]) => api.setRepoEnabled(...args) },
}));
vi.mock("@/app/api/detection", () => ({ detection: { scan: (repo: string) => api.scan(repo) } }));

const { enableSourceRepositories, ensureRepositoryEnabled } = await import(
  "@/app/api/repo-enablement"
);

/**
 * Turning repositories on — shared by Get started and by adding or editing a GitHub source,
 * so a source's repositories reach the picker, the Issues backlog and detection.
 */

const TENANT = "tenant-acme";

/**
 * An enablement list.
 *
 * @param orgs Each account: its login, whether it is on, and its repositories with their flags.
 * @returns The list.
 */
function enablement(
  orgs: { login: string; enabled: boolean; repos: [string, boolean][] }[] = [],
) {
  return {
    orgTotal: orgs.length,
    orgs: orgs.map(({ login, enabled, repos }) => ({
      org: { id: `org-${login}`, login, enabled },
      repos: repos.map(([name, on]) => ({ id: `repo-${name}`, name, enabled: on })),
      repoTotal: repos.length,
    })),
  } as unknown as Parameters<typeof ensureRepositoryEnabled>[1];
}

/**
 * A ticket source.
 *
 * @param kind Its kind.
 * @param config Its settings.
 * @returns The source.
 */
function source(kind: string, config: Record<string, unknown>) {
  return { id: "source-1", kind, config } as unknown as Parameters<
    typeof enableSourceRepositories
  >[1];
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.readEnablement.mockResolvedValue(enablement());
  api.scan.mockResolvedValue({});
});

describe("ensureRepositoryEnabled", () => {
  it("records an account and a repository the mirror does not hold yet", async () => {
    await ensureRepositoryEnabled(TENANT, enablement(), "kensuenobu/dotfiles");

    expect(api.recordOrg).toHaveBeenCalledExactlyOnceWith(TENANT, "kensuenobu", true);
    expect(api.setRepoEnabled).toHaveBeenCalledExactlyOnceWith(
      TENANT,
      "kensuenobu",
      "dotfiles",
      true,
    );
  });

  it("switches on an account and a repository that are recorded but off", async () => {
    const listed = enablement([{ login: "Acme", enabled: false, repos: [["Firmware", false]] }]);

    await ensureRepositoryEnabled(TENANT, listed, "acme/firmware");

    expect(api.recordOrg).not.toHaveBeenCalled();
    expect(api.setOrgEnabled).toHaveBeenCalledExactlyOnceWith(TENANT, "Acme", true);
    expect(api.setRepoEnabled).toHaveBeenCalledExactlyOnceWith(TENANT, "Acme", "Firmware", true);
  });

  it("writes nothing for a repository that is already on", async () => {
    const listed = enablement([{ login: "acme", enabled: true, repos: [["firmware", true]] }]);

    await ensureRepositoryEnabled(TENANT, listed, "acme/firmware");

    expect(api.recordOrg).not.toHaveBeenCalled();
    expect(api.setOrgEnabled).not.toHaveBeenCalled();
    expect(api.setRepoEnabled).not.toHaveBeenCalled();
  });
});

describe("enableSourceRepositories", () => {
  it("turns on every repository a GitHub source names, recording a new account once", async () => {
    const turnedOn = await enableSourceRepositories(
      TENANT,
      source("github", { login: "KenSuenobu", repos: ["dotfiles", "Playground"] }),
    );

    expect(turnedOn).toEqual(["kensuenobu/dotfiles", "kensuenobu/playground"]);
    expect(api.readEnablement).toHaveBeenCalledExactlyOnceWith(TENANT);
    expect(api.recordOrg).toHaveBeenCalledExactlyOnceWith(TENANT, "kensuenobu", true);
    expect(api.setRepoEnabled.mock.calls.map((call) => call[2])).toEqual([
      "dotfiles",
      "playground",
    ]);
  });

  it("asks detection to scan each repository it turned on", async () => {
    await enableSourceRepositories(TENANT, source("github", { login: "acme", repos: ["a", "b"] }));

    expect(api.scan.mock.calls.map((call) => call[0])).toEqual(["acme/a", "acme/b"]);
  });

  it("keeps the enablement when a scan is refused", async () => {
    api.scan.mockRejectedValue(new ApiError(409, "detection_rescan_too_soon", "Too soon.", {}));

    await expect(
      enableSourceRepositories(TENANT, source("github", { login: "acme", repos: ["a"] })),
    ).resolves.toEqual(["acme/a"]);
  });

  it("turns nothing on for a source that is not GitHub, or whose config it cannot read", async () => {
    await enableSourceRepositories(TENANT, source("jira", { login: "acme", repos: ["a"] }));
    await enableSourceRepositories(TENANT, source("github", { repos: ["a"] }));

    expect(api.readEnablement).not.toHaveBeenCalled();
    expect(api.setRepoEnabled).not.toHaveBeenCalled();
  });

  it("lets a refused write travel to the caller", async () => {
    api.recordOrg.mockRejectedValue(new ApiError(403, "forbidden", "Owners only.", {}));

    await expect(
      enableSourceRepositories(TENANT, source("github", { login: "acme", repos: ["a"] })),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

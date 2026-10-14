import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { SWITCH_FAILED, SWITCH_NOT_COVERED } from "@/app/repositories/view";

import { source } from "../helpers/sources";

const api = vi.hoisted(() => ({
  readEnablement: vi.fn(),
  listSources: vi.fn(),
  ensure: vi.fn(),
  setRepo: vi.fn(),
  scan: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/access", () => ({
  requireWorkspace: () => Promise.resolve({ membership: { id: "tenant-acme" } }),
}));
vi.mock("@/app/api/enablement", () => ({
  readEnablement: (tenantId: string) => api.readEnablement(tenantId),
}));
vi.mock("@/app/api/sources", () => ({ sources: { list: () => api.listSources() } }));
vi.mock("@/app/api/repo-enablement", () => ({
  ensureRepositoryEnabled: (...args: unknown[]) => api.ensure(...args),
}));
vi.mock("@/app/api/repos", () => ({
  repos: { setEnabled: (...args: unknown[]) => api.setRepo(...args) },
}));
vi.mock("@/app/api/detection", () => ({ detection: { scan: (repo: string) => api.scan(repo) } }));
vi.mock("@/app/api/backlog", () => ({ backlog: { sync: () => api.sync() } }));

const { scanIssuesNow, setRepositoryEnabled } = await import("@/app/repositories/actions");

/**
 * Settings → Repositories' writes. A Server Action is a POST endpoint anybody can reach: the
 * workspace is the session's, a malformed repository writes nothing, and a repository no
 * GitHub source names is never turned on.
 */

const LISTED = {
  orgTotal: 1,
  orgs: [
    {
      org: { id: "org-acme", login: "acme-robotics", enabled: true },
      repos: [{ id: "repo-fw", name: "helios-firmware", enabled: true }],
      repoTotal: 1,
    },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.readEnablement.mockResolvedValue(LISTED);
  api.listSources.mockResolvedValue({ items: [source()], total: 1 });
  api.scan.mockResolvedValue({});
  api.sync.mockResolvedValue({});
});

describe("setRepositoryEnabled", () => {
  it("turns on a repository a GitHub source names, then asks detection to scan it", async () => {
    expect(await setRepositoryEnabled("Acme-Robotics/Helios-Console", true)).toEqual({ ok: true });

    expect(api.ensure).toHaveBeenCalledExactlyOnceWith(
      "tenant-acme",
      LISTED,
      "acme-robotics/helios-console",
    );
    expect(api.scan).toHaveBeenCalledExactlyOnceWith("acme-robotics/helios-console");
  });

  it("refuses to turn on a repository no source names, before any write", async () => {
    expect(await setRepositoryEnabled("acme-robotics/elsewhere", true)).toEqual({
      ok: false,
      reason: SWITCH_NOT_COVERED,
    });
    expect(api.ensure).not.toHaveBeenCalled();
  });

  it("turns off the repository's own flag only", async () => {
    expect(await setRepositoryEnabled("acme-robotics/helios-firmware", false)).toEqual({ ok: true });

    expect(api.setRepo).toHaveBeenCalledExactlyOnceWith(
      "tenant-acme",
      "acme-robotics",
      "helios-firmware",
      false,
    );
  });

  it("writes nothing to turn off a repository that is not on", async () => {
    await setRepositoryEnabled("acme-robotics/helios-console", false);

    expect(api.setRepo).not.toHaveBeenCalled();
  });

  it("writes nothing for a malformed repository or flag", async () => {
    expect(await setRepositoryEnabled("not a repo", true)).toEqual({ ok: false, reason: SWITCH_FAILED });
    expect(
      await setRepositoryEnabled("acme-robotics/helios-firmware", "true" as unknown as boolean),
    ).toEqual({ ok: false, reason: SWITCH_FAILED });
    expect(api.readEnablement).not.toHaveBeenCalled();
  });

  it("keeps the service's refusal as a value", async () => {
    api.ensure.mockRejectedValue(new ApiError(403, "forbidden", "Owners and admins only.", {}));

    expect(await setRepositoryEnabled("acme-robotics/helios-console", true)).toEqual({
      ok: false,
      reason: "Owners and admins only.",
    });
  });
});

describe("scanIssuesNow", () => {
  it("asks the backlog for a pass", async () => {
    expect(await scanIssuesNow()).toEqual({ ok: true });
    expect(api.sync).toHaveBeenCalledOnce();
  });

  it("keeps the service's refusal as a value", async () => {
    api.sync.mockRejectedValue(new ApiError(409, "backlog_sync_running", "A sync is running.", {}));

    expect(await scanIssuesNow()).toEqual({ ok: false, reason: "A sync is running." });
  });
});

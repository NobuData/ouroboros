import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { membership, sessionUser } from "../helpers/login";
import { REPO, firstIssueCard, seededCard, seededTiles, selfHostedDefaults, sourcesReadings, wizard } from "../helpers/onboarding";

/**
 * `/get-started`'s first paint (#390): which repository — the query's, else the first mirrored
 * (enabled first) — its wizard, and what the person may do; and the dashboard's offer.
 */

vi.mock("server-only", () => ({}));

const read = vi.fn();
const readDetection = vi.fn();
const readTemplates = vi.fn();
const readFirstIssue = vi.fn();
const readDefaults = vi.fn();
const surfacing = vi.fn();
const readEnablement = vi.fn();

vi.mock("@/app/api/onboarding", () => ({
  onboarding: {
    read: (repo: string) => read(repo),
    surfacing: () => surfacing(),
    templates: (repo: string) => readTemplates(repo),
    defaults: (repo: string) => readDefaults(repo),
  },
  readFirstIssueCard: (repo: string) => readFirstIssue(repo),
}));
vi.mock("@/app/api/detection", () => ({ detection: { read: (repo: string) => readDetection(repo) } }));
vi.mock("@/app/api/enablement", () => ({ readEnablement: (tenant: string) => readEnablement(tenant) }));
vi.mock("@/app/sources/data", () => ({ readSources: (access: unknown) => readSources(access) }));

const readSources = vi.fn();

const { readGetStarted, readGetStartedOffer } = await import("@/app/get-started/data");

/** The workspace, as the gate returns it. */
function access(roles: Workspace["membership"]["roles"] = ["owner"]): Workspace {
  return { session: { user: sessionUser() } as Workspace["session"], membership: membership({ roles }) };
}

/** An enablement list. */
function listed(orgs: { login: string; enabled: boolean; repos: { name: string; enabled: boolean }[] }[]) {
  return {
    orgTotal: orgs.length,
    orgs: orgs.map((org) => ({
      org: { login: org.login, enabled: org.enabled },
      repos: org.repos,
      repoTotal: org.repos.length,
    })),
  };
}

beforeEach(() => {
  read.mockReset().mockResolvedValue(wizard());
  readDetection.mockReset().mockResolvedValue(seededCard());
  readTemplates.mockReset().mockResolvedValue(seededTiles());
  readFirstIssue.mockReset().mockResolvedValue(firstIssueCard());
  readDefaults.mockReset().mockResolvedValue(selfHostedDefaults());
  surfacing.mockReset().mockResolvedValue({ offer: true, reason: "fresh_organization" });
  readSources.mockReset().mockResolvedValue(sourcesReadings());
  readEnablement.mockReset().mockResolvedValue(
    listed([
      { login: "acme-robotics", enabled: true, repos: [{ name: "zeta", enabled: false }, { name: "helios-firmware", enabled: true }] },
    ]),
  );
});

describe("readGetStarted", () => {
  it("reads the repository the query names — and the sources and the mirror once, for steps 1–2's surfaces (#395)", async () => {
    const mirror = listed([
      { login: "acme-robotics", enabled: true, repos: [{ name: "zeta", enabled: false }, { name: "helios-firmware", enabled: true }] },
    ]);

    expect(await readGetStarted(access(), REPO)).toEqual({
      repo: REPO,
      wizard: { ok: true, value: wizard() },
      detection: { ok: true, value: seededCard() },
      templates: { ok: true, value: seededTiles() },
      firstIssue: { ok: true, value: firstIssueCard() },
      defaults: { ok: true, value: selfHostedDefaults() },
      sources: { ok: true, value: sourcesReadings() },
      enablement: { ok: true, value: mirror },
      reposFailure: null,
      abilities: { contribute: true, administer: true },
    });
    expect(readEnablement).toHaveBeenCalledExactlyOnceWith(membership().id);
    expect(readSources).toHaveBeenCalledOnce();
    expect(readDetection).toHaveBeenCalledWith(REPO);
    expect(readTemplates).toHaveBeenCalledWith(REPO);
    expect(readFirstIssue).toHaveBeenCalledWith(REPO);
    expect(readDefaults).toHaveBeenCalledWith(REPO);
  });

  it("opens on the first enabled repository when the query names none — or names one that is not", async () => {
    expect((await readGetStarted(access(), undefined)).repo).toBe(REPO);
    expect((await readGetStarted(access(), "not a repo")).repo).toBe(REPO);
    expect(readEnablement).toHaveBeenCalledWith(membership().id);
    expect(read).toHaveBeenCalledWith(REPO);
  });

  it("counts a repository under a disabled account as not enabled", async () => {
    readEnablement.mockResolvedValue(
      listed([
        { login: "acme-labs", enabled: false, repos: [{ name: "alpha", enabled: true }] },
        { login: "acme-robotics", enabled: true, repos: [{ name: "helios-firmware", enabled: true }] },
      ]),
    );

    expect((await readGetStarted(access(), undefined)).repo).toBe(REPO);
  });

  it("asks nothing of the wizard when the workspace has mirrored no repository — and still hands over the sources, so step 1 can start here", async () => {
    readEnablement.mockResolvedValue(listed([]));

    expect(await readGetStarted(access(), undefined)).toMatchObject({
      repo: null,
      wizard: null,
      detection: null,
      templates: null,
      firstIssue: null,
      defaults: null,
      sources: { ok: true, value: sourcesReadings() },
      enablement: { ok: true, value: listed([]) },
      reposFailure: null,
    });
    expect(read).not.toHaveBeenCalled();
    expect(readDetection).not.toHaveBeenCalled();
    expect(readTemplates).not.toHaveBeenCalled();
    expect(readFirstIssue).not.toHaveBeenCalled();
    expect(readDefaults).not.toHaveBeenCalled();
  });

  it("says why when the repository list could not be read", async () => {
    readEnablement.mockRejectedValue(new ApiError(503, "unavailable", "Try again."));

    expect(await readGetStarted(access(), undefined)).toMatchObject({
      repo: null,
      wizard: null,
      enablement: { ok: false, reason: "Try again." },
      reposFailure: "Try again.",
    });
  });

  it("carries the sources that could not be read as a reason, beside a wizard that could (#395)", async () => {
    readSources.mockRejectedValue(new ApiError(503, "unavailable", "The sources are busy."));

    const readings = await readGetStarted(access(), REPO);

    expect(readings.wizard).toEqual({ ok: true, value: wizard() });
    expect(readings.sources).toEqual({ ok: false, reason: "The sources are busy." });
  });

  it("carries a wizard that could not be read as a reason, not a throw", async () => {
    read.mockRejectedValue(new ApiError(503, "unavailable", "The service is busy."));

    expect((await readGetStarted(access(), REPO)).wizard).toEqual({ ok: false, reason: "The service is busy." });
  });

  it("carries a detection card that could not be read as a reason, beside a wizard that could (#391)", async () => {
    readDetection.mockRejectedValue(new ApiError(503, "unavailable", "Detection is busy."));

    const readings = await readGetStarted(access(), REPO);

    expect(readings.wizard).toEqual({ ok: true, value: wizard() });
    expect(readings.detection).toEqual({ ok: false, reason: "Detection is busy." });
  });

  it("carries template tiles that could not be read as a reason, beside the rest (#392)", async () => {
    readTemplates.mockRejectedValue(new ApiError(503, "unavailable", "Templates are busy."));

    const readings = await readGetStarted(access(), REPO);

    expect(readings.wizard).toEqual({ ok: true, value: wizard() });
    expect(readings.templates).toEqual({ ok: false, reason: "Templates are busy." });
  });

  it("carries a first-issue card that could not be read as a reason, beside the rest (#393)", async () => {
    readFirstIssue.mockRejectedValue(new ApiError(503, "unavailable", "The picker is busy."));

    const readings = await readGetStarted(access(), REPO);

    expect(readings.wizard).toEqual({ ok: true, value: wizard() });
    expect(readings.firstIssue).toEqual({ ok: false, reason: "The picker is busy." });
  });

  it("carries a right column that could not be read as a reason, beside the rest (#394)", async () => {
    readDefaults.mockRejectedValue(new ApiError(503, "unavailable", "The defaults are busy."));

    const readings = await readGetStarted(access(), REPO);

    expect(readings.wizard).toEqual({ ok: true, value: wizard() });
    expect(readings.defaults).toEqual({ ok: false, reason: "The defaults are busy." });
  });

  it("knows a member may move the wizard on but not enable a repository, and a viewer neither", async () => {
    expect((await readGetStarted(access(["member"]), REPO)).abilities).toEqual({ contribute: true, administer: false });
    expect((await readGetStarted(access(["viewer"]), REPO)).abilities).toEqual({ contribute: false, administer: false });
  });
});

describe("readGetStartedOffer", () => {
  it("offers the wizard on the opening repository while the fresh-org rule says so", async () => {
    expect(await readGetStartedOffer("tenant")).toEqual({ repo: REPO });
  });

  it("offers it with no repository when nothing is mirrored", async () => {
    readEnablement.mockResolvedValue(listed([]));

    expect(await readGetStartedOffer("tenant")).toEqual({ repo: null });
  });

  it("offers nothing once the rule stops — and nothing when it could not be read", async () => {
    surfacing.mockResolvedValue({ offer: false, reason: "organization_has_runs" });
    expect(await readGetStartedOffer("tenant")).toBeNull();

    surfacing.mockRejectedValue(new ApiError(503, "unavailable", "Try again."));
    expect(await readGetStartedOffer("tenant")).toBeNull();
    expect(readEnablement).not.toHaveBeenCalled();
  });
});

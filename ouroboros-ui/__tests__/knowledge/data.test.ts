import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import {
  CITED_TICKET_552,
  CITED_TICKET_560,
  READ_AT,
  SEEDED_REPO,
  pendingMap,
  repoMapStatuses,
  seededDetection,
  seededFacts,
  seededPlaybooks,
  seededRecipe,
  seededRepos,
  seededSkills,
  seededStats,
  seededTickets,
} from "../helpers/knowledge";
import { TENANT_ID, enablement, membership, org, repo, sessionUser } from "../helpers/login";

/**
 * The knowledge frame's reader (#417; the stats since #418; the facts and their cited tickets since
 * #419; the playbooks and the profile since #420; the repo-map status since #422): six reads in parallel, each kept as a value, so
 * a refused one degrades its own concern and the redirect signal still travels — the tickets the
 * facts cite resolved to their tracker pages, one read each; the profile card's detection and
 * recipe read for the one repository it draws — and the instant of the read, which every age on
 * the page is measured from.
 */

// The module is server-only; the marker refuses to load under jsdom, and the test is the server.
vi.mock("server-only", () => ({}));

const list = vi.fn();
const stats = vi.fn();
const listFacts = vi.fn();
const detail = vi.fn();
const readEnablement = vi.fn();
const listPlaybooks = vi.fn();
const readDetection = vi.fn();
const readRecipe = vi.fn();
const mapStatus = vi.fn();

vi.mock("@/app/api/skills", () => ({ skills: { list: () => list(), stats: () => stats() } }));
vi.mock("@/app/api/facts", () => ({ facts: { list: () => listFacts() } }));
vi.mock("@/app/api/backlog", () => ({ backlog: { detail: (id: string) => detail(id) } }));
vi.mock("@/app/api/playbooks", () => ({ playbooks: { list: () => listPlaybooks() } }));
vi.mock("@/app/api/repo-map", () => ({ repoMap: { status: () => mapStatus() } }));
vi.mock("@/app/api/detection", () => ({ detection: { read: (repo: string) => readDetection(repo) } }));
vi.mock("@/app/api/env-recipes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/env-recipes")>()),
  envRecipes: { read: (repo: string) => readRecipe(repo) },
}));
vi.mock("@/app/api/enablement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/enablement")>()),
  readEnablement: (tenantId: string) => readEnablement(tenantId),
}));

const { readKnowledge } = await import("@/app/knowledge/data");

/** The workspace the gate hands over. */
const ACCESS: Workspace = {
  session: {
    user: sessionUser(),
    memberships: [membership()],
    membershipTotal: 1,
    activeOrganizationId: TENANT_ID,
    tenantSuggestion: null,
  },
  membership: membership(),
};

/** The seeded workspace's enablement list: one organisation, its two repositories enabled. */
const ENABLEMENT = enablement([
  [
    org({ login: "acme-robotics", enabled: true }),
    seededRepos().map((one) => repo({ id: one.id, name: one.name, enabled: true })),
  ],
]);

beforeEach(() => {
  list.mockReset().mockResolvedValue(seededSkills());
  stats.mockReset().mockResolvedValue(seededStats());
  listFacts.mockReset().mockResolvedValue(seededFacts());
  detail.mockReset().mockImplementation((id: string) =>
    Promise.resolve({
      issue: { number: id === CITED_TICKET_552 ? 552 : 560, repository: "acme-robotics/helios-firmware" },
      estimate: null,
      history: [],
    }),
  );
  readEnablement.mockReset().mockResolvedValue(ENABLEMENT);
  listPlaybooks.mockReset().mockResolvedValue(seededPlaybooks());
  readDetection.mockReset().mockResolvedValue(seededDetection());
  readRecipe.mockReset().mockResolvedValue(seededRecipe());
  mapStatus.mockReset().mockResolvedValue(repoMapStatuses());
});

describe("readKnowledge", () => {
  it("reads the skills, their stats and the enabled repositories of the gate's workspace, and stamps the instant", async () => {
    const readings = await readKnowledge(ACCESS, new Date(READ_AT));

    expect(readEnablement).toHaveBeenCalledExactlyOnceWith(ACCESS.membership.id);
    expect(readings.skills).toEqual({ ok: true, value: seededSkills() });
    expect(readings.stats).toEqual({ ok: true, value: seededStats() });
    expect(readings.facts).toEqual({ ok: true, value: seededFacts() });
    expect(readings.repos).toEqual({ ok: true, value: seededRepos() });
    expect(readings.playbooks).toEqual({ ok: true, value: seededPlaybooks() });
    expect(readings.maps).toEqual({ ok: true, value: repoMapStatuses() });
    expect(readings.readAt).toBe(READ_AT);
  });

  describe("the repo-map status (#422)", () => {
    it("is read once, as the service answers it — pending is the service's word, not an inference", async () => {
      mapStatus.mockResolvedValue(repoMapStatuses([pendingMap()]));

      const readings = await readKnowledge(ACCESS, new Date(READ_AT));

      expect(mapStatus).toHaveBeenCalledOnce();
      expect(readings.maps).toEqual({ ok: true, value: repoMapStatuses([pendingMap()]) });
    });

    it("keeps its refusal as that reading's reason, and leaves every other reading whole", async () => {
      mapStatus.mockRejectedValue(new ApiError(500, "internal_error", "The status failed.", {}));

      const readings = await readKnowledge(ACCESS, new Date(READ_AT));

      expect(readings.maps).toEqual({ ok: false, reason: "The status failed." });
      expect(readings.skills.ok).toBe(true);
      expect(readings.facts.ok).toBe(true);
      expect(readings.playbooks.ok).toBe(true);
      expect(readings.repos.ok).toBe(true);
      expect(readings.profile.detection.ok).toBe(true);
    });
  });

  describe("the profile card's repository", () => {
    it("is the first enabled one when the address names none, read for detection and its recipe", async () => {
      const readings = await readKnowledge(ACCESS, new Date(READ_AT));

      expect(readings.profile.repo).toEqual(seededRepos()[0]);
      expect(readDetection).toHaveBeenCalledExactlyOnceWith(SEEDED_REPO);
      expect(readRecipe).toHaveBeenCalledExactlyOnceWith(SEEDED_REPO);
      expect(readings.profile.detection).toEqual({ ok: true, value: seededDetection() });
      expect(readings.profile.recipe).toEqual({ ok: true, value: seededRecipe() });
    });

    it("is the address's when it is enabled", async () => {
      const readings = await readKnowledge(ACCESS, new Date(READ_AT), "acme-robotics/helios-tools");

      expect(readings.profile.repo).toEqual(seededRepos()[1]);
      expect(readDetection).toHaveBeenCalledExactlyOnceWith("acme-robotics/helios-tools");
    });

    it("keeps a repository with no recipe as a state, not a failed read", async () => {
      readRecipe.mockRejectedValue(new ApiError(404, "env_recipe_not_found", "None yet.", { repo: SEEDED_REPO }));

      const readings = await readKnowledge(ACCESS, new Date(READ_AT));

      expect(readings.profile.recipe).toEqual({ ok: true, value: null });
    });

    it("keeps any other refusal of the recipe as that reading's reason, leaving detection whole", async () => {
      readRecipe.mockRejectedValue(new ApiError(500, "internal_error", "The service failed.", {}));

      const readings = await readKnowledge(ACCESS, new Date(READ_AT));

      expect(readings.profile.recipe).toEqual({ ok: false, reason: "The service failed." });
      expect(readings.profile.detection.ok).toBe(true);
    });

    it("reads nothing and says so when no repository is enabled", async () => {
      readEnablement.mockResolvedValue(enablement([[org({ login: "acme-robotics", enabled: true }), []]]));

      const readings = await readKnowledge(ACCESS, new Date(READ_AT));

      expect(readings.profile.repo).toBeNull();
      expect(readings.profile.detection).toEqual({ ok: false, reason: "No repository is enabled." });
      expect(readDetection).not.toHaveBeenCalled();
      expect(readRecipe).not.toHaveBeenCalled();
    });

    it("carries the enablement's refusal when the repositories could not be read", async () => {
      readEnablement.mockRejectedValue(new ApiError(500, "internal_error", "The service failed.", {}));

      const readings = await readKnowledge(ACCESS, new Date(READ_AT));

      expect(readings.profile).toEqual({
        repo: null,
        detection: { ok: false, reason: "The service failed." },
        recipe: { ok: false, reason: "The service failed." },
      });
    });
  });

  it("resolves each cited ticket once, to its tracker page", async () => {
    const readings = await readKnowledge(ACCESS, new Date(READ_AT));

    expect(readings.tickets).toEqual(seededTickets());
    expect(detail).toHaveBeenCalledTimes(2);
    expect(detail.mock.calls.map(([id]) => id).sort()).toEqual([CITED_TICKET_552, CITED_TICKET_560].sort());
  });

  it("leaves out a ticket it could not read, so the card draws its ref as text", async () => {
    detail.mockImplementation((id: string) =>
      id === CITED_TICKET_560
        ? Promise.reject(new ApiError(404, "backlog_issue_not_found", "No such issue.", {}))
        : Promise.resolve({ issue: { number: 552, repository: "acme-robotics/helios-firmware" }, estimate: null, history: [] }),
    );

    const readings = await readKnowledge(ACCESS, new Date(READ_AT));

    expect(Object.keys(readings.tickets)).toEqual([CITED_TICKET_552]);
  });

  it("resolves no tickets when the facts could not be read", async () => {
    listFacts.mockRejectedValue(new ApiError(500, "internal_error", "The service failed.", {}));

    const readings = await readKnowledge(ACCESS, new Date(READ_AT));

    expect(readings.facts).toEqual({ ok: false, reason: "The service failed." });
    expect(readings.tickets).toEqual({});
    expect(detail).not.toHaveBeenCalled();
  });

  it("stamps the clock's instant when none is given", async () => {
    const before = Date.now();
    const readings = await readKnowledge(ACCESS);

    expect(new Date(readings.readAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("keeps one refusal as that reading's reason and leaves the other whole", async () => {
    list.mockRejectedValue(new ApiError(500, "internal_error", "The service failed.", {}));

    const readings = await readKnowledge(ACCESS);

    expect(readings.skills).toEqual({ ok: false, reason: "The service failed." });
    expect(readings.stats.ok).toBe(true);
    expect(readings.repos.ok).toBe(true);
  });

  it("lets anything that is not the service's refusal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    readEnablement.mockRejectedValue(redirect);

    await expect(readKnowledge(ACCESS)).rejects.toBe(redirect);
  });
});

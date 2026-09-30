import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { SEEDED_REPO, repoMapReport, seededSkill } from "../helpers/knowledge";

/**
 * The skills table's server hops (#418). A Server Action is a POST endpoint anybody can reach, so
 * each call takes no workspace and no person, and every gate — the role, the required lock — is
 * the service's, answered back as a value.
 */

const update = vi.fn();
const regenerate = vi.fn();

vi.mock("@/app/api/skills", () => ({
  skills: { update: (slug: string, body: unknown) => update(slug, body) },
}));
vi.mock("@/app/api/repo-map", () => ({
  repoMap: { regenerate: (body: unknown) => regenerate(body) },
}));

const { regenerateRepoMap, setSkillEnabled } = await import("@/app/knowledge/skills-actions");

beforeEach(() => {
  update.mockReset().mockResolvedValue(seededSkill("zephyr-conventions"));
  regenerate.mockReset().mockResolvedValue(repoMapReport());
});

describe("setSkillEnabled", () => {
  it("sends the position to move to, and nothing else", async () => {
    await setSkillEnabled("zephyr-conventions", false);

    expect(update).toHaveBeenCalledExactlyOnceWith("zephyr-conventions", { enabled: false });
  });

  it("answers with the skill as the service now holds it", async () => {
    const after = { ...seededSkill("zephyr-conventions"), enabled: false, active: false };
    update.mockResolvedValue(after);

    await expect(setSkillEnabled("zephyr-conventions", false)).resolves.toEqual({ ok: true, value: after });
  });

  it("answers the required lock's refusal as a value — the API's reason, for the row to show", async () => {
    update.mockRejectedValue(
      new ApiError(403, "skill_required_locked", "required by policy — cannot disable", {
        slug: "hil-safety",
        reason: "required_by_policy",
      }),
    );

    await expect(setSkillEnabled("hil-safety", false)).resolves.toEqual({
      ok: false,
      refusal: {
        code: "skill_required_locked",
        message: "required by policy — cannot disable",
        details: { slug: "hil-safety", reason: "required_by_policy" },
      },
    });
  });

  it("answers a member's direct call with the service's forbidden, and writes nothing", async () => {
    update.mockRejectedValue(new ApiError(403, "forbidden", "Forbidden.", {}));

    await expect(setSkillEnabled("zephyr-conventions", false)).resolves.toMatchObject({
      ok: false,
      refusal: { code: "forbidden" },
    });
  });

  it("lets anything that is not the service's refusal travel — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    update.mockRejectedValue(redirect);

    await expect(setSkillEnabled("zephyr-conventions", false)).rejects.toBe(redirect);
  });
});

describe("regenerateRepoMap", () => {
  it("forwards the repository and answers with the report", async () => {
    await expect(regenerateRepoMap({ repo: SEEDED_REPO })).resolves.toEqual({ ok: true, value: repoMapReport() });
    expect(regenerate).toHaveBeenCalledExactlyOnceWith({ repo: SEEDED_REPO });
  });

  it("answers the rate limit as a value, with the wait", async () => {
    regenerate.mockRejectedValue(
      new ApiError(409, "repo_map_regenerate_too_soon", "Too soon.", { retryAfterSeconds: 41 }),
    );

    await expect(regenerateRepoMap({ repo: SEEDED_REPO })).resolves.toEqual({
      ok: false,
      refusal: { code: "repo_map_regenerate_too_soon", message: "Too soon.", details: { retryAfterSeconds: 41 } },
    });
  });

  it("lets the redirect signal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    regenerate.mockRejectedValue(redirect);

    await expect(regenerateRepoMap({ repo: SEEDED_REPO })).rejects.toBe(redirect);
  });
});

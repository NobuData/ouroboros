import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { SEEDED_REPO, seededRecipe } from "../helpers/knowledge";

/**
 * The repo-profile card's server hop (#420). A Server Action is a POST endpoint anybody can
 * reach, so the call takes no workspace and no person — the version is saved in the session's
 * person's name — and every gate is the service's, answered back as a value.
 */

const save = vi.fn();

vi.mock("@/app/api/env-recipes", () => ({ envRecipes: { save: (body: unknown) => save(body) } }));

const { saveEnvRecipe } = await import("@/app/knowledge/profile-actions");

const BODY = { repo: SEEDED_REPO, commands: [{ command: "west update" }] };

beforeEach(() => {
  save.mockReset().mockResolvedValue(seededRecipe({ version: 4 }));
});

describe("saveEnvRecipe", () => {
  it("forwards the block as parsed and answers the version now in force", async () => {
    await expect(saveEnvRecipe(BODY)).resolves.toEqual({ ok: true, value: seededRecipe({ version: 4 }) });
    expect(save).toHaveBeenCalledExactlyOnceWith(BODY);
  });

  it("answers a refusal as a value — the role and the race are the service's", async () => {
    save.mockRejectedValue(new ApiError(409, "env_recipe_version_conflict", "Taken.", { version: 4 }));

    await expect(saveEnvRecipe(BODY)).resolves.toEqual({
      ok: false,
      refusal: { code: "env_recipe_version_conflict", message: "Taken.", details: { version: 4 } },
    });
  });

  it("lets anything that is not the service's refusal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    save.mockRejectedValue(redirect);

    await expect(saveEnvRecipe(BODY)).rejects.toBe(redirect);
  });
});

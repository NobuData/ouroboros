import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { SEEDED_REPO, seededRecipe } from "../helpers/knowledge";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { ENV_RECIPE_CONFLICT_CODE, ENV_RECIPE_NOT_FOUND_CODE, envRecipes } = await import("@/app/api/env-recipes");

/**
 * The environment-recipe facade (#420): the version in force by repository, the save as the next
 * version, and the two refusals the card turns into states.
 */

describe("envRecipes.read", () => {
  it("asks for the repository's recipe, naming no workspace", async () => {
    const { client, requests } = clientAnswering(seededRecipe());

    expect(await envRecipes.read(SEEDED_REPO, client)).toEqual(seededRecipe());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/knowledge/env-recipe?repo=${encodeURIComponent(SEEDED_REPO)}`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });

  it("answers a repository with none as the service's 404, by the code the reader keeps as a state", async () => {
    const { client } = clientAnswering({ code: ENV_RECIPE_NOT_FOUND_CODE, message: "None yet.", details: { repo: SEEDED_REPO } }, 404);

    const error = await envRecipes.read(SEEDED_REPO, client).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: ENV_RECIPE_NOT_FOUND_CODE });
  });
});

describe("envRecipes.save", () => {
  it("puts the whole block and answers the version now in force", async () => {
    const saved = seededRecipe({ version: 4 });
    const { client, requests } = clientAnswering(saved, 201);
    const body = { repo: SEEDED_REPO, commands: [{ command: "west update" }, { command: "west build", comment: "the app" }] };

    expect(await envRecipes.save(body, client)).toEqual(saved);
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/knowledge/env-recipe`);
    expect(requests[0]?.method).toBe("PUT");
    expect(await requests[0]?.json()).toEqual(body);
  });

  it("answers a lost race as the service's conflict", async () => {
    const { client } = clientAnswering({ code: ENV_RECIPE_CONFLICT_CODE, message: "Taken.", details: { version: 4 } }, 409);

    const error = await envRecipes.save({ repo: SEEDED_REPO, commands: [{ command: "x" }] }, client).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, code: ENV_RECIPE_CONFLICT_CODE, details: { version: 4 } });
  });
});

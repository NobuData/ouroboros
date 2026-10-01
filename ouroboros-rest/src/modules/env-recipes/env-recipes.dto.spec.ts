import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  EnvRecipeQuery,
  MAX_COMMAND_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_RECIPE_COMMANDS,
  SaveEnvRecipeBody,
} from "./env-recipes.dto";
import { SAVE_BODY } from "./env-recipes.fixture";

/** What the env-recipe routes accept (#420) — V073's bounds, refused before the database sees them. */

/**
 * The properties a body fails on, nested ones flattened to the top-level property.
 *
 * @param type - The DTO.
 * @param body - What arrived.
 * @returns The failing property names.
 */
async function failing<T extends object>(type: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(type, body));

  return errors.map((error) => error.property);
}

/**
 * A save body with one command replaced.
 *
 * @param entry - The entry.
 * @returns The body.
 */
function withCommand(entry: object): object {
  return { repo: SAVE_BODY.repo, commands: [entry] };
}

describe("the repo query", () => {
  it("is the onboarding wizard's grammar, so /knowledge and /onboarding name a repository alike", async () => {
    await expect(
      failing(EnvRecipeQuery, { repo: "acme-robotics/helios-firmware" }),
    ).resolves.toEqual([]);
    await expect(failing(EnvRecipeQuery, { repo: "../x" })).resolves.toEqual(["repo"]);
    await expect(failing(EnvRecipeQuery, { repo: "helios" })).resolves.toEqual(["repo"]);
    await expect(failing(EnvRecipeQuery, {})).resolves.toEqual(["repo"]);
  });
});

describe("the save body", () => {
  it("accepts the seed's recipe, a comment optional per entry", async () => {
    await expect(failing(SaveEnvRecipeBody, SAVE_BODY)).resolves.toEqual([]);
  });

  it("needs at least one command and at most sixty-four", async () => {
    await expect(
      failing(SaveEnvRecipeBody, { repo: SAVE_BODY.repo, commands: [] }),
    ).resolves.toEqual(["commands"]);

    const many = Array.from({ length: MAX_RECIPE_COMMANDS + 1 }, (_, index) => ({
      command: `step ${String(index)}`,
    }));
    await expect(
      failing(SaveEnvRecipeBody, { repo: SAVE_BODY.repo, commands: many }),
    ).resolves.toEqual(["commands"]);
  });

  it.each([
    ["a blank command", { command: "   " }],
    ["a multi-line command", { command: "west init\nwest update" }],
    ["a command over its length", { command: "x".repeat(MAX_COMMAND_LENGTH + 1) }],
    ["a blank comment", { command: "west update", comment: " " }],
    ["a multi-line comment", { command: "west update", comment: "a\nb" }],
    [
      "a comment over its length",
      { command: "west update", comment: "x".repeat(MAX_COMMENT_LENGTH + 1) },
    ],
    ["a command that is not a string", { command: 42 }],
    ["an entry with no command", { comment: "orphan" }],
  ])("refuses %s", async (_name, entry) => {
    await expect(failing(SaveEnvRecipeBody, withCommand(entry))).resolves.toEqual(["commands"]);
  });

  it("refuses a malformed repository", async () => {
    await expect(failing(SaveEnvRecipeBody, { ...SAVE_BODY, repo: "not a repo" })).resolves.toEqual(
      ["repo"],
    );
  });
});

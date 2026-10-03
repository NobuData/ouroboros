import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { PatchWorkspaceDto, WORKSPACE_NAME_MAX_LENGTH } from "./workspace.dto";

/**
 * The card's grammar — and the property the issue asks for: every refusal names the field it
 * belongs to, so the card can attach the message to that input.
 */

/** Validate a body as the pipe would, answering `{field: messages}`. */
async function refusalsOf(body: unknown): Promise<Record<string, string[]>> {
  const errors = await validate(plainToInstance(PatchWorkspaceDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return Object.fromEntries(
    errors.map((error) => [error.property, Object.values(error.constraints ?? {})]),
  );
}

describe("the workspace patch body", () => {
  it("accepts a name, a domain, both, or neither", async () => {
    await expect(refusalsOf({ name: "acme-robotics" })).resolves.toEqual({});
    await expect(refusalsOf({ domain: "acme.ouroboros.dev" })).resolves.toEqual({});
    await expect(refusalsOf({ name: "Acme Robotics", domain: "acme.io" })).resolves.toEqual({});
    await expect(refusalsOf({})).resolves.toEqual({});
  });

  it.each(["A", "Acme Robotics — EU", "ä".repeat(WORKSPACE_NAME_MAX_LENGTH)])(
    "accepts the name %p",
    async (name) => {
      await expect(refusalsOf({ name })).resolves.toEqual({});
    },
  );

  it.each([
    ["", "must not be empty"],
    [" acme", "must not be empty, start or end with a space"],
    ["acme ", "must not be empty, start or end with a space"],
    ["ac\u0007me", "control characters"],
    ["a".repeat(WORKSPACE_NAME_MAX_LENGTH + 1), "at most 100 characters"],
    [null, "name must be text"],
    [42, "name must be text"],
  ])("refuses the name %p, bound to the field", async (name, message) => {
    const refusals = await refusalsOf({ name });

    expect(Object.keys(refusals)).toEqual(["name"]);
    expect(refusals.name.join(" ")).toContain(message);
  });

  it.each(["Acme.io", "acme", "acme..io", "-acme.io", null, "a".repeat(251) + ".io"])(
    "refuses the domain %p, bound to the field",
    async (domain) => {
      expect(Object.keys(await refusalsOf({ domain }))).toEqual(["domain"]);
    },
  );

  it.each(["region", "trainingData", "slug"])(
    "refuses %s — deployment truth and identity are not settings",
    async (field) => {
      expect(Object.keys(await refusalsOf({ [field]: "x" }))).toEqual([field]);
    },
  );
});

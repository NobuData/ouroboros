import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { EnableToolDto, ToolParams } from "./catalog.dto";

/**
 * The enable flow's request, shape only (CN.3, #629) — the tool's own schema is the service's
 * to judge, so a well-formed body naming an unknown field passes here.
 */

/**
 * The properties a value fails on.
 *
 * @param type - The DTO.
 * @param value - The value as a client sends it.
 * @returns The failing property names.
 */
async function failures(type: new () => object, value: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("the enable request", () => {
  it("accepts a form of strings and lists, and an empty one", async () => {
    expect(await failures(EnableToolDto, { config: {} })).toEqual([]);
    expect(
      await failures(EnableToolDto, { config: { provider: "brave", repos: ["a/b", "c/d"] } }),
    ).toEqual([]);
  });

  it.each([
    ["no config", {}],
    ["a list", { config: [] }],
    ["a string", { config: "provider=brave" }],
    ["a nested object", { config: { provider: { id: "brave" } } }],
    ["a number", { config: { windowDays: 7 } }],
  ])("refuses %s", async (_name, body) => {
    expect(await failures(EnableToolDto, body)).toEqual(["config"]);
  });

  it("refuses a field the route does not take", async () => {
    expect(await failures(EnableToolDto, { config: {}, secret: "x" })).toEqual(["secret"]);
  });

  it("takes a tool slug and nothing shaped otherwise", async () => {
    expect(await failures(ToolParams, { slug: "web" })).toEqual([]);
    expect(await failures(ToolParams, { slug: "Web Search" })).toEqual(["slug"]);
    expect(await failures(ToolParams, { slug: "../settings" })).toEqual(["slug"]);
  });
});

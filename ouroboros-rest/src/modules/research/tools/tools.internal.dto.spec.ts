import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { ToolInvocationDto } from "./tools.internal.dto";

/**
 * The body's shape — what the global pipe refuses with `422 validation_failed` before the
 * invoker sees it. What an `input` must hold is the invoker's, per operation.
 */

/**
 * The properties a body fails on.
 *
 * @param body - The raw body.
 * @returns The failing property paths.
 */
function failures(body: unknown): string[] {
  const dto = plainToInstance(ToolInvocationDto, body);

  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).flatMap((error) =>
    error.children !== undefined && error.children.length > 0
      ? error.children.map((child) => `${error.property}.${child.property}`)
      : [error.property],
  );
}

describe("the tool invocation body", () => {
  const valid = {
    investigation: "5eed0084-0000-4000-8000-000000000127",
    input: { query: "gust" },
    budget: { operations: 40, tokens: 10000 },
  };

  it("accepts an investigation, an input object and a budget", () => {
    expect(failures(valid)).toEqual([]);
    expect(failures({ ...valid, budget: { operations: 40 } })).toEqual([]);
    expect(failures({ ...valid, budget: { operations: 40, tokens: null } })).toEqual([]);
  });

  it("refuses a malformed investigation, input or budget", () => {
    expect(failures({ ...valid, investigation: "RS-127" })).toEqual(["investigation"]);
    expect(failures({ ...valid, input: "gust" })).toEqual(["input"]);
    expect(failures({ ...valid, budget: { operations: -1 } })).toEqual(["budget.operations"]);
    expect(failures({ ...valid, budget: { operations: 1, tokens: 2.5 } })).toEqual([
      "budget.tokens",
    ]);
  });

  it("refuses a field the operation does not define — a workspace named by the caller among them", () => {
    expect(failures({ ...valid, organizationId: "org-other" })).toEqual(["organizationId"]);
  });
});

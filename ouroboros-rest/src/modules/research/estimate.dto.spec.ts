import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { EstimateInvestigationDto, MAX_TOOLS } from "./estimate.dto";

/**
 * The composer's body, shape only — registration is the service's (a `404`/`422` naming the
 * slug), so a well-formed slug that names nothing passes here.
 */

/**
 * The properties a body fails on.
 *
 * @param body - The body as a client sends it.
 * @returns The failing property names.
 */
async function failures(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(EstimateInvestigationDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("the estimate request", () => {
  it("accepts the seeded composer's choices", async () => {
    expect(
      await failures({
        kind: "gap_analysis",
        depth: "deep_dive",
        tools: ["web", "competitor", "code", "tickets", "telemetry"],
      }),
    ).toEqual([]);
  });

  it("accepts a body with no tools — the kind's defaults", async () => {
    expect(await failures({ kind: "bug_root_cause", depth: "quick" })).toEqual([]);
  });

  it("accepts a well-formed slug the workspace may not have", async () => {
    expect(
      await failures({ kind: "market_sizing", depth: "standard", tools: ["patents"] }),
    ).toEqual([]);
  });

  it.each([
    [{ depth: "quick" }, "kind"],
    [{ kind: "Gap Analysis", depth: "quick" }, "kind"],
    [{ kind: 7, depth: "quick" }, "kind"],
    [{ kind: "gap_analysis" }, "depth"],
    [{ kind: "gap_analysis", depth: "deep" }, "depth"],
    [{ kind: "gap_analysis", depth: "quick", tools: [] }, "tools"],
    [{ kind: "gap_analysis", depth: "quick", tools: "web" }, "tools"],
    [{ kind: "gap_analysis", depth: "quick", tools: ["web", "web"] }, "tools"],
    [{ kind: "gap_analysis", depth: "quick", tools: ["Web"] }, "tools"],
    [{ kind: "gap_analysis", depth: "quick", tools: [3] }, "tools"],
    [{ kind: "gap_analysis", depth: "quick", tools: null }, "tools"],
  ])("refuses %p on %s", async (body, property) => {
    expect(await failures(body)).toContain(property);
  });

  it("refuses more tools than any installation has", async () => {
    const tools = Array.from({ length: MAX_TOOLS + 1 }, (_, index) => `tool${index}`);

    expect(await failures({ kind: "gap_analysis", depth: "quick", tools })).toContain("tools");
  });

  it("refuses a field it does not know — the workspace is the session's, never the body's", async () => {
    expect(
      await failures({ kind: "gap_analysis", depth: "quick", organizationId: "org-other" }),
    ).toContain("organizationId");
  });
});

import { HttpStatus } from "@nestjs/common";

import { FakeResearchTool } from "./adapters/fake.tool.fixture";
import type { ToolCapabilities } from "./research-tool.adapter";
import { RESEARCH_TOOL_ERRORS } from "./research-tool.errors";
import { ResearchToolRegistry } from "./research-tool.registry";

describe("the research tool registry", () => {
  it("looks a tool up by slug and lists the slugs sorted", () => {
    const web = new FakeResearchTool({ slug: "web" });
    const code = new FakeResearchTool({ slug: "code" });
    const registry = new ResearchToolRegistry([web, code]);

    expect(registry.get("web")).toBe(web);
    expect(registry.find("code")).toBe(code);
    expect(registry.find("docs")).toBeUndefined();
    expect(registry.slugs()).toEqual(["code", "web"]);
  });

  it("answers 501 for a slug this build has no adapter for, naming what it has", () => {
    const registry = new ResearchToolRegistry([new FakeResearchTool({ slug: "web" })]);

    try {
      registry.get("competitor");
      throw new Error("expected a refusal");
    } catch (error) {
      const refusal = error as {
        getStatus(): number;
        envelope(): { code: string; details: unknown };
      };

      expect(refusal.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
      expect(refusal.envelope().code).toBe(RESEARCH_TOOL_ERRORS.toolNotRegistered);
      expect(refusal.envelope().details).toEqual({ tool: "competitor", registered: ["web"] });
    }
  });

  it("ships empty — every slug is honestly a 501 until CL.2–CL.6 register one", () => {
    expect(new ResearchToolRegistry([]).slugs()).toEqual([]);
  });

  it("refuses to boot with two adapters on one slug", () => {
    expect(
      () =>
        new ResearchToolRegistry([
          new FakeResearchTool({ slug: "web" }),
          new FakeResearchTool({ slug: "web" }),
        ]),
    ).toThrow('Two research tools are registered for slug "web"');
  });

  it("refuses to boot with a flag that disagrees with its member", () => {
    const lying = Object.assign(new FakeResearchTool({ slug: "web" }), {
      capabilities: (): ToolCapabilities => ({
        search: true,
        fetch: false,
        query: true,
        watch: false,
      }),
    });

    expect(() => new ResearchToolRegistry([lying])).toThrow(
      'Research tool "web": declares fetch: false but its fetch member says otherwise',
    );
  });
});

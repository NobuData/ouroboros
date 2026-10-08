import { cruiseFixture } from "../../../testing/depcruise.fixture";

/**
 * CL.1's acceptance criterion: **the dependency-cruiser rule fails the build on a direct tool
 * import from core code** — watched failing, as `providers/boundary.spec.ts` does for decision
 * P1: each case builds a tree containing exactly the violation it describes, cruises it with the
 * service's real `.dependency-cruiser.cjs`, and asserts the named rule reports it. (Whether the
 * whole service is clean is `providers/boundary.spec.ts`'s first case, which cruises everything.)
 */

/** A stand-in adapter. What is under test is who imports it. */
const AN_ADAPTER = "src/modules/research/tools/adapters/web.tool.ts";

/** Its contents. */
const AN_ADAPTER_SOURCE = "export class WebTool {}\n";

describe("the research tool boundary", () => {
  it("fails the build on core code importing a tool directly", () => {
    const result = cruiseFixture({
      [AN_ADAPTER]: AN_ADAPTER_SOURCE,
      "src/modules/research/tools/research-tool.invoker.ts":
        'import { WebTool } from "./adapters/web.tool";\n\nexport const a = WebTool;\n',
    });

    expect(result.output).toContain("research-tool-core-imports-the-spi-only");
    expect(result.exitCode).not.toBe(0);
  });

  it("fails it from another module too", () => {
    const result = cruiseFixture({
      [AN_ADAPTER]: AN_ADAPTER_SOURCE,
      "src/modules/research/estimate.service.ts":
        'import { WebTool } from "./tools/adapters/web.tool";\n\nexport const a = WebTool;\n',
    });

    expect(result.output).toContain("research-tool-core-imports-the-spi-only");
    expect(result.exitCode).not.toBe(0);
  });

  it("allows research-tools.module.ts to import one, because registration happens somewhere", () => {
    const result = cruiseFixture({
      [AN_ADAPTER]: AN_ADAPTER_SOURCE,
      "src/modules/research/tools/research-tools.module.ts":
        'import { WebTool } from "./adapters/web.tool";\n\nexport const a = WebTool;\n',
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("allows a core suite to import the fake, which is what the fake is for", () => {
    const result = cruiseFixture({
      "src/modules/research/tools/adapters/fake.tool.fixture.ts": "export class Fake {}\n",
      "src/modules/research/tools/research-tool.invoker.spec.ts":
        'import { Fake } from "./adapters/fake.tool.fixture";\n\nexport const a = Fake;\n',
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("fails a core suite that reaches for a real adapter instead of the fake", () => {
    const result = cruiseFixture({
      [AN_ADAPTER]: AN_ADAPTER_SOURCE,
      "src/modules/research/tools/research-tool.invoker.spec.ts":
        'import { WebTool } from "./adapters/web.tool";\n\nexport const a = WebTool;\n',
    });

    expect(result.output).toContain("research-tool-core-tests-run-on-the-fake");
    expect(result.exitCode).not.toBe(0);
  });

  it("allows an adapter's own suite to import it", () => {
    const result = cruiseFixture({
      [AN_ADAPTER]: AN_ADAPTER_SOURCE,
      "src/modules/research/tools/adapters/web.tool.spec.ts":
        'import { WebTool } from "./web.tool";\n\nexport const a = WebTool;\n',
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });
});

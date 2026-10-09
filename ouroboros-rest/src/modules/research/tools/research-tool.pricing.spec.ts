import type { ResearchToolConfig } from "./research-tool.config";
import { FakeResearchTool } from "./adapters/fake.tool.fixture";
import { RegistryToolPricing } from "./research-tool.pricing";
import { ResearchToolRegistry } from "./research-tool.registry";
import { ResearchToolSettings, type ToolSettings } from "./research-tool.settings";

/** The fake, given a price that depends on its configuration's `plan`. */
class PricedFake extends FakeResearchTool {
  /** Every configuration the price was asked for. */
  readonly asked: (ResearchToolConfig | null)[] = [];

  operationPriceCents(config: ResearchToolConfig | null): number | null {
    this.asked.push(config);
    if (config?.plan === "free") return 0;
    return config?.plan === "paid" ? 0.5 : null;
  }
}

/** Settings answering from a map of slug → stored configuration. */
class MapSettings extends ResearchToolSettings {
  constructor(private readonly stored: Record<string, ResearchToolConfig>) {
    super();
  }

  override settingsFor(organizationId: string, slug: string): Promise<ToolSettings | null> {
    void organizationId;
    const config = this.stored[slug];
    return Promise.resolve(config === undefined ? null : { config, secret: null });
  }
}

describe("the registry-backed hosted tool pricing", () => {
  it("prices a tool whose stored configuration is priced", async () => {
    const web = new PricedFake({ slug: "web" });
    const pricing = new RegistryToolPricing(
      new ResearchToolRegistry([web]),
      new MapSettings({ web: { plan: "paid" } }),
    );

    const prices = await pricing.operationPrices("org-acme", ["web"]);

    expect([...prices]).toEqual([["web", 0.5]]);
    expect(web.asked).toEqual([{ plan: "paid" }]);
  });

  it("leaves out unpriced, free, unconfigured, priceless and unregistered tools", async () => {
    const web = new PricedFake({ slug: "web" });
    const docs = new PricedFake({ slug: "docs" });
    const code = new PricedFake({ slug: "code" });
    const tickets = new FakeResearchTool({ slug: "tickets" });
    const pricing = new RegistryToolPricing(
      new ResearchToolRegistry([web, docs, code, tickets]),
      new MapSettings({ docs: { plan: "free" }, tickets: { plan: "paid" } }),
    );

    const prices = await pricing.operationPrices("org-acme", [
      "web",
      "docs",
      "code",
      "tickets",
      "telemetry",
    ]);

    expect(prices.size).toBe(0);
    expect(web.asked).toEqual([null]);
  });

  it("asks once per tool however often the estimate names it", async () => {
    const web = new PricedFake({ slug: "web" });
    const pricing = new RegistryToolPricing(
      new ResearchToolRegistry([web]),
      new MapSettings({ web: { plan: "paid" } }),
    );

    await pricing.operationPrices("org-acme", ["web", "web"]);

    expect(web.asked).toHaveLength(1);
  });
});

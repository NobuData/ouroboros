import { ResearchToolPricing } from "./tool-pricing";

describe("the default hosted tool pricing", () => {
  it("declares no prices — the base class knows no provider; RegistryToolPricing does", async () => {
    const prices = await new ResearchToolPricing().operationPrices("org-acme", [
      "web",
      "competitor",
    ]);

    expect(prices.size).toBe(0);
  });
});

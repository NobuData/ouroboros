import { ResearchToolPricing } from "./tool-pricing";

describe("the default hosted tool pricing", () => {
  it("declares no prices — no hosted provider is configured until #615 binds one", async () => {
    const prices = await new ResearchToolPricing().operationPrices("org-acme", [
      "web",
      "competitor",
    ]);

    expect(prices.size).toBe(0);
  });
});

import { routeStatsByTaskKind, toRouteStatsResource, toRoutingSpend } from "./stats";
import type { ProviderSpendRow, TaskKindStatsRow } from "./stats.repository";
import { statsWindow } from "./stats.window";

/**
 * The arithmetic, and every way a number here could have been a lie.
 *
 * This suite is where decision **M7** is enforced, because this is the layer that could break
 * it: the statements answer nulls honestly and the contract publishes what it is handed, so the
 * only place *unknown* could quietly become *zero* is the function in between.
 *
 * Four of the ticket's acceptance criteria are asserted here against hand-written rows, and
 * `stats.integration-spec.ts` then asserts the same conclusions against the seeded database:
 *
 *   * **an empty organization yields em-dashes and zero-states, never `$0.00` for unpriced**;
 *   * **zero-priced local usage and unpriced usage are distinguishable, not merged**;
 *   * **p50 is absent where stage timings do not exist**; and
 *   * the meters are **widths relative to the maximum**, which no row can compute alone.
 */

const WINDOW = statsWindow(new Date("2026-08-23T09:58:12.004Z"));

/**
 * A per-kind row, with everything measured unless a test says otherwise.
 *
 * @param overrides - What this row says instead.
 * @returns The row.
 */
function kindRow(overrides: Partial<TaskKindStatsRow> = {}): TaskKindStatsRow {
  return {
    task_kind: "implement",
    cost_cents_avg: "87.0000",
    latency_p50_ms: 41_000,
    priced_calls: 15,
    unpriced_calls: 0,
    timed_calls: 15,
    ...overrides,
  };
}

/**
 * A per-provider row, priced unless a test says otherwise.
 *
 * @param provider - The `token_usage.provider` value.
 * @param overrides - What this row says instead.
 * @returns The row.
 */
function providerRow(
  provider: string,
  overrides: Partial<ProviderSpendRow> = {},
): ProviderSpendRow {
  return {
    provider,
    spend_cents: "41280.0000",
    tokens: "35000000",
    priced_calls: 101,
    unpriced_calls: 0,
    ...overrides,
  };
}

describe("a matrix row's two numerics", () => {
  it("converts the average once, at the edge, from the text `pg` handed back", () => {
    // `numeric(14, 4)` arrives as a string so nothing rounds it in transit. This is the one
    // place it becomes a number, which is the same trade `dashboard.service.ts` makes.
    expect(toRouteStatsResource(kindRow()).costCentsPerRunAvg).toBe(87);
    expect(toRouteStatsResource(kindRow({ cost_cents_avg: "0.5625" })).costCentsPerRunAvg).toBe(
      0.5625,
    );
  });

  it("keeps a zero average that came from calls priced at nothing", () => {
    // A `docs` pass on a local model costs nothing, and fifteen priced calls saying so is a
    // measurement. It is `$0.00` because it was measured, not because nothing was.
    const stats = toRouteStatsResource(kindRow({ cost_cents_avg: "0.0000", priced_calls: 15 }));

    expect(stats.costCentsPerRunAvg).toBe(0);
    expect(stats.pricedCalls).toBe(15);
    expect(stats.unpricedCalls).toBe(0);
  });

  it("reports an em-dash, never a zero, for a kind whose calls are all unpriced", () => {
    // The other side of the same coin, and the distinction DASH-J.4 (#92) exists to keep: the
    // average is absent and the count says why. A `0` here would be a bill nobody has sent.
    const stats = toRouteStatsResource(
      kindRow({ cost_cents_avg: null, priced_calls: 0, unpriced_calls: 15 }),
    );

    expect(stats.costCentsPerRunAvg).toBeNull();
    expect(stats.unpricedCalls).toBe(15);
  });

  it("reports no p50 where nothing timed a call, and does not invent a zero", () => {
    // The acceptance criterion *p50 is absent where stage timings do not exist*. `0ms` is a
    // call that returned inside a millisecond — which a local daemon on loopback really does.
    const stats = toRouteStatsResource(kindRow({ latency_p50_ms: null, timed_calls: 0 }));

    expect(stats.latencyP50Ms).toBeNull();
    expect(stats.timedCalls).toBe(0);
  });

  it("keeps a measured p50 of zero, which is a fast call and not an absent one", () => {
    expect(toRouteStatsResource(kindRow({ latency_p50_ms: 0, timed_calls: 9 })).latencyP50Ms).toBe(
      0,
    );
  });

  it("keys the kinds so the matrix can look its rows up, and leaves the rest absent", () => {
    // A kind that is missing from the map is a kind nothing was spent on. That is the ordinary
    // case rather than an error, and it is what makes the em-dash reachable without a branch.
    const map = routeStatsByTaskKind([kindRow(), kindRow({ task_kind: "docs" })]);

    expect([...map.keys()]).toEqual(["implement", "docs"]);
    expect(map.get("commit-msg")).toBeUndefined();
  });
});

describe("the spend card", () => {
  it("draws no rows and claims no share for a workspace that has spent nothing", () => {
    // The acceptance criterion *an empty organization yields em-dashes and zero-states*. The
    // share is **null** rather than `0`: a workspace that ran nothing did not fail to run
    // locally, and `0%` is a sentence about behaviour that never happened.
    const spend = toRoutingSpend([], WINDOW);

    expect(spend.providers).toEqual([]);
    expect(spend.totalSpendCents).toBeNull();
    expect(spend.localTokenShare).toBeNull();
    expect(spend.tokens).toBe(0);
    expect(spend.unpricedCalls).toBe(0);
  });

  it("publishes the window it was measured over", () => {
    expect(toRoutingSpend([], WINDOW).window).toEqual({
      days: 30,
      since: "2026-07-24T09:58:12.004Z",
      until: "2026-08-23T09:58:12.004Z",
    });
  });

  it("folds the two local kinds into the one metered row the mockup draws", () => {
    // Merged here rather than by the client, because the meters are widths *relative to the
    // largest row* — a client that merged afterwards would be rescaling numbers it had already
    // been given — and the footnote's share is a fraction of exactly this row's tokens.
    const spend = toRoutingSpend(
      [
        providerRow("anthropic"),
        providerRow("ollama", { spend_cents: "0.0000", tokens: "2100000", priced_calls: 15 }),
        providerRow("openai_compatible", {
          spend_cents: "0.0000",
          tokens: "19600000",
          priced_calls: 245,
        }),
      ],
      WINDOW,
    );

    expect(spend.providers.map((row) => row.key)).toEqual([
      "anthropic",
      "ollama+openai_compatible",
    ]);
    expect(spend.providers[1]).toMatchObject({
      local: true,
      kinds: ["ollama", "openai_compatible"],
      spendCents: 0,
      tokens: 21_700_000,
      pricedCalls: 260,
    });
  });

  it("keeps a local row's zero-priced total apart from its unpriced calls", () => {
    // The acceptance criterion, and the exact state Y.4 seeds: Ollama's routed `docs` calls are
    // priced at zero and its earlier calls are priced by nobody. `$0.00` **and** five calls
    // whose cost is unknown are both true of that row, and the payload says both.
    const spend = toRoutingSpend(
      [
        providerRow("ollama", {
          spend_cents: "0.0000",
          tokens: "2100000",
          priced_calls: 15,
          unpriced_calls: 5,
        }),
      ],
      WINDOW,
    );

    expect(spend.providers[0]).toMatchObject({
      spendCents: 0,
      pricedCalls: 15,
      unpricedCalls: 5,
    });
    expect(spend.unpricedCalls).toBe(5);
  });

  it("says unpriced rather than zero for a provider nothing has priced at all", () => {
    // `null` is *we do not know what this cost*. Rendering it as `$0.00` is the one failure
    // this whole surface is built to prevent, and there is no member of the type that means it.
    const spend = toRoutingSpend(
      [providerRow("cursor", { spend_cents: null, priced_calls: 0, unpriced_calls: 6 })],
      WINDOW,
    );

    expect(spend.providers[0].spendCents).toBeNull();
    expect(spend.providers[0].meterFraction).toBeNull();
    expect(spend.totalSpendCents).toBeNull();
  });

  it("meters every row against the largest bill on the card", () => {
    const spend = toRoutingSpend(
      [
        providerRow("anthropic", { spend_cents: "41280.0000" }),
        providerRow("copilot", { spend_cents: "7600.0000" }),
        providerRow("ollama", { spend_cents: "0.0000" }),
      ],
      WINDOW,
    );

    expect(spend.providers.map((row) => row.meterFraction)).toEqual([1, 7600 / 41_280, 0]);
  });

  it("draws every meter at zero when the largest bill is itself zero", () => {
    // A workspace that runs only local models: every row cost nothing, so no row is longer than
    // another. A division would be by zero; the branch that avoids it is asserted rather than
    // trusted, because `NaN` reaches a stylesheet as a width nobody can explain.
    const spend = toRoutingSpend([providerRow("ollama", { spend_cents: "0.0000" })], WINDOW);

    expect(spend.providers[0].meterFraction).toBe(0);
  });

  it("orders the card by the size of the bill, which is the mockup's own order", () => {
    const spend = toRoutingSpend(
      [
        providerRow("cursor", { spend_cents: "6410.0000" }),
        providerRow("ollama", { spend_cents: "0.0000" }),
        providerRow("anthropic", { spend_cents: "41280.0000" }),
        providerRow("copilot", { spend_cents: "7600.0000" }),
      ],
      WINDOW,
    );

    expect(spend.providers.map((row) => row.key)).toEqual([
      "anthropic",
      "copilot",
      "cursor",
      "ollama",
    ]);
  });

  it("sorts a provider nothing has priced after every provider that has been", () => {
    // The card is about money, and *we do not know* is not a large number however many tokens
    // it served. Among the unknowns, the biggest is the one a reader should see first.
    const spend = toRoutingSpend(
      [
        providerRow("custom", { spend_cents: null, tokens: "10", priced_calls: 0 }),
        providerRow("cursor", { spend_cents: null, tokens: "900", priced_calls: 0 }),
        providerRow("ollama", { spend_cents: "0.0000" }),
      ],
      WINDOW,
    );

    expect(spend.providers.map((row) => row.key)).toEqual(["ollama", "cursor", "custom"]);
  });

  it("computes the footnote as local tokens over all tokens", () => {
    // Y.4's own arithmetic: 21 700 000 of 70 000 000 is 31%, with no rounding. A fraction
    // rather than a percentage — where the digits are grouped is the stylesheet's business.
    const spend = toRoutingSpend(
      [
        providerRow("anthropic", { tokens: "35000000" }),
        providerRow("copilot", { tokens: "8180000" }),
        providerRow("cursor", { tokens: "5120000" }),
        providerRow("ollama", { spend_cents: "0.0000", tokens: "2100000" }),
        providerRow("openai_compatible", { spend_cents: "0.0000", tokens: "19600000" }),
      ],
      WINDOW,
    );

    expect(spend.tokens).toBe(70_000_000);
    expect(spend.localTokens).toBe(21_700_000);
    expect(spend.localTokenShare).toBeCloseTo(0.31, 10);
  });

  it("says zero rather than nothing when tokens ran and none of them were local", () => {
    // The distinction the null is reserved for: *nothing ran* is an em-dash, and *nothing ran
    // locally* is a real 0%.
    const spend = toRoutingSpend([providerRow("anthropic", { tokens: "1000" })], WINDOW);

    expect(spend.localTokenShare).toBe(0);
  });

  it("adds the priced rows into a total, and leaves the unpriced ones out of it", () => {
    const spend = toRoutingSpend(
      [
        providerRow("anthropic", { spend_cents: "41280.0000" }),
        providerRow("copilot", { spend_cents: "7600.0000" }),
        providerRow("custom", { spend_cents: null, priced_calls: 0, unpriced_calls: 3 }),
      ],
      WINDOW,
    );

    expect(spend.totalSpendCents).toBe(48_880);
    expect(spend.unpricedCalls).toBe(3);
  });

  it("does not call an unrecognised provider local", () => {
    // `token_usage.provider` is free text with no reference to V015's column, so a kind that
    // column no longer admits is a real value here. The honest answer for *we do not know what
    // this is* is the one that does not promise the network is unnecessary.
    const spend = toRoutingSpend([providerRow("some-retired-kind")], WINDOW);

    expect(spend.providers[0].local).toBe(false);
    expect(spend.localTokens).toBe(0);
  });
});

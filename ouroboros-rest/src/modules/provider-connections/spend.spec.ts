import type { ProviderSpendRow } from "../routing/stats.repository";
import {
  monthWindow,
  toMonthWindowResource,
  toProviderMonthlySpend,
  toProviderMonthlySpendRow,
} from "./spend";

/**
 * The cards' monthly meters ([#228](https://github.com/NobuData/ouroboros/issues/228)) —
 * the month's boundary, and the ledger's rows in the contract's vocabulary.
 *
 * Two things are worth holding. The boundary is the **UTC calendar month** (decision P7),
 * which is what `tests/seed.sql` asserts the seeded meters against, and it is the same on
 * the first of a month and the last. And nothing here coalesces: an unpriced kind stays
 * `null`, which is the difference between *no metered spend* and `$0.00`.
 */

/** A row as Z.5's statement answers one — numerics as text, the counts as integers. */
function row(overrides: Partial<ProviderSpendRow> = {}): ProviderSpendRow {
  return {
    provider: "anthropic",
    spend_cents: "41280.0000",
    tokens: "24000000",
    priced_calls: 15,
    unpriced_calls: 0,
    ...overrides,
  };
}

describe("the month's boundary", () => {
  it("starts at the first instant of the request's UTC month and ends at the request", () => {
    const window = monthWindow(new Date("2026-08-23T09:59:41.882Z"));

    expect(window.since.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(window.until.toISOString()).toBe("2026-08-23T09:59:41.882Z");
  });

  it("is the UTC month even when the local calendar has already turned", () => {
    // 23:30 on the 31st in UTC is the 1st somewhere east of it; the ledger and the seed are
    // in UTC, so the meter is too, and a reader in Tokyo sees the same figure as one in Lima.
    const window = monthWindow(new Date("2026-08-31T23:30:00.000Z"));

    expect(window.since.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("is an empty span on the first instant of a month, which is still a real month", () => {
    const window = monthWindow(new Date("2026-09-01T00:00:00.000Z"));

    expect(window.since.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(window.until.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("crosses the year boundary without help", () => {
    expect(monthWindow(new Date("2027-01-15T12:00:00.000Z")).since.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("renders both instants as ISO 8601", () => {
    expect(toMonthWindowResource(monthWindow(new Date("2026-08-23T09:59:41.882Z")))).toEqual({
      since: "2026-08-01T00:00:00.000Z",
      until: "2026-08-23T09:59:41.882Z",
    });
  });
});

describe("one row", () => {
  it("narrows the ledger's text numerics once, at the edge", () => {
    expect(toProviderMonthlySpendRow(row())).toEqual({
      kind: "anthropic",
      local: false,
      spendCents: 41_280,
      tokens: 24_000_000,
      pricedCalls: 15,
      unpricedCalls: 0,
    });
  });

  it("keeps an unpriced kind null — never a zero", () => {
    // Ollama's `$0.00 · 2.1M tokens on-box` is `null` costs: calls nobody priced. The card
    // says *no metered spend*, and it can only say so if the null survives the trip.
    expect(
      toProviderMonthlySpendRow(
        row({
          provider: "ollama",
          spend_cents: null,
          tokens: "2100000",
          priced_calls: 0,
          unpriced_calls: 2,
        }),
      ),
    ).toEqual({
      kind: "ollama",
      local: true,
      spendCents: null,
      tokens: 2_100_000,
      pricedCalls: 0,
      unpricedCalls: 2,
    });
  });

  it("keeps a kind priced at nothing at zero — which is a different fact", () => {
    expect(
      toProviderMonthlySpendRow(row({ provider: "openai_compatible", spend_cents: "0.0000" })),
    ).toMatchObject({ local: true, spendCents: 0 });
  });

  it("marks the local kinds from the lease policy's list rather than from a list of its own", () => {
    expect(toProviderMonthlySpendRow(row({ provider: "ollama" })).local).toBe(true);
    expect(toProviderMonthlySpendRow(row({ provider: "openai_compatible" })).local).toBe(true);
    expect(toProviderMonthlySpendRow(row({ provider: "copilot" })).local).toBe(false);
    expect(toProviderMonthlySpendRow(row({ provider: "cursor" })).local).toBe(false);
  });
});

describe("the resource", () => {
  it("carries the month and every row, in the statement's order", () => {
    const window = monthWindow(new Date("2026-08-23T09:59:41.882Z"));

    const spend = toProviderMonthlySpend(
      [row(), row({ provider: "cursor", spend_cents: "6410.0000" })],
      window,
    );

    expect(spend.month).toEqual({
      since: "2026-08-01T00:00:00.000Z",
      until: "2026-08-23T09:59:41.882Z",
    });
    expect(spend.providers.map((provider) => [provider.kind, provider.spendCents])).toEqual([
      ["anthropic", 41_280],
      ["cursor", 6_410],
    ]);
  });

  it("is empty rows for a workspace that has spent nothing this month, not rows of zeros", () => {
    const spend = toProviderMonthlySpend([], monthWindow(new Date("2026-08-23T09:59:41.882Z")));

    expect(spend.providers).toEqual([]);
  });
});

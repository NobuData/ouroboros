import { recordingDatabase } from "../db/database.fixture";
import { readSpendTotals } from "./run.spend";

/**
 * The ledger sum AP.1's receipt and AP.2's Resources card share — asserted once, here, for the
 * rule both depend on: an unpriced ledger sums to `null`, never to `0`.
 */

const RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

describe("readSpendTotals", () => {
  it("sums one run's tokens and cost, keyed by the run", async () => {
    const database = recordingDatabase();
    database.answers({
      rows: [{ tokens_in: "169600", tokens_out: "42400", cost_cents: "114.0000", unpriced: "0" }],
    });

    expect(await readSpendTotals(database.service.db, RUN)).toEqual({
      tokensIn: 169_600,
      tokensOut: 42_400,
      costCents: "114.0000",
      unpricedEvents: 0,
    });

    const [statement] = database.statements;
    expect(statement.sql).toContain('from "ouroboros"."token_usage"');
    expect(statement.sql).toContain('"run_id" = $1');
    expect(statement.parameters).toEqual([RUN]);
  });

  it("leaves the cost as SQL's sum left it — null when nothing is priced, not coalesced to zero", async () => {
    const database = recordingDatabase();
    database.answers({
      rows: [{ tokens_in: "1000", tokens_out: "250", cost_cents: null, unpriced: "3" }],
    });

    const totals = await readSpendTotals(database.service.db, RUN);

    expect(totals.costCents).toBeNull();
    expect(totals.unpricedEvents).toBe(3);
    // Tokens are coalesced (no rows is zero tokens); cost deliberately is not.
    expect(database.statements[0].sql).toContain("coalesce(sum(tokens_in), 0)");
    expect(database.statements[0].sql).toContain("sum(cost_cents)");
    expect(database.statements[0].sql).not.toContain("coalesce(sum(cost_cents)");
  });
});

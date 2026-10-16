import { FACADE_ERROR_CODES, facadeRefusal } from "./harness.errors";

describe("facade refusals", () => {
  it("are shaped as the Messages API shapes an error, with the rule named", () => {
    expect(facadeRefusal("alias_mismatch", "No.")).toEqual({
      status: 403,
      body: {
        type: "error",
        error: { type: "permission_error", message: "No." },
        ouroboros: { code: "alias_mismatch" },
      },
    });
  });

  it.each(FACADE_ERROR_CODES)(
    "gives %s a status the SDK does not retry, but provider_unavailable",
    (code) => {
      const { status } = facadeRefusal(code, "x");

      if (code === "provider_unavailable") {
        expect(status).toBe(502);
      } else {
        expect([400, 401, 403, 404]).toContain(status);
      }
    },
  );

  it("carries a cap, a reason and the skipped hops when given", () => {
    const cap = { source: "route" as const, limitCents: 250, spentCents: 250 };

    expect(
      facadeRefusal("cost_cap_exceeded", "Cap.", { cap, skipped: ["hop 2"] }).body.ouroboros,
    ).toEqual({
      code: "cost_cap_exceeded",
      cap,
      skipped: ["hop 2"],
    });
  });

  it("carries the stage attempt's token budget on token_budget_exceeded (#315)", () => {
    const attemptBudget = {
      limitTokens: 400_000,
      spentTokens: 400_120,
      stage: "implement",
      attempt: 2,
    };
    const refusal = facadeRefusal("token_budget_exceeded", "Budget.", { attemptBudget });

    expect(refusal.status).toBe(400);
    expect(refusal.body.error.type).toBe("invalid_request_error");
    expect(refusal.body.ouroboros).toEqual({ code: "token_budget_exceeded", attemptBudget });
  });
});

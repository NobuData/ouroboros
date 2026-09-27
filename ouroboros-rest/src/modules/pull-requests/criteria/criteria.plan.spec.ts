import { MAX_CLAIM_LENGTH, planCriteria } from "./criteria.plan";

/**
 * Plan import's reading of a draft body (#359, option 4-A): only a stated *Acceptance criteria*
 * section is imported, and nothing else in the body is read as a claim.
 */
describe("planCriteria", () => {
  /** #482's plan, as a pushed draft body would carry it. */
  const PLAN = [
    "Fix the flaky CAN-bus telemetry test.",
    "",
    "- Decouple PID sampling from the telemetry drain",
    "  - keep k_msgq",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] Telemetry frames must arrive in ISR order under load",
    "- [x] No regression in e-stop response envelope",
    "  - measured on helios-rig-02",
    "* Fix must not mask real ordering bugs in tests",
    "1. Zero heap allocation in ISR fast path",
    "2) Flake must not reappear across temperature range",
    "",
    "## Notes",
    "- not a criterion",
  ].join("\n");

  it("imports the section's items in order, boxes dropped and detail skipped", () => {
    expect(planCriteria(PLAN)).toEqual({
      found: true,
      claims: [
        "Telemetry frames must arrive in ISR order under load",
        "No regression in e-stop response envelope",
        "Fix must not mask real ordering bugs in tests",
        "Zero heap allocation in ISR fast path",
        "Flake must not reappear across temperature range",
      ],
      tooLong: [],
    });
  });

  it("finds the section as a heading, a bold line or a label", () => {
    for (const heading of [
      "### acceptance criteria",
      "**Acceptance Criteria**",
      "Acceptance criteria:",
      "__Acceptance criteria:__",
    ]) {
      expect(planCriteria(`${heading}\n- Frames arrive in order`).claims).toEqual([
        "Frames arrive in order",
      ]);
    }
  });

  it("reads nothing from a body with no section — never guesses claims from task detail", () => {
    expect(planCriteria("- Decouple PID sampling\n- Keep k_msgq")).toEqual({
      found: false,
      claims: [],
      tooLong: [],
    });
    expect(planCriteria(null).found).toBe(false);
    expect(planCriteria("The acceptance criteria are below.\n- x").found).toBe(false);
  });

  it("ends the section at flush prose, and keeps an empty section found but empty", () => {
    expect(planCriteria("## Acceptance criteria\n- One\nThen some prose.\n- Two").claims).toEqual([
      "One",
    ]);
    expect(planCriteria("## Acceptance criteria\n\n## Next")).toEqual({
      found: true,
      claims: [],
      tooLong: [],
    });
  });

  it("imports each claim once, and reports one too long to store rather than cutting it", () => {
    const long = "x".repeat(MAX_CLAIM_LENGTH + 1);
    const result = planCriteria(
      `Acceptance criteria:\r\n- Same\r\n- Same\r\n- [ ] \r\n- ${long}\r\n- Last`,
    );

    expect(result.claims).toEqual(["Same", "Last"]);
    expect(result.tooLong).toEqual([long]);
  });
});

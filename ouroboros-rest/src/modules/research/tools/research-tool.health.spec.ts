import {
  NOT_CONFIGURED_HEALTH,
  TOOL_HEALTH_DOTS,
  TOOL_HEALTH_STATES,
  UNKNOWN_COUNT,
  healthDot,
  renderSubLine,
  subLineSlots,
} from "./research-tool.health";

describe("research tool health", () => {
  it("maps the four states onto the card's four dots one to one", () => {
    // CL.1's acceptance criterion: total (every state has a dot) and injective (no two share one),
    // so the four dots of mockup 22's shared stylesheet are exactly the four states.
    const dots = TOOL_HEALTH_STATES.map((state) => TOOL_HEALTH_DOTS[state]);

    expect(dots).toEqual(["ok", "warn", "err", "idle"]);
    expect(new Set(dots).size).toBe(TOOL_HEALTH_STATES.length);
  });

  it("draws an unconfigured tool idle, not as a failure", () => {
    expect(healthDot(NOT_CONFIGURED_HEALTH)).toBe("idle");
    expect(healthDot({ state: "down", detail: "unreachable" })).toBe("err");
  });
});

describe("the sub-line", () => {
  it("names its slots, once each, in order", () => {
    expect(subLineSlots("{rivals} rivals watched · release notes, changelogs, filings")).toEqual([
      "rivals",
    ]);
    expect(subLineSlots("{issues} issues · {tickets} tickets · {issues} again")).toEqual([
      "issues",
      "tickets",
    ]);
    expect(subLineSlots("search API + full-page extraction, robots-aware")).toEqual([]);
  });

  it("renders mockup 22's sub-lines from live counts", () => {
    expect(
      renderSubLine("{rivals} rivals watched · release notes, changelogs, filings", { rivals: 4 }),
    ).toBe("4 rivals watched · release notes, changelogs, filings");
    expect(
      renderSubLine("{issues} issues · support tickets · churn interviews", { issues: 3412 }),
    ).toBe("3,412 issues · support tickets · churn interviews");
  });

  it("renders an unknown or missing count as an em dash, never as zero", () => {
    expect(renderSubLine("{rivals} rivals watched", { rivals: null })).toBe(
      `${UNKNOWN_COUNT} rivals watched`,
    );
    expect(renderSubLine("{rivals} rivals watched", {})).toBe(`${UNKNOWN_COUNT} rivals watched`);
    expect(renderSubLine("{rivals} rivals watched", { rivals: 0 })).toBe("0 rivals watched");
  });

  it("keeps a phrase the registry computed as written, and a blank one as an em dash", () => {
    expect(
      renderSubLine("{watched} · {kinds}", {
        watched: "4 rivals watched",
        kinds: "release notes, changelogs, filings",
      }),
    ).toBe("4 rivals watched · release notes, changelogs, filings");
    expect(renderSubLine("{kinds}", { kinds: "  " })).toBe(UNKNOWN_COUNT);
  });
});

import {
  DEFAULT_ORIGIN,
  isMixed,
  isOriginFilter,
  keeps,
  ORIGIN_FILTERS,
  originsOf,
  originsPresent,
} from "./metrics.origin";

/**
 * The origin filter every aggregate reads under (DJ.2, #1315): live by default, one origin at a
 * time, and `all` the only answer that may sum origins — and say so.
 */
describe("metrics origin filter", () => {
  it("defaults to live and lists every origin plus all", () => {
    expect(DEFAULT_ORIGIN).toBe("live");
    expect(ORIGIN_FILTERS).toEqual(["live", "simulated", "seeded", "all"]);
  });

  it("narrows only the four filters", () => {
    for (const filter of ORIGIN_FILTERS) {
      expect(isOriginFilter(filter)).toBe(true);
    }

    expect(isOriginFilter("LIVE")).toBe(false);
    expect(isOriginFilter("")).toBe(false);
    expect(isOriginFilter(undefined)).toBe(false);
    expect(isOriginFilter(["live"])).toBe(false);
  });

  it("keeps one origin, or every one for all", () => {
    expect(originsOf("seeded")).toEqual(["seeded"]);
    expect(originsOf("all")).toEqual(["live", "simulated", "seeded"]);
    expect(keeps("live", "live")).toBe(true);
    expect(keeps("live", "seeded")).toBe(false);
    expect(keeps("all", "simulated")).toBe(true);
  });

  it("reports the origins present once each, in vocabulary order", () => {
    expect(
      originsPresent([
        { origin: "seeded" },
        { origin: "live" },
        { origin: "seeded" },
        { origin: "simulated" },
      ]),
    ).toEqual(["live", "simulated", "seeded"]);
    expect(originsPresent([])).toEqual([]);
  });

  it("calls an answer mixed only under all, and only over more than one origin", () => {
    expect(isMixed("all", ["live", "seeded"])).toBe(true);
    expect(isMixed("all", ["seeded"])).toBe(false);
    expect(isMixed("all", [])).toBe(false);
    expect(isMixed("live", ["live", "seeded"])).toBe(false);
  });
});

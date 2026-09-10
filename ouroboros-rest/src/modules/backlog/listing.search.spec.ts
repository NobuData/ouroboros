import { escapeLike, searchTerms } from "./listing.search";

/**
 * The one box that promises three matches.
 *
 * Two rules are asserted here and nowhere else, because both are invisible in a green
 * integration run over a well-behaved fixture: a search is escaped before it becomes a
 * pattern, and `#485` is a number **as well as** text rather than instead of it.
 */

describe("escaping a search for `like`", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeLike("watchdog")).toBe("watchdog");
    expect(escapeLike("I²C bus lockup")).toBe("I²C bus lockup");
  });

  it("escapes the two wildcards, which are ordinary characters in a title", () => {
    // Without this, `100%` matches every title beginning `100` and `a_b` matches `axb` —
    // results a person cannot explain and cannot turn off.
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("escapes the escape character first", () => {
    // The ordering every one of these functions gets wrong exactly once: escaping `%` before
    // `\` would turn `\%` into `\\%`, which is a literal backslash followed by a wildcard.
    expect(escapeLike("\\%")).toBe("\\\\\\%");
  });
});

describe("reading the search box", () => {
  it("wraps the term as a substring pattern", () => {
    expect(searchTerms("watchdog").pattern).toBe("%watchdog%");
  });

  it("reads `#485` as the issue number, hash and all", () => {
    expect(searchTerms("#485").number).toBe(485);
  });

  it("reads a bare number as one too, because a person pastes both", () => {
    expect(searchTerms("485").number).toBe(485);
  });

  it("still matches the number as text, rather than switching into a mode", () => {
    // The acceptance criterion — `q="#485"` finds exactly one — holds because one issue carries
    // that number, not because the title and label matches were suppressed.
    expect(searchTerms("#485").pattern).toBe("%#485%");
  });

  it("is not a number when there is anything else in the box", () => {
    expect(searchTerms("485 watchdog").number).toBeUndefined();
    expect(searchTerms("#bug").number).toBeUndefined();
    expect(searchTerms("v485").number).toBeUndefined();
  });

  it("declines a number no issue column could hold", () => {
    // `github_issues.number` is an `integer`. Ten digits is a title search, not a query that
    // should fail on overflow.
    expect(searchTerms("1234567890").number).toBeUndefined();
    expect(searchTerms("999999999").number).toBe(999_999_999);
  });

  it("escapes the pattern it builds", () => {
    expect(searchTerms("100%").pattern).toBe("%100\\%%");
  });
});

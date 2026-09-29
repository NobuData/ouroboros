import {
  MAX_SLUG_ORDINAL,
  NAME_MAX_LENGTH,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  nextFreeSlug,
  slugify,
} from "./slug";

/**
 * The identifier a `workflow_tag` resolves through, and the one property that matters about
 * deriving one: **whatever comes out satisfies `workflows_slug_format`**.
 *
 * The individual cases below are readable examples; the property is the last test, which runs
 * every derivation through the constraint the database will apply.
 */

describe("slugify", () => {
  it.each([
    ["the mockup's own workflow", "Standard Fix", "standard-fix"],
    ["a title that is already a slug", "docs-loop", "docs-loop"],
    ["capitals and spaces", "Hotfix P0", "hotfix-p0"],
    ["punctuation between words", "Deps / Refresh!", "deps-refresh"],
    ["a run of separators", "feature   ___  loop", "feature-loop"],
    ["leading and trailing noise", "  -- release train -- ", "release-train"],
    ["digits, which the pattern admits", "Rollback 2 Stage", "rollback-2-stage"],
  ])("folds %s", (_name, title, expected) => {
    expect(slugify(title)).toBe(expected);
  });

  it("truncates before trimming, so a cut never leaves a trailing hyphen", () => {
    // 64 characters is `workflows_slug_format`'s bound. A title cut mid-separator would end in
    // the one character the pattern forbids at the end, which is a 500 rather than a slug.
    const title = `${"a".repeat(SLUG_MAX_LENGTH)} tail`;
    const slug = slugify(title);

    expect(slug).toBe("a".repeat(SLUG_MAX_LENGTH));
    expect(slug).not.toMatch(/-$/);
  });

  it.each([
    ["a title with no ASCII letters or digits", "日本語のワークフロー"],
    ["punctuation alone", "***"],
    ["whitespace alone", "   "],
    ["the empty string", ""],
  ])("answers undefined for %s rather than inventing one", (_name, title) => {
    // Inventing `workflow-1` would hand somebody an identifier with no relationship to what
    // they typed — and the slug is what a closed run is still rendered under. The caller is
    // asked for one instead, which `workflow_slug_required` says in as many words.
    expect(slugify(title)).toBeUndefined();
  });

  it("produces nothing the database would refuse, for any title", () => {
    const titles = [
      "Standard Fix",
      "  Hotfix P0 — urgent!! ",
      "release/train/2026",
      "a".repeat(NAME_MAX_LENGTH),
      "ünïcödé mixed with ASCII",
      "1",
      "-leading",
      "trailing-",
      "多言語 Feature Loop",
    ];

    for (const title of titles) {
      const slug = slugify(title);

      if (slug === undefined) continue;

      expect(slug).toMatch(SLUG_PATTERN);
      expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    }
  });
});

describe("nextFreeSlug — the suffix flow (BB.3, #386)", () => {
  it("answers the base itself when it is free", () => {
    expect(nextFreeSlug("quick-fixes", new Set(["standard-fix"]))).toEqual({
      slug: "quick-fixes",
      ordinal: 1,
    });
  });

  it("suffixes -2 when the base is taken", () => {
    expect(nextFreeSlug("quick-fixes", new Set(["quick-fixes"]))).toEqual({
      slug: "quick-fixes-2",
      ordinal: 2,
    });
  });

  it("skips every taken suffix", () => {
    const taken = new Set(["quick-fixes", "quick-fixes-2", "quick-fixes-3"]);

    expect(nextFreeSlug("quick-fixes", taken)).toEqual({ slug: "quick-fixes-4", ordinal: 4 });
  });

  it("fills a gap left by a deleted suffix", () => {
    const taken = new Set(["quick-fixes", "quick-fixes-3"]);

    expect(nextFreeSlug("quick-fixes", taken)?.slug).toBe("quick-fixes-2");
  });

  it("keeps a suffixed slug of a 64-character base inside the bound and the pattern", () => {
    const base = `${"a".repeat(62)}-b`;
    const free = nextFreeSlug(base, new Set([base]));

    expect(free?.slug).toHaveLength(SLUG_MAX_LENGTH);
    expect(free?.slug).toMatch(SLUG_PATTERN);
    expect(free?.slug.endsWith("-2")).toBe(true);
  });

  it("trims a hyphen the cut leaves before the suffix", () => {
    const base = `${"a".repeat(61)}-bc`;
    const free = nextFreeSlug(base, new Set([base]));

    expect(free?.slug).toBe(`${"a".repeat(61)}-2`);
    expect(free?.slug).toMatch(SLUG_PATTERN);
  });

  it("gives up after the last ordinal", () => {
    const taken = new Set(["x"]);

    for (let ordinal = 2; ordinal <= MAX_SLUG_ORDINAL; ordinal += 1) taken.add(`x-${ordinal}`);

    expect(nextFreeSlug("x", taken)).toBeUndefined();
  });
});

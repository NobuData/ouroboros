import { NAME_MAX_LENGTH, SLUG_MAX_LENGTH, SLUG_PATTERN, slugify } from "./slug";

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

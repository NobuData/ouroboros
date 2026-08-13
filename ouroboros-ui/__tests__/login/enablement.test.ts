import { describe, expect, it } from "vitest";

import { ENABLED_FIELD, WORKSPACE_FIELD, repoSummary } from "@/app/login/enablement";

import { membership } from "../helpers/login";

/**
 * The sentence under each workspace row — the mockup's "4 repos enabled · incl.
 * helios-firmware", plus the fact the mockup has no way to know it needs.
 *
 * **The counting moved to the service in
 * [#719](https://github.com/NobuData/ouroboros/issues/719).** The line was derived here from
 * a list of repositories the screen had fetched per organisation; `OrgRow` carries
 * `repoCounts` and `featuredRepo`, computed by the query that already had the rows in hand,
 * so what is left in this module is the *wording* — which is the part a person reads and the
 * part a test can hold to the drawing.
 *
 * `enabledRepos` went with the fetching. It filtered a list that no longer reaches this
 * screen; `repoCounts.enabled` is the same number, counted where the repositories are.
 */

describe("field names", () => {
  it("are what the forms and the actions both read, so neither can rename alone", () => {
    // A `"use server"` module may export nothing but async functions, which is why these are
    // here rather than beside the action that reads them.
    expect(WORKSPACE_FIELD).toBe("workspace");
    expect(ENABLED_FIELD).toBe("enabled");
  });
});

describe("repoSummary", () => {
  it("counts the enabled repositories and names one, as the mockup does", () => {
    const line = repoSummary(
      membership({ repoCounts: { enabled: 4, total: 4 }, featuredRepo: "helios-firmware" }),
    );

    expect(line).toBe("4 repos enabled · incl. helios-firmware");
  });

  it("draws the mockup's second row, which has nothing enabled and nothing to name", () => {
    const line = repoSummary(
      membership({ enabled: false, repoCounts: { enabled: 0, total: 0 }, featuredRepo: null }),
    );

    expect(line).toBe("0 repos enabled");
  });

  it("says nothing about an example when the service named none", () => {
    expect(
      repoSummary(membership({ repoCounts: { enabled: 0, total: 9 }, featuredRepo: null })),
    ).toBe("0 repos enabled");
  });

  it("gets the singular right, because a row that says '1 repos' is a row nobody proofread", () => {
    expect(
      repoSummary(membership({ repoCounts: { enabled: 1, total: 1 }, featuredRepo: "a" })),
    ).toBe("1 repo enabled · incl. a");
  });

  it("says the workspace is off, which is the fact the two flags together decide", () => {
    // A repository is in scope only when its own flag *and* its organisation's are both
    // true, so enabled repositories under a switched-off workspace are not work about to
    // happen — and the row must not read as if they were.
    const line = repoSummary(
      membership({ enabled: false, repoCounts: { enabled: 1, total: 1 }, featuredRepo: "a" }),
    );

    expect(line).toBe("1 repo enabled · incl. a · org off — none in scope");
  });

  it("does not add that note when nothing is enabled under the switched-off workspace", () => {
    // There is nothing out of scope to warn about, and the count already says so.
    expect(
      repoSummary(
        membership({ enabled: false, repoCounts: { enabled: 0, total: 3 }, featuredRepo: null }),
      ),
    ).toBe("0 repos enabled");
  });

  it("is never empty, whatever the row carries", () => {
    for (const one of [
      membership(),
      membership({ enabled: false }),
      membership({ repoCounts: { enabled: 0, total: 0 }, featuredRepo: null }),
    ]) {
      expect(repoSummary(one)).not.toBe("");
    }
  });
});

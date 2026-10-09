import {
  COMPETITOR_SOURCE_KINDS,
  SOURCE_KIND_LABELS,
  acceptsSelector,
  githubRepoOf,
} from "./competitor.kinds";

describe("the tracker's kinds", () => {
  it("label every kind as V112's competitor_source_kind_label does", () => {
    expect(COMPETITOR_SOURCE_KINDS.map((kind) => SOURCE_KIND_LABELS[kind])).toEqual([
      "release notes",
      "changelogs",
      "GitHub releases",
      "RSS feeds",
      "filings",
      "pages",
    ]);
  });

  it("let only page kinds take a selector", () => {
    expect(COMPETITOR_SOURCE_KINDS.filter(acceptsSelector)).toEqual([
      "release_notes",
      "changelog",
      "page",
    ]);
  });

  it.each([
    ["https://github.com/skylink/firmware", { owner: "skylink", repo: "firmware" }],
    ["https://github.com/skylink/firmware/releases", { owner: "skylink", repo: "firmware" }],
    ["https://github.com/skylink/firmware.git", { owner: "skylink", repo: "firmware" }],
    ["https://github.com/skylink", null],
    ["https://github.com/skylink/firmware/issues", null],
    ["http://github.com/skylink/firmware", null],
    ["https://gitlab.com/skylink/firmware", null],
    ["not a url", null],
  ])("reads %s as a repository", (url, expected) => {
    expect(githubRepoOf(url)).toEqual(expected);
  });
});

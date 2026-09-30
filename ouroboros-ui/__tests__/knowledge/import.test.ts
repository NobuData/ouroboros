import { describe, expect, it } from "vitest";

import {
  AWAITING_LINK,
  DRAFTS_LINK,
  FILE_NOT_FOUND,
  FILE_TRUNCATED,
  IMPORT_FAILED,
  IMPORT_NO_REPOS,
  IMPORT_RATE_LIMITED,
  IMPORT_READ_ONLY,
  IMPORT_REPOS_UNREAD,
  IMPORT_SOURCE_FAILED,
  IMPORT_SOURCE_MISSING,
  IMPORT_STALE,
  IMPORT_TOO_LARGE,
  NONE_FOUND_TITLE,
  NOTHING_ENABLED,
  NOTHING_USABLE_TITLE,
  UNCHANGED_TITLE,
  applyReason,
  counted,
  dedupedCount,
  defaultRepo,
  fileLine,
  importFailure,
  importReason,
  importToast,
  noneFoundNote,
  plannedCount,
  previewKind,
  sectionLine,
  totalsLine,
} from "@/app/knowledge/import";
import { FACTS_REGION_ID, SKILLS_REGION_ID } from "@/app/knowledge/view";

import {
  absentFile,
  claudeFile,
  importPreview,
  importResult,
  noneFoundPreview,
  nothingUsablePreview,
  seededRepos,
  unchangedPreview,
} from "../helpers/knowledge";

/**
 * The import sheet's judgements (#417): which repository it opens on, which of the four things a
 * preview is, what the counts say, the statement that nothing is enabled, and what every refusal
 * says.
 */

describe("the repository", () => {
  it("opens on the chip's focus repo when it is enabled, the first enabled one otherwise", () => {
    const repos = seededRepos();

    expect(defaultRepo(repos, { id: repos[1]!.id, name: "helios-tools" })).toBe("acme-robotics/helios-tools");
    expect(defaultRepo(repos, { id: "not-enabled", name: "elsewhere" })).toBe("acme-robotics/helios-firmware");
    expect(defaultRepo(repos, null)).toBe("acme-robotics/helios-firmware");
    expect(defaultRepo([], null)).toBe("");
  });

  it("holds the head's action, with the reason, when there is nothing to import from", () => {
    expect(importReason(null)).toBe(IMPORT_REPOS_UNREAD);
    expect(importReason([])).toBe(IMPORT_NO_REPOS);
    expect(importReason(seededRepos())).toBeUndefined();
  });
});

describe("which of the four things a preview is", () => {
  it("is ready when something would be written", () => {
    expect(previewKind(importPreview())).toBe("ready");
  });

  it("is the honest empty result when the repository has none of the four files", () => {
    expect(previewKind(noneFoundPreview())).toBe("none-found");
  });

  it("is an unchanged re-import when everything found dedupes away", () => {
    expect(previewKind(unchangedPreview())).toBe("unchanged");
  });

  it("is nothing usable when files were found and parse to nothing", () => {
    expect(previewKind(nothingUsablePreview())).toBe("nothing-usable");
  });

  it("holds Apply, with the reason, for every kind but ready", () => {
    expect(applyReason("ready")).toBeUndefined();
    expect(applyReason("none-found")).toBe(NONE_FOUND_TITLE);
    expect(applyReason("unchanged")).toBe(UNCHANGED_TITLE);
    expect(applyReason("nothing-usable")).toBe(NOTHING_USABLE_TITLE);
  });

  it("sums what is planned and what deduped", () => {
    expect(plannedCount(importPreview().totals)).toBe(12);
    expect(dedupedCount(importPreview().totals)).toBe(3);
  });
});

describe("what the preview says", () => {
  it("counts with the right plural", () => {
    expect(counted(1, "skill draft")).toBe("1 skill draft");
    expect(counted(3, "fact candidate")).toBe("3 fact candidates");
    expect(counted(0, "skill update")).toBe("0 skill updates");
  });

  it("lines up drafts, updates only when there are any, candidates, and what was already known", () => {
    expect(totalsLine(importPreview().totals)).toBe("2 skill drafts · 1 skill update · 9 fact candidates (3 already known)");
    expect(
      totalsLine({ filesFound: 1, skillDrafts: 1, skillUpdates: 0, factCandidates: 0, dedupedSkills: 0, dedupedFacts: 0 }),
    ).toBe("1 skill draft · 0 fact candidates");
  });

  it("says per file what it would create, that it is absent, or that only its head was read", () => {
    expect(fileLine(claudeFile())).toBe("3 skill drafts · 9 fact candidates");
    expect(fileLine(absentFile("AGENTS.md"))).toBe(FILE_NOT_FOUND);
    expect(fileLine(claudeFile({ truncated: true }))).toContain(FILE_TRUNCATED);
  });

  it("names a sample's section, or the whole file when there was no heading", () => {
    expect(sectionLine("Kconfig", "CLAUDE.md")).toBe("CLAUDE.md · § Kconfig");
    expect(sectionLine(null, ".cursorrules")).toBe(".cursorrules · whole file");
  });

  it("states that nothing imported is enabled, in as many words", () => {
    expect(NOTHING_ENABLED).toMatch(/Nothing imported is enabled/);
    expect(NOTHING_ENABLED).toMatch(/drafts/);
    expect(NOTHING_ENABLED).toMatch(/candidates/);
  });

  it("tells the empty result what was looked for and what to do instead", () => {
    const note = noneFoundNote("acme-robotics/helios-firmware");

    expect(note).toContain("acme-robotics/helios-firmware");
    expect(note).toContain("CLAUDE.md");
    expect(note).toContain(".cursorrules");
    expect(note).toContain("+ New skill");
  });
});

describe("what a refusal says", () => {
  it("is one sentence per code, ending on the fact that nothing was imported", () => {
    const cases: readonly [string, string][] = [
      ["forbidden", IMPORT_READ_ONLY],
      ["detection_source_missing", IMPORT_SOURCE_MISSING],
      ["knowledge_import_preview_stale", IMPORT_STALE],
      ["knowledge_import_too_large", IMPORT_TOO_LARGE],
      ["knowledge_import_rate_limited", IMPORT_RATE_LIMITED],
      ["knowledge_import_source_failed", IMPORT_SOURCE_FAILED],
    ];

    for (const [code, sentence] of cases) {
      expect(importFailure({ code, message: "", details: {} })).toBe(sentence);
      expect(sentence).toContain("Nothing was imported.");
    }
  });

  it("tells a stale apply to preview again", () => {
    expect(IMPORT_STALE).toMatch(/Preview again/);
  });

  it("follows the product's line with the service's own sentence for anything else", () => {
    expect(importFailure({ code: "internal_error", message: "The service failed.", details: {} })).toBe(
      `${IMPORT_FAILED} The service failed.`,
    );
  });
});

describe("the toast", () => {
  it("quotes what the apply wrote, from where, that none of it is live, and links both review states", () => {
    const toast = importToast(importResult());

    expect(toast.text).toBe(
      "Imported 3 skill drafts and 9 fact candidates from acme-robotics/helios-firmware. Nothing is enabled yet.",
    );
    expect(toast.links).toEqual([
      { label: DRAFTS_LINK, href: `#${SKILLS_REGION_ID}` },
      { label: AWAITING_LINK, href: `#${FACTS_REGION_ID}` },
    ]);
  });

  it("links only the states it filled", () => {
    const result = importResult();
    const toast = importToast({ ...result, created: { skills: result.created.skills, facts: [] } });

    expect(toast.text).toContain("0 fact candidates");
    expect(toast.links.map((link) => link.label)).toEqual([DRAFTS_LINK]);
  });
});

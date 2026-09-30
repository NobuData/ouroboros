import { NO_DRAFT } from "../workflows/draft.etag";
import { parseSkillDocument } from "./skills.frontmatter";
import {
  isActive,
  skillCode,
  skillDetail,
  skillDraftEtag,
  skillFilePath,
  skillList,
  skillVersionSummary,
} from "./skills.resources";
import { AT, skillRow, versionRow } from "./skills.fixture";

/** The skills API's wire shapes (#410). */

describe("active", () => {
  it("is enabled, not a draft, and published — a draft is never active", () => {
    expect(isActive(skillRow())).toBe(true);
    expect(isActive(skillRow({ enabled: false }))).toBe(false);
    expect(isActive(skillRow({ draft: true }))).toBe(false);
    expect(isActive(skillRow({ current_version: null }))).toBe(false);
  });
});

describe("the list", () => {
  it("counts only the active skills — the card's `6 active`", () => {
    const list = skillList([
      skillRow(),
      skillRow({ id: "s2", slug: "power-budget-checks", draft: true, enabled: false }),
      skillRow({ id: "s3", slug: "hil-safety", required: true }),
    ]);

    expect(list.active).toBe(2);
    expect(list.skills.map((skill) => [skill.slug, skill.active])).toEqual([
      ["zephyr-conventions", true],
      ["power-budget-checks", false],
      ["hil-safety", true],
    ]);
  });

  it("carries the scope's referent, the version chip and the editor path", () => {
    const [skill] = skillList([
      skillRow({
        scope: "workflow",
        repo_ref: null,
        workflow_id: "wf-1",
        workflow_slug: "standard-fix",
      }),
    ]).skills;

    expect(skill).toMatchObject({
      scope: "workflow",
      repoRef: null,
      workflow: { id: "wf-1", slug: "standard-fix" },
      currentVersion: 12,
      publishedAt: AT.toISOString(),
      path: "skills/zephyr-conventions.skill.md",
    });
  });
});

describe("the draft etag", () => {
  it("is `none` for an empty slot, and changes with the draft's content", () => {
    const draft = versionRow({
      version: null,
      published_at: null,
      published_by: null,
      change_note: null,
    });

    expect(skillDraftEtag(undefined)).toBe(NO_DRAFT);
    expect(skillDraftEtag(draft)).toMatch(/^[0-9a-f]{64}$/);
    expect(skillDraftEtag({ ...draft, body: "changed" })).not.toBe(skillDraftEtag(draft));
  });

  it("is carried by the detail whether or not there is a draft", () => {
    expect(skillDetail(skillRow(), versionRow(), undefined)).toMatchObject({
      draft: null,
      draftEtag: NO_DRAFT,
      version: { version: 12, changeNote: "Drop the legacy timer rule." },
    });
  });
});

describe("the history row", () => {
  it("marks the version in force", () => {
    expect(skillVersionSummary(versionRow(), 12).isCurrent).toBe(true);
    expect(skillVersionSummary(versionRow({ version: 11 }), 12).isCurrent).toBe(false);
  });
});

describe("the code view's file", () => {
  it("is skills/<slug>.skill.md, printed so it reads back as the stored version", () => {
    const shown = versionRow();
    const file = skillCode(skillRow(), shown, undefined, true);
    const reread = parseSkillDocument(file.text);

    expect(file).toMatchObject({
      path: skillFilePath("zephyr-conventions"),
      slug: "zephyr-conventions",
      etag: NO_DRAFT,
      readOnly: true,
      version: 12,
      currentVersion: 12,
    });
    expect(reread).toEqual({
      ok: true,
      document: { frontmatter: shown.frontmatter, body: shown.body },
    });
  });
});

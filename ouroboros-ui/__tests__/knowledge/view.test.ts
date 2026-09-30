import { describe, expect, it } from "vitest";

import {
  FACTS_REGION_ID,
  IMPORT_LABEL,
  KNOWLEDGE_EYEBROW,
  KNOWLEDGE_SUBLINE,
  KNOWLEDGE_TITLE,
  NEW_SKILL_LABEL,
  READ_ONLY_BODY,
  SKILLS_REGION_ID,
  readOnlyNote,
} from "@/app/knowledge/view";

/**
 * The knowledge frame's sentences (#417): the head is mockup 14's to the character, the two actions
 * are named as the mockup names them, and the read-only note takes the reader's own role.
 */

describe("the head", () => {
  it("is mockup 14's eyebrow, heading and subline, verbatim", () => {
    expect(KNOWLEDGE_EYEBROW).toBe("Knowledge");
    expect(KNOWLEDGE_TITLE).toBe("Teach the loop once. Every run remembers.");
    expect(KNOWLEDGE_SUBLINE).toBe(
      "Skills you write, facts the loop learns (and you approve), and playbooks you can aim at any " +
        "issue. Scoped per repo or org-wide.",
    );
  });

  it("names the two actions as the mockup does", () => {
    expect(IMPORT_LABEL).toBe("Import CLAUDE.md / .cursorrules");
    expect(NEW_SKILL_LABEL).toBe("+ New skill");
  });
});

describe("the read-only note", () => {
  it("names the reader's role with its article", () => {
    expect(readOnlyNote("member").head).toBe("Viewing knowledge as a member.");
    expect(readOnlyNote("owner").head).toBe("Viewing knowledge as an owner.");
    expect(readOnlyNote("viewer").body).toBe(READ_ONLY_BODY);
  });
});

describe("the anchors", () => {
  it("are distinct ids the toast can point at", () => {
    expect(SKILLS_REGION_ID).not.toBe(FACTS_REGION_ID);
    for (const id of [SKILLS_REGION_ID, FACTS_REGION_ID]) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });
});

/**
 * The shipped procedures: what a workspace starts with, and that the development seed holds the
 * same words — the seed's skills and the ones written on first use must not drift apart.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OUTPUT_KEYWORDS } from "./pipeline.skills.fixture";
import {
  CREATE_ISSUES_BODY,
  CREATE_ROADMAP_BODY,
  SHIPPED_CHANGE_NOTE,
  SHIPPED_SKILLS,
} from "./pipeline.skills";

const SEED = readFileSync(
  join(__dirname, "../../../../../ouroboros-db/migrations/R__dev_seed_workspace_research.sql"),
  "utf8",
);

describe("the shipped pipeline skills", () => {
  it.each(Object.values(SHIPPED_SKILLS))("seeds $slug with exactly the shipped body", (skill) => {
    expect(SEED).toContain(`$skill$${skill.body}$skill$`);
    expect(SEED).toContain(`'${skill.slug}', '${skill.description.replace(/'/g, "''")}'`);
  });

  it("seeds them the way the registry ships them: generated, published by nobody, under one note", () => {
    expect(SEED).toContain("'org', true, false, false, 'generated'");
    expect(SEED).toContain(`null, '${SHIPPED_CHANGE_NOTE}'`);
    expect(SEED).toContain("'load', 'on_trigger', 'triggers', jsonb_build_array(skill.slug)");
  });

  it.each(Object.values(SHIPPED_SKILLS))("loads $slug only by its own name", (skill) => {
    expect(skill.triggers).toEqual([skill.slug]);
    expect(skill.body.startsWith(`# ${skill.slug}\n`)).toBe(true);
    expect(skill.description.length).toBeLessThanOrEqual(200);
  });

  it("holds nothing a seed file or a placeholder would trip on", () => {
    for (const body of [CREATE_ROADMAP_BODY, CREATE_ISSUES_BODY]) {
      expect(body).not.toContain("$skill$");
      expect(body).not.toContain("${");
      expect(body.toLowerCase()).not.toContain("secret");
      expect(body.endsWith("\n")).toBe(true);
    }
  });

  it("names every input the pipeline sends, so an edited copy starts from the truth", () => {
    for (const keyword of OUTPUT_KEYWORDS["create-roadmap"])
      expect(CREATE_ROADMAP_BODY).toContain(`\`${keyword}\``);
    for (const keyword of OUTPUT_KEYWORDS["create-issues"])
      expect(CREATE_ISSUES_BODY).toContain(`\`${keyword}\``);
  });

  it("leaves sizing to the estimator", () => {
    expect(CREATE_ISSUES_BODY).toContain("the estimator sizes every issue when it is filed");
  });
});

/**
 * Rows for the skills module's suites (#410): a skill as `SkillsRepository` reads it, and a
 * version. Each builder is a published, enabled, repo-scoped `zephyr-conventions`, overridden.
 */

import type { SkillVersion } from "../db/schema";
import type { SkillRow } from "./skills.resources";

/** The instant every fixture row is stamped with. */
export const AT = new Date("2026-09-27T12:00:00Z");

/**
 * A skill row.
 *
 * @param overrides - What differs from an enabled, published, repo-scoped skill.
 * @returns The row.
 */
export function skillRow(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "skill-1",
    organization_id: "acme-robotics-id",
    slug: "zephyr-conventions",
    name: "zephyr-conventions",
    description: "Kconfig, devicetree & ISR-safety house rules",
    scope: "repo",
    repo_ref: "acme-robotics/helios-firmware",
    workflow_id: null,
    enabled: true,
    required: false,
    draft: false,
    origin: "authored",
    current_version: 12,
    created_at: AT,
    updated_at: AT,
    workflow_slug: null,
    current_published_at: AT,
    ...overrides,
  };
}

/**
 * A version row.
 *
 * @param overrides - What differs from published v12.
 * @returns The row.
 */
export function versionRow(overrides: Partial<SkillVersion> = {}): SkillVersion {
  return {
    id: "version-12",
    skill_id: "skill-1",
    version: 12,
    body: "# Zephyr conventions",
    frontmatter: { name: "zephyr-conventions", description: "Kconfig house rules" },
    published_at: AT,
    published_by: "user-1",
    change_note: "Drop the legacy timer rule.",
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

/**
 * A draft version row.
 *
 * @param overrides - What differs from an unpublished zephyr-conventions draft.
 * @returns The row.
 */
export function draftRow(overrides: Partial<SkillVersion> = {}): SkillVersion {
  return versionRow({
    id: "draft-1",
    version: null,
    published_at: null,
    published_by: null,
    change_note: null,
    ...overrides,
  });
}

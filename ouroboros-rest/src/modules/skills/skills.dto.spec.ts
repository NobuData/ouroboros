import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  CreateSkillBody,
  MAX_STATS_DAYS,
  MoveSkillScopeBody,
  ReadSkillQuery,
  SkillSlugParams,
  SkillStatsQuery,
  UpdateSkillBody,
} from "./skills.dto";

/**
 * The skills routes' request shapes (#410), validated the way the pipe validates them — through
 * `class-transformer`, so a query string's strings are what the decorators judge.
 */

/**
 * Validate one value the way the pipe would.
 *
 * @param type - The DTO.
 * @param value - The plain value.
 * @returns The names of the failing properties.
 */
async function violations<T extends object>(
  type: new () => T,
  value: Record<string, unknown>,
): Promise<string[]> {
  return (await validate(plainToInstance(type, value))).map((failure) => failure.property);
}

describe("the slug", () => {
  it("is lower-case kebab, as V069's skills_slug_format", async () => {
    expect(await violations(SkillSlugParams, { slug: "hil-safety" })).toEqual([]);
    expect(await violations(SkillSlugParams, { slug: "HIL_safety" })).toEqual(["slug"]);
    expect(await violations(SkillSlugParams, { slug: "a".repeat(65) })).toEqual(["slug"]);
  });
});

describe("the version query", () => {
  it("reads a number from the query string, and refuses anything under 1", async () => {
    expect(await violations(ReadSkillQuery, { version: "12" })).toEqual([]);
    expect(await violations(ReadSkillQuery, { version: "0" })).toEqual(["version"]);
  });
});

describe("the create", () => {
  it("needs the document, and holds scope, repoRef and workflowId to their shapes", async () => {
    expect(await violations(CreateSkillBody, { text: "---\n---\n" })).toEqual([]);
    expect(await violations(CreateSkillBody, {})).toEqual(["text"]);
    expect(
      await violations(CreateSkillBody, {
        text: "x",
        scope: "galaxy",
        repoRef: "../etc",
        workflowId: "standard-fix",
      }),
    ).toEqual(["scope", "repoRef", "workflowId"]);
  });
});

describe("the patch", () => {
  it("admits any subset of the three switches", async () => {
    expect(await violations(UpdateSkillBody, {})).toEqual([]);
    expect(
      await violations(UpdateSkillBody, { enabled: false, required: true, draft: false }),
    ).toEqual([]);
  });

  it("refuses an explicit null, which is no switch position", async () => {
    expect(
      await violations(UpdateSkillBody, { enabled: null, required: null, draft: null }),
    ).toEqual(["enabled", "required", "draft"]);
  });
});

describe("the scope move", () => {
  it("needs the preview's 64-character token, and knows one resolution", async () => {
    const token = "a".repeat(64);

    expect(await violations(MoveSkillScopeBody, { scope: "org", previewToken: token })).toEqual([]);
    expect(
      await violations(MoveSkillScopeBody, {
        scope: "org",
        previewToken: token,
        resolve: "keep_both",
      }),
    ).toEqual([]);
    expect(
      await violations(MoveSkillScopeBody, {
        scope: "org",
        previewToken: "short",
        resolve: "overwrite",
      }),
    ).toEqual(["previewToken", "resolve"]);
  });
});

describe("the stats window", () => {
  it("is 1 to 365 days", async () => {
    expect(await violations(SkillStatsQuery, {})).toEqual([]);
    expect(await violations(SkillStatsQuery, { days: "30" })).toEqual([]);
    expect(await violations(SkillStatsQuery, { days: "0" })).toEqual(["days"]);
    expect(await violations(SkillStatsQuery, { days: String(MAX_STATS_DAYS + 1) })).toEqual([
      "days",
    ]);
  });
});

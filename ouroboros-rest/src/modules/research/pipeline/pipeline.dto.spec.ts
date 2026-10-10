import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  DraftEpicDto,
  FileIssuesDto,
  GenerateRoadmapDto,
  MAX_HINT_BYTES,
  MAX_SUGGESTION_LENGTH,
  RoadmapParams,
  SaveRoadmapSettingsDto,
  SuggestDto,
  SuggestionParams,
} from "./pipeline.dto";

/**
 * What the pipeline's routes accept (CM.5, #624), shape only.
 */

const ID = "5eed0091-0000-4000-8000-000000000124";

/** The properties a value fails on, validated as the global pipe validates. */
async function failures(type: new () => object, value: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errors.map((error) => error.property);
}

describe("the pipeline's requests", () => {
  it("takes uuids for the investigation and the suggestion", async () => {
    expect(await failures(RoadmapParams, { investigationId: ID })).toEqual([]);
    expect(await failures(RoadmapParams, { investigationId: "RS-124" })).toEqual([
      "investigationId",
    ]);
    expect(await failures(SuggestionParams, { investigationId: ID, suggestionId: ID })).toEqual([]);
    expect(await failures(SuggestionParams, { investigationId: ID, suggestionId: "1" })).toEqual([
      "suggestionId",
    ]);
  });

  it("drafts an epic with or without a named source", async () => {
    expect(await failures(DraftEpicDto, {})).toEqual([]);
    expect(await failures(DraftEpicDto, { targetSourceId: ID })).toEqual([]);
    expect(await failures(DraftEpicDto, { targetSourceId: "github" })).toEqual(["targetSourceId"]);
    expect(await failures(DraftEpicDto, { epicName: "Docking" })).toEqual(["epicName"]);
  });

  it.each(["docs/ROADMAP.md", "ROADMAP.md", "a/b/c/roadmap-q4.md"])(
    "writes a roadmap to %s",
    async (path) => {
      expect(await failures(GenerateRoadmapDto, { path })).toEqual([]);
    },
  );

  it.each([
    "/docs/ROADMAP.md",
    "docs/../ROADMAP.md",
    "./ROADMAP.md",
    "docs//ROADMAP.md",
    "docs/road map.md",
    "",
    7,
    `${"a/".repeat(260)}x`,
  ])("refuses to write a roadmap to %p", async (path) => {
    expect(await failures(GenerateRoadmapDto, { path })).toEqual(["path"]);
  });

  it("generates with nothing said, and refuses a field it does not take", async () => {
    expect(await failures(GenerateRoadmapDto, {})).toEqual([]);
    expect(await failures(GenerateRoadmapDto, { targetSourceId: "x" })).toEqual(["targetSourceId"]);
    expect(await failures(GenerateRoadmapDto, { title: "Mine" })).toEqual(["title"]);
  });

  it("takes a suggestion's words, trimmed, and an optional object hint", async () => {
    expect(await failures(SuggestDto, { text: "Pull #744 into MVP." })).toEqual([]);
    expect(plainToInstance(SuggestDto, { text: "  Pull it in.  " }).text).toBe("Pull it in.");
    expect(
      await failures(SuggestDto, { text: "x", hint: { item: "dock-gust", to: true } }),
    ).toEqual([]);
  });

  it.each([
    ["no text", {}, "text"],
    ["blank text", { text: "   " }, "text"],
    ["text over the bound", { text: "x".repeat(MAX_SUGGESTION_LENGTH + 1) }, "text"],
    ["text that is not a string", { text: 7 }, "text"],
    ["a hint that is a list", { text: "x", hint: ["a"] }, "hint"],
    ["a hint that is a string", { text: "x", hint: "mvp" }, "hint"],
    ["a hint over 8 KiB", { text: "x", hint: { note: "x".repeat(MAX_HINT_BYTES) } }, "hint"],
  ])("refuses a suggestion with %s", async (_name, body, property) => {
    expect(await failures(SuggestDto, body)).toEqual([property]);
  });

  it("takes a suggestion exactly at the bound", async () => {
    expect(await failures(SuggestDto, { text: "x".repeat(MAX_SUGGESTION_LENGTH) })).toEqual([]);
  });

  it("files with or without pushUnsized, which is a boolean", async () => {
    expect(await failures(FileIssuesDto, {})).toEqual([]);
    expect(await failures(FileIssuesDto, { pushUnsized: true })).toEqual([]);
    expect(await failures(FileIssuesDto, { pushUnsized: "yes" })).toEqual(["pushUnsized"]);
  });

  it("needs the policy said outright", async () => {
    expect(await failures(SaveRoadmapSettingsDto, { directCommit: false })).toEqual([]);
    expect(await failures(SaveRoadmapSettingsDto, {})).toEqual(["directCommit"]);
    expect(await failures(SaveRoadmapSettingsDto, { directCommit: "on" })).toEqual([
      "directCommit",
    ]);
  });
});

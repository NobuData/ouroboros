import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  ListInvestigationsQuery,
  MAX_QUESTION_LENGTH,
  PatchResearchSettingsDto,
  STATUS_FILTERS,
  StartInvestigationDto,
} from "./lifecycle.dto";

/**
 * What the lifecycle routes accept (CM.6, #625), shape only — whether a kind or tool exists is
 * the service's to say.
 */

/** The properties a value fails on, validated as the global pipe validates. */
async function failures(type: new () => object, value: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("the start request", () => {
  const body = {
    question: "Autonomous docking vs. the field",
    kind: "gap_analysis",
    depth: "deep_dive",
    tools: ["web", "competitor"],
  };

  it("accepts the composer's payload, with or without tools", async () => {
    expect(await failures(StartInvestigationDto, body)).toEqual([]);
    expect(await failures(StartInvestigationDto, { ...body, tools: undefined })).toEqual([]);
  });

  it("trims the question", () => {
    expect(plainToInstance(StartInvestigationDto, { ...body, question: "  why?  " }).question).toBe(
      "why?",
    );
  });

  it.each([
    ["a missing question", { question: undefined }],
    ["a blank question", { question: "   " }],
    ["a question that is not text", { question: 42 }],
    ["a question past the limit", { question: "x".repeat(MAX_QUESTION_LENGTH + 1) }],
  ])("refuses %s", async (_name, change) => {
    expect(await failures(StartInvestigationDto, { ...body, ...change })).toEqual(["question"]);
  });

  it("accepts a question at the limit", async () => {
    expect(
      await failures(StartInvestigationDto, { ...body, question: "x".repeat(MAX_QUESTION_LENGTH) }),
    ).toEqual([]);
  });

  it.each([
    ["kind", { kind: "Gap Analysis" }],
    ["kind", { kind: undefined }],
    ["depth", { depth: "bottomless" }],
    ["depth", { depth: undefined }],
    ["tools", { tools: [] }],
    ["tools", { tools: ["web", "web"] }],
    ["tools", { tools: ["Web Search"] }],
    ["tools", { tools: "web" }],
    ["tools", { tools: null }],
  ])("refuses a bad %s (%j)", async (property, change) => {
    expect(await failures(StartInvestigationDto, { ...body, ...change })).toEqual([property]);
  });

  it("refuses a field it does not know — a caller cannot set status or origin", async () => {
    expect(await failures(StartInvestigationDto, { ...body, status: "brief_ready" })).toEqual([
      "status",
    ]);
  });
});

describe("the list query", () => {
  it("accepts no filters, and every filter together with a page", async () => {
    expect(await failures(ListInvestigationsQuery, {})).toEqual([]);
    expect(
      await failures(ListInvestigationsQuery, {
        kind: "gap_analysis",
        status: "brief_ready",
        quarter: "2026-Q4",
        limit: "10",
        offset: "20",
      }),
    ).toEqual([]);
  });

  it("accepts every status, and `active`", async () => {
    expect(STATUS_FILTERS).toEqual([
      "active",
      "queued",
      "running",
      "brief_ready",
      "issues_filed",
      "failed",
      "cancelled",
    ]);
    for (const status of STATUS_FILTERS) {
      expect(await failures(ListInvestigationsQuery, { status })).toEqual([]);
    }
  });

  it("accepts `current` as the quarter", async () => {
    expect(await failures(ListInvestigationsQuery, { quarter: "current" })).toEqual([]);
  });

  it.each([
    ["kind", { kind: "Gap" }],
    ["status", { status: "done" }],
    ["status", { status: ["queued", "running"] }],
    ["quarter", { quarter: "Q4" }],
    ["quarter", { quarter: "2026-Q5" }],
    ["limit", { limit: "0" }],
    ["limit", { limit: "101" }],
    ["offset", { offset: "-1" }],
  ])("refuses a bad %s (%j)", async (property, query) => {
    expect(await failures(ListInvestigationsQuery, query)).toEqual([property]);
  });
});

describe("the settings patch", () => {
  it("accepts either role, and an empty body", async () => {
    expect(await failures(PatchResearchSettingsDto, { startRole: "member" })).toEqual([]);
    expect(await failures(PatchResearchSettingsDto, { startRole: "admin" })).toEqual([]);
    expect(await failures(PatchResearchSettingsDto, {})).toEqual([]);
  });

  it.each(["viewer", "owner", "", null, 1])("refuses %p as the starter role", async (startRole) => {
    expect(await failures(PatchResearchSettingsDto, { startRole })).toEqual(["startRole"]);
  });
});

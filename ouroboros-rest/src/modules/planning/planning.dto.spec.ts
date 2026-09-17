import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import {
  BatchParams,
  CreateBatchBody,
  CreateEpicBody,
  DraftParams,
  EpicTicketsBody,
  MAX_DRAFT_DEPENDENCIES,
  MAX_TICKET_SEARCH_LENGTH,
  MAX_DRAFT_TITLE_LENGTH,
  PatchDraftBody,
  ReorderEpicsBody,
  TicketSearchQuery,
  UpdateEpicBody,
} from "./planning.dto";

/**
 * What the pipe refuses before the planning services run (AL.4, #280): shapes the database or the
 * plan contract would refuse become a `422` naming the field.
 */

const SOURCE = "5eed001a-0000-4000-8000-000000000001";
const UUID = "5eed0280-0000-4000-8000-0000000000b1";

/**
 * Validate a value the way the pipe does.
 *
 * @param type - The DTO class.
 * @param value - What a client sent.
 * @returns The property names that failed.
 */
function offenders<T extends object>(type: new () => T, value: unknown): string[] {
  return validateSync(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);
}

describe("CreateBatchBody", () => {
  it("accepts the generator card's body, and a narrative-only one", () => {
    expect(
      offenders(CreateBatchBody, {
        prompt: "OTA updates that survive power loss.",
        outline: "- Partition table  blocks: OTA-3",
        targetSourceId: SOURCE,
        milestone: "Helios 2.1",
        epicId: UUID,
        autoSize: true,
        queueSmall: false,
        localKeyPrefix: "OTA",
      }),
    ).toEqual([]);
    expect(
      offenders(CreateBatchBody, {
        prompt: "OTA updates.",
        outline: null,
        milestone: null,
        targetSourceId: SOURCE,
      }),
    ).toEqual([]);
  });

  it.each([
    ["a blank prompt", { prompt: " " }, "prompt"],
    ["an untrimmed prompt", { prompt: " OTA " }, "prompt"],
    ["a prompt longer than the plan contract", { prompt: "a".repeat(16_385) }, "prompt"],
    ["an outline longer than the plan contract", { outline: "a".repeat(32_769) }, "outline"],
    ["a target that is not a uuid", { targetSourceId: "github" }, "targetSourceId"],
    ["a blank milestone", { milestone: "" }, "milestone"],
    ["a toggle that is not a boolean", { autoSize: "yes" }, "autoSize"],
    ["a lower-case prefix", { localKeyPrefix: "ota" }, "localKeyPrefix"],
    ["a field nobody declared", { planner: "llm-v1" }, "planner"],
  ])("refuses %s", (_name, override, field) => {
    expect(
      offenders(CreateBatchBody, { prompt: "OTA", targetSourceId: SOURCE, ...override }),
    ).toEqual([field]);
  });
});

describe("PatchDraftBody", () => {
  it("accepts a selection, an edit, a cleared body and a blocked-by set", () => {
    expect(offenders(PatchDraftBody, { selected: false })).toEqual([]);
    expect(offenders(PatchDraftBody, { title: "Rollback", body: null })).toEqual([]);
    expect(offenders(PatchDraftBody, { dependencies: ["OTA-5"] })).toEqual([]);
    expect(offenders(PatchDraftBody, { dependencies: [] })).toEqual([]);
  });

  it.each([
    ["a title past the column", { title: "a".repeat(MAX_DRAFT_TITLE_LENGTH + 1) }, "title"],
    ["a blank title", { title: "" }, "title"],
    ["a repeated dependency", { dependencies: ["OTA-5", "OTA-5"] }, "dependencies"],
    [
      "too many dependencies",
      {
        dependencies: Array.from(
          { length: MAX_DRAFT_DEPENDENCIES + 1 },
          (_, i) => `OTA-${String(i + 1)}`,
        ),
      },
      "dependencies",
    ],
    ["a dependency that is not a key", { dependencies: ["OTA 5"] }, "dependencies"],
    ["a provenance, which is the server's to set", { provenance: "planned" }, "provenance"],
  ])("refuses %s", (_name, body, field) => {
    expect(offenders(PatchDraftBody, body)).toEqual([field]);
  });
});

describe("route parameters", () => {
  it("holds a batch to a uuid and a key to the local-key shape", () => {
    expect(offenders(BatchParams, { batch: UUID })).toEqual([]);
    expect(offenders(BatchParams, { batch: "OTA" })).toEqual(["batch"]);
    expect(offenders(DraftParams, { batch: UUID, key: "OTA-3" })).toEqual([]);
    expect(offenders(DraftParams, { batch: UUID, key: "../OTA" })).toEqual(["key"]);
  });
});

describe("epic bodies", () => {
  it("accepts a lane and an unscoped one", () => {
    expect(
      offenders(CreateEpicBody, {
        name: "OTA hardening",
        tint: "accent",
        status: "active",
        startMonth: "2026-07",
        endMonth: "2026-09",
        roadmapName: "Helios 2.1",
        roadmapWindow: "Q3–Q4 2026",
      }),
    ).toEqual([]);
    expect(
      offenders(UpdateEpicBody, { status: "unscoped", startMonth: null, endMonth: null }),
    ).toEqual([]);
  });

  it.each([
    ["a tint outside V036's five", { tint: "purple" }, "tint"],
    ["a status outside V036's four", { status: "archived" }, "status"],
    ["a day rather than a month", { startMonth: "2026-07-01" }, "startMonth"],
    ["a thirteenth month", { endMonth: "2026-13" }, "endMonth"],
  ])("refuses %s", (_name, override, field) => {
    expect(offenders(CreateEpicBody, { name: "Lane", ...override })).toEqual([field]);
  });

  it("requires a name to create a lane, not to edit one", () => {
    expect(offenders(CreateEpicBody, {})).toEqual(["name"]);
    expect(offenders(UpdateEpicBody, {})).toEqual([]);
  });

  it("holds reorders and links to non-empty lists of distinct uuids", () => {
    expect(offenders(ReorderEpicsBody, { epicIds: [UUID] })).toEqual([]);
    expect(offenders(ReorderEpicsBody, { epicIds: [] })).toEqual(["epicIds"]);
    expect(offenders(EpicTicketsBody, { ticketIds: [UUID, UUID] })).toEqual(["ticketIds"]);
    expect(offenders(EpicTicketsBody, { ticketIds: ["612"] })).toEqual(["ticketIds"]);
  });
});

describe("TicketSearchQuery", () => {
  it("takes an optional term, bounded", () => {
    expect(offenders(TicketSearchQuery, {})).toEqual([]);
    expect(offenders(TicketSearchQuery, { q: "#548" })).toEqual([]);
    expect(offenders(TicketSearchQuery, { q: "x".repeat(MAX_TICKET_SEARCH_LENGTH + 1) })).toEqual([
      "q",
    ]);
    expect(offenders(TicketSearchQuery, { q: "ota", limit: "5" })).toEqual(["limit"]);
  });
});

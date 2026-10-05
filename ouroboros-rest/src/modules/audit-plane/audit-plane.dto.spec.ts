import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { AuditExportQuery, AuditPlaneQuery, AuditTodayQuery } from "./audit-plane.dto";

/** The audit plane's query strings (#486): shapes refused by the pipe, with readable messages. */
async function refusalsOf<T extends object>(
  type: new () => T,
  query: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, query));
  return errors.map((error) => error.property).sort();
}

describe("the audit plane's query", () => {
  it("accepts an empty one — the newest page", async () => {
    await expect(refusalsOf(AuditPlaneQuery, {})).resolves.toEqual([]);
  });

  it("accepts every filter together", async () => {
    await expect(
      refusalsOf(AuditPlaneQuery, {
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-06T00:00:00.000+02:00",
        actorKind: "service",
        actorId: "5eed0003-0000-4000-8000-000000000001",
        actorService: "ouroboros-app",
        action: "policy.*",
        ref: "pr:509",
        cursor: "eyJhdCI6IngifQ",
        limit: "200",
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    ["from", { from: "yesterday" }],
    ["to", { to: "2026-10-06" + "T25:00:00Z" }],
    ["actorKind", { actorKind: "user" }],
    ["actorId", { actorId: "x".repeat(129) }],
    ["actorService", { actorService: "Devops Bot" }],
    ["action", { action: "policy" }],
    ["ref", { ref: "509" }],
    ["limit", { limit: "201" }],
    ["limit", { limit: "0" }],
    ["cursor", { cursor: "x".repeat(257) }],
  ])("refuses a malformed %s", async (field, query) => {
    await expect(refusalsOf(AuditPlaneQuery, query)).resolves.toEqual([field]);
  });

  it("takes the export's filters — the range's presence is the service's check", async () => {
    await expect(refusalsOf(AuditExportQuery, {})).resolves.toEqual([]);
    await expect(refusalsOf(AuditExportQuery, { from: "soon" })).resolves.toEqual(["from"]);
  });

  it("takes an IANA zone and a line count for the today view", async () => {
    await expect(refusalsOf(AuditTodayQuery, { tz: "Europe/Berlin", limit: "5" })).resolves.toEqual(
      [],
    );
    await expect(refusalsOf(AuditTodayQuery, { tz: "Mars/Olympus" })).resolves.toEqual(["tz"]);
    await expect(refusalsOf(AuditTodayQuery, { limit: "51" })).resolves.toEqual(["limit"]);
  });
});

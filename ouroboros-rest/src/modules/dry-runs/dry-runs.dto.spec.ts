import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  DryRunCandidatesQuery,
  DryRunParams,
  DryRunWorkflowParams,
  MAX_CANDIDATE_LIMIT,
  StartDryRunBody,
} from "./dry-runs.dto";

const WORKFLOW = "5eed0089-0000-4000-8000-000000000001";
const TICKET = "5eed0088-0000-4000-8000-000000000489";
const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";

async function problems(instance: object): Promise<string[]> {
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((error) => error.property);
}

describe("the dry-run DTOs", () => {
  it("accepts a start naming a ticket and a draft revision, with or without a session", async () => {
    expect(
      await problems(plainToInstance(StartDryRunBody, { ticketId: TICKET, draftRev: 3 })),
    ).toEqual([]);
    expect(
      await problems(
        plainToInstance(StartDryRunBody, { ticketId: TICKET, draftRev: 0, sessionId: DRY_RUN }),
      ),
    ).toEqual([]);
  });

  it("refuses a start without a ticket, without a revision, or with either malformed", async () => {
    expect(await problems(plainToInstance(StartDryRunBody, {}))).toEqual(["ticketId", "draftRev"]);
    expect(
      await problems(plainToInstance(StartDryRunBody, { ticketId: "#489", draftRev: 3 })),
    ).toEqual(["ticketId"]);
    expect(
      await problems(plainToInstance(StartDryRunBody, { ticketId: TICKET, draftRev: -1 })),
    ).toEqual(["draftRev"]);
    expect(
      await problems(plainToInstance(StartDryRunBody, { ticketId: TICKET, draftRev: 1.5 })),
    ).toEqual(["draftRev"]);
    expect(
      await problems(
        plainToInstance(StartDryRunBody, { ticketId: TICKET, draftRev: 3, sessionId: "latest" }),
      ),
    ).toEqual(["sessionId"]);
    expect(
      await problems(
        plainToInstance(StartDryRunBody, { ticketId: TICKET, draftRev: 3, budgetCents: 1 }),
      ),
    ).toEqual(["budgetCents"]);
  });

  it("holds both path ids to uuids, so `candidates` is never a dry run's id", async () => {
    expect(await problems(plainToInstance(DryRunWorkflowParams, { id: WORKFLOW }))).toEqual([]);
    expect(await problems(plainToInstance(DryRunWorkflowParams, { id: "security-patch" }))).toEqual(
      ["id"],
    );
    expect(
      await problems(plainToInstance(DryRunParams, { id: WORKFLOW, dryRunId: DRY_RUN })),
    ).toEqual([]);
    expect(
      await problems(plainToInstance(DryRunParams, { id: WORKFLOW, dryRunId: "candidates" })),
    ).toEqual(["dryRunId"]);
  });

  it("bounds the picker's limit and reads it from a query string", async () => {
    expect(await problems(plainToInstance(DryRunCandidatesQuery, {}))).toEqual([]);
    const parsed = plainToInstance(DryRunCandidatesQuery, { limit: "5" });
    expect(await problems(parsed)).toEqual([]);
    expect(parsed.limit).toBe(5);
    expect(await problems(plainToInstance(DryRunCandidatesQuery, { limit: "0" }))).toEqual([
      "limit",
    ]);
    expect(
      await problems(
        plainToInstance(DryRunCandidatesQuery, { limit: String(MAX_CANDIDATE_LIMIT + 1) }),
      ),
    ).toEqual(["limit"]);
  });
});

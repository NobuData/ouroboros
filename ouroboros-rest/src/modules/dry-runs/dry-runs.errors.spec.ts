import { HttpStatus } from "@nestjs/common";

import {
  DRY_RUN_ERRORS,
  dryRunDraftStale,
  dryRunInProgress,
  dryRunNotFound,
  dryRunNotRunning,
  dryRunRepositoryUnresolved,
  dryRunSessionMismatch,
  dryRunSourceUnsupported,
  dryRunTicketNotFound,
} from "./dry-runs.errors";

describe("the dry-run errors", () => {
  it("answers a missing dry run and a missing ticket as 404s naming what was asked for", () => {
    expect(dryRunNotFound("r-1").getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(dryRunNotFound("r-1").details).toEqual({ dryRunId: "r-1" });
    expect(dryRunTicketNotFound("t-1").getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(dryRunTicketNotFound("t-1").code).toBe(DRY_RUN_ERRORS.ticketNotFound);
  });

  it("answers a moved draft, an open run and an ended run as 409s a client can act on", () => {
    const stale = dryRunDraftStale(2, 3);
    expect(stale.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(stale.details).toEqual({ requestedDraftRev: 2, currentDraftRev: 3 });

    expect(dryRunInProgress("r-1").getStatus()).toBe(HttpStatus.CONFLICT);
    expect(dryRunInProgress("r-1").details).toEqual({ dryRunId: "r-1" });

    const ended = dryRunNotRunning("r-1", "budget_stopped");
    expect(ended.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(ended.message).toBe(
      "This dry run is already budget stopped; there is nothing to cancel.",
    );
    expect(ended.details).toEqual({ dryRunId: "r-1", status: "budget_stopped" });
  });

  it("answers a ticket it cannot run against, and a session about something else, as 422s", () => {
    const unresolved = dryRunRepositoryUnresolved("SUP-1");
    expect(unresolved.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(unresolved.message).toContain("SUP-1 names no repository");

    const unsupported = dryRunSourceUnsupported("SUP-1", "custom");
    expect(unsupported.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(unsupported.details).toEqual({ ticket: "SUP-1", source: "custom" });

    expect(dryRunSessionMismatch("s-1").getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(dryRunSessionMismatch("s-1").details).toEqual({ sessionId: "s-1" });
  });

  it("documents every code once", () => {
    const codes = Object.values(DRY_RUN_ERRORS);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^dry_run_[a-z_]+$/);
  });
});

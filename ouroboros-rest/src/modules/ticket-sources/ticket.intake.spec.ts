import { Logger } from "@nestjs/common";

import { LoggingTicketIntake, TICKET_INTAKE, type EstimableTicket } from "./ticket.intake";

/**
 * The port ([#139](https://github.com/NobuData/ouroboros/issues/139)) and the placeholder bound
 * to it.
 *
 * The interesting claim is the one in `ticket.intake.ts`'s header: the handoff exists, it is
 * exercised, and what receives it **says out loud** that nothing was queued — because the
 * estimation pipeline is keyed on `github_issues.id` and a canonical `tickets.id` handed to it
 * would be a log full of misses rather than a pipeline doing work. A placeholder that was
 * silent would make this release look like it had wired something up.
 */

/** One ticket for the handoff. */
function estimable(overrides: Partial<EstimableTicket> = {}): EstimableTicket {
  return {
    organizationId: "org-sources",
    ticketId: "5eed0031-0000-0000-0000-000000000001",
    sourceId: "b0390000-0000-0000-0000-00000000000a",
    sourceKind: "github",
    externalKey: "#485",
    reason: "imported",
    ...overrides,
  };
}

/** Everything written to the logger during `work`, as one string. */
async function transcriptOf(work: () => Promise<unknown>): Promise<string> {
  const lines: unknown[] = [];
  const spy = jest.spyOn(Logger.prototype, "log").mockImplementation((...args: unknown[]) => {
    lines.push(...args);

    return undefined;
  });

  try {
    await work();
  } finally {
    spy.mockRestore();
  }

  return lines.join("\n");
}

describe("the canonical ticket handoff", () => {
  it("carries the display key rather than the identity, for a log a person can follow", () => {
    // `#485` is what somebody pastes into a tracker's search box; `485` and a Linear uuid are
    // not. V030 split the two columns for exactly this.
    expect(estimable().externalKey).toBe("#485");
  });

  it("is keyed on tickets.id, which is what makes it a second port", () => {
    // `backlog-sync/estimation.intake.ts` carries `githubRepoId`, a numeric `number` and a
    // `github_issues.id`. None of the three exists here, which is the whole reason this port
    // could not be the same one.
    expect(Object.keys(estimable()).sort()).toStrictEqual([
      "externalKey",
      "organizationId",
      "reason",
      "sourceId",
      "sourceKind",
      "ticketId",
    ]);
  });
});

describe("LoggingTicketIntake", () => {
  it("says how many tickets would be estimated, and that none were", async () => {
    // The gap, made legible from a running process. An operator who turns this loop on with a
    // provider registered should be able to see that the tickets landed and where they
    // stopped — which is a more honest description of this build than a queue that accepted
    // them and did nothing.
    const transcript = await transcriptOf(async () =>
      new LoggingTicketIntake().accept([estimable(), estimable({ reason: "reopened" })]),
    );

    expect(transcript).toContain("2 canonical ticket(s) ready to estimate");
    expect(transcript).toContain("1 new, 1 reopened");
    expect(transcript).toContain("nothing was queued");
    expect(transcript).toContain("#140");
  });

  it("says nothing about an empty batch, which is most cycles", async () => {
    const transcript = await transcriptOf(async () => new LoggingTicketIntake().accept([]));

    expect(transcript).toBe("");
  });

  it("resolves rather than throwing, so a committed sync is never lost to it", async () => {
    await transcriptOf(async () =>
      expect(new LoggingTicketIntake().accept([estimable()])).resolves.toBeUndefined(),
    );
  });

  it("is bound under a token, so Q.3 re-points it by changing one provide", () => {
    expect(TICKET_INTAKE).toBe("TICKET_INTAKE");
  });
});

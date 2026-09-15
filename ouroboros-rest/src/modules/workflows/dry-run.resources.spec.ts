import { dryRunTicket, workflowDryRun } from "./dry-run.resources";

/**
 * The ticket a stored issue makes, and the answer a walk makes — pure functions over values.
 */

describe("dryRunTicket", () => {
  it("keys the ticket the way every explanation names it, from GitHub", () => {
    expect(dryRunTicket({ number: 485, labels: ["bug", "i2c"], effort: "m" })).toEqual({
      externalKey: "#485",
      source: "github",
      labels: ["bug", "i2c"],
      estimate: { effort: "m" },
    });
  });

  it("states an unsized issue as a null estimate, which satisfies no effort comparison", () => {
    expect(dryRunTicket({ number: 12, labels: [], effort: null }).estimate).toBeNull();
  });
});

describe("workflowDryRun", () => {
  const TICKET = dryRunTicket({ number: 485, labels: [], effort: "m" });

  it("echoes the ticket beside the walk, which it relays verbatim", () => {
    const steps = [
      {
        nodeId: "issue-queued",
        type: "trigger",
        title: "Issue queued",
        verdict: "matched" as const,
        annotation: "Starts a run.",
        evaluation: null,
        edges: [],
      },
    ];
    const verdicts = [
      { nodeId: "issue-queued", verdict: "matched" as const, explanation: "Fires." },
    ];
    const highlightPath = [{ from: "issue-queued", to: "analyze" }];

    const answer = workflowDryRun(TICKET, { findings: [], steps, verdicts, highlightPath });

    expect(answer.ticket).toBe(TICKET);
    expect(answer.steps).toBe(steps);
    expect(answer.verdicts).toBe(verdicts);
    expect(answer.highlightPath).toBe(highlightPath);
  });

  it("gives every finding the engine as its source, keeping each anchor it had", () => {
    const answer = workflowDryRun(TICKET, {
      findings: [
        { code: "a", message: "Anchored to a node.", node: "plan", path: "/nodes/3" },
        { code: "b", message: "Anchored to an edge.", edge: { from: "plan", to: "implement" } },
      ],
      steps: [],
      verdicts: [],
      highlightPath: [],
    });

    expect(answer.findings).toEqual([
      {
        source: "engine",
        code: "a",
        message: "Anchored to a node.",
        node: "plan",
        path: "/nodes/3",
      },
      {
        source: "engine",
        code: "b",
        message: "Anchored to an edge.",
        edge: { from: "plan", to: "implement" },
      },
    ]);
  });
});

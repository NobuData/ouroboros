import type { SuggestionRow } from "./actions.repository";
import { ticketDraftOf } from "./ticket.drafts";

/**
 * A suggestion as a ticket draft (BV.5, #514): the evidence line and resolvable references go into
 * the body, and a spike states its uncertainty instead of asserting an impact.
 */

/** A ticket suggestion, as the actions read it. */
function suggestion(overrides: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    id: "5eed0067-0000-4000-8000-000000000021",
    repo_ref: "acme-robotics/helios-firmware",
    kind: "ticket_draft",
    title: "Refactor tests/ota fixtures — image server times out under load",
    evidence_line: "61.8% of OTA suite failures share one fixture timeout signature (47 builds)",
    confidence: 84,
    impact: null,
    needs_spike: false,
    action_binding: { plane: "planning", change: { ticket: "fixture_timeout_ticket" } },
    status: "open",
    last_run_id: "5eed0065-0000-4000-8000-000000000002",
    evidence_refs: [
      { kind: "test_run", id: "5eed0040-0000-4000-8000-000000000002" },
      { kind: "build", id: "5eed0028-0000-4000-8000-000000000479" },
    ],
    ...overrides,
  };
}

describe("a ticket draft", () => {
  it("carries the evidence line and every reference, sorted, with its provenance", () => {
    const draft = ticketDraftOf(suggestion(), 1);

    expect(draft.localKey).toBe("BA-1");
    expect(draft.title).toBe("Refactor tests/ota fixtures — image server times out under load");
    expect(draft.body).toContain(
      "**Evidence:** 61.8% of OTA suite failures share one fixture timeout signature (47 builds)",
    );
    expect(draft.body.indexOf("- build `5eed0028")).toBeLessThan(
      draft.body.indexOf("- test_run `5eed0040"),
    );
    expect(draft.body).toContain("confidence 84%");
    expect(draft.body).toContain("analysis run `5eed0065-0000-4000-8000-000000000002`");
  });
});

describe("a spike draft", () => {
  it("drafts an investigation that states the uncertainty and asserts no estimate", () => {
    const draft = ticketDraftOf(
      suggestion({
        kind: "build_process",
        title: "Link zephyr.elf incrementally (partial link cache)",
        needs_spike: true,
        impact: {
          estimate: null,
          unit: "seconds",
          applies_to: "per build",
          basis: {
            method: "unquantified",
            description: "not computable — the finding does not carry step_seconds_delta",
            formula: "link_cache v1",
            inputs: {},
            window: { from: "2026-06-01", to: "2026-08-29", days: 90 },
            calibration: {
              analyzer: "workflow_outcome",
              impact_class: "build_duration",
              factor: 1,
            },
            raw: null,
          },
        },
      }),
      2,
    );

    expect(draft.title).toBe("Spike: Link zephyr.elf incrementally (partial link cache)");
    expect(draft.body).toContain("asserts no impact");
    expect(draft.body).toContain(
      "**What is uncertain:** not computable — the finding does not carry step_seconds_delta.",
    );
    expect(draft.body).not.toMatch(/-\d+\s*s\b/);
  });
});

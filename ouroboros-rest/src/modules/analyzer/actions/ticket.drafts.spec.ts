import type { SuggestionRow } from "./actions.repository";
import { draftEvidence, ticketDraftOf } from "./ticket.drafts";

/**
 * A suggestion as a ticket draft (BV.5, #514): the evidence line and resolvable references go into
 * the body, and a spike states its uncertainty instead of asserting an impact. And the way back
 * (BW.4, #519): what the body says its evidence is, read as it stands now.
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

describe("a draft's evidence, read back from its body", () => {
  const BUILD = { kind: "build", id: "5eed0028-0000-4000-8000-000000000479" };
  const TEST_RUN = { kind: "test_run", id: "5eed0040-0000-4000-8000-000000000002" };

  it("is what the composer wrote: the line, and the references in the body's order", () => {
    expect(draftEvidence(ticketDraftOf(suggestion(), 1).body)).toEqual({
      line: "61.8% of OTA suite failures share one fixture timeout signature (47 builds)",
      refs: [BUILD, TEST_RUN],
    });
  });

  it("reads a spike's, under what the spike says first", () => {
    const spike = ticketDraftOf(suggestion({ kind: "build_process", needs_spike: true }), 2);

    expect(spike.body.startsWith("**Investigate before building.**")).toBe(true);
    expect(draftEvidence(spike.body)).toEqual({
      line: "61.8% of OTA suite failures share one fixture timeout signature (47 builds)",
      refs: [BUILD, TEST_RUN],
    });
  });

  it("reads a merge's commit sha, whole or abbreviated", () => {
    const merged = suggestion({
      evidence_refs: [
        { kind: "merge", id: "63863e5" },
        { kind: "merge", id: "63863e5a1b2c3d4e5f60718293a4b5c6d7e8f901" },
      ],
    });

    expect(draftEvidence(ticketDraftOf(merged, 1).body).refs).toEqual([
      { kind: "merge", id: "63863e5" },
      { kind: "merge", id: "63863e5a1b2c3d4e5f60718293a4b5c6d7e8f901" },
    ]);
  });

  it("has no references when the findings carried none", () => {
    const body = ticketDraftOf(suggestion({ evidence_refs: [] }), 1).body;

    expect(body).toContain("- (the cited findings carry no references)");
    expect(draftEvidence(body).refs).toEqual([]);
  });

  it("has neither for a body somebody rewrote, and for a draft with no body", () => {
    expect(draftEvidence("Please look at the OTA fixtures.\n\nThanks.")).toEqual({
      line: null,
      refs: [],
    });
    expect(draftEvidence(null)).toEqual({ line: null, refs: [] });
    expect(draftEvidence("**Evidence:**   ")).toEqual({ line: null, refs: [] });
  });

  it("keeps what an edit kept: text added around the line and the list", () => {
    const body = [
      "Context from the on-call: this bit us twice last week.",
      "",
      "**Evidence:** 31 builds share one signature  ",
      "",
      "**References:**",
      `- build \`${BUILD.id}\``,
      "- see also the runbook",
      `- test_run \`${TEST_RUN.id}\`   `,
      "",
      `- build \`5eed0028-0000-4000-8000-000000000480\``,
    ].join("\r\n");

    expect(draftEvidence(body)).toEqual({
      line: "31 builds share one signature",
      // The list ends at the first blank line; prose inside it is not a reference.
      refs: [BUILD, TEST_RUN],
    });
  });

  it("lists a reference once however often the body repeats it", () => {
    const body = ["**References:**", `- build \`${BUILD.id}\``, `- build \`${BUILD.id}\``].join(
      "\n",
    );

    expect(draftEvidence(body).refs).toEqual([BUILD]);
  });

  it.each([
    ["an id that is not a uuid", "- build `not-an-id`"],
    ["a uuid with something after it", "- build `5eed0028-0000-4000-8000-000000000479'; --`"],
    ["a sha on a kind that is not a merge", "- build `63863e5`"],
    ["a uuid where a merge wants a sha", "- merge `5eed0028-0000-4000-8000-000000000479`"],
    ["a kind that is not a word", "- Build Job `5eed0028-0000-4000-8000-000000000479`"],
    ["an id outside its backticks", "- build 5eed0028-0000-4000-8000-000000000479"],
  ])("never reads %s as a reference", (_what, entry) => {
    expect(draftEvidence(["**References:**", entry].join("\n")).refs).toEqual([]);
  });

  it("reads only the list under the heading, not look-alike lines elsewhere", () => {
    const body = [`- build \`${BUILD.id}\``, "", "**Evidence:** something"].join("\n");

    expect(draftEvidence(body)).toEqual({ line: "something", refs: [] });
  });
});

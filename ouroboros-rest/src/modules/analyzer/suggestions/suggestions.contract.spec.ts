import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import { previewResource } from "../actions/actions.resources";
import type { ActionPlan } from "../actions/bindings";
import { resolvedEvidence } from "../duration/duration.fixture";
import {
  calibrationRow,
  composedRun,
  findingRow,
  FORGE_02_ID,
  HELIOS,
  measurementRow,
  POOL_A_ID,
  RUNNER_MOVE_ID,
  suggestionRow,
} from "./suggestions.fixture";
import { emptySuggestions, suggestionsResource } from "./suggestions.resources";

/**
 * `GET /api/v1/analyzer/suggestions` answers what `openapi.yaml` documents (BW.3, #518) — an open
 * row with its bases and findings, an applied one, a dismissed one, a row an older composer wrote,
 * and the empty read — held to the `AnalysisSuggestions` schema the UI's client is generated from.
 * So is the preview's workflow delta, which BW.3 added to `SuggestionPreview`.
 */

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns The compiled validator.
 */
function validator(name: string) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });
  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

/** What the fixture's references name — one of them a row retention has removed. */
const RESOLVED = resolvedEvidence({
  runnerPools: [{ id: POOL_A_ID, name: "pool-a" }],
  runners: [],
  testCases: [
    {
      id: "5eed0033-0000-4000-8000-000000000001",
      run_id: "5eed0009-0000-4000-8000-000000000479",
      attempt_seq: 3,
      suite: "telemetry integration",
      name: "ring buffer drains under burst",
    },
  ],
});

describe("the suggestion cards' read, against its documented schema", () => {
  it("documents open, applied, dismissed and drafted rows as sent", () => {
    const at = new Date("2026-08-08T12:00:00Z");
    const body = suggestionsResource(
      HELIOS,
      composedRun(),
      [
        suggestionRow(),
        suggestionRow({
          id: "5eed0067-0000-4000-8000-000000000012",
          status: "applied",
          resolved_at: at,
          resolved_by_name: "Ken Suenobu",
        }),
        suggestionRow({
          id: "5eed0067-0000-4000-8000-000000000015",
          kind: "workflow",
          action_binding: { plane: "workflow", change: { workflow: "standard-fix" } },
          workflow_slug: "standard-fix",
          workflow_version: 14,
          status: "dismissed",
          resolved_at: at,
          resolved_by_name: null,
          resolution_reason: "Review is the slow stage here.",
        }),
        suggestionRow({
          id: "5eed0067-0000-4000-8000-000000000014",
          needs_spike: true,
          action_binding: { plane: "planning", change: { spike: "Link zephyr.elf incrementally" } },
          status: "drafted",
          resolved_at: at,
          draft_batch_id: "5eed006a-0000-4000-8000-000000000002",
        }),
      ],
      [
        findingRow({
          evidence_refs: [
            { kind: "runner_pool", id: POOL_A_ID },
            { kind: "runner", id: FORGE_02_ID },
            { kind: "test_case", id: "5eed0033-0000-4000-8000-000000000001" },
          ],
        }),
      ],
      [measurementRow({ suggestion_id: "5eed0067-0000-4000-8000-000000000012" })],
      [calibrationRow()],
      RESOLVED,
    );
    const validate = validator("AnalysisSuggestions");

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body.suggestions.map((entry) => entry.status)).toEqual([
      "open",
      "applied",
      "dismissed",
      "drafted",
    ]);
    expect(
      body.suggestions
        .find((entry) => entry.id === RUNNER_MOVE_ID)
        ?.findings[0].evidence.map((entry) => entry.surface),
    ).toEqual(["farm", null, "test_results"]);
  });

  it("documents a row an older composer wrote — no confidence basis, a bare impact basis", () => {
    const body = suggestionsResource(
      HELIOS,
      composedRun({ finished_at: null }),
      [
        suggestionRow({
          confidence_basis: null,
          impact: {
            estimate: -110,
            unit: "seconds",
            applies_to: "first build after a runner start",
            basis: { method: "measured", sample_size: 9, description: "9 runner starts" },
          },
        }),
        suggestionRow({
          id: "5eed0067-0000-4000-8000-000000000014",
          needs_spike: true,
          impact: {
            estimate: null,
            unit: "seconds",
            applies_to: "per build",
            basis: { method: "unquantified", description: "no step timing in the corpus" },
          },
        }),
      ],
      [],
      [],
      [],
      RESOLVED,
    );
    const validate = validator("AnalysisSuggestions");

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body).toMatchObject({ analyzedAt: null });
  });

  it("documents the empty read", () => {
    const validate = validator("AnalysisSuggestions");

    expect(validate(emptySuggestions(HELIOS)) ? null : validate.errors).toBeNull();
  });
});

describe("the consequence preview, against its documented schema", () => {
  const validate = validator("SuggestionPreview");

  it("documents a workflow draft with its stage and connection delta", () => {
    const plan: ActionPlan = {
      kind: "workflow_draft",
      plane: "workflow",
      summary: "standard-fix: a draft on v14 moves `review` to run before `build`.",
      lands: "Workflow studio · standard-fix draft",
      change: {
        workflowId: "5eed001b-0000-4000-8000-000000000001",
        slug: "standard-fix",
        ifMatch: "none",
        nextVersion: 15,
        changeNote: "Proposed by the Build Analyzer",
        definition: { nodes: [], edges: [] } as never,
      },
      delta: {
        nodesAdded: [],
        nodesRemoved: [],
        edgesAdded: ["implement → review", "review → build", "test → checks-green"],
        edgesRemoved: ["implement → build", "test → review", "review → checks-green"],
      },
    };
    const body = previewResource("5eed0067-0000-4000-8000-000000000015", plan, false);

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body.delta?.edgesAdded).toHaveLength(3);
  });

  it("documents a plan with no delta — a farm change, or one no plane can take", () => {
    const body = previewResource(
      "5eed0067-0000-4000-8000-000000000011",
      {
        kind: "unavailable",
        plane: "test_gate",
        summary: "PR builds run native_sim; qemu_cortex_m3, HIL run only at the merge gate.",
        lands: "nowhere — not applied",
        reason: "no plane owns per-stage PR and merge gates yet",
      },
      false,
    );

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body).toMatchObject({ appliable: false, delta: null, change: null });
  });
});

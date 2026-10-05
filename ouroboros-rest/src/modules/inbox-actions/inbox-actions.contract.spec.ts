/**
 * The OpenAPI document and what an answered press sends (#462, receipt #467): real
 * `actionResultResource` answers — one per kind of outcome — held to `InboxActionResult`, which is
 * closed, so a receipt field the document does not describe fails here.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import type { ActionItem, ActionResolution } from "./inbox-actions.repository";
import { actionResultResource } from "./inbox-actions.resources";

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns A function answering Ajv's complaint, or undefined when the value validates.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/** The answer as it leaves the service — JSON, as a client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

const ITEM: ActionItem = {
  id: "5eed0082-0000-4000-8000-000000000002",
  organizationId: "org-acme",
  kindId: "protected_path_allow_once",
  kindVersion: 1,
  status: "open",
  payload: {},
  refs: [
    { type: "run", id: "5eed0009-0000-4000-8000-000000000479", label: "loop #1844" },
    { type: "pr", id: "5eed003a-0000-4000-8000-000000000504", label: "PR #504" },
  ],
  sourceRef: "guardrail:evaluation:e-1",
};

/** A stored resolution with an outcome. */
function resolution(actionId: string, outcome: Record<string, unknown>): ActionResolution {
  return {
    actionId,
    resolver: "human",
    policy: null,
    actor: { id: "5eed0003-0000-4000-8000-000000000001", name: "Ken Suenobu" },
    channel: "web",
    note: null,
    outcome,
    resolvedAt: new Date("2026-10-04T19:46:00Z"),
  };
}

describe("an answered press and the document", () => {
  const validate = validatorFor("InboxActionResult");

  it.each([
    [
      "guardrail.allow_once",
      "allow_once",
      { run_id: "r", exception_id: "x", control_state: "pending" },
    ],
    [
      "pr.approve_and_merge",
      "approve_merge",
      { pr_id: "p", merge: "merged", merge_sha: "3f9c2ab7" },
    ],
    ["pr.waive_criterion", "waive_annotate", { pr_id: "p", annotation: "annotated" }],
    ["planning.require_bench_upgrade", "require_bench_upgrade", { draft_batch_id: "b" }],
    ["facts.confirm", "confirm", { fact_id: "f", status: "confirmed" }],
    [undefined, "approve_spend", {}],
  ])("sends what InboxActionResult describes for %s", (binding, actionId, outcome) => {
    const answer = actionResultResource(
      ITEM,
      "0c8e5f2a-7b14-4d39-a6e0-1f2b3c4d5e6f",
      "key-1",
      resolution(actionId, outcome),
      false,
      binding,
    );

    expect(validate(wire(answer))).toBeUndefined();
    expect(answer.receipt.effects.length).toBeGreaterThan(0);
  });

  it("refuses a receipt with no effect, or a field the document does not describe", () => {
    const answer = wire(
      actionResultResource(
        ITEM,
        "0c8e5f2a-7b14-4d39-a6e0-1f2b3c4d5e6f",
        "k",
        resolution("deny", {}),
        false,
        undefined,
      ),
    ) as { receipt: Record<string, unknown> };

    expect(validate({ ...answer, receipt: { effects: [], links: [] } })).toBeDefined();
    expect(validate({ ...answer, receipt: { ...answer.receipt, text: "x" } })).toBeDefined();
  });
});

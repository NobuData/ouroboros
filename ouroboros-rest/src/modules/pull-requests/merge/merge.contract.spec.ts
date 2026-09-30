import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import { dryRunStateOf } from "../../policies/org-policy.rules";
import { mergePlanResource } from "./merge.resources";
import type { StoredMergePlan } from "./merge.repository";

/**
 * The OpenAPI document and what the merge plan's routes send (AY.7,
 * [#369](https://github.com/NobuData/ouroboros/issues/369)). `openapi.spec.ts` sees these routes
 * only unauthenticated, so this is where a plan is held to `PrMergePlan` — which is
 * `additionalProperties: false`, so `armedByPerson` fails here unless the document lists it — and
 * where the edit's body and its refusals are held to what the service does.
 */

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

/** A value as the client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const KEN = { id: "user-ken", name: "Ken S" };

/** Dry-run off, and no auto-merge terminal to override. */
const OFF = dryRunStateOf(false, false);

/** The seeded plan. */
const STORED: StoredMergePlan = {
  id: "5eed0041-0000-4000-8000-000000000514",
  prId: "5eed003a-0000-4000-8000-000000000514",
  strategy: "squash",
  deleteBranch: true,
  commitMessage: "fix(can): preserve ISR frame order in telemetry path\n\nCloses #482.",
  closeTicket: true,
  commentEvidence: true,
  backAnnotateEpic: false,
  epicId: null,
  armed: false,
  armedBy: null,
  armedAt: null,
  armedAgainstRevisionId: null,
  disarmReason: null,
  mergedResult: null,
  updatedAt: new Date("2026-09-27T14:31:00Z"),
};

/** It, armed by Ken against revision 2. */
const ARMED: StoredMergePlan = {
  ...STORED,
  armed: true,
  armedBy: KEN.id,
  armedAt: new Date("2026-09-27T14:40:00Z"),
  armedAgainstRevisionId: "5eed003b-0000-4000-8000-000000000002",
};

describe("the merge plan keeps its OpenAPI contract (#369)", () => {
  const valid = validatorFor("PrMergePlan");

  it("sends a PrMergePlan — planned, armed by a person, armed by one who has gone", () => {
    expect(valid(wire(mergePlanResource(STORED, null, OFF)))).toBeUndefined();
    expect(valid(wire(mergePlanResource(ARMED, KEN, OFF)))).toBeUndefined();
    expect(valid(wire(mergePlanResource(ARMED, null, OFF)))).toBeUndefined();
  });

  it("…edited, annotating an epic", () => {
    const edited = mergePlanResource(
      {
        ...STORED,
        commitMessage: "fix(can): reworded",
        closeTicket: false,
        backAnnotateEpic: true,
        epicId: "5eed001f-0000-4000-8000-000000000001",
      },
      null,
      OFF,
    );

    expect(valid(wire(edited))).toBeUndefined();
  });

  it("…disarmed by a re-check, and merged", () => {
    expect(
      valid(
        wire(
          mergePlanResource(
            { ...STORED, disarmReason: "gate_red: Physical HIL is red on revision 2." },
            null,
            OFF,
          ),
        ),
      ),
    ).toBeUndefined();
    expect(
      valid(
        wire(
          mergePlanResource(
            {
              ...STORED,
              mergedResult: {
                sha: "b7e41d0",
                identity_used: "ken-s",
                actions_executed: ["close_ticket", "comment_evidence", "delete_branch"],
                merged_at: "2026-09-27T14:45:00.000Z",
              },
            },
            null,
            OFF,
          ),
        ),
      ),
    ).toBeUndefined();
  });

  it("…under the dry-run policy, overriding an auto-merge terminal and disarmed by it (#382)", () => {
    expect(valid(wire(mergePlanResource(STORED, null, dryRunStateOf(true, true))))).toBeUndefined();
    expect(
      valid(
        wire(
          mergePlanResource(
            {
              ...STORED,
              disarmReason:
                "dry_run_policy_active: dry-run policy active — the PR stays a draft and nothing merges until an owner or admin turns dry-run off in Settings → Policies.",
            },
            null,
            dryRunStateOf(true, false),
          ),
        ),
      ),
    ).toBeUndefined();
  });

  it("documents the dry-run refusal on the arm and the merge (#382)", () => {
    const paths = document().paths as Record<
      string,
      Record<string, { responses: Record<string, { description: string }> }>
    >;

    for (const route of ["arm", "merge"]) {
      const { responses } = paths[`/api/v1/pull-requests/{id}/merge-plan/${route}`].post;

      expect(responses["409"].description).toContain("dry_run_policy_active");
    }
  });

  it("names only the person who armed the plan", () => {
    expect(mergePlanResource(ARMED, KEN, OFF).armedByPerson).toEqual(KEN);
    // A person read for somebody else is never drawn as the one who armed.
    expect(
      mergePlanResource(ARMED, { id: "user-mara", name: "Mara" }, OFF).armedByPerson,
    ).toBeNull();
    expect(mergePlanResource(STORED, KEN, OFF).armedByPerson).toBeNull();
  });

  it("documents the edit's body: every field optional, the epic alone nullable", () => {
    const body = validatorFor("UpdateMergePlanRequest");

    expect(body({})).toBeUndefined();
    expect(body({ closeTicket: false })).toBeUndefined();
    expect(body({ epicId: null })).toBeUndefined();
    expect(body({ epicId: "5eed001f-0000-4000-8000-000000000001" })).toBeUndefined();
    expect(body({ commitMessage: "fix(can): reworded" })).toBeUndefined();
    expect(body({ commitMessage: "" })).toBeDefined();
    expect(body({ closeTicket: null })).toBeDefined();
    expect(body({ epicId: "ota-hardening" })).toBeDefined();
    // The pinned policy's, and not edited here.
    expect(body({ strategy: "rebase" })).toBeDefined();
    expect(body({ deleteBranch: false })).toBeDefined();
  });

  it("documents the edit's refusals by code, and that it needs a session", () => {
    const paths = document().paths as Record<
      string,
      Record<string, { responses: Record<string, { description: string }> }>
    >;
    const { responses } = paths["/api/v1/pull-requests/{id}/merge-plan"].patch;

    expect(Object.keys(responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "422",
      "500",
    ]);
    expect(responses["403"].description).toContain("merge_not_policy_eligible");
    expect(responses["409"].description).toContain("merge_plan_armed");
    expect(responses["409"].description).toContain("merge_plan_merged");
    expect(responses["409"].description).toContain("pull_request_not_open");
    expect(responses["422"].description).toContain("merge_plan_epic_required");
    expect(responses["422"].description).toContain("merge_plan_epic_not_found");
  });
});

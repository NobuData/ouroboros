/**
 * `GET /api/v1/loop/readiness` and the document (DK.1, #1318): what `loopReadiness` answers is
 * what `LoopReadiness` in `openapi.yaml` describes, and the two vocabularies agree.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import {
  loopReadiness,
  READINESS_CHECK_IDS,
  READINESS_CODES,
  type ReadinessFacts,
} from "./readiness";

/**
 * A validator for one component schema.
 *
 * @param name - The schema's name.
 * @returns A function answering the error text, or `undefined` when the value is valid.
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

/** A ready workspace. */
const READY: ReadinessFacts = {
  repository: { slug: "acme/helios", enabled: true },
  workflowSlug: "live-slice",
  workflow: {
    slug: "live-slice",
    version: 1,
    stages: { modelStages: 1, tasks: ["implement"], buildStages: [{ node: "build", pool: "a" }] },
  },
  deploymentEnabled: true,
  workspaceState: "active",
  connections: [{ kind: "anthropic", displayName: "Anthropic", status: "active" }],
  routes: [{ task: "implement", resolves: true, alias: "coder-std", priced: true }],
  engine: { reachable: true, executors: ["harness"] },
  pools: [{ name: "a", exists: true, enabled: true, online: 1, eligible: 1 }],
  push: { outcome: "can_push" },
  pullRequest: { outcome: "can_push" },
  dryRun: true,
  slots: { taken: 0, ceiling: 1 },
  estimate: {
    costCapCentsPerRun: 200,
    issue: { number: 1, title: "Greet by name", size: "s", sizedBy: "heuristic-v0" },
  },
};

/** A workspace where almost nothing holds. */
const BARE: ReadinessFacts = {
  ...READY,
  repository: { slug: "acme/helios", enabled: false },
  workflow: undefined,
  deploymentEnabled: false,
  workspaceState: "paused",
  connections: [],
  routes: [],
  engine: { reachable: false, executors: [] },
  pools: [],
  push: { outcome: "not_configured" },
  pullRequest: { outcome: "no_issue" },
  dryRun: false,
  slots: { taken: 1, ceiling: 1 },
  estimate: { costCapCentsPerRun: null, issue: null },
};

/** A component schema of the document, by name. */
function schema(name: string): Record<string, unknown> {
  const schemas = document().components?.schemas as Record<string, Record<string, unknown>>;

  return schemas[name];
}

describe("the readiness route and the document", () => {
  const valid = validatorFor("LoopReadiness");

  it("sends what LoopReadiness describes — ready", () => {
    expect(valid(wire(loopReadiness(READY)))).toBeUndefined();
  });

  it("sends what LoopReadiness describes — nothing ready, unknowns included", () => {
    const readiness = loopReadiness(BARE);

    expect(readiness.checks.some((check) => check.state === "unknown")).toBe(true);
    expect(valid(wire(readiness))).toBeUndefined();
  });

  it("is refused by the document when a field is added that it does not describe", () => {
    const readiness = wire(loopReadiness(READY)) as Record<string, unknown>;

    expect(valid({ ...readiness, etaMinutes: 4 })).toContain("additional properties");
  });

  it("documents every check id and every code, and no other", () => {
    const check = schema("LoopReadinessCheck").properties as Record<
      string,
      { enum?: string[]; oneOf?: { enum?: string[] }[] }
    >;

    expect(check.id.enum).toEqual([...READINESS_CHECK_IDS]);
    expect(check.code.oneOf?.[0].enum).toEqual([...READINESS_CODES]);
  });
});

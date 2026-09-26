import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";

import {
  MAX_DIFF_FILES,
  TRIAGE_CONTRACT,
  TRIAGE_V0_FIELDS,
  heuristicTriageResponse,
  triageRequest,
  type CaseDossier,
} from "./triage.contract";
import { HINT_MATRIX } from "./triage.matrix.fixture";
import { evaluateHints } from "./triage.rules";

/** The published contract. */
const CONTRACT = join(__dirname, "..", "..", "..", "..", "schemas", "triage");

/** A JSON Schema node, as far as the walk below reads one. */
interface SchemaNode {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly items?: SchemaNode;
  readonly $defs?: Readonly<Record<string, SchemaNode>>;
}

const document = JSON.parse(readFileSync(join(CONTRACT, "v0.json"), "utf8")) as SchemaNode & {
  $id: string;
};

/**
 * Every field of the schema as `path:type` — what {@link TRIAGE_V0_FIELDS} pins.
 *
 * @param node - Where to start.
 * @param prefix - Its path.
 * @returns The fields beneath it, in document order.
 */
function fields(node: SchemaNode, prefix: string): string[] {
  const out: string[] = [];

  for (const [name, raw] of Object.entries(node.properties ?? {})) {
    const child = resolve(raw);
    const path = `${prefix}.${name}`;

    out.push(`${path}:${typeOf(child)}`);
    out.push(...fields(child, path));

    if (child.items !== undefined) {
      const items = resolve(child.items);

      if (items.properties === undefined) out.push(`${path}[]:${typeOf(items)}`);
      out.push(...fields(items, `${path}[]`));
    }
  }

  return out;
}

/**
 * Follow a local `$ref`.
 *
 * @param node - A node.
 * @returns The node it refers to, or itself.
 */
function resolve(node: SchemaNode): SchemaNode {
  if (node.$ref === undefined) return node;

  const name = node.$ref.replace("#/$defs/", "");
  const target = document.$defs?.[name];

  if (target === undefined) throw new Error(`v0.json has no $defs/${name}`);

  return target;
}

/**
 * A node's type, as the pin writes it.
 *
 * @param node - A resolved node.
 * @returns `const(…)`, `enum(…)` or the type(s).
 */
function typeOf(node: SchemaNode): string {
  if (node.const !== undefined) return `const(${JSON.stringify(node.const).replaceAll('"', "")})`;
  if (node.enum !== undefined) return `enum(${node.enum.map((value) => String(value)).join(",")})`;

  return Array.isArray(node.type) ? node.type.join("|") : String(node.type);
}

/** The contract compiled, with its request half addressable. */
function compile(): { response: ValidateFunction; request: ValidateFunction } {
  const ajv = new Ajv2020({ strict: true });

  ajv.addSchema(document);

  const response = ajv.getSchema(document.$id);
  const request = ajv.getSchema(`${document.$id}#/$defs/triage_request`);

  if (response === undefined || request === undefined) throw new Error("v0.json did not compile");

  return { response, request };
}

/** A dossier for the mockup's failing HIL case. */
function dossier(overrides: Partial<CaseDossier> = {}): CaseDossier {
  return {
    case: {
      case_key: "c".repeat(64),
      name: "pid_overshoot_under_load",
      classname: "motor.control",
      suite: "PHYSICAL · HIL rig",
      platform: "rig:helios-rig-02",
      status: "failed",
      retry_outcomes: ["failed"],
      failure: { message: "overshoot 2.4% > limit 2.0%", path: "drivers/motor/pid.c" },
    },
    hilMeasurements: [
      {
        metric: "overshoot_pct",
        value: 2.4,
        unit: "%",
        limit_value: 2,
        limit_kind: "max",
        verdict: "fail",
        trials: [{ n: 1, value: 2.4 }],
      },
    ],
    changedFiles: [
      { path: "drivers/motor/pid.c", status: "modified", additions: 14, deletions: 3 },
    ],
    priorAttempts: [{ attempt_seq: 1, outcome: "passed", commit_sha: "a3f19c2" }],
    flakeHistory: { occurrences: 1, pass_on_retry: 0, score: null, state: null },
    ...overrides,
  };
}

/**
 * `/v0/triage` is committed and drift-checked (#332): the TypeScript pin is the document's
 * shape, the fixtures are classified as recorded, and what this service builds validates.
 */
describe("the triage contract", () => {
  it("pins every field of v0.json with its type — a shape change without this file is red", () => {
    const published = [
      ...fields(document, "response"),
      ...fields(resolve({ $ref: "#/$defs/triage_request" }), "request"),
    ];

    expect([...TRIAGE_V0_FIELDS].sort()).toEqual(published.sort());
  });

  it("compiles under strict JSON Schema 2020-12", () => {
    expect(() => compile()).not.toThrow();
  });

  it("classifies every published fixture as expected.json records", () => {
    const validators = compile();
    const expected = JSON.parse(
      readFileSync(join(CONTRACT, "fixtures", "expected.json"), "utf8"),
    ) as { cases: { document: string; def: "request" | "response"; valid: boolean }[] };
    const onDisk = ["valid", "invalid"].flatMap((dir) =>
      readdirSync(join(CONTRACT, "fixtures", dir)).map((name) => `${dir}/${name}`),
    );

    expect(expected.cases.map((entry) => entry.document).sort()).toEqual(onDisk.sort());

    for (const { document: name, def, valid } of expected.cases) {
      const body: unknown = JSON.parse(readFileSync(join(CONTRACT, "fixtures", name), "utf8"));

      expect({ name, valid: validators[def](body) }).toEqual({ name, valid });
    }
  });

  it("refuses a heuristic that reports a confidence", () => {
    const { response } = compile();
    const hint = evaluateHints(HINT_MATRIX[1].context).hint;

    if (hint === null) throw new Error("the matrix's flake row has no hint");

    expect(response({ ...heuristicTriageResponse(hint, dossier()), confidence: 84 })).toBe(false);
  });
});

describe("what this service builds", () => {
  it("is a valid request for the mockup's HIL failure", () => {
    const { request } = compile();

    expect(request(triageRequest(dossier()))).toBe(true);
  });

  it("caps the diff and says it did", () => {
    const { request } = compile();
    const many = Array.from({ length: MAX_DIFF_FILES + 1 }, (_, index) => ({
      path: `src/file-${index}.c`,
      status: "modified" as const,
      additions: 1,
      deletions: 0,
    }));
    const built = triageRequest(dossier({ changedFiles: many }));

    expect(built.diff.files).toHaveLength(MAX_DIFF_FILES);
    expect(built.diff.truncated).toBe(true);
    expect(request(built)).toBe(true);
  });

  it.each(HINT_MATRIX.filter((row) => row.hint !== null))(
    "answers the hint in the response shape — $name",
    ({ context }) => {
      const { response } = compile();
      const hint = evaluateHints(context).hint;

      if (hint === null) throw new Error("expected a hint");

      const answer = heuristicTriageResponse(hint, dossier());

      expect(response(answer)).toBe(true);
      expect(answer.confidence).toBeNull();
      expect(answer.narrative).toBeNull();
      expect(answer.provenance).toEqual({
        contract: TRIAGE_CONTRACT,
        actor: "heuristic",
        rule_id: hint.ruleId,
        model: null,
      });
    },
  );

  it("cites the failure's path for a diff overlap, and the case otherwise", () => {
    const overlap = evaluateHints(HINT_MATRIX[12].context).hint;
    const flake = evaluateHints(HINT_MATRIX[1].context).hint;

    if (overlap === null || flake === null) throw new Error("expected hints");

    expect(heuristicTriageResponse(overlap, dossier()).evidence[0]).toEqual(
      expect.objectContaining({ kind: "diff_path", ref: "drivers/motor/pid.c" }),
    );
    expect(heuristicTriageResponse(flake, dossier()).evidence[0]).toEqual(
      expect.objectContaining({ kind: "flake_history", ref: "c".repeat(64) }),
    );
  });
});

import { Logger } from "@nestjs/common";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import type { BriefsRepository } from "./briefs.repository";
import { BriefsService } from "./briefs.service";
import { MatrixBuilderService } from "./matrix-builder.service";
import {
  INVESTIGATION,
  MemoryBriefStore,
  WORKSPACE,
  brief,
  investigation,
  seeded,
} from "./rs127.fixture";

/**
 * The brief routes' answers are what `openapi.yaml` documents (CM.2, #621) — the real service's,
 * over RS-127, held to the schemas the UI's client is generated from.
 */

function validator(name: string) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });
  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

function service(...held: Parameters<typeof seeded>): BriefsService {
  return new BriefsService(new MemoryBriefStore(seeded(...held)) as unknown as BriefsRepository);
}

/** What the documented example of an operation's `200` says. */
function example(path: string, media: string): unknown {
  const paths = document().paths as unknown as Record<
    string,
    {
      get: {
        responses: Record<
          string,
          {
            content: Record<
              string,
              { examples?: { seeded: { value: unknown } }; example?: unknown }
            >;
          }
        >;
      };
    }
  >;
  const content = paths[path].get.responses["200"].content[media];

  return content.examples?.seeded.value ?? content.example;
}

const BASE = "/api/v1/research/investigations/{investigationId}";

beforeEach(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("the briefs contract", () => {
  it("documents RS-127's brief: paragraphs, panel, matrix and proposal", async () => {
    const valid = validator("InvestigationBrief");
    const read = await service().brief(WORKSPACE, INVESTIGATION);

    expect(valid(read)).toBe(true);
    expect(valid.errors).toBeNull();
    // The contract is closed: a field the document does not name is refused.
    expect(valid({ ...read, extra: true })).toBe(false);
  });

  it("documents a brief with no matrix, no proposal and no provenance", async () => {
    const read = await service({
      investigation: investigation({ provenance: null }),
      matrix: undefined,
      matrixInput: undefined,
    }).brief(WORKSPACE, INVESTIGATION);

    expect(read.matrix).toBeNull();
    expect(validator("InvestigationBrief")(read)).toBe(true);
  });

  it("documents open questions, demotions and stubs without an effort", async () => {
    const held = seeded();
    const read = await service({
      brief: brief({
        body: { paragraphs: [{ spans: [{ text: "Does AeroMesh use a beacon?", claim: "q1" }] }] },
      }),
      claims: [{ ref: "q1", type: "open_question", text: "Beacon?", demoted: true, sources: [] }],
      matrixInput: {
        ...held.matrixInput,
        tickets: [{ key: "DOCK-1", title: "MPC", capability: "Docking in >8 m/s gusts" }],
      },
    }).brief(WORKSPACE, INVESTIGATION);

    expect(read.proposed?.effort).toBeNull();
    expect(validator("InvestigationBrief")(read)).toBe(true);
  });

  it("documents a matrix the builder built, derivations included", async () => {
    const store = new MemoryBriefStore(seeded({ matrix: undefined }));
    await new MatrixBuilderService(store as unknown as BriefsRepository).build(
      WORKSPACE,
      INVESTIGATION,
    );
    const read = await new BriefsService(store as unknown as BriefsRepository).brief(
      WORKSPACE,
      INVESTIGATION,
    );

    expect(validator("CapabilityMatrix")(read.matrix)).toBe(true);
    expect(validator("GapProposals")(read.proposed)).toBe(true);
  });

  it("documents the whole ledger, and an empty one", async () => {
    const valid = validator("BriefLedger");

    expect(valid(await service().sources(WORKSPACE, INVESTIGATION))).toBe(true);
    expect(valid(await service({ ledger: [] }).sources(WORKSPACE, INVESTIGATION))).toBe(true);
  });

  it("documents examples the schemas accept", () => {
    expect(validator("InvestigationBrief")(example(`${BASE}/brief`, "application/json"))).toBe(
      true,
    );
    expect(validator("BriefLedger")(example(`${BASE}/sources`, "application/json"))).toBe(true);
  });

  it("documents an export example in the shape the export has", async () => {
    const documented = example(`${BASE}/brief/export`, "text/markdown") as string;
    const exported = (await service().export(WORKSPACE, INVESTIGATION)).markdown;

    for (const line of [
      "# RS-127 — Autonomous docking vs. Skylink / AeroMesh / Novum",
      "> Gap analysis · deep dive · 44 sources · brief v1",
      "- [07] Skylink S4 docking module — teardown & sensor BOM — `https://droneanalysts.example.com/s4-teardown` — retrieved 2026-10-07T12:07:00.000Z",
      "_Provenance: investigation RS-127 · researcher loop-v1 · alias researcher-long-ctx · brief v1 · 2026-10-07_",
    ]) {
      expect(documented).toContain(line);
      expect(exported).toContain(line);
    }
  });
});

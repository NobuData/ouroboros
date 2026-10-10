import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import type { BatchesService } from "../../planning/batches.service";
import type { EpicsService } from "../../planning/epics.service";
import type { BriefsService } from "../briefs/briefs.service";
import { GapHandoffService } from "./gap-handoff.service";
import { pipelineBench } from "./pipeline.bench.fixture";
import {
  FakePlanning,
  INVESTIGATION,
  MemoryPipelineStore,
  ORG,
  USER,
  issuesRun,
  refused,
  roadmapRun,
  rs124Roadmap,
} from "./pipeline.fixture";

/**
 * The pipeline's answers are what `openapi.yaml` documents (CM.5, #624) — the real services',
 * over the suites' stand-ins, held to the schemas the UI's client is generated from.
 */

const BASE = "/api/v1/research/investigations/{investigationId}";
const KEYS = [
  "dock-mpc",
  "dock-retry",
  "dock-gust",
  "fleet-battery",
  "fleet-gaps",
  "fleet-playbook",
];

function validator(name: string) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });

  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

interface Body {
  example?: unknown;
  examples?: Record<string, { value: unknown }>;
}

interface Operation {
  operationId: string;
  requestBody?: { content: Record<string, Body & { schema: { $ref: string } }> };
  responses: Record<string, { content?: Record<string, Body & { schema: { $ref: string } }> }>;
}

function operation(path: string, method: string): Operation {
  return (document().paths as Record<string, Record<string, Operation>>)[path][method];
}

function examplesOf(body: Body): unknown[] {
  return body.examples === undefined
    ? [body.example]
    : Object.values(body.examples).map((entry) => entry.value);
}

/**
 * An answer with the stand-ins' readable ids (`batch-1`, `ticket-742`, `suggestion-3`) replaced by
 * uuids, as the real stores mint them — the schemas say `format: uuid`, and the fixtures' ids
 * are kept readable for every other suite.
 */
function wire<T>(answer: T): T {
  const minted = new Map<string, string>();
  const text = JSON.stringify(answer).replace(
    /"((?:batch|ticket|suggestion|doc)-[a-z0-9-]+)"/g,
    (_match, id: string) => {
      const known =
        minted.get(id) ?? `5eed00aa-0000-4000-8000-${String(minted.size + 1).padStart(12, "0")}`;

      minted.set(id, known);

      return `"${known}"`;
    },
  );

  return JSON.parse(text) as T;
}

/** A bench carried to a filed, merged, clean document. */
async function filed() {
  const bench = pipelineBench();

  bench.skills.answer(roadmapRun(rs124Roadmap()), issuesRun(KEYS));
  await bench.roadmap.generate(ORG, INVESTIGATION);

  return bench;
}

describe("the roadmap pipeline contract", () => {
  it("documents the card at every stage of a document's life", async () => {
    const valid = validator("ResearchRoadmap");
    const blocked = pipelineBench();

    blocked.repo.refusal = refused("auth");
    blocked.skills.answer(roadmapRun(rs124Roadmap()));

    // Pending, with the reason it could not be projected.
    const pending = await blocked.roadmap.generate(ORG, INVESTIGATION);

    expect(valid(pending)).toBe(true);
    expect(valid.errors).toBeNull();

    const bench = await filed();

    // A pull request open, nothing filed, one open suggestion of each kind.
    await bench.roadmap.suggest(ORG, USER, INVESTIGATION, {
      text: "Gust into MVP.",
      hint: { item: "dock-gust" },
    });
    await bench.roadmap.raise(
      bench.store.current()!.docId,
      "estimator",
      "Split the battery model.",
    );
    expect(valid(wire(await bench.roadmap.card(ORG, INVESTIGATION)))).toBe(true);

    // Filed and sized, written back.
    await bench.issues.file(ORG, USER, INVESTIGATION);
    bench.planning.size("batch-1");

    const written = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(valid(wire(written.roadmap))).toBe(true);
    expect(valid.errors).toBeNull();

    // Committed, then drifted.
    bench.repo.merge(88);
    expect(valid(wire((await bench.drift.check(ORG, INVESTIGATION)).roadmap))).toBe(true);
    bench.store.trackerChange("#744", { state: "closed" });
    expect(valid(wire((await bench.drift.check(ORG, INVESTIGATION)).roadmap))).toBe(true);
    expect(valid.errors).toBeNull();

    expect(valid({ ...pending, extra: true })).toBe(false);
  });

  it("documents a suggestion — open, applied and dismissed", async () => {
    const valid = validator("ResearchRoadmapSuggestion");
    const bench = pipelineBench();

    bench.skills.answer(roadmapRun(rs124Roadmap()));
    await bench.roadmap.generate(ORG, INVESTIGATION);
    const applied = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, { text: "A." });
    const dismissed = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, {
      text: "B.",
      hint: { a: 1 },
    });

    expect(valid(wire(applied))).toBe(true);
    expect(valid.errors).toBeNull();

    bench.skills.answer(roadmapRun(rs124Roadmap()));
    await bench.roadmap.apply(ORG, USER, INVESTIGATION, applied.id);

    const card = await bench.roadmap.dismiss(ORG, USER, INVESTIGATION, dismissed.id);

    for (const suggestion of card.suggestions.items) expect(valid(wire(suggestion))).toBe(true);
    expect(card.suggestions.items.map((item) => item.status)).toEqual(["applied", "dismissed"]);
  });

  it("documents create-issues at each place it can stop", async () => {
    const valid = validator("ResearchRoadmapIssues");
    const bench = await filed();
    const sizing = await bench.issues.file(ORG, USER, INVESTIGATION);

    bench.planning.size("batch-1");
    bench.planning.pushLimit = 3;

    const partial = await bench.issues.file(ORG, USER, INVESTIGATION);
    const done = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect([sizing.stage, partial.stage, done.stage]).toEqual(["sizing", "partial", "filed"]);
    for (const answer of [sizing, partial, done]) {
      expect(valid(wire(answer))).toBe(true);
      expect(valid.errors).toBeNull();
    }
    expect(valid({ ...wire(done), stage: "queued" })).toBe(false);
  });

  it("documents a drift check, identical and not", async () => {
    const valid = validator("ResearchRoadmapDrift");
    const bench = await filed();

    await bench.issues.file(ORG, USER, INVESTIGATION, { pushUnsized: true });
    bench.repo.merge(88);

    const clean = await bench.drift.check(ORG, INVESTIGATION);

    bench.store.trackerChange("#745", { title: "Battery health model v3", labels: ["mvp"] });
    bench.repo.handEdit("docs/ROADMAP.md", "# Mine\n");

    const drifted = await bench.drift.check(ORG, INVESTIGATION);

    expect(clean.identical).toBe(true);
    expect(drifted.differences.map((difference) => difference.field)).toEqual([
      "title",
      "mvp",
      "file",
    ]);
    for (const answer of [clean, drifted]) {
      expect(valid(wire(answer))).toBe(true);
      expect(valid.errors).toBeNull();
    }
  });

  it("documents the gaps hand-off", async () => {
    const valid = validator("ResearchDraftEpic");
    const store = new MemoryPipelineStore();
    const planning = new FakePlanning(store);
    const service = new GapHandoffService(
      store as never,
      {
        document: () =>
          Promise.resolve({
            brief: {
              investigation: { displayId: "RS-127" },
              proposed: {
                epic: { title: "Docking parity", label: "EPIC · Docking parity" },
                tickets: [
                  {
                    key: "DOCK-1",
                    title: "Wind-feedforward MPC",
                    label: "DOCK-1",
                    effort: "m",
                    capability: "Wind-compensated docking",
                    severity: "high",
                    sources: [],
                  },
                  {
                    key: "DOCK-2",
                    title: "Retry",
                    label: "DOCK-2",
                    effort: null,
                    capability: "Retry after abort",
                    severity: "med",
                    sources: [],
                  },
                ],
                top: [],
                more: 0,
                effort: "m",
              },
            },
            ledger: [],
          }),
      } as unknown as BriefsService,
      {
        create: () =>
          Promise.resolve({ id: "5eed0030-0000-4000-8000-000000000127", name: "Docking parity" }),
        read: () =>
          Promise.resolve({ id: "5eed0030-0000-4000-8000-000000000127", name: "Docking parity" }),
      } as unknown as EpicsService,
      {
        compose: async (...args: Parameters<FakePlanning["compose"]>) =>
          uuids(await planning.compose(...args)),
        read: async (...args: Parameters<FakePlanning["read"]>) =>
          uuids(await planning.read(...args)),
      } as unknown as BatchesService,
    );
    const answer = await service.draftEpic(ORG, USER, INVESTIGATION);

    expect(valid(answer)).toBe(true);
    expect(valid.errors).toBeNull();
    expect(valid({ ...answer, filed: true })).toBe(false);
  });

  it("documents the policy and its save", async () => {
    const valid = validator("ResearchRoadmapSettings");
    const bench = pipelineBench();

    expect(valid(await bench.roadmap.settings(ORG))).toBe(true);
    expect(valid(await bench.roadmap.saveSettings(ORG, USER, true))).toBe(true);
    expect(valid({})).toBe(false);
    expect(valid({ directCommit: "yes" })).toBe(false);
  });

  it.each([
    [
      "ResearchDraftEpicRequest",
      [{}, { targetSourceId: "5eed0020-0000-4000-8000-000000000001" }],
      [{ epic: "x" }],
    ],
    ["ResearchRoadmapGenerateRequest", [{}, { path: "docs/ROADMAP.md" }], [{ title: "x" }]],
    [
      "ResearchRoadmapSuggestionRequest",
      [{ text: "x" }, { text: "x", hint: { a: 1 } }],
      [{}, { text: "" }, { text: "x", hint: [] }],
    ],
    ["ResearchRoadmapIssuesRequest", [{}, { pushUnsized: true }], [{ pushUnsized: "yes" }]],
  ])("documents the request %s", (name, accepted, refusedBodies) => {
    const valid = validator(name);

    for (const body of accepted) expect(valid(body)).toBe(true);
    for (const body of refusedBodies) expect(valid(body)).toBe(false);
  });

  it.each([
    [`${BASE}/draft-epic`, "post", "draftEpicFromGaps"],
    [`${BASE}/roadmap`, "post", "generateResearchRoadmap"],
    [`${BASE}/roadmap`, "get", "getResearchRoadmap"],
    [`${BASE}/roadmap/suggestions`, "post", "suggestResearchRoadmapChange"],
    [`${BASE}/roadmap/suggestions/{suggestionId}/apply`, "post", "applyResearchRoadmapSuggestion"],
    [
      `${BASE}/roadmap/suggestions/{suggestionId}/dismiss`,
      "post",
      "dismissResearchRoadmapSuggestion",
    ],
    [`${BASE}/roadmap/issues`, "post", "fileResearchRoadmapIssues"],
    [`${BASE}/roadmap/drift-check`, "post", "checkResearchRoadmapDrift"],
    ["/api/v1/research/roadmap-settings", "get", "getResearchRoadmapSettings"],
    ["/api/v1/research/roadmap-settings", "put", "saveResearchRoadmapSettings"],
  ])("documents %s %s with examples its own schemas accept", (path, method, operationId) => {
    const documented = operation(path, method);

    expect(documented.operationId).toBe(operationId);

    const bodies = [
      ...Object.values(documented.requestBody?.content ?? {}),
      ...Object.entries(documented.responses)
        .filter(([status]) => status.startsWith("2"))
        .flatMap(([, response]) => Object.values(response.content ?? {})),
    ];

    expect(bodies.length).toBeGreaterThan(0);

    for (const body of bodies) {
      const valid = validator(body.schema.$ref.replace("#/components/schemas/", ""));

      for (const example of examplesOf(body)) {
        expect(valid(example)).toBe(true);
        expect(valid.errors).toBeNull();
      }
    }
  });
});

/** The fake Planning's ids as the uuids the real one answers. */
function uuids<T extends { id: string; drafts: readonly { id: string }[] }>(batch: T): T {
  return {
    ...batch,
    id: "5eed0090-0000-4000-8000-000000000127",
    drafts: batch.drafts.map((draft, index) => ({
      ...draft,
      id: `5eed0090-0000-4000-8000-00000000127${String(index + 1)}`,
    })),
  };
}

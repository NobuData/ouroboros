import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import type { ResearchEstimateService } from "../estimate.service";
import type { InvestigationDispatchService } from "../loop/investigation-dispatch.service";
import {
  KEN,
  MemoryLifecycleStore,
  WORKSPACE,
  investigationId,
  record,
  rs121,
} from "./lifecycle.fixture";
import type { LifecycleRepository } from "./lifecycle.repository";
import { InvestigationLifecycleService } from "./lifecycle.service";
import { formatProgress, progressFailure } from "./progress.stream";

/**
 * The lifecycle routes' answers are what `openapi.yaml` documents (CM.6, #625) — the real
 * service's, over the seeded card's rows, held to the schemas the UI's client is generated from.
 */

const NOW = new Date("2026-10-10T12:00:00Z");
const CALLER = { userId: KEN, roles: ["member"] as const };
const BASE = "/api/v1/research/investigations";

const ESTIMATE = {
  depth: "deep_dive" as const,
  tools: ["web", "code"],
  researcher: {
    taskKind: "research",
    routeTag: "research-primary",
    alias: "researcher-long-ctx",
    modelId: "claude-sonnet-4-6",
  },
  calibrationVersion: 1,
  operations: { total: 20, byTool: [{ tool: "web", operations: 12, hostedCostCents: 0 }] },
  synthesisCalls: { min: 24, max: 34 },
  sources: { min: 20, max: 30 },
  costCents: { min: 261, max: 344 },
  label: "est. 20–30 sources · ~$3",
};

function validator(name: string) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });
  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

function service(store = new MemoryLifecycleStore()): InvestigationLifecycleService {
  return new InvestigationLifecycleService(
    store as unknown as LifecycleRepository,
    { estimate: () => Promise.resolve(ESTIMATE) } as unknown as ResearchEstimateService,
    {
      dispatch: () => Promise.resolve({}),
      requestCancel: () => Promise.resolve({ investigation: "RS-121", state: "cancelling" }),
    } as unknown as InvestigationDispatchService,
  );
}

type Operation = {
  responses: Record<
    string,
    {
      content: Record<string, { examples?: Record<string, { value: unknown }>; example?: unknown }>;
    }
  >;
};

/** The documented examples of an operation's success response. */
function examples(path: string, method: string, status: string): unknown[] {
  const paths = document().paths as unknown as Record<string, Record<string, Operation>>;
  const content = paths[path][method].responses[status].content["application/json"];

  return content.examples === undefined
    ? [content.example]
    : Object.values(content.examples).map((example) => example.value);
}

/** The events of the documented stream example. */
function streamExample(): { event: string; data: unknown }[] {
  const paths = document().paths as unknown as Record<string, Record<string, Operation>>;
  const text = paths[`${BASE}/{investigationId}/progress`].get.responses["200"].content[
    "text/event-stream"
  ].example as string;

  return text
    .trim()
    .split("\n\n")
    .map((frame) => {
      const [event, data] = frame.split("\n");
      return {
        event: event.replace("event: ", ""),
        data: JSON.parse(data.replace("data: ", "")) as unknown,
      };
    });
}

describe("the lifecycle contract", () => {
  it("documents the list: rows, counts and the quarter", async () => {
    const valid = validator("InvestigationList");
    const list = await service().list(WORKSPACE, {}, { limit: 25, offset: 0 }, NOW);

    expect(valid(list)).toBe(true);
    expect(valid.errors).toBeNull();
    expect(list.items).toHaveLength(4);
    // The contract is closed: a field the document does not name is refused.
    expect(valid({ ...list, extra: true })).toBe(false);
  });

  it("documents every row's link kind and pill state", async () => {
    const valid = validator("Investigation");
    const { items } = await service().list(WORKSPACE, {}, { limit: 25, offset: 0 }, NOW);

    expect(items.map((row) => row.link?.kind)).toEqual(["brief", "roadmap", "evidence", "run"]);
    for (const row of items) {
      expect(valid(row)).toBe(true);
    }
    expect(valid({ ...items[0], link: { kind: "brief", label: "brief ↑" } })).toBe(false);
    expect(valid({ ...items[0], pill: { ...items[0].pill, state: "done" } })).toBe(false);
  });

  it("documents the detail of a finished investigation and of a queued one", async () => {
    const valid = validator("InvestigationDetail");
    const store = new MemoryLifecycleStore();
    store.ledgers.set(investigationId(127), [{ tool: "web", count: 44 }]);

    for (const id of [investigationId(127), investigationId(121), investigationId(118)]) {
      const detail = await service(store).detail(WORKSPACE, CALLER, id);

      expect(valid(detail)).toBe(true);
      expect(valid.errors).toBeNull();
    }
  });

  it("documents a failed investigation's reason and an unpriced one's null spend", async () => {
    const valid = validator("InvestigationDetail");
    const failed = record({
      status: "failed",
      actuals: null,
      spendCents: null,
      estimate: { sources: { min: 1, max: 2 }, cost_cents: null },
      startedBy: null,
      loop: {
        iteration: 1,
        cancelRequestedAt: null,
        failureReason: "tool_exhaustion",
        failureDetail: "Every tool failed.",
        updatedAt: NOW,
      },
    });

    const detail = await service(new MemoryLifecycleStore([failed])).detail(
      WORKSPACE,
      CALLER,
      failed.id,
    );

    expect(valid(detail)).toBe(true);
    expect(valid.errors).toBeNull();
    expect(detail.failure?.reason).toBe("tool_exhaustion");
  });

  it("documents a start and a cancel", async () => {
    const started = await service().start(WORKSPACE, CALLER, {
      question: "Why?",
      kind: "gap_analysis",
      depth: "deep_dive",
    });
    const cancelled = await service(
      new MemoryLifecycleStore([rs121({ status: "running" })]),
    ).cancel(WORKSPACE, CALLER, investigationId(121));

    const start = validator("StartedInvestigation");
    const cancel = validator("CancelledInvestigation");
    expect(start(started)).toBe(true);
    expect(start.errors).toBeNull();
    expect(cancel(cancelled)).toBe(true);
    expect(cancel.errors).toBeNull();
  });

  it("documents the composer's payload", () => {
    const valid = validator("InvestigationStart");

    expect(valid({ question: "Why?", kind: "gap_analysis", depth: "quick" })).toBe(true);
    expect(valid({ question: "Why?", kind: "gap_analysis", depth: "quick", tools: ["web"] })).toBe(
      true,
    );
    expect(valid({ question: "   ", kind: "gap_analysis", depth: "quick" })).toBe(false);
    expect(valid({ question: "Why?", kind: "gap_analysis", depth: "quick", tools: [] })).toBe(
      false,
    );
    expect(valid({ question: "Why?", kind: "gap_analysis", depth: "quick", status: "x" })).toBe(
      false,
    );
  });

  it("documents the settings and their patch", async () => {
    const settings = validator("ResearchSettings");
    const patch = validator("ResearchSettingsPatch");

    expect(settings(await service().settings(WORKSPACE))).toBe(true);
    expect(settings({ startRole: "viewer" })).toBe(false);
    expect(patch({})).toBe(true);
    expect(patch({ startRole: "admin" })).toBe(true);
    expect(patch({ startRole: "owner" })).toBe(false);
  });

  it("documents every progress event the stream writes", async () => {
    const valid = validator("InvestigationProgressEvent");
    const reading = await service().progress(WORKSPACE, investigationId(121));

    for (const event of [
      { kind: "progress" as const, ...reading },
      { kind: "done" as const, ...reading, status: "cancelled" as const },
      progressFailure(new Error("boom")),
    ]) {
      // What is validated is what is written: the frame's own `data`.
      const data = JSON.parse(formatProgress(event).split("\ndata: ")[1]) as unknown;
      expect(valid(data)).toBe(true);
    }
    expect(valid({ kind: "keep-alive" })).toBe(false);
  });

  it.each([
    [BASE, "post", "201", "StartedInvestigation"],
    [BASE, "get", "200", "InvestigationList"],
    [`${BASE}/{investigationId}`, "get", "200", "InvestigationDetail"],
    [`${BASE}/{investigationId}/cancel`, "post", "200", "CancelledInvestigation"],
    ["/api/v1/research/settings", "get", "200", "ResearchSettings"],
    ["/api/v1/research/settings", "patch", "200", "ResearchSettings"],
  ])("gives %s %s a %s example its own schema accepts", (path, method, status, schema) => {
    const valid = validator(schema);
    const documented = examples(path, method, status);

    expect(documented.length).toBeGreaterThan(0);
    for (const example of documented) {
      expect(valid(example)).toBe(true);
      expect(valid.errors).toBeNull();
    }
  });

  it("gives the stream an example of start → progress → brief_ready, the count rising", () => {
    const valid = validator("InvestigationProgressEvent");
    const frames = streamExample();

    expect(frames.map((frame) => frame.event)).toEqual([
      "progress",
      "progress",
      "progress",
      "done",
    ]);
    for (const frame of frames) {
      expect(valid(frame.data)).toBe(true);
      expect((frame.data as { kind: string }).kind).toBe(frame.event);
    }
    const counts = frames.map((frame) => (frame.data as { sources: number }).sources);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(frames.at(-1)?.data).toMatchObject({ status: "brief_ready" });
  });
});

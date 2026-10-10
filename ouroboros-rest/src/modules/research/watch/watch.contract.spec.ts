import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document, internalDocument } from "../../../openapi/specification";
import type { AuditService } from "../../audit/audit.service";
import type { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import type { CodeBisectService } from "../code/code-bisect.service";
import type { ResearchToolRegistry } from "../tools/research-tool.registry";
import {
  BISECT_RESULT,
  FakeTelemetry,
  MemoryWatchStore,
  ORG,
  REPO,
  baseline,
  hoverMetric,
  item,
} from "./watch.fixture";
import type { WatchRepository } from "./watch.repository";
import { RegressionWatchService } from "./watch.service";

/**
 * The watch's answers are what `openapi.yaml` documents (CM.4, #623) — the real service's,
 * over an in-memory store, held to the schemas the UI's client is generated from.
 */

const BASE = "/api/v1/research/regression-watch";

function validator(name: string, source: () => { components?: unknown } = document) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: source().components });
  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

function world() {
  const store = new MemoryWatchStore();
  store.stored.set(ORG, {
    thresholds: { classes: { timing: { warn_pct: 3, err_pct: 9 } }, metrics: {} },
    metrics: [hoverMetric(), hoverMetric({ repo: "acme/console", replay: null })],
    autoBisect: true,
    autoFile: false,
    fixSourceId: null,
    lastComparedAt: null,
  });
  const service = new RegressionWatchService(
    store as unknown as WatchRepository,
    new FakeTelemetry().registry() as unknown as ResearchToolRegistry,
    { emit: () => Promise.resolve({}) } as unknown as DecisionKindRegistry,
    { cancel: () => Promise.resolve() } as unknown as CodeBisectService,
    { record: () => Promise.resolve() } as unknown as AuditService,
  );
  return { store, service };
}

type Operation = {
  requestBody?: {
    content: Record<string, { example?: unknown; examples?: Record<string, { value: unknown }> }>;
  };
  responses: Record<
    string,
    {
      content: Record<string, { example?: unknown; examples?: Record<string, { value: unknown }> }>;
    }
  >;
};

function operation(
  path: string,
  method: string,
  source: () => { paths?: unknown } = document,
): Operation {
  return (source().paths as Record<string, Record<string, Operation>>)[path][method];
}

function examplesOf(body: {
  example?: unknown;
  examples?: Record<string, { value: unknown }>;
}): unknown[] {
  return body.examples === undefined
    ? [body.example]
    : Object.values(body.examples).map((entry) => entry.value);
}

describe("the regression watch contract", () => {
  it("documents the card in every state an item can be in", async () => {
    const valid = validator("RegressionWatchCard");
    const { store, service } = world();
    store.baselines = [baseline()];
    store.rows = [
      item(),
      item({
        id: "17e00000-0000-4000-8000-000000000002",
        status: "detected",
        note: "needs repro: no replayable test",
      }),
      item({
        id: "17e00000-0000-4000-8000-000000000003",
        status: "bisected",
        bisectId: "b15ec700-0000-4000-8000-000000000001",
        bisectResult: BISECT_RESULT,
      }),
      item({
        id: "17e00000-0000-4000-8000-000000000004",
        status: "fixed_merged",
        severity: "ok",
        bisectResult: BISECT_RESULT,
        investigationId: "1e500000-0000-4000-8000-000000000131",
        investigationDisplayId: "RS-131",
        fixTicketRef: { kind: "ticket", id: "71c4e700-0000-4000-8000-000000000517", key: "#517" },
        prRef: { pull_request_id: "9a000000-0000-4000-8000-000000000641", key: "#641" },
      }),
      item({ id: "17e00000-0000-4000-8000-000000000005", status: "dismissed" }),
    ];

    const card = await service.card(ORG);

    expect(valid(card)).toBe(true);
    expect(valid.errors).toBeNull();
    expect(valid({ ...card, extra: true })).toBe(false);
    expect(valid(await service.card("org-empty"))).toBe(true);
  });

  it("documents the settings, the defaults they sit over, and a save", async () => {
    const settings = validator("RegressionWatchSettings");
    const save = validator("RegressionWatchSettingsSave");
    const { service } = world();

    const read = await service.settings(ORG);
    expect(settings(read)).toBe(true);
    expect(settings.errors).toBeNull();
    expect(settings(await service.settings("org-new"))).toBe(true);

    expect(save({})).toBe(true);
    expect(save({ metrics: read.metrics, autoFile: true, fixSourceId: null })).toBe(true);
    expect(
      save({ thresholds: { classes: { timing: { warnPct: 3, errPct: 9 } }, metrics: {} } }),
    ).toBe(true);
    expect(save({ autoFile: "yes" })).toBe(false);
    expect(save({ status: "dismissed" })).toBe(false);
    expect(
      save({
        metrics: [{ repository: "helios", source: "bi_metric", key: "merge_rate", class: "rate" }],
      }),
    ).toBe(false);
  });

  it("documents a capture, a comparison and a dismissal", async () => {
    const { store, service } = world();

    const captured = await service.capture(ORG, {
      repository: REPO,
      releaseTag: "v2.0.4",
      via: "manual",
      userId: "u",
    });
    const again = await service.capture(ORG, {
      repository: REPO,
      releaseTag: "v2.0.4",
      via: "manual",
      userId: "u",
    });
    const compared = await service.compare(ORG, new Date("2026-10-10T02:00:00Z"));
    const dismissed = await service.dismiss(ORG, "u", store.rows[0].id, "A sensor swap.");

    const capture = validator("RegressionBaselinesCaptured");
    expect(capture(captured)).toBe(true);
    expect(capture.errors).toBeNull();
    expect(capture(again)).toBe(true);
    const comparison = validator("RegressionComparison");
    expect(comparison(compared)).toBe(true);
    expect(comparison.errors).toBeNull();
    const row = validator("RegressionWatchItem");
    expect(row(dismissed)).toBe(true);
    expect(row.errors).toBeNull();
    expect(validator("RegressionBaselineCapture")({ repository: REPO, releaseTag: "v2.0.4" })).toBe(
      true,
    );
    expect(validator("RegressionBaselineCapture")({ repository: REPO, releaseTag: "v 2" })).toBe(
      false,
    );
    expect(validator("RegressionWatchDismissal")({ reason: "  " })).toBe(false);
  });

  it.each([
    [BASE, "get", "200", "RegressionWatchCard"],
    [`${BASE}/settings`, "get", "200", "RegressionWatchSettings"],
    [`${BASE}/settings`, "put", "200", "RegressionWatchSettings"],
    [`${BASE}/baselines`, "post", "201", "RegressionBaselinesCaptured"],
    [`${BASE}/comparisons`, "post", "200", "RegressionComparison"],
    [`${BASE}/items/{itemId}/dismiss`, "post", "200", "RegressionWatchItem"],
  ])("gives %s %s a %s example its own schema accepts", (path, method, status, schema) => {
    const valid = validator(schema);
    const documented = examplesOf(
      operation(path, method).responses[status].content["application/json"],
    );

    expect(documented.length).toBeGreaterThan(0);
    for (const example of documented) {
      expect(valid(example)).toBe(true);
      expect(valid.errors).toBeNull();
    }
  });

  it.each([
    [`${BASE}/settings`, "put", "RegressionWatchSettingsSave"],
    [`${BASE}/baselines`, "post", "RegressionBaselineCapture"],
    [`${BASE}/items/{itemId}/dismiss`, "post", "RegressionWatchDismissal"],
  ])("gives %s %s a request example its own schema accepts", (path, method, schema) => {
    const valid = validator(schema);
    const body = operation(path, method).requestBody?.content["application/json"];

    for (const example of examplesOf(body ?? {})) {
      expect(valid(example)).toBe(true);
      expect(valid.errors).toBeNull();
    }
  });

  it("documents the internal release announcement", async () => {
    const path = "/internal/research/regression-watch/releases";
    const { service } = world();
    const announced = {
      repository: REPO,
      releaseTag: "v2.0.4",
      ...(await service.released(REPO, "v2.0.4")),
    };
    const answer = validator("RegressionWatchReleaseAnnounced", internalDocument);
    const body = validator("RegressionWatchRelease", internalDocument);
    const documented = operation(path, "post", internalDocument);

    expect(answer(announced)).toBe(true);
    expect(answer.errors).toBeNull();
    expect(announced).toMatchObject({ workspaces: 1, captured: 1 });
    expect(answer(documented.responses["200"].content["application/json"].example)).toBe(true);
    expect(body(documented.requestBody?.content["application/json"].example)).toBe(true);
    expect(body({ repository: "helios", releaseTag: "v1" })).toBe(false);
    expect(body({ repository: REPO, releaseTag: "v1", organizationId: "org" })).toBe(false);
  });
});

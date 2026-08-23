import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  INVOKE_ERROR_CODES,
  INVOKE_EVENT_KINDS,
  INVOKE_MEDIA_TYPE,
  type InvokeEvent,
  type InvokeRequest,
} from "./invoke.contract";

/**
 * The specified half, held to the document that publishes it.
 *
 * Nothing here executes anything — there is nothing to execute until AF.2
 * ([#235](https://github.com/NobuData/ouroboros/issues/235)). What a suite *can* do for a
 * contract written before its implementation is make sure the two places it is written down
 * agree: these constants and `openapi.internal.yaml`. Without that, the document and the
 * types drift the moment somebody edits one of them, and the executor is built against
 * whichever they happened to read.
 *
 * The type-level assertions below compile or they do not; they are here because a shape is
 * the part of a contract a test cannot otherwise reach, and because AF.2 changing one should
 * be a deliberate edit to this file rather than a silent widening.
 */

/** The module root, where the internal specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

/** The internal specification, as data. */
const SPECIFICATION = JSON.parse(
  readFileSync(join(MODULE_ROOT, "openapi.internal.json"), "utf8"),
) as {
  paths: Record<string, Record<string, { responses: Record<string, { content: object }> }>>;
  components: { schemas: Record<string, { enum?: string[]; oneOf?: { $ref: string }[] }> };
};

describe("the streamed answer", () => {
  it("is newline-delimited JSON, and the document says the same", () => {
    // NDJSON rather than SSE: the reader is a worker process, not a browser, so reconnection
    // and event ids buy nothing and cost a framing layer on both sides.
    expect(INVOKE_MEDIA_TYPE).toBe("application/x-ndjson");
    expect(
      SPECIFICATION.paths["/internal/llm/invoke"].post.responses["200"].content,
    ).toHaveProperty(INVOKE_MEDIA_TYPE);
  });

  it("has one schema per event kind, and no more", () => {
    // Five kinds, five members of the union. A kind added to one place and not the other is
    // an executor emitting something no reader knows how to parse.
    const published = SPECIFICATION.components.schemas.InvokeEvent.oneOf ?? [];

    expect(published).toHaveLength(INVOKE_EVENT_KINDS.length);
    for (const kind of INVOKE_EVENT_KINDS) {
      const name = `Invoke${kind[0].toUpperCase()}${kind.slice(1)}Event`;
      expect(published.map((member) => member.$ref)).toContain(`#/components/schemas/${name}`);
    }
  });
});

describe("the error taxonomy", () => {
  it("publishes exactly the codes the types name", () => {
    // AB.1's per-hop rules. #235's first acceptance criterion is that an executor's failover
    // matches what routing's explanation promised a user, and that is only checkable if both
    // sides are reading one list.
    expect(SPECIFICATION.components.schemas.InvokeErrorCode.enum?.toSorted()).toEqual(
      Object.values(INVOKE_ERROR_CODES).toSorted(),
    );
  });

  it("names a rule for every code, in the document", () => {
    // A code without a stated behaviour is a code two implementations will treat differently.
    // The table in the schema's description is where the rule lives; this is what stops a
    // code being added without one.
    const described = JSON.stringify(SPECIFICATION.components.schemas.InvokeErrorCode);

    for (const code of Object.values(INVOKE_ERROR_CODES)) {
      expect(described).toContain(code);
    }
  });

  it.each(Object.values(INVOKE_ERROR_CODES))(
    "spells %s the way every other code is spelled",
    (code) => {
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    },
  );
});

describe("the request", () => {
  it("carries a target, a payload and a run context", () => {
    // A compile-time assertion: this is the shape AF.2 receives and the engine's stub sends,
    // and widening it should be an edit somebody made on purpose.
    const request: InvokeRequest = {
      alias: "reasoning-primary",
      payload: { messages: [] },
      runCtx: { run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94" },
    };

    expect(request.runCtx.run).toBeDefined();
  });

  it("names every AB.1 semantic in the run context", () => {
    // The hooks, as fields. An executor that was never handed a floor cannot be found to
    // have ignored one — which is why they are named here rather than left to AF.2.
    const request: InvokeRequest = {
      connection: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      payload: {},
      runCtx: {
        run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
        hop: 1,
        stage: "analyse",
        floorHopIndex: 2,
        costCapCents: 500,
        resolutionVersion: "r1",
        vote: true,
      },
    };

    expect(Object.keys(request.runCtx).toSorted()).toEqual([
      "costCapCents",
      "floorHopIndex",
      "hop",
      "resolutionVersion",
      "run",
      "stage",
      "vote",
    ]);
  });

  it("carries no credential, because the worker has none", () => {
    // The one thing this shape must never grow. The lint rule beside it is what refuses the
    // field; this is the statement of intent it enforces.
    const published = JSON.stringify(SPECIFICATION.components.schemas.InvokeRequest);

    expect(published).not.toMatch(/"(apiKey|token|secret|credential|password)"/i);
  });
});

describe("the events", () => {
  it("ends a stream with exactly one terminal kind", () => {
    const done: InvokeEvent = { kind: "done", hop: 0, finishReason: "stop" };
    const failed: InvokeEvent = {
      kind: "error",
      code: INVOKE_ERROR_CODES.floorExhausted,
      message: "The chain reached its floor.",
    };

    expect([done.kind, failed.kind]).toEqual(["done", "error"]);
  });

  it("prices an unpriced hop as null rather than zero", () => {
    // The honesty rule CH.3 (#586) already enforces: a local model's tokens are *unpriced*,
    // which is a different statement from *free*, and a zero here is spend nobody incurred
    // appearing in an aggregate.
    const usage: InvokeEvent = {
      kind: "usage",
      hop: 0,
      connection: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      model: "qwen3-coder:32b",
      inputTokens: 1200,
      outputTokens: 340,
      costCents: null,
    };

    expect(usage).toMatchObject({ costCents: null });
  });
});

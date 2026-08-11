import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import {
  ENGINE_ECHO_ROUTE,
  ENGINE_STATUS_ROUTE,
  INTERNAL_KEY_HEADER,
  echoRequestBody,
  echoResultSchema,
  engineRouteUrl,
  engineStatusSchema,
} from "./engine.contract";

/**
 * The mirror, and whether it still reflects.
 *
 * Two kinds of assertion. The parsing ones are about this side: `snake_case` becomes
 * `camelCase` exactly once, an added field is tolerated and a missing one is not. The last
 * group is about the *other* side — it reads `ouroboros-engine/openapi.yaml` and fails when
 * the routes, the header or the fields this file mirrors stop being what the engine
 * publishes. Without that group, a contract change in the engine is a green suite here and
 * a `502` in production.
 */

/** The parts of the engine's specification this file reads. */
interface EngineSpecification {
  paths: Record<string, unknown>;
  components: {
    securitySchemes: Record<string, { name: string; in: string }>;
    schemas: Record<string, { required: string[]; properties: Record<string, { $ref?: string }> }>;
  };
}

/** The engine's committed specification, from the sibling module. */
function engineDocument(): EngineSpecification {
  const path = join(__dirname, "..", "..", "..", "..", "ouroboros-engine", "openapi.yaml");

  return parse(readFileSync(path, "utf8")) as EngineSpecification;
}

describe("engineRouteUrl", () => {
  it("resolves a route against the engine's base URL", () => {
    expect(engineRouteUrl("http://engine:8000", ENGINE_STATUS_ROUTE)).toBe(
      "http://engine:8000/v0/status",
    );
  });

  it("does not double the separator when the base already ends in one", () => {
    expect(engineRouteUrl("http://engine:8000/", ENGINE_STATUS_ROUTE)).toBe(
      "http://engine:8000/v0/status",
    );
  });

  it("keeps a path the base URL carries", () => {
    // An engine behind a reverse proxy on /engine is a deployment decision this service
    // does not get to make, and `new URL` against a base with no trailing slash would
    // silently discard it.
    expect(engineRouteUrl("http://gateway/engine", ENGINE_ECHO_ROUTE)).toBe(
      "http://gateway/engine/v0/tasks/echo",
    );
  });
});

describe("the status schema", () => {
  it("renames the engine's fields to this service's", () => {
    const parsed = engineStatusSchema.parse({
      service: "ouroboros-engine",
      version: "0.3.0",
      uptime_seconds: 12.5,
    });

    expect(parsed).toEqual({ service: "ouroboros-engine", version: "0.3.0", uptimeSeconds: 12.5 });
  });

  it("ignores a field the engine added", () => {
    // `/v0`'s compatibility rule allows a response to grow a field. A client that refused
    // one would turn every forward-compatible engine release into an outage here.
    const parsed = engineStatusSchema.parse({
      service: "ouroboros-engine",
      version: "0.3.0",
      uptime_seconds: 12.5,
      queue_depth: 4,
    });

    expect(parsed).not.toHaveProperty("queue_depth");
  });

  it.each([
    ["a missing field", { service: "ouroboros-engine", version: "0.3.0" }],
    ["a field of the wrong type", { service: "e", version: 3, uptime_seconds: 1 }],
    ["an empty object", {}],
    ["a body that is not an object", "ouroboros-engine 0.3.0"],
    ["null", null],
  ])("refuses %s", (_description, body) => {
    expect(engineStatusSchema.safeParse(body).success).toBe(false);
  });
});

describe("the echo schema", () => {
  /** A well-formed answer, as the engine sends it. */
  const answer = {
    accepted: true,
    echo: { task_kind: "echo", payload: { note: "hello" } },
    engine_version: "0.3.0",
  };

  it("renames every field, at every depth", () => {
    expect(echoResultSchema.parse(answer)).toEqual({
      accepted: true,
      echo: { taskKind: "echo", payload: { note: "hello" } },
      engineVersion: "0.3.0",
    });
  });

  it("carries the payload through untouched", () => {
    const payload = { issue: { number: 52, labels: ["mvp"] }, dryRun: false, unset: null };

    const parsed = echoResultSchema.parse({ ...answer, echo: { task_kind: "plan", payload } });

    expect(parsed.echo.payload).toEqual(payload);
  });

  it("refuses an `accepted` that is not the documented `true`", () => {
    // The engine documents it as `const: true`, so `false` is an engine this client does
    // not understand rather than a task that was declined — and turning it into a `502` is
    // better than handing a caller a success with `accepted: false` in it.
    expect(echoResultSchema.safeParse({ ...answer, accepted: false }).success).toBe(false);
  });

  it("refuses a payload that is not an object", () => {
    const wrong = { ...answer, echo: { task_kind: "echo", payload: "hello" } };

    expect(echoResultSchema.safeParse(wrong).success).toBe(false);
  });
});

describe("echoRequestBody", () => {
  it("writes the only `snake_case` this service sends", () => {
    expect(echoRequestBody({ taskKind: "echo", payload: { note: "hello" } })).toEqual({
      task_kind: "echo",
      payload: { note: "hello" },
    });
  });

  it("round-trips through the schema that reads the answer back", () => {
    // The engine hands the request back under `echo`, so these two functions are inverses
    // across the boundary — and this is the assertion that keeps them so.
    const task = { taskKind: "plan.issue", payload: { number: 52 } };

    const parsed = echoResultSchema.parse({
      accepted: true,
      echo: echoRequestBody(task),
      engine_version: "0.3.0",
    });

    expect(parsed.echo).toEqual(task);
  });
});

describe("the engine's own specification", () => {
  it("serves the status route this client calls", () => {
    expect(engineDocument().paths).toHaveProperty(`/${ENGINE_STATUS_ROUTE}`);
  });

  it("serves the echo route this client calls", () => {
    expect(engineDocument().paths).toHaveProperty(`/${ENGINE_ECHO_ROUTE}`);
  });

  it("names the header this client sends the shared secret on", () => {
    const scheme = engineDocument().components.securitySchemes.InternalKey;

    expect(scheme.name).toBe(INTERNAL_KEY_HEADER);
    expect(scheme.in).toBe("header");
  });

  it.each([
    ["ServiceStatus", ["service", "version", "uptime_seconds"]],
    ["EchoRequest", ["task_kind", "payload"]],
    ["EchoResponse", ["accepted", "echo", "engine_version"]],
  ])("describes %s with the fields this client reads", (name, fields) => {
    // The schemas above ignore what they do not know about, which is the compatibility rule
    // working — and is also what would let a *removed* field go unnoticed until a call
    // failed. This is where that is caught instead.
    const schema = engineDocument().components.schemas[name];

    for (const field of fields) {
      expect(Object.keys(schema.properties)).toContain(field);
      expect(schema.required).toContain(field);
    }
  });

  it("still answers the echo route with the request shape under `echo`", () => {
    const schema = engineDocument().components.schemas.EchoResponse;

    expect(schema.properties.echo.$ref).toBe("#/components/schemas/EchoRequest");
  });
});

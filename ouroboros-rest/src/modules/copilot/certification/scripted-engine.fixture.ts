/**
 * The engine the copilot certification suites talk to (CD.6,
 * [#564](https://github.com/NobuData/ouroboros/issues/564)): a real listener that speaks the
 * engine's wire format for the three routes the copilot plane calls, and answers each from a
 * script.
 *
 * ```
 * POST /v0/copilot-workflow     the next scripted turn, as NDJSON
 * POST /v0/dry-runs             the next scripted run, as NDJSON
 * GET  /v0/dry-runs/harness     the description the engine's own contract commits to
 * POST /v0/workflows/validate   no findings
 * ```
 *
 * **Why a listener and not a replaced provider.** The issue's line is *provider calls are stubbed
 * at the gateway boundary*. Everything on this service's side of that boundary — the engine
 * client, its NDJSON reader, the schemas that turn the engine's names into this service's — is
 * what the suites are certifying, so none of it is replaced: `OURO_ENGINE_URL` points here and
 * the process's own `EngineClient` makes every call.
 *
 * **Why not `engine.stub.fixture.ts`.** That stub answers one JSON document per request and
 * checks it against the engine's schemas; a turn and a dry run are streams whose lines a suite
 * writes one by one. The harness description *is* read from the engine's committed document
 * ({@link harnessExample}), so the safety strip is asserted against what the engine publishes.
 */

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { parse } from "yaml";

import { ENGINE_WORKFLOW_VALIDATE_ROUTE, INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { ENGINE_COPILOT_ROUTE } from "../../engine/engine.copilot";
import { ENGINE_DRY_RUN_HARNESS_ROUTE, ENGINE_DRY_RUNS_ROUTE } from "../../engine/engine.dryruns";

/** One line of a stream, in the engine's own names. */
export type WireEvent = Record<string, unknown>;

/** A request body the engine accepted, in the engine's own names. */
export type WireRequest = Record<string, unknown>;

/** A turn's script: the lines to answer with, or a function of the request that makes them. */
export type TurnScript = readonly WireEvent[] | ((request: WireRequest) => readonly WireEvent[]);

/** A dry run's script, likewise. */
export type RunScript = readonly WireEvent[] | ((request: WireRequest) => readonly WireEvent[]);

/** The scripted engine, as a suite holds it. */
export interface ScriptedEngine {
  /** Where it listens, as `OURO_ENGINE_URL` wants it. */
  readonly url: string;
  /** Every turn request received, oldest first. */
  readonly turns: WireRequest[];
  /** Every dry-run request received, oldest first. */
  readonly runs: WireRequest[];
  /** Every request to a route the copilot plane has no business calling, as `METHOD path`. */
  readonly strays: string[];
  /**
   * Queue the next turns. Each request takes the oldest script; with none left the turn is a
   * plain `done`, which ends an exchange.
   */
  script(...turns: TurnScript[]): void;
  /** Queue the next dry runs. With none left a run is answered `502`. */
  scriptRun(...runs: RunScript[]): void;
  /** Forget what was received and what was queued. */
  reset(): void;
  /** Stop listening. */
  stop(): Promise<void>;
}

/** `ouroboros-engine/openapi.yaml`, from this file. */
const ENGINE_SPECIFICATION = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "ouroboros-engine",
  "openapi.yaml",
);

/**
 * The harness description the engine's contract documents as its `200` example.
 *
 * @returns The example body, in the engine's names.
 * @throws {Error} When the document no longer carries one — the safety suite would otherwise
 *   assert against a description nobody published.
 */
export function harnessExample(): Record<string, unknown> {
  const document = parse(readFileSync(ENGINE_SPECIFICATION, "utf8")) as {
    paths?: Record<string, { get?: { responses?: Record<string, unknown> } }>;
  };
  const answer = document.paths?.[`/${ENGINE_DRY_RUN_HARNESS_ROUTE}`]?.get?.responses?.["200"] as
    | {
        content?: Record<
          string,
          { example?: unknown; examples?: Record<string, { value?: unknown }> }
        >;
      }
    | undefined;
  const media = answer?.content?.["application/json"];
  const example = media?.example ?? Object.values(media?.examples ?? {})[0]?.value;

  if (typeof example !== "object" || example === null) {
    throw new Error(
      `ouroboros-engine/openapi.yaml no longer documents an example for GET /${ENGINE_DRY_RUN_HARNESS_ROUTE}.`,
    );
  }

  return example as Record<string, unknown>;
}

/* ------------------------------------------------------------------ lines a script is made of */

/** A fragment of reply text. */
export function delta(text: string): WireEvent {
  return { kind: "delta", text };
}

/**
 * A tool call the model made.
 *
 * @param id - The call's id; a script's ids must be unique within a turn.
 * @param tool - The tool.
 * @param args - Its arguments, or `null` with an `error` for a call the engine could not parse.
 * @param error - Why the engine could not parse it.
 * @returns The line.
 */
export function toolCall(
  id: string,
  tool: string,
  args: Record<string, unknown> | null,
  error: string | null = null,
): WireEvent {
  return { kind: "tool_call", id, tool, arguments: args, error };
}

/** What a turn consumed. `costCents` is `null` for an unpriced model. */
export function usage(
  inputTokens: number,
  outputTokens: number,
  costCents: number | null,
): WireEvent {
  return {
    kind: "usage",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_cents: costCents,
    model: "scripted-model",
    connection: "scripted",
  };
}

/** The end of a turn. */
export function done(finishReason = "stop"): WireEvent {
  return { kind: "done", finish_reason: finishReason };
}

/** A failure the engine reports in the stream. */
export function failure(code: string, message: string): WireEvent {
  return { kind: "error", code, message };
}

/** One stage of a dry run, with the fields a script usually leaves alone filled in. */
export function stage(
  seq: number,
  key: string,
  fields: Partial<{
    display_name: string;
    nodes: string[];
    verdict: "ok" | "skipped" | "failed" | "not_reached";
    how: "llm" | "replayed" | "deterministic" | "skipped";
    note: string;
    metrics: Record<string, unknown>;
    skip_reason: string | null;
    skip_kind: string | null;
    skip_input: string | null;
  }> = {},
): WireEvent {
  return {
    seq,
    stage_key: key,
    display_name: key,
    nodes: [key],
    verdict: "ok",
    how: "llm",
    note: "completed",
    metrics: {},
    skip_reason: null,
    skip_kind: null,
    skip_input: null,
    started_at: "2026-10-11T00:00:00Z",
    finished_at: "2026-10-11T00:00:01Z",
    ...fields,
  };
}

/**
 * A whole dry run as the harness streams it: each stage started and finished, then `done` with
 * the result.
 *
 * @param request - The request being answered; its `dry_run` is echoed, as the engine does.
 * @param stages - The stage rows, from {@link stage}.
 * @param result - What to change in the result: status, artifacts, guard audit, cost.
 * @returns The lines.
 */
export function runOf(
  request: WireRequest,
  stages: readonly WireEvent[],
  result: Record<string, unknown> = {},
): WireEvent[] {
  const audit =
    (result.guard_audit as
      { guard: string; call: string; stage_key: string | null }[] | undefined) ?? [];

  return [
    ...stages.flatMap((row) => [
      {
        kind: "stage_started",
        seq: row.seq,
        stage_key: row.stage_key,
        display_name: row.display_name,
      },
      { kind: "stage_finished", stage: row },
    ]),
    ...audit.map((entry) => ({
      kind: "guard_blocked",
      guard: entry.guard,
      call: entry.call,
      stage_key: entry.stage_key ?? "",
    })),
    {
      kind: "done",
      result: {
        dry_run: request.dry_run,
        harness: "scripted-harness",
        status: "complete",
        failure_reason: null,
        findings: [],
        stages,
        artifacts: [],
        guard_audit: [],
        guards_clean: audit.length === 0,
        tokens: 1200,
        cost_cents: 3,
        duration_ms: 1000,
        workspace_notes: [],
        ...result,
      },
    },
  ];
}

/* ------------------------------------------------------------------ the listener */

/**
 * Start the scripted engine.
 *
 * @param sharedSecret - The key every call must carry; a call without it is answered `401`, as
 *   the engine answers it.
 * @returns The engine, listening on a loopback port of its own.
 */
export async function startScriptedEngine(sharedSecret: string): Promise<ScriptedEngine> {
  const turns: WireRequest[] = [];
  const runs: WireRequest[] = [];
  const strays: string[] = [];
  const turnScripts: TurnScript[] = [];
  const runScripts: RunScript[] = [];
  const harness = harnessExample();

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const path = new URL(request.url ?? "/", "http://engine.invalid").pathname;
      const route = `${request.method ?? "GET"} ${path}`;
      const json = (status: number, body: unknown): void => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      const stream = (lines: readonly WireEvent[]): void => {
        response.writeHead(200, { "content-type": "application/x-ndjson" });
        response.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
      };

      if (route === "GET /healthz") return json(200, { status: "ok" });
      if (request.headers[INTERNAL_KEY_HEADER.toLowerCase()] !== sharedSecret) {
        return json(401, {
          code: "unauthorized",
          message: "The internal key is missing.",
          details: {},
        });
      }

      const raw = Buffer.concat(chunks).toString("utf8");
      const body = (raw === "" ? {} : JSON.parse(raw)) as WireRequest;

      switch (route) {
        case `POST /${ENGINE_COPILOT_ROUTE}`: {
          turns.push(body);
          const next = turnScripts.shift() ?? [done()];
          return stream(typeof next === "function" ? next(body) : next);
        }
        case `POST /${ENGINE_DRY_RUNS_ROUTE}`: {
          runs.push(body);
          const next = runScripts.shift();
          if (next === undefined) {
            return json(502, {
              code: "unscripted",
              message: "No dry run was scripted.",
              details: {},
            });
          }
          return stream(typeof next === "function" ? next(body) : next);
        }
        case `GET /${ENGINE_DRY_RUN_HARNESS_ROUTE}`:
          return json(200, harness);
        case `POST /${ENGINE_WORKFLOW_VALIDATE_ROUTE}`:
          return json(200, { findings: [] });
        default:
          strays.push(route);
          return json(404, { code: "not_found", message: "No such route.", details: {} });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    turns,
    runs,
    strays,
    script: (...next) => {
      turnScripts.push(...next);
    },
    scriptRun: (...next) => {
      runScripts.push(...next);
    },
    reset: () => {
      turns.length = 0;
      runs.length = 0;
      strays.length = 0;
      turnScripts.length = 0;
      runScripts.length = 0;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

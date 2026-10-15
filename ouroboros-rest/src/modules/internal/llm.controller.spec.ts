import { HttpStatus } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { INTERNAL_ONLY } from "./internal.decorators";
import { INTERNAL_ERRORS, invokeTargetInvalid } from "./internal.errors";
import { INVOKE_ROUTE, LLM_PATH } from "./internal.paths";
import {
  INVOCATION_GATEWAY_AVAILABLE,
  INVOKE_MEDIA_TYPE,
  type InvokeEvent,
} from "./invoke.contract";
import type { InvokeRequestDto } from "./invoke/invoke.dto";
import type { InvokeService } from "./invoke/invoke.service";
import { LlmController, type NdjsonResponse } from "./llm.controller";

/**
 * The route, streaming.
 *
 * The walk itself is `invoke/invoke.executor.spec.ts`'s; what is asserted here is the shape
 * of the surface AD.3 specified and AF.2 (#235) implemented — the path, the verb, the guard
 * metadata, and that everything after `prepare` is NDJSON on a `200`.
 */

/** A response that records what was written to it. */
function recordingResponse(): NdjsonResponse & {
  readonly lines: string[];
  readonly headers: Map<string, string>;
  ended: boolean;
  statusCode: number;
  close(): void;
} {
  const listeners: (() => void)[] = [];
  const response = {
    lines: [] as string[],
    headers: new Map<string, string>(),
    ended: false,
    statusCode: 0,
    status(code: number) {
      response.statusCode = code;
    },
    setHeader(name: string, value: string) {
      response.headers.set(name, value);
    },
    write(chunk: string) {
      response.lines.push(chunk);
    },
    end() {
      response.ended = true;
    },
    on(_event: "close", listener: () => void) {
      listeners.push(listener);
    },
    close() {
      for (const listener of listeners) listener();
    },
  };

  return response;
}

const BODY = {
  alias: "reasoning-primary",
  payload: {},
  runCtx: { run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94" },
} as InvokeRequestDto;

describe("what it answers", () => {
  it("streams every event as one NDJSON line on a 200", async () => {
    const events: InvokeEvent[] = [
      { kind: "delta", hop: 0, text: "hi" },
      { kind: "done", hop: 0, finishReason: "stop" },
    ];
    const service = {
      prepare: jest.fn().mockResolvedValue({}),
      stream: jest.fn(
        (_prepared: unknown, _signal: AbortSignal, emit: (event: InvokeEvent) => void) => {
          events.forEach(emit);

          return Promise.resolve();
        },
      ),
    } as unknown as InvokeService;
    const response = recordingResponse();

    await new LlmController(service).invoke(BODY, response);

    expect(response.statusCode).toBe(HttpStatus.OK);
    expect(response.headers.get("content-type")).toBe(INVOKE_MEDIA_TYPE);
    expect(response.lines).toEqual(events.map((event) => `${JSON.stringify(event)}\n`));
    expect(response.ended).toBe(true);
  });

  it("refuses before streaming when prepare refuses", async () => {
    const service = {
      prepare: jest.fn().mockRejectedValue(invokeTargetInvalid()),
      stream: jest.fn(),
    } as unknown as InvokeService;
    const response = recordingResponse();

    await expect(new LlmController(service).invoke(BODY, response)).rejects.toMatchObject({
      code: INTERNAL_ERRORS.invokeTargetInvalid,
    });
    expect(response.statusCode).toBe(0);
    expect(response.lines).toEqual([]);
  });

  it("aborts the walk when the worker disconnects", async () => {
    let seen: AbortSignal | undefined;
    const response = recordingResponse();
    const service = {
      prepare: jest.fn().mockResolvedValue({}),
      stream: jest.fn(
        (_prepared: unknown, signal: AbortSignal, emit: (event: InvokeEvent) => void) => {
          seen = signal;
          response.close();
          emit({ kind: "delta", hop: 0, text: "x" });

          return Promise.resolve();
        },
      ),
    } as unknown as InvokeService;

    await new LlmController(service).invoke(BODY, response);

    expect(seen?.aborted).toBe(true);
    expect(response.ended).toBe(true);
  });

  it("is reported available, now that it answers", () => {
    // What Research's page reads (`GET /research/settings` § `gateway`, #633).
    expect(INVOCATION_GATEWAY_AVAILABLE).toBe(true);
  });
});

describe("how the route is declared", () => {
  it("sits at the path the contract publishes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, LlmController)).toBe(LLM_PATH);
    expect(Reflect.getMetadata(PATH_METADATA, LlmController.prototype.invoke)).toBe(INVOKE_ROUTE);
  });

  it("is a POST", () => {
    expect(Reflect.getMetadata(METHOD_METADATA, LlmController.prototype.invoke)).toBe(1);
  });

  it("is marked internal, so the key is required before anything else", () => {
    // An unauthenticated caller must learn nothing about this path, and a model call
    // reachable by anybody would be spend anybody could make.
    expect(Reflect.getMetadata(INTERNAL_ONLY, LlmController)).toBe(true);
  });

  it("is exempt from the session, like the rest of the surface", () => {
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, LlmController)).toBe(true);
  });
});

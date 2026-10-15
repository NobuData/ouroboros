/**
 * `POST /internal/llm/invoke` — the chain executor's surface.
 *
 * AD.3 ([#224](https://github.com/NobuData/ouroboros/issues/224)) specified it and answered
 * `501` until AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)) replaced that
 * method body with the executor, as the contract promised: nothing about the path, the guard,
 * the document or the engine's client changed.
 *
 * ```
 * body ─▶ ValidationPipe (422) ─▶ InvokeService.prepare (404 / 422) ─▶ 200 application/x-ndjson
 *                                                                       one InvokeEvent per line
 * ```
 *
 * Everything that can be refused as an HTTP status is refused before the first byte; from the
 * `200` on, every outcome — a failover, a cap, an exhausted chain — is an event in the stream
 * (`invoke.contract.ts` decision 3). A caller that disconnects aborts the walk: the hop in
 * flight is cancelled and its usage so far is still stored.
 */

import { Body, Controller, HttpCode, HttpStatus, Post, Res, VERSION_NEUTRAL } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "./internal.decorators";
import { INVOKE_ROUTE, LLM_PATH } from "./internal.paths";
import { INVOKE_MEDIA_TYPE, type InvokeEvent } from "./invoke.contract";
import { InvokeRequestDto } from "./invoke/invoke.dto";
import { InvokeService } from "./invoke/invoke.service";

/** What the controller needs of the response it streams to. */
export interface NdjsonResponse {
  /** Set the status. */
  status(code: number): unknown;
  /** Set a header. */
  setHeader(name: string, value: string): unknown;
  /** Send the headers now, so the worker sees the stream open before the first event. */
  flushHeaders?(): unknown;
  /** Write one chunk. */
  write(chunk: string): unknown;
  /** End the stream. */
  end(): unknown;
  /** The connection closed — the worker left, or the stream ended. */
  on(event: "close", listener: () => void): unknown;
}

/**
 * One event as one NDJSON line.
 *
 * @param event - The event.
 * @returns Its JSON and a newline.
 */
export function ndjsonLine(event: InvokeEvent): string {
  return `${JSON.stringify(event)}\n`;
}

@InternalOnly()
@AllowAnonymous()
@Controller({ path: LLM_PATH, version: VERSION_NEUTRAL })
export class LlmController {
  constructor(private readonly invocations: InvokeService) {}

  /**
   * Make a model call on a worker's behalf and stream the answer.
   *
   * Authenticated first, like every route on this surface: a caller without the internal key
   * is told `401` and learns nothing more.
   *
   * @param body - The request.
   * @param response - Written directly, as `application/x-ndjson`.
   * @returns When the stream has ended.
   * @throws {InvalidRequestError} `422` for a body the pipe refuses, `invoke_target_invalid`,
   *   `invoke_model_required` or `alias_unavailable` — before any byte is streamed.
   * @throws {NotFoundError} `404 run_not_found`, `alias_not_found` or `connection_not_found`.
   */
  @Post(INVOKE_ROUTE)
  @HttpCode(HttpStatus.OK)
  async invoke(@Body() body: InvokeRequestDto, @Res() response: NdjsonResponse): Promise<void> {
    const prepared = await this.invocations.prepare(body);
    const gone = new AbortController();

    response.on("close", () => {
      gone.abort();
    });
    response.status(HttpStatus.OK);
    response.setHeader("content-type", INVOKE_MEDIA_TYPE);
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("x-accel-buffering", "no");
    response.flushHeaders?.();

    try {
      // Written as each event happens. Not backpressured, as the AF.1 prototype was not: a
      // worker reads its stream promptly, and what one answer can buffer is that answer.
      await this.invocations.stream(prepared, gone.signal, (event) => {
        response.write(ndjsonLine(event));
      });
    } finally {
      response.end();
    }
  }
}

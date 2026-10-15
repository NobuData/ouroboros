/**
 * `POST /internal/harness/anthropic/v1/messages` (and `…/count_tokens`) — the facade a stage
 * harness reaches as its `ANTHROPIC_BASE_URL` (DH.2, [#1303](https://github.com/NobuData/ouroboros/issues/1303)).
 *
 * **Not behind the internal key.** The Claude Agent SDK can present one secret — its
 * `ANTHROPIC_API_KEY` — and that is the run-scoped credential, which is this route's whole
 * authentication (decision of #1303). Like every `/internal/*` path it is reachable on the
 * internal network only, and outside it the credential is useless: it names no provider and
 * opens no key.
 *
 * Every answer is written by hand, as the Messages API writes it: a relayed success or upstream
 * error byte for byte, a facade refusal in the API's error shape.
 */

import { Body, Controller, Post, Req, Res, VERSION_NEUTRAL } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import type { MessagesRelayPath } from "../../providers/provider.adapter";
import {
  HARNESS_ANTHROPIC_PATH,
  HARNESS_COUNT_TOKENS_ROUTE,
  HARNESS_MESSAGES_ROUTE,
} from "../internal.paths";
import { HarnessCredentialsService } from "./harness.credentials.service";
import { HarnessFacadeService, writeRefusal, type RelaySink } from "./harness.facade.service";

/** What the controller reads of the request. */
export interface FacadeRequest {
  readonly headers: Readonly<Record<string, unknown>>;
}

/** What the controller needs of the response it writes. */
export interface FacadeResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
  flushHeaders?(): unknown;
  write(chunk: Uint8Array): unknown;
  end(): unknown;
  on(event: "close", listener: () => void): unknown;
}

/**
 * A response as a {@link RelaySink}.
 *
 * @param response - The response.
 * @returns The sink. Headers are flushed at once, so the harness sees the stream open before
 *   the first event.
 */
export function sinkOf(response: FacadeResponse): RelaySink {
  return {
    head: (status, headers) => {
      response.status(status);

      for (const [name, value] of Object.entries(headers)) {
        response.setHeader(name, value);
      }

      response.flushHeaders?.();
    },
    write: (chunk) => {
      response.write(chunk);
    },
    end: () => {
      response.end();
    },
  };
}

@AllowAnonymous()
@Controller({ path: HARNESS_ANTHROPIC_PATH, version: VERSION_NEUTRAL })
export class HarnessFacadeController {
  constructor(
    private readonly credentials: HarnessCredentialsService,
    private readonly facade: HarnessFacadeService,
  ) {}

  /**
   * One Messages call.
   *
   * @param body - The harness's request, an open list of fields.
   * @param request - For the credential and the forwarded headers.
   * @param response - Written directly.
   */
  @Post(HARNESS_MESSAGES_ROUTE)
  async messages(
    @Body() body: unknown,
    @Req() request: FacadeRequest,
    @Res() response: FacadeResponse,
  ): Promise<void> {
    await this.answer("/v1/messages", body, request, response);
  }

  /**
   * One token count — relayed, and not metered: counting spends nothing.
   *
   * @param body - The harness's request.
   * @param request - For the credential and the forwarded headers.
   * @param response - Written directly.
   */
  @Post(HARNESS_COUNT_TOKENS_ROUTE)
  async countTokens(
    @Body() body: unknown,
    @Req() request: FacadeRequest,
    @Res() response: FacadeResponse,
  ): Promise<void> {
    await this.answer("/v1/messages/count_tokens", body, request, response);
  }

  /**
   * Authenticate, then relay.
   *
   * @param path - Which Messages route.
   * @param body - The request body.
   * @param request - The request.
   * @param response - The response.
   */
  private async answer(
    path: MessagesRelayPath,
    body: unknown,
    request: FacadeRequest,
    response: FacadeResponse,
  ): Promise<void> {
    const sink = sinkOf(response);
    const binding = await this.credentials.authenticate(request.headers);

    if ("status" in binding) {
      writeRefusal(sink, binding);
      return;
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      sink.head(400, { "content-type": "application/json" });
      sink.write(
        new TextEncoder().encode(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "The body must be a JSON object." },
          }),
        ),
      );
      sink.end();
      return;
    }

    const gone = new AbortController();

    response.on("close", () => {
      gone.abort();
    });

    await this.facade.relay(
      {
        path,
        binding,
        body: body as Record<string, unknown>,
        headers: request.headers,
        signal: gone.signal,
      },
      sink,
    );
  }
}

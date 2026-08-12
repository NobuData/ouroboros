/**
 * The only place this service calls `ouroboros-engine`, and the shape of that boundary.
 *
 * `docs/ARCHITECTURE.md` § 3.2: the UI never calls the engine; it calls this service, and
 * this service calls the engine. Everything that is true of *every* such call is decided
 * here rather than at each call site — the base URL, the shared secret, a deadline, one
 * retry, and the mapping of every possible failure onto one `502`.
 *
 * Bare `fetch` rather than a client library: Node 24 has one, this is two routes, and
 * `@nestjs/axios` would add an interceptor stack and an RxJS surface in exchange for a base
 * URL and a header. (`auth/github.ts` made the same call for the same reason until #702
 * replaced it with BetterAuth's provider, which brings its own fetch wrapper.)
 *
 * Four rules hold for every call below:
 *
 *   * **Every call is bounded.** {@link ENGINE_TIMEOUT_MS} on all of them, aborted rather
 *     than raced — an abort actually ends the request, so a gateway under load does not
 *     accumulate a socket per abandoned call against an engine that is already struggling.
 *   * **One retry, and only for a failure that proves nothing was delivered.** See
 *     {@link RETRYABLE_CONNECT_CODES}. A deadline is not retried (the caller's patience is
 *     already spent), and neither is an answer — an engine that said `500` will say it
 *     again, and a `POST` that may have arrived must not be sent twice.
 *   * **Nothing the engine says reaches a client.** Every failure becomes
 *     {@link engineUnavailable}, and the engine's own body is never read on a failure path.
 *     Its error envelope is written for this service, and its `401` in particular must not
 *     become a `401` here (`engine.errors.ts`).
 *   * **The diagnosis goes to the log.** The URL, the status, the failing code and the
 *     validation failure are all in the service log, where an operator inside the cluster
 *     reads them, and none of them are in the answer.
 *
 * Circuit breaking is deliberately not here. With one retry and a bounded deadline, a
 * client waits at most one timeout for an engine that is down; a breaker's value is in
 * *shedding* that load across many concurrent callers, which is a v2 decision the roadmap
 * records rather than a default worth guessing at now.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type { ZodType } from "zod";

import { AppConfigService } from "../config/config.service";
import { describeForLog, failureCode } from "../errors/failure";
import {
  ENGINE_ECHO_ROUTE,
  ENGINE_STATUS_ROUTE,
  INTERNAL_KEY_HEADER,
  echoRequestBody,
  echoResultSchema,
  engineRouteUrl,
  engineStatusSchema,
  type EchoResult,
  type EchoTask,
  type EngineStatus,
} from "./engine.contract";
import { engineUnavailable } from "./engine.errors";

/**
 * How long any single call to the engine may take, in milliseconds.
 *
 * Longer than the readiness probe's two seconds (`health/probe.ts`), and the comparison is
 * the reason: a probe answers a healthcheck that has its own short timeout, while this holds
 * a request a person is watching a spinner for, over a hop that is inside the cluster — so a
 * call that has not answered in five seconds has told us what we needed to know.
 *
 * It is deliberately *shorter* than a call to a third party would be. BetterAuth's own
 * deadline governs the GitHub round trips now (#702); those hold a browser mid-redirect,
 * which it will wait through, and this does not.
 */
export const ENGINE_TIMEOUT_MS = 5_000;

/**
 * The socket failures worth one more attempt.
 *
 * Every code here means the request was *never delivered*: nothing was listening
 * (`ECONNREFUSED`), or the name did not resolve (`ENOTFOUND`, `EAI_AGAIN`) — which is what a
 * pod being replaced or a DNS record settling looks like from this side, and is worth
 * retrying because the second attempt usually lands on the new one.
 *
 * `ECONNRESET` is deliberately absent. A connection that was established and then reset may
 * have delivered the request, and a task the engine has already accepted must not be sent a
 * second time because this side never saw the answer. `status()` would survive it and
 * `echo()` might not, and a retry rule that is safe for one route and not the other is a
 * rule nobody can apply to the next route.
 */
export const RETRYABLE_CONNECT_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/** How many attempts a retryable failure gets in total — the original, and one more. */
export const MAX_ATTEMPTS = 2;

/** The status the engine answers when the two sides hold different shared secrets. */
const ENGINE_UNAUTHORIZED = 401;

/** The typed client every engine call goes through. */
@Injectable()
export class EngineClient {
  /** Where the real failure goes. The client gets a constant; see this file's header. */
  private readonly logger = new Logger(EngineClient.name);

  /**
   * @param config - Typed configuration, for `OURO_ENGINE_URL` and
   *   `OURO_ENGINE_SHARED_SECRET`. Injected rather than read, because nothing outside
   *   `src/modules/config/` names an environment variable
   *   ([#28](https://github.com/NobuData/ouroboros/issues/28)).
   * @param fetchImpl - How a request is made. Defaults to the runtime's `fetch`; the seam
   *   exists so the specs beside this file exercise the retry, the deadline and the failure
   *   mapping against responses they construct rather than against a running engine.
   *   `@Optional()` because Nest has no provider for a bare function type and would refuse
   *   to construct this — marked optional it supplies `undefined`, which is what makes the
   *   default parameter apply.
   */
  constructor(
    private readonly config: AppConfigService,
    @Optional() private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Ask the engine which build is answering, and for how long it has been.
   *
   * @returns The engine's status, parsed and in this service's names.
   * @throws {UpstreamError} `engine_unavailable` for every way this can fail — see
   *   {@link call}.
   */
  async status(): Promise<EngineStatus> {
    return this.call(ENGINE_STATUS_ROUTE, engineStatusSchema);
  }

  /**
   * Send a task to the engine's echo route and read what came back.
   *
   * The contract exemplar rather than a feature: it is the round trip that proves this
   * service, its configuration and the engine agree, which is what the end-to-end smoke
   * test drives ([#56](https://github.com/NobuData/ouroboros/issues/56)) and what the next
   * real engine operation is written against.
   *
   * @param task - The task to send. Its `payload` is opaque to this service.
   * @returns The engine's answer, parsed and in this service's names.
   * @throws {UpstreamError} `engine_unavailable` — including when the engine *refused* the
   *   task as invalid. A `422` from the engine means this service sent a body its own
   *   contract does not describe, which is a bug here rather than something a client can
   *   act on; it is logged with the status, like any other refusal.
   */
  async echo(task: EchoTask): Promise<EchoResult> {
    return this.call(ENGINE_ECHO_ROUTE, echoResultSchema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(echoRequestBody(task)),
    });
  }

  /**
   * Make one call, with the deadline, the retry and the parsing every call needs.
   *
   * @param route - A route relative to `OURO_ENGINE_URL`, from `engine.contract.ts`.
   * @param schema - What the answer must be. Parsed rather than asserted; see that file.
   * @param init - Method, headers and body for anything that is not a plain `GET`.
   * @returns The parsed body, in this service's names.
   * @throws {UpstreamError} `engine_unavailable` for a transport failure, a deadline, a
   *   non-2xx status, a body that is not JSON, or a body that is not the contract. One
   *   answer, because a client can act on exactly one of them.
   */
  private async call<T>(route: string, schema: ZodType<T>, init: RequestInit = {}): Promise<T> {
    const url = engineRouteUrl(this.config.engineUrl, route);
    const response = await this.send(url, init);

    if (!response.ok) {
      // The body is never read: it is the engine's error envelope, written for this
      // service, and forwarding any of it would publish an internal contract as this
      // API's. Cancelling gives the socket back to undici's pool immediately rather than
      // when the garbage collector gets to it.
      await response.body?.cancel();

      if (response.status === ENGINE_UNAUTHORIZED) {
        // Named separately because it is the one failure here that is *this deployment's*
        // to fix and would otherwise be indistinguishable from an engine that is simply
        // unwell. `docs/ARCHITECTURE.md` § 3.2's third acceptance criterion.
        this.logger.error(
          `${this.describe(init)} ${url} was refused: OURO_ENGINE_SHARED_SECRET does not ` +
            "match the value ouroboros-engine holds. The client is told the engine is " +
            "unavailable, never that it was unauthorised.",
        );
      } else {
        this.logger.error(`${this.describe(init)} ${url} responded ${response.status}`);
      }

      throw engineUnavailable();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      this.logger.error(`${this.describe(init)} ${url} answered with a body that is not JSON`, {
        cause: error,
      });
      throw engineUnavailable();
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      // The engine's contract allows fields to be *added*, and this parse ignores those —
      // so reaching here means a field this service reads is missing or has changed type,
      // which is a contract break rather than a version skew. The issues are logged; the
      // body they came from is not, because it is data from another service.
      this.logger.error(
        `${this.describe(init)} ${url} answered outside the /v0 contract: ` +
          JSON.stringify(parsed.error.issues),
      );
      throw engineUnavailable();
    }

    return parsed.data;
  }

  /**
   * Perform the request, retrying once when nothing was delivered.
   *
   * @param url - The absolute URL to call.
   * @param init - Method, headers and body.
   * @returns Whatever the engine answered, whether or not it is a success.
   * @throws {UpstreamError} `engine_unavailable` when the last attempt did not produce an
   *   answer at all — a refused connection, an unresolvable name, or the deadline.
   */
  private async send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.fetchImpl(url, {
          ...init,
          headers: { ...this.headers(), ...init.headers },
          // Built per attempt, deliberately: a signal that has already fired aborts the
          // retry before it is sent, which would make the second attempt a formality.
          signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
        });
      } catch (error) {
        const retryable = attempt < MAX_ATTEMPTS && isRetryable(error);

        this.logger.error(
          `${this.describe(init)} ${url} failed (attempt ${attempt}${retryable ? ", retrying" : ""})`,
          describeForLog(error),
        );

        if (!retryable) {
          throw engineUnavailable();
        }
      }
    }
  }

  /**
   * The headers every call carries.
   *
   * @returns The shared secret and the media type this service accepts. The secret is read
   *   per call rather than cached, so nothing here holds a copy of it beyond the call —
   *   and it is never logged, right or wrong.
   */
  private headers(): Record<string, string> {
    return {
      [INTERNAL_KEY_HEADER]: this.config.engineSharedSecret,
      accept: "application/json",
    };
  }

  /**
   * How a call is named in a log line.
   *
   * @param init - The request's options.
   * @returns Its method, upper-cased, defaulting to `GET` as `fetch` itself does.
   */
  private describe(init: RequestInit): string {
    return (init.method ?? "GET").toUpperCase();
  }
}

/**
 * Was this failure one that proves the request was never delivered?
 *
 * `fetch` reports a transport failure as a `TypeError` reading "fetch failed" and hangs the
 * real cause — the one carrying the code — off `cause`, which is why the code is read with
 * `errors/failure.ts`'s lookup rather than off the error directly.
 *
 * @param error - Whatever `fetch` rejected with.
 * @returns `true` when the code is one of {@link RETRYABLE_CONNECT_CODES}. A deadline is
 *   never retryable: it arrives as a `TimeoutError` with no code at all, and the time it
 *   consumed is time the caller has already spent.
 */
export function isRetryable(error: unknown): boolean {
  const code = failureCode(error);

  return code !== undefined && RETRYABLE_CONNECT_CODES.has(code);
}

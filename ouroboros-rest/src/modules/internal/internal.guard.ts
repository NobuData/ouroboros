/**
 * The guard that lets one caller in and nobody else — this service's half of the #51
 * shared-secret pattern.
 *
 * `ouroboros-engine` has enforced that pattern on its own routes since
 * [#51](https://github.com/NobuData/ouroboros/issues/51): every path but liveness requires
 * `X-Ouro-Internal-Key`, compared in constant time, refused with one constant body. AD.3
 * ([#224](https://github.com/NobuData/ouroboros/issues/224)) is the first time traffic runs
 * the *other* way, so this is that middleware written again in Nest's vocabulary — the same
 * header, the same variable (`OURO_ENGINE_SHARED_SECRET`), the same terse rejection.
 *
 * ---------------------------------------------------------------------------
 * **Four properties, each one deliberate.**
 *
 *   * **It is global, and it decides by metadata.** Registered as an `APP_GUARD` by
 *     `internal.module.ts` and gated on `@InternalOnly()`. A controller-scoped
 *     `@UseGuards()` would protect the routes somebody remembered to decorate, and the
 *     failure mode of forgetting is an unauthenticated internal endpoint — the worst
 *     failure this file can have. `internal.module.spec.ts` asserts the complement: every
 *     route whose path is under `/internal` carries the decorator, so neither half can be
 *     forgotten quietly.
 *   * **The comparison is over digests.** `timingSafeEqual` throws on operands of different
 *     lengths, so comparing the raw strings would mean a length check first — and a length
 *     check is a branch a caller can time. Hashing both sides to a fixed 32 bytes removes
 *     the branch and, with it, the length of the value from what an observer can learn. A
 *     missing header takes exactly the same path as a wrong one.
 *   * **The rejection says nothing.** One code, one constant message, no details, no header
 *     echo — `internal.errors.ts` holds it. What an operator needs is in the log line
 *     below, which stays inside the cluster.
 *   * **It refuses rather than returning `false`.** A guard's `false` is a bare `403` with
 *     no envelope; every refusal in this service is a thrown `DomainError` that
 *     `error.filter.ts` renders, which is what makes the boundary answer in one shape.
 *
 * ---------------------------------------------------------------------------
 * **It admits two principals, and records which one it admitted.** AP.1
 * ([#303](https://github.com/NobuData/ouroboros/issues/303)) needs a run's `simulated`
 * watermark to follow the caller rather than the body, and the only thing a caller proves
 * here is which secret it holds — so `OURO_RUN_SIMULATOR_SECRET` is a second accepted value
 * and `internal.principal.ts` is what the two mean. The guard writes the answer onto the
 * request, where `@CallingPrincipal()` reads it; nothing about *authorisation* changes,
 * because both principals reach every internal route.
 *
 * The second comparison runs **unconditionally**, over a digest like the first, and its
 * result is combined with `||` rather than short-circuited on. A guard that skipped the
 * simulator check once the engine check had matched would take a different amount of time
 * for the two principals, which is a branch a caller can time — and the whole reason the
 * comparison is over fixed-length digests is to have no such branch. When the simulator
 * secret is unset the guard compares against a value no caller can send, so the absent
 * principal costs the same as a present one.
 */

import { Injectable, type CanActivate, type ExecutionContext, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash, timingSafeEqual } from "node:crypto";

import { AppConfigService } from "../config/config.service";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { isInternalOnly } from "./internal.decorators";
import { internalUnauthenticated } from "./internal.errors";
import { INTERNAL_PRINCIPAL_PROPERTY, type PrincipalCarrier } from "./internal.principal";

/** The part of a request this guard reads, and the one property it writes. */
export interface InternalRequest extends PrincipalCarrier {
  /** Headers, lower-cased by the adapter. */
  headers?: Record<string, unknown>;
  /** The path, for the log line a rejection produces. */
  url?: string;
  /** The verb, likewise. */
  method?: string;
}

/**
 * A value no `X-Ouro-Internal-Key` can equal.
 *
 * What the simulator comparison runs against when `OURO_RUN_SIMULATOR_SECRET` is unset. A
 * header value is a string; this is not one any caller can send, because a header carrying a
 * NUL is refused by the parser long before it reaches a guard. It exists so the unset case
 * costs one more digest and one more comparison, exactly as the set case does, instead of a
 * branch.
 */
const UNMATCHABLE = "\u0000 no simulator principal is configured";

/**
 * The header the shared secret travels on, lower-cased.
 *
 * Node lower-cases every incoming header name, and the constant is written in the canonical
 * casing because that is how both sides *send* it — `engine.contract.ts` for the outbound
 * direction, `ouroboros_engine.core.security` for the inbound one. Folding it here rather
 * than keeping a second constant is what stops the two spellings from drifting apart.
 */
export const INTERNAL_KEY_HEADER_LOWERCASE = INTERNAL_KEY_HEADER.toLowerCase();

/**
 * Reduce a candidate to a fixed-length digest.
 *
 * @param value - The header's value, or the configured secret.
 * @returns Its SHA-256 digest — 32 bytes whatever went in.
 */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

@Injectable()
export class InternalKeyGuard implements CanActivate {
  /** Where a refusal is diagnosed. The caller is told nothing; this is told the path. */
  private readonly logger = new Logger(InternalKeyGuard.name);

  /**
   * @param reflector - How `@InternalOnly()` is read.
   * @param config - The typed configuration, for `OURO_ENGINE_SHARED_SECRET`. Read per
   *   request rather than captured at construction because `AppConfigService` is already a
   *   getter over a frozen object — there is nothing to cache and nothing that can change.
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Admit the request, or refuse it before any handler or pipe sees it.
   *
   * @param context - The execution context, read as HTTP.
   * @returns `true` for every route that is not `@InternalOnly()`, and for an internal route
   *   whose request carried the right key.
   * @throws {UnauthenticatedError} `401 unauthenticated` otherwise — see
   *   `internal.errors.ts` for why the body is a constant.
   */
  canActivate(context: ExecutionContext): boolean {
    if (!isInternalOnly(this.reflector, context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<InternalRequest>();
    const offered = request.headers?.[INTERNAL_KEY_HEADER_LOWERCASE];
    // A header sent twice arrives as an array. Neither half of it is compared: a caller
    // that sent two keys is not a caller that got one right, and picking one would be
    // choosing which of their guesses to grade.
    const candidate = typeof offered === "string" ? offered : "";

    const offeredDigest = digest(candidate);
    const isExecutor = timingSafeEqual(offeredDigest, digest(this.config.engineSharedSecret));
    const isSimulator = timingSafeEqual(
      offeredDigest,
      digest(this.config.runSimulatorSecret ?? UNMATCHABLE),
    );

    if (isExecutor || isSimulator) {
      // The executor wins a tie it cannot have: `configuration.ts` refuses a deployment
      // whose two secrets are equal, so at most one of these is true. Stating the
      // precedence anyway keeps this line total rather than leaving the impossible case to
      // whichever branch happened to be written first.
      request[INTERNAL_PRINCIPAL_PROPERTY] = isExecutor ? "executor" : "simulator";

      return true;
    }

    // The path is safe to log and is the whole diagnostic: this record stays inside the
    // cluster, and an operator chasing a misconfigured worker needs to know what it was
    // reaching for. Whether a key was *present* separates the two mistakes an operator
    // makes — a caller that never sends one, and two sides holding different values — and
    // the value itself is never logged, right or wrong.
    this.logger.warn(
      `refused ${request.method ?? "?"} ${request.url ?? "?"}: ` +
        `${candidate === "" ? "no" : "an invalid"} ${INTERNAL_KEY_HEADER} header. ` +
        "Both sides read OURO_ENGINE_SHARED_SECRET and must hold the same value.",
    );

    throw internalUnauthenticated();
  }
}

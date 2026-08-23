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
 */

import { Injectable, type CanActivate, type ExecutionContext, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash, timingSafeEqual } from "node:crypto";

import { AppConfigService } from "../config/config.service";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { isInternalOnly } from "./internal.decorators";
import { internalUnauthenticated } from "./internal.errors";

/** The part of a request this guard reads. */
export interface InternalRequest {
  /** Headers, lower-cased by the adapter. */
  headers?: Record<string, unknown>;
  /** The path, for the log line a rejection produces. */
  url?: string;
  /** The verb, likewise. */
  method?: string;
}

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

    if (timingSafeEqual(digest(candidate), digest(this.config.engineSharedSecret))) {
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

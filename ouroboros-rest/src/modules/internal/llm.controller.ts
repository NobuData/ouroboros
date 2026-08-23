/**
 * `POST /internal/llm/invoke` — the contract, callable, and honest about not being built.
 *
 * AD.3 ([#224](https://github.com/NobuData/ouroboros/issues/224)) specifies this surface;
 * AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)) implements it. The shapes
 * are in `invoke.contract.ts` and in `openapi.internal.yaml`; what is here is the route that
 * makes the contract something an executor can be *written against* rather than merely read.
 *
 * **Why serve it at all, rather than only document it.** Three reasons, and the third is the
 * one that decided it:
 *
 *   1. A `404` is what a caller with the path wrong gets. An engine developer building
 *      against this contract needs to be able to tell that from *the path is right and the
 *      other half is not built yet*, and only a `501` says the second thing.
 *   2. The specification suite holds the document and the router to each other in both
 *      directions. A path that were documented and not served would need an exemption, and
 *      an exemption is a hole that outlives the reason for it.
 *   3. When AF.2 lands, it replaces a method body. Nothing about the path, the guard, the
 *      document or the engine's client changes — which is what makes this a contract rather
 *      than a plan.
 *
 * **It reads no body.** No DTO, deliberately: validation is part of the implementation, and
 * a `422` for a request the finished surface would accept is worse than no validation at
 * all. The request's shape is published in the internal document and mirrored by the
 * engine's client, and it is AF.2 that makes this service enforce it.
 */

import { Controller, Post, VERSION_NEUTRAL } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "./internal.decorators";
import { invocationNotImplemented } from "./internal.errors";
import { INVOKE_ROUTE, LLM_PATH } from "./internal.paths";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: LLM_PATH, version: VERSION_NEUTRAL })
export class LlmController {
  /**
   * Refuse an invocation, naming what will answer it.
   *
   * Authenticated first, like every route on this surface: a caller without the internal key
   * is told `401` and learns nothing about what this path will one day do. The `501` is for
   * the caller that got everything right.
   *
   * @returns Never. The signature says `never` rather than a response type so that AF.2
   *   changes it to the streamed answer and the compiler finds every caller.
   * @throws {NotImplementedError} `501 invocation_not_implemented`, always.
   */
  @Post(INVOKE_ROUTE)
  invoke(): never {
    throw invocationNotImplemented();
  }
}

import { HttpStatus } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { INTERNAL_ONLY } from "./internal.decorators";
import { INTERNAL_ERRORS } from "./internal.errors";
import { INVOKE_ROUTE, LLM_PATH } from "./internal.paths";
import { LlmController } from "./llm.controller";

/**
 * The contract, callable — and refusing.
 *
 * There is one behaviour to assert and it is a refusal, which makes this suite look thin. It
 * is not: what is being protected is the *shape* of a surface specified in one ticket and
 * implemented in another, and every assertion here is one that must still hold on the day
 * AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)) replaces the method body.
 * The path, the verb, the guard metadata and the authentication are all part of the contract;
 * only the body of `invoke()` is AF.2's to change.
 */

describe("what it answers today", () => {
  it("refuses with 501, naming the issue that will implement it", () => {
    const controller = new LlmController();

    expect(() => controller.invoke()).toThrow(
      expect.objectContaining({ code: INTERNAL_ERRORS.invocationNotImplemented }) as Error,
    );
  });

  it("is a 501 rather than a 404, so a caller can tell the path was right", () => {
    const controller = new LlmController();

    try {
      controller.invoke();
      throw new Error("the controller was expected to refuse");
    } catch (error) {
      expect((error as { getStatus: () => number }).getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    }
  });

  it("reads no body", () => {
    // No DTO, deliberately: validation is part of the implementation, and a `422` for a
    // request the finished surface would accept is worse than no validation at all. The
    // handler takes no parameters, which is the mechanical form of that decision.
    expect(LlmController.prototype.invoke).toHaveLength(0);
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

  it("is marked internal, so the key is required before the 501", () => {
    // The order matters more here than anywhere else on this surface: an unauthenticated
    // caller must learn nothing about what this path will one day do, and a `501` reachable
    // by anybody would be an advertisement.
    expect(Reflect.getMetadata(INTERNAL_ONLY, LlmController)).toBe(true);
  });

  it("is exempt from the session, like the rest of the surface", () => {
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, LlmController)).toBe(true);
  });
});

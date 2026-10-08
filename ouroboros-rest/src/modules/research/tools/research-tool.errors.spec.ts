import { HttpStatus } from "@nestjs/common";

import {
  RESEARCH_TOOL_ERRORS,
  ResearchToolError,
  TOOL_ERROR_CLASSES,
  TOOL_ERROR_RETRYABLE,
  TOOL_ERROR_SURFACES,
  budgetExhausted,
  contractViolation,
  investigationNotRunning,
  isResearchToolError,
  operationUnsupported,
  toolFailed,
  toolNotConfigured,
  toolNotEnabled,
  toolNotRegistered,
} from "./research-tool.errors";

describe("the research tool error taxonomy", () => {
  it("is the six classes the issue names", () => {
    expect(TOOL_ERROR_CLASSES).toEqual([
      "auth",
      "network",
      "robots_denied",
      "rate_limited",
      "upstream",
      "unsupported",
    ]);
  });

  it("gives every class a designed surface state and a retry answer", () => {
    for (const errorClass of TOOL_ERROR_CLASSES) {
      expect(TOOL_ERROR_SURFACES[errorClass]).toEqual(expect.any(String));
      expect(typeof TOOL_ERROR_RETRYABLE[errorClass]).toBe("boolean");
    }

    expect(TOOL_ERROR_SURFACES.robots_denied).toBe("skipped_source");
    expect(TOOL_ERROR_SURFACES.auth).toBe("reconnect");
    expect(TOOL_ERROR_RETRYABLE.auth).toBe(false);
    expect(TOOL_ERROR_RETRYABLE.rate_limited).toBe(true);
  });

  it("recognises a classified failure and nothing else", () => {
    expect(isResearchToolError(new ResearchToolError("network", "refused"))).toBe(true);
    expect(isResearchToolError(new Error("refused"))).toBe(false);
    expect(isResearchToolError(new ResearchToolError("sideways" as never, "x"))).toBe(false);
  });

  it("surfaces a tool failure as 502 with its class, state, retry and wait", () => {
    const error = toolFailed(
      "web",
      "fetch",
      new ResearchToolError("rate_limited", "429 slow down", 30),
    );

    expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(error.envelope()).toEqual({
      code: RESEARCH_TOOL_ERRORS.toolFailed,
      message: "The research tool failed.",
      details: {
        tool: "web",
        operation: "fetch",
        errorClass: "rate_limited",
        surfaceState: "backing_off",
        retryable: true,
        retryAfterSeconds: 30,
        detail: "429 slow down",
      },
    });
  });

  it("answers each refusal with its own status and code", () => {
    const cases = [
      [
        toolNotRegistered("web", []),
        HttpStatus.NOT_IMPLEMENTED,
        RESEARCH_TOOL_ERRORS.toolNotRegistered,
      ],
      [
        operationUnsupported("web", "query", ["search"]),
        HttpStatus.UNPROCESSABLE_ENTITY,
        RESEARCH_TOOL_ERRORS.operationUnsupported,
      ],
      [
        toolNotEnabled("web", "RS-127", ["code"]),
        HttpStatus.FORBIDDEN,
        RESEARCH_TOOL_ERRORS.toolNotEnabled,
      ],
      [toolNotConfigured("web"), HttpStatus.CONFLICT, RESEARCH_TOOL_ERRORS.toolNotConfigured],
      [
        investigationNotRunning("RS-127", "queued"),
        HttpStatus.CONFLICT,
        RESEARCH_TOOL_ERRORS.investigationNotRunning,
      ],
      [
        budgetExhausted("RS-127", { operations: 0, tokens: null }),
        HttpStatus.CONFLICT,
        RESEARCH_TOOL_ERRORS.budgetExhausted,
      ],
      [
        contractViolation("web", "search", ["x"]),
        HttpStatus.BAD_GATEWAY,
        RESEARCH_TOOL_ERRORS.contractViolation,
      ],
    ] as const;

    for (const [error, status, code] of cases) {
      expect(error.getStatus()).toBe(status);
      expect(error.envelope().code).toBe(code);
    }
  });

  it("names the input problem only when there is one", () => {
    expect(
      operationUnsupported("web", "search", ["search"], "query must be non-blank").envelope()
        .details,
    ).toEqual({
      tool: "web",
      operation: "search",
      supported: ["search"],
      reason: "query must be non-blank",
    });
    expect(operationUnsupported("web", "query", ["search"]).envelope().details).not.toHaveProperty(
      "reason",
    );
  });
});

import { HttpStatus } from "@nestjs/common";

import {
  RESEARCH_ERRORS,
  investigationNotFound,
  investigationNotQueued,
  kindNotFound,
  outcomeUnavailable,
  toolUnknown,
  toolsRequired,
} from "./research.errors";

/** Each refusal's status, stable code and the details a client points with. */
describe("the research estimator's refusals", () => {
  it.each([
    [
      kindNotFound("market_sizing"),
      HttpStatus.NOT_FOUND,
      RESEARCH_ERRORS.kindNotFound,
      { kind: "market_sizing" },
    ],
    [
      toolUnknown(["patents"]),
      HttpStatus.UNPROCESSABLE_ENTITY,
      RESEARCH_ERRORS.toolUnknown,
      { tools: ["patents"] },
    ],
    [
      toolsRequired("custom"),
      HttpStatus.UNPROCESSABLE_ENTITY,
      RESEARCH_ERRORS.toolsRequired,
      { kind: "custom" },
    ],
    [
      investigationNotFound("5eed0084-0000-4000-8000-000000000127"),
      HttpStatus.NOT_FOUND,
      RESEARCH_ERRORS.investigationNotFound,
      { investigationId: "5eed0084-0000-4000-8000-000000000127" },
    ],
    [
      investigationNotQueued("RS-127", "running"),
      HttpStatus.CONFLICT,
      RESEARCH_ERRORS.investigationNotQueued,
      { investigation: "RS-127", status: "running" },
    ],
    [
      outcomeUnavailable("RS-127"),
      HttpStatus.CONFLICT,
      RESEARCH_ERRORS.outcomeUnavailable,
      { investigation: "RS-127" },
    ],
  ])("%#: answers its status, code and details", (error, status, code, details) => {
    expect(error.getStatus()).toBe(status);
    expect(error.code).toBe(code);
    expect(error.details).toEqual(details);
    expect(error.envelope().message).not.toBe("");
  });

  it("copies the unknown tools rather than keeping the caller's array", () => {
    const tools = ["patents"];
    const error = toolUnknown(tools);
    tools.push("forums");

    expect(error.details).toEqual({ tools: ["patents"] });
  });

  it("uses distinct codes", () => {
    const codes = Object.values(RESEARCH_ERRORS);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

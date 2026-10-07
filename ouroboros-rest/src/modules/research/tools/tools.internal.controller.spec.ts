import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../../auth/anonymous";
import { INTERNAL_ONLY } from "../../internal/internal.decorators";
import {
  INTERNAL_PATHS,
  INTERNAL_RESEARCH_TOOL_PATH,
  RESEARCH_TOOL_OPERATION_ROUTE,
  RESEARCH_TOOLS_PATH,
  isInternalPath,
} from "../../internal/internal.paths";
import type { ResearchToolInvoker } from "./research-tool.invoker";
import { ResearchToolsInternalController } from "./tools.internal.controller";

/**
 * The route, which is thin: it hands the request through and carries the decorators the
 * boundary depends on. A missing `@InternalOnly()` would be an unauthenticated route into every
 * workspace's tool credentials and ledger; a missing `@AllowAnonymous()` would be a route the
 * session guard refuses before the internal key is ever checked.
 */

const INVESTIGATION = "5eed0084-0000-4000-8000-000000000127";

describe("the research tools internal controller", () => {
  it("passes the slug, the operation and the request through", async () => {
    const invoke = jest.fn(() => Promise.resolve({ ok: true }));
    const controller = new ResearchToolsInternalController({
      invoke,
    } as unknown as ResearchToolInvoker);

    await controller.operate("web", "search", {
      investigation: INVESTIGATION,
      input: { query: "gust" },
      budget: { operations: 3, tokens: null },
    });

    expect(invoke).toHaveBeenCalledWith("web", "search", {
      investigation: INVESTIGATION,
      input: { query: "gust" },
      budget: { operations: 3, tokens: null },
    });
  });

  it("treats an omitted token budget as no token budget", async () => {
    const invoke = jest.fn(() => Promise.resolve({}));
    const controller = new ResearchToolsInternalController({
      invoke,
    } as unknown as ResearchToolInvoker);

    await controller.operate("web", "fetch", {
      investigation: INVESTIGATION,
      input: { locator: "https://a.example.com/" },
      budget: { operations: 3 } as never,
    });

    expect(invoke).toHaveBeenCalledWith(
      "web",
      "fetch",
      expect.objectContaining({ budget: { operations: 3, tokens: null } }),
    );
  });

  it("lets a refusal travel", async () => {
    const controller = new ResearchToolsInternalController({
      invoke: () => Promise.reject(new Error("refused")),
    } as unknown as ResearchToolInvoker);

    await expect(
      controller.operate("web", "search", {
        investigation: INVESTIGATION,
        input: {},
        budget: { operations: 1, tokens: null },
      }),
    ).rejects.toThrow("refused");
  });
});

describe("how the route is declared", () => {
  it("sits at /internal/research/tools/:slug/:op, outside /api", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ResearchToolsInternalController)).toBe(
      RESEARCH_TOOLS_PATH,
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, ResearchToolsInternalController.prototype.operate),
    ).toBe(RESEARCH_TOOL_OPERATION_ROUTE);
    expect(INTERNAL_RESEARCH_TOOL_PATH).toBe("/internal/research/tools/:slug/:op");
    expect(isInternalPath(RESEARCH_TOOLS_PATH)).toBe(true);
    expect(INTERNAL_PATHS).toContain(INTERNAL_RESEARCH_TOOL_PATH);
  });

  it("is a POST answering 200 — an operation is not a created resource", () => {
    expect(
      Reflect.getMetadata(METHOD_METADATA, ResearchToolsInternalController.prototype.operate),
    ).toBe(1);
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, ResearchToolsInternalController.prototype.operate),
    ).toBe(HttpStatus.OK);
  });

  it("is internal-only and sessionless", () => {
    expect(Reflect.getMetadata(INTERNAL_ONLY, ResearchToolsInternalController)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, ResearchToolsInternalController)).toBe(true);
  });
});

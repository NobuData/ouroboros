import { HttpStatus } from "@nestjs/common";

import { RESEARCH_ERRORS } from "../research.errors";
import { FAKE_CORPUS, FAKE_SECRET, FakeResearchTool } from "./adapters/fake.tool.fixture";
import type { SourceRecord, ToolResult } from "./research-tool.adapter";
import { RESEARCH_TOOL_ERRORS } from "./research-tool.errors";
import {
  ResearchToolInvoker,
  SEARCH_LIMIT,
  inputViolation,
  type ToolInvocation,
} from "./research-tool.invoker";
import { ResearchToolRegistry } from "./research-tool.registry";
import type { ResearchToolRepository, ToolInvestigation } from "./research-tool.repository";
import type { ToolSettings } from "./research-tool.settings";

/**
 * The pipeline behind `/internal/research/tools/:slug/:op`, on the in-memory fake: the refusals
 * in their order, the workspace resolved from the investigation, the citation contract held
 * before anything is archived, budgets enforced per call, and the ledger's numbers returned.
 */

const INVESTIGATION = "5eed0084-0000-4000-8000-000000000127";

/** RS-127, running, with the fake enabled. */
const RUNNING: ToolInvestigation = {
  id: INVESTIGATION,
  organizationId: "org-acme",
  displayId: "RS-127",
  status: "running",
  tools: ["fake", "code"],
};

/** A request with budget to spare. */
const REQUEST: ToolInvocation = {
  investigation: INVESTIGATION,
  input: { query: "gust" },
  budget: { operations: 40, tokens: 10_000 },
};

/** The workspace's settings for the fake. */
const SETTINGS: ToolSettings = {
  config: { endpoint: "https://search.example.com" },
  secret: FAKE_SECRET,
};

interface Harness {
  readonly invoker: ResearchToolInvoker;
  readonly tool: FakeResearchTool;
  readonly archive: jest.Mock;
  readonly settingsFor: jest.Mock;
  readonly recordSkip: jest.Mock;
}

/**
 * An invoker over the fake, a stub repository and stub settings.
 *
 * @param options - What the stubs answer.
 * @returns The harness.
 */
function harness(
  options: {
    investigation?: ToolInvestigation | undefined;
    settings?: ToolSettings | null;
    tool?: FakeResearchTool;
    skipAlreadyRecorded?: boolean;
  } = {},
): Harness {
  const tool = options.tool ?? new FakeResearchTool();
  const investigation = "investigation" in options ? options.investigation : RUNNING;
  const archive = jest.fn((_id: string, _slug: string, sources: readonly SourceRecord[]) =>
    Promise.resolve(
      sources.map((_source, index) => ({
        id: `ledger-${index.toString()}`,
        citeNo: index + 7,
        deduplicated: index > 0,
      })),
    ),
  );
  const settingsFor = jest.fn(() =>
    Promise.resolve(options.settings === undefined ? SETTINGS : options.settings),
  );
  const recordSkip = jest.fn(() => Promise.resolve(options.skipAlreadyRecorded !== true));
  const repository = {
    findInvestigation: () => Promise.resolve(investigation),
    archiveSources: archive,
    recordSkip,
  } as unknown as ResearchToolRepository;

  return {
    invoker: new ResearchToolInvoker(new ResearchToolRegistry([tool]), repository, {
      settingsFor,
    }),
    tool,
    archive,
    settingsFor,
    recordSkip,
  };
}

/**
 * The refusal an invocation rejects with.
 *
 * @param work - The invocation.
 * @returns Its status and envelope.
 */
async function refusal(
  work: Promise<unknown>,
): Promise<{ status: number; code: string; details: Record<string, unknown> }> {
  try {
    await work;
  } catch (error) {
    const domain = error as {
      getStatus(): number;
      envelope(): { code: string; details: Record<string, unknown> };
    };

    return { status: domain.getStatus(), ...domain.envelope() };
  }

  throw new Error("expected a refusal");
}

describe("the research tool invoker", () => {
  describe("an accepted operation", () => {
    it("archives the sources and answers them with the ledger's numbers", async () => {
      const { invoker, archive } = harness();
      const answer = await invoker.invoke("fake", "search", REQUEST);

      expect(archive).toHaveBeenCalledWith(INVESTIGATION, "fake", expect.any(Array));
      expect(answer.investigation).toBe("RS-127");
      expect(answer.payload).toEqual({
        hits: [{ title: FAKE_CORPUS[1].title, locator: FAKE_CORPUS[1].locator }],
      });
      expect(answer.sources).toEqual([
        expect.objectContaining({
          id: "ledger-0",
          citeNo: 7,
          deduplicated: false,
          locator: FAKE_CORPUS[1].locator,
        }),
      ]);
    });

    it("scopes the call to the investigation's workspace — settings, credential and all", async () => {
      const { invoker, tool, settingsFor } = harness();

      await invoker.invoke("fake", "fetch", {
        ...REQUEST,
        input: { locator: FAKE_CORPUS[0].locator },
      });

      expect(settingsFor).toHaveBeenCalledWith("org-acme", "fake");
      expect(tool.contexts[0]).toEqual({
        organizationId: "org-acme",
        investigationId: INVESTIGATION,
        config: SETTINGS.config,
        secret: FAKE_SECRET,
        tokenCeiling: 10_000,
      });
    });

    it("never puts a setting or the credential in the answer", async () => {
      const { invoker } = harness();
      const answer = await invoker.invoke("fake", "search", REQUEST);

      expect(JSON.stringify(answer)).not.toContain(FAKE_SECRET);
      expect(JSON.stringify(answer)).not.toContain("search.example.com");
    });

    it("counts one operation and the adapter's tokens against the budget", async () => {
      const { invoker } = harness({ tool: new FakeResearchTool({ tokensPerOperation: 1200 }) });
      const answer = await invoker.invoke("fake", "search", REQUEST);

      expect(answer.usage).toEqual({ operations: 1, tokens: 1200 });
      expect(answer.budget).toEqual({ operations: 39, tokens: 8800 });
    });

    it("leaves an unbounded token budget unbounded", async () => {
      const { invoker } = harness();
      const answer = await invoker.invoke("fake", "search", {
        ...REQUEST,
        budget: { operations: 1, tokens: null },
      });

      expect(answer.budget).toEqual({ operations: 0, tokens: null });
    });

    it("answers an empty search as a null payload with nothing archived", async () => {
      const { invoker, archive } = harness();
      const answer = await invoker.invoke("fake", "search", {
        ...REQUEST,
        input: { query: "battery" },
      });

      expect(answer.payload).toBeNull();
      expect(answer.sources).toEqual([]);
      expect(archive).toHaveBeenCalledWith(INVESTIGATION, "fake", []);
    });

    it("runs a tool with no required settings when the workspace has none", async () => {
      const { invoker, tool } = harness({ settings: null });

      await invoker.invoke("fake", "query", {
        ...REQUEST,
        input: { locatorPrefix: "https://skylink" },
      });

      expect(tool.contexts[0].config).toEqual({});
      expect(tool.contexts[0].secret).toBeNull();
    });

    it("passes the search limit, defaulting it", async () => {
      const tool = new FakeResearchTool();
      const search = jest.spyOn(tool, "search");
      const { invoker } = harness({ tool });

      await invoker.invoke("fake", "search", REQUEST);
      await invoker.invoke("fake", "search", { ...REQUEST, input: { query: "gust", limit: 3 } });

      expect(search.mock.calls.map((call) => call[2])).toEqual([
        { limit: SEARCH_LIMIT.default },
        { limit: 3 },
      ]);
    });
  });

  describe("the refusals, in order", () => {
    it("404s an investigation that does not exist", async () => {
      const { invoker } = harness({ investigation: undefined });

      expect(await refusal(invoker.invoke("fake", "search", REQUEST))).toMatchObject({
        status: HttpStatus.NOT_FOUND,
        code: RESEARCH_ERRORS.investigationNotFound,
      });
    });

    it("409s an investigation that is not running", async () => {
      const { invoker } = harness({ investigation: { ...RUNNING, status: "brief_ready" } });

      expect(await refusal(invoker.invoke("fake", "search", REQUEST))).toMatchObject({
        status: HttpStatus.CONFLICT,
        code: RESEARCH_TOOL_ERRORS.investigationNotRunning,
        details: { investigation: "RS-127", status: "brief_ready" },
      });
    });

    it("403s a tool the investigation did not enable — before asking whether it exists", async () => {
      const { invoker } = harness({ investigation: { ...RUNNING, tools: ["code"] } });

      expect(await refusal(invoker.invoke("docs", "search", REQUEST))).toMatchObject({
        status: HttpStatus.FORBIDDEN,
        code: RESEARCH_TOOL_ERRORS.toolNotEnabled,
      });
    });

    it("501s an enabled tool this build has no adapter for", async () => {
      const { invoker } = harness();

      expect(await refusal(invoker.invoke("code", "search", REQUEST))).toMatchObject({
        status: HttpStatus.NOT_IMPLEMENTED,
        code: RESEARCH_TOOL_ERRORS.toolNotRegistered,
      });
    });

    it("422s an operation that is not one of the three, or input the operation does not take", async () => {
      const { invoker } = harness();

      expect(await refusal(invoker.invoke("fake", "watch", REQUEST))).toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: RESEARCH_TOOL_ERRORS.operationUnsupported,
        details: { supported: ["search", "fetch", "query"] },
      });
      expect(
        await refusal(invoker.invoke("fake", "search", { ...REQUEST, input: { q: "gust" } })),
      ).toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        details: { reason: "search takes {query, limit?}; unexpected: q" },
      });
    });

    it("409s a call with no operations or no tokens left", async () => {
      const { invoker, tool } = harness();

      for (const budget of [
        { operations: 0, tokens: 100 },
        { operations: 5, tokens: 0 },
      ]) {
        expect(
          await refusal(invoker.invoke("fake", "search", { ...REQUEST, budget })),
        ).toMatchObject({
          status: HttpStatus.CONFLICT,
          code: RESEARCH_TOOL_ERRORS.budgetExhausted,
        });
      }
      expect(tool.contexts).toHaveLength(0);
    });

    it("409s a tool whose schema requires settings the workspace has not stored", async () => {
      const { invoker } = harness({
        settings: null,
        tool: new FakeResearchTool({ requiresConfig: true }),
      });

      expect(await refusal(invoker.invoke("fake", "search", REQUEST))).toMatchObject({
        status: HttpStatus.CONFLICT,
        code: RESEARCH_TOOL_ERRORS.toolNotConfigured,
      });
    });
  });

  describe("an answer outside the contract", () => {
    it("502s a classified failure with its surface state, archiving nothing", async () => {
      const { invoker, tool, archive, recordSkip } = harness();

      tool.willFail("rate_limited");

      expect(await refusal(invoker.invoke("fake", "search", REQUEST))).toMatchObject({
        status: HttpStatus.BAD_GATEWAY,
        code: RESEARCH_TOOL_ERRORS.toolFailed,
        details: { errorClass: "rate_limited", surfaceState: "backing_off", retryable: true },
      });
      expect(archive).not.toHaveBeenCalled();
      expect(recordSkip).not.toHaveBeenCalled();
    });

    it("answers a robots-denied fetch as a skip and records it under the investigation", async () => {
      const { invoker, tool, archive, recordSkip } = harness();

      tool.willFail("robots_denied");
      const answer = await invoker.invoke("fake", "fetch", {
        ...REQUEST,
        input: { locator: FAKE_CORPUS[1].locator },
      });

      expect(answer).toMatchObject({
        payload: null,
        sources: [],
        skipped: { locator: FAKE_CORPUS[1].locator, reason: "robots_denied", recorded: true },
        usage: { operations: 1, tokens: 0 },
        budget: { operations: REQUEST.budget.operations - 1, tokens: REQUEST.budget.tokens },
      });
      expect(recordSkip).toHaveBeenCalledWith(INVESTIGATION, "fake", {
        locator: FAKE_CORPUS[1].locator,
        reason: "robots_denied",
        note: answer.skipped?.note,
      });
      expect(archive).not.toHaveBeenCalled();
    });

    it("answers an unsupported type as an unsupported_type skip", async () => {
      const { invoker, tool, recordSkip } = harness();

      tool.willFail("unsupported");
      const answer = await invoker.invoke("fake", "fetch", {
        ...REQUEST,
        input: { locator: FAKE_CORPUS[1].locator },
      });

      expect(answer.skipped).toMatchObject({ reason: "unsupported_type" });
      expect(recordSkip).toHaveBeenCalledTimes(1);
    });

    it("keeps an unsupported search a failure — only a fetch skips a page", async () => {
      const { invoker, tool, recordSkip } = harness();

      tool.willFail("unsupported");

      expect(await refusal(invoker.invoke("fake", "search", REQUEST))).toMatchObject({
        status: HttpStatus.BAD_GATEWAY,
        details: { errorClass: "unsupported" },
      });
      expect(recordSkip).not.toHaveBeenCalled();
    });

    it("says when the skip was already on the record", async () => {
      const { invoker, tool } = harness({ skipAlreadyRecorded: true });

      tool.willFail("robots_denied");
      const answer = await invoker.invoke("fake", "fetch", {
        ...REQUEST,
        input: { locator: FAKE_CORPUS[1].locator },
      });

      expect(answer.skipped?.recorded).toBe(false);
    });

    it("502s a payload with no sources — and archives nothing", async () => {
      const tool = Object.assign(new FakeResearchTool(), {
        search: (): Promise<ToolResult> =>
          Promise.resolve({ payload: { hits: [1] }, sources: [], usage: { tokens: 0 } }),
      });
      const { invoker, archive } = harness({ tool });

      expect(await refusal(invoker.invoke("fake", "search", REQUEST))).toMatchObject({
        status: HttpStatus.BAD_GATEWAY,
        code: RESEARCH_TOOL_ERRORS.contractViolation,
        details: {
          violations: [
            "an operation that returns a payload must return at least one source record",
          ],
        },
      });
      expect(archive).not.toHaveBeenCalled();
    });

    it("502s more tokens than the ceiling allowed", async () => {
      const { invoker } = harness({ tool: new FakeResearchTool({ tokensPerOperation: 600 }) });

      expect(
        await refusal(
          invoker.invoke("fake", "search", { ...REQUEST, budget: { operations: 3, tokens: 500 } }),
        ),
      ).toMatchObject({ code: RESEARCH_TOOL_ERRORS.contractViolation });
    });

    it("502s an unclassified exception without echoing its message", async () => {
      const tool = Object.assign(new FakeResearchTool(), {
        search: (): Promise<ToolResult> =>
          Promise.reject(new Error(`Authorization: Bearer ${FAKE_SECRET}`)),
      });
      const { invoker } = harness({ tool });
      const answer = await refusal(invoker.invoke("fake", "search", REQUEST));

      expect(answer.code).toBe(RESEARCH_TOOL_ERRORS.contractViolation);
      expect(JSON.stringify(answer)).not.toContain(FAKE_SECRET);
    });
  });
});

describe("operation input", () => {
  it("takes {query, limit?} for search", () => {
    expect(inputViolation("search", { query: "gust", limit: 5 })).toBeNull();
    expect(inputViolation("search", { query: " " })).toMatch(/^query must be/);
    expect(inputViolation("search", { query: "x", limit: 51 })).toMatch(/^limit must be/);
    expect(inputViolation("search", { query: "x", limit: 2.5 })).toMatch(/^limit must be/);
  });

  it("takes {locator} for fetch", () => {
    expect(inputViolation("fetch", { locator: "https://a.example.com/" })).toBeNull();
    expect(inputViolation("fetch", { locator: "" })).toMatch(/^locator must be/);
    expect(inputViolation("fetch", { locator: "x", extra: 1 })).toBe("fetch takes {locator}");
  });

  it("takes any non-empty object for query", () => {
    expect(inputViolation("query", { op: "blame", path: "src/dock/dock_ctrl.c" })).toBeNull();
    expect(inputViolation("query", {})).toBe("query takes a non-empty structured object");
  });
});

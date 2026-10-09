import type {
  ResearchToolAdapter,
  SearchCapableTool,
  ToolCapabilities,
  ToolResult,
} from "./research-tool.adapter";
import { FAKE_CONFIG, FAKE_SECRET, FakeResearchTool } from "./adapters/fake.tool.fixture";
import {
  conformanceContext,
  countsViolations,
  displayViolations,
  failureViolations,
  fixtureCoverageViolations,
  healthViolations,
  operationViolations,
  schemaViolations,
  settle,
  type ToolConformance,
} from "./conformance.fixture";
import { ResearchToolError } from "./research-tool.errors";
import { registrationViolations } from "./research-tool.registry";

/**
 * The kit refuses what it is for refusing. Each case builds an adapter wrong in exactly one way
 * and asserts the rule that should catch it does — including CL.1's second acceptance criterion,
 * **an operation returning a payload with no source records fails conformance**.
 */

const context = conformanceContext({ config: FAKE_CONFIG, secret: FAKE_SECRET });

/** A well-formed source, for answers that are wrong somewhere else. */
const SOURCE = {
  kind: "web",
  title: "Skylink firmware 6.2 release notes",
  locator: "https://skylink.example.com/releases/6.2",
  retrievedAt: "2026-10-06T12:00:00.000Z",
  contentHash: `sha256:${"a".repeat(64)}`,
  excerpt: "Gust-adaptive final approach.",
  meta: {},
} as const;

/**
 * A fake whose `search` answers what a test scripts.
 *
 * @param answer - What search resolves to.
 * @returns The adapter.
 */
function searchingWith(answer: unknown): SearchCapableTool {
  const tool = new FakeResearchTool();

  return Object.assign(tool, {
    search: () => Promise.resolve(answer as ToolResult),
  });
}

describe("the research tool conformance kit", () => {
  describe("the citation contract", () => {
    it("fails an operation that returns a payload with no source records", async () => {
      const tool = searchingWith({
        payload: { hits: [{ title: "x" }] },
        sources: [],
        usage: { tokens: 0 },
      });
      const result = await tool.search(context, "gust", { limit: 5 });

      expect(operationViolations("search", result, FAKE_SECRET)).toEqual([
        "search: an operation that returns a payload must return at least one source record",
      ]);
    });

    it("accepts an empty answer — a null payload — with no sources", () => {
      expect(
        operationViolations("search", { payload: null, sources: [], usage: { tokens: 0 } }, null),
      ).toEqual([]);
    });

    it("fails a source the ledger would refuse", () => {
      const violations = operationViolations(
        "fetch",
        {
          payload: {},
          sources: [
            { ...SOURCE, locator: "javascript:alert(1)", contentHash: "md5:x", excerpt: " " },
          ],
          usage: { tokens: 0 },
        },
        null,
      );

      expect(violations).toEqual([
        "fetch: source 1: locator is not well-formed for a web source",
        "fetch: source 1: contentHash must be sha256:<64 lowercase hex>",
        "fetch: source 1: excerpt must be non-blank and at most 4096 bytes",
      ]);
    });

    it("fails an answer that spends more tokens than its ceiling", () => {
      expect(
        operationViolations(
          "search",
          { payload: {}, sources: [SOURCE], usage: { tokens: 900 } },
          null,
          500,
        ),
      ).toEqual(["search: usage.tokens (900) exceeds the call's ceiling of 500"]);
    });

    it("fails an answer that quotes the credential", () => {
      expect(
        operationViolations(
          "fetch",
          { payload: { echoed: `Bearer ${FAKE_SECRET}` }, sources: [SOURCE], usage: { tokens: 0 } },
          FAKE_SECRET,
        ),
      ).toEqual(["fetch: the answer quotes the credential"]);
    });

    it("fails an answer with no usage report", () => {
      expect(operationViolations("query", { payload: {}, sources: [SOURCE] }, null)).toEqual([
        "query: usage.tokens must be a non-negative integer",
      ]);
    });
  });

  describe("registration", () => {
    it("fails a flag that claims a member the adapter does not have", () => {
      const tool = new FakeResearchTool();
      const lying: ResearchToolAdapter = Object.assign(Object.create(tool) as FakeResearchTool, {
        fetch: undefined,
      });

      expect(registrationViolations(lying)).toEqual([
        "declares fetch: true but its fetch member says otherwise",
      ]);
    });

    it("fails a member the flags do not declare", () => {
      const tool = new FakeResearchTool();
      const hiding = Object.assign(Object.create(tool) as FakeResearchTool, {
        capabilities: (): ToolCapabilities => ({
          search: true,
          fetch: true,
          query: false,
          watch: false,
        }),
      });

      expect(registrationViolations(hiding)).toEqual([
        "declares query: false but its query member says otherwise",
      ]);
    });

    it("fails a slug that is not a research tool slug", () => {
      expect(registrationViolations(new FakeResearchTool({ slug: "Web Search" }))).toEqual([
        'slug "Web Search" is not a research tool slug',
      ]);
    });
  });

  describe("the card", () => {
    it("fails a row with a blank name and a two-character glyph", () => {
      const tool = Object.assign(new FakeResearchTool(), {
        displayMeta: () => ({ name: " ", glyph: "◇◇", subLine: "x" }),
      });

      expect(displayViolations(tool)).toEqual([
        "displayMeta().name must be non-blank",
        "displayMeta().glyph must be exactly one character",
      ]);
    });

    it("fails counts that leave a slot unanswered or answer one the sub-line does not name", () => {
      expect(countsViolations(new FakeResearchTool(), { rivals: 4 })).toEqual([
        "counts() does not answer the sub-line's {documents}",
        "counts() answers rivals, which the sub-line does not name",
      ]);
    });

    it("accepts a phrase for a slot, and fails a blank one or a negative count", () => {
      expect(countsViolations(new FakeResearchTool(), { documents: "three sets" })).toEqual([]);
      expect(countsViolations(new FakeResearchTool(), { documents: " " })).toEqual([
        "counts().documents must be a non-blank phrase of at most 200 characters",
      ]);
      expect(countsViolations(new FakeResearchTool(), { documents: -1 })).toEqual([
        "counts().documents must be a non-negative integer, a phrase or null",
      ]);
    });

    it("fails a health detail that quotes the credential, and an unknown state", () => {
      expect(
        healthViolations({ state: "down", detail: `401 for ${FAKE_SECRET}` }, FAKE_SECRET, "down"),
      ).toEqual(["down: quotes the credential"]);
      expect(healthViolations({ state: "broken" as never, detail: "x" }, null, "x")).toEqual([
        'x: state "broken" is not one of healthy, degraded, down, not_configured',
      ]);
    });
  });

  describe("the config schema", () => {
    it("fails a schema outside the form dialect", () => {
      const tool = Object.assign(new FakeResearchTool(), {
        configSchema: () =>
          ({ type: "object", properties: { depth: { type: "number" } } }) as never,
      });

      expect(schemaViolations(tool).length).toBeGreaterThan(0);
      expect(schemaViolations(tool)[0]).toMatch(/^configSchema\(\): /);
    });

    it("fails a schema the adapter hands out by reference", () => {
      const tool = new FakeResearchTool();
      const shared = tool.configSchema();
      const leaky = Object.assign(tool, { configSchema: () => shared });

      expect(schemaViolations(leaky)).toEqual([
        "configSchema() must answer a fresh value — a caller's edit reached the adapter",
      ]);
    });
  });

  describe("failures", () => {
    it("fails an operation that resolves when it was recorded failing", async () => {
      expect(failureViolations("network", await settle(() => Promise.resolve({})), null)).toEqual([
        "network: the operation resolved — a failure must reject with ResearchToolError",
      ]);
    });

    it("fails an unclassified exception and a misclassified one", async () => {
      expect(
        failureViolations(
          "network",
          await settle(() => Promise.reject(new Error("ECONNREFUSED"))),
          null,
        ),
      ).toEqual(["network: rejected with something other than a classified ResearchToolError"]);
      expect(
        failureViolations(
          "network",
          await settle(() => Promise.reject(new ResearchToolError("upstream", "503"))),
          null,
        ),
      ).toEqual(["network: classified as upstream"]);
    });

    it("fails a failure detail that quotes the credential", async () => {
      expect(
        failureViolations(
          "auth",
          await settle(() =>
            Promise.reject(new ResearchToolError("auth", `key ${FAKE_SECRET} rejected`)),
          ),
          FAKE_SECRET,
        ),
      ).toEqual(["auth: the detail quotes the credential"]);
    });
  });

  describe("fixture coverage", () => {
    it("fails a harness missing a declared operation's fixture or a required failure", () => {
      const harness: ToolConformance = {
        adapter: new FakeResearchTool(),
        config: FAKE_CONFIG,
        secret: null,
        operations: { search: () => Promise.resolve(null) },
        failures: { network: () => Promise.resolve(null) },
        health: {},
      };

      expect(fixtureCoverageViolations(harness)).toEqual([
        "declares fetch but records no fixture for it",
        "declares query but records no fixture for it",
        "records no upstream failure — every adapter must",
      ]);
    });
  });
});

import { FakeResearchTool } from "./adapters/fake.tool.fixture";
import {
  partitionToolSubmission,
  toToolFormFields,
  toolConfigViolations,
  toolSchemaViolations,
} from "./research-tool.config";

/**
 * CL.1's acceptance criterion: **`configSchema()` renders a working enable form with no
 * tool-specific UI code.** The form is derived by the same function that renders a ticket
 * source's form, the submission is checked by the same rules, and the credential is split off
 * the same way — so a tool's schema is a form the existing components draw.
 */
describe("a research tool's config schema", () => {
  const schema = new FakeResearchTool().configSchema();

  it("is in the dialect the enable form renders", () => {
    expect(toolSchemaViolations(schema)).toEqual([]);
  });

  it("renders as form fields — a URL, a list and a masked credential", () => {
    expect(toToolFormFields(schema).map((field) => [field.name, field.widget])).toEqual([
      ["endpoint", "url"],
      ["scope", "list"],
      ["apiKey", "secret"],
    ]);
  });

  it("checks a submission against the schema", () => {
    expect(
      toolConfigViolations(schema, {
        endpoint: "https://search.example.com",
        scope: ["example.com"],
      }),
    ).toEqual({});
    expect(
      Object.keys(toolConfigViolations(schema, { endpoint: "not a url", depth: "3" })),
    ).toEqual(expect.arrayContaining(["endpoint", "depth"]));
  });

  it("keeps the credential out of the stored configuration", () => {
    const parts = partitionToolSubmission(schema, {
      endpoint: "https://search.example.com",
      apiKey: "sk-research",
    });

    expect(parts.secret).toBe("sk-research");
    expect(parts.config).toEqual({ endpoint: "https://search.example.com" });
  });

  it("refuses a schema outside the dialect", () => {
    expect(
      toolSchemaViolations({ type: "object", properties: { depth: { type: "number" } } }),
    ).not.toEqual([]);
  });
});

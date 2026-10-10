import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateDocumentImportDto, DocumentImportParams } from "./document-imports.dto";

/**
 * The import request, shape only (CL.5, #618) — whether the file parses is the service's, so it
 * can answer with a sentence naming the row.
 */

/**
 * The properties a body fails on.
 *
 * @param body - The body as a client sends it.
 * @returns The failing property names.
 */
async function failures(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(CreateDocumentImportDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

const valid = {
  collection: "support",
  name: "churn-2026-q2",
  format: "csv",
  content: "text\nA document.\n",
};

describe("the document import request", () => {
  it("accepts a locator, a format and a file — title and description optional", async () => {
    expect(await failures(valid)).toEqual([]);
    expect(await failures({ ...valid, title: "Churn interviews", description: "Q2." })).toEqual([]);
    expect(await failures({ ...valid, format: "markdown", name: "Notes_v1.2" })).toEqual([]);
  });

  it.each([
    ["collection", "Support"],
    ["collection", "-support"],
    ["collection", "sup port"],
    ["collection", "a/b"],
    ["collection", "s".repeat(64)],
    ["name", ".hidden"],
    ["name", "a/b"],
    ["name", "has space"],
    ["name", "n".repeat(101)],
    ["name", "with#hash"],
    ["title", "   "],
    ["title", "t".repeat(301)],
    ["description", ""],
    ["description", "d".repeat(2001)],
    ["format", "pdf"],
    ["content", "  \n "],
    ["content", 7],
  ])("refuses %s = %j", async (field, value) => {
    expect(await failures({ ...valid, [field]: value })).toEqual([field]);
  });

  it("refuses a missing field and one it does not take", async () => {
    expect(await failures({})).toEqual(["collection", "name", "format", "content"]);
    expect(await failures({ ...valid, organizationId: "org-other" })).toEqual(["organizationId"]);
  });

  it("takes a set by uuid", async () => {
    const problems = async (importId: string): Promise<number> =>
      (await validate(plainToInstance(DocumentImportParams, { importId }))).length;

    expect(await problems("5eed009a-0000-4000-8000-000000000001")).toBe(0);
    expect(await problems("churn-2026-q2")).toBe(1);
  });
});

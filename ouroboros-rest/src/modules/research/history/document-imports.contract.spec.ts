import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import { CHURN_CSV, CHURN_SET } from "./document-import.fixture";
import { parseDocumentImport } from "./document-import.parse";
import { importDetailResource, importResource } from "./document-imports.resources";
import type { DocumentImportItemRow, DocumentImportRow } from "./history-index.repository";

/**
 * Imported sets' answers are what `openapi.yaml` documents (CL.5, #618) — held to the schemas the
 * UI's client is generated from.
 */

function validator(name: string) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });
  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

const row: DocumentImportRow = {
  id: "5eed009a-0000-4000-8000-000000000001",
  ...CHURN_SET,
  format: "csv",
  contentHash: `sha256:${"a".repeat(64)}`,
  importedBy: "5eed0003-0000-4000-8000-000000000001",
  createdAt: new Date("2026-09-19T00:00:00Z"),
  documents: 14,
};

const items: DocumentImportItemRow[] = parseDocumentImport("csv", CHURN_CSV).documents.map(
  (parsed, index) => ({
    id: `5eed009a-0000-4000-8000-0001${String(index + 1).padStart(8, "0")}`,
    position: index + 1,
    ...parsed,
  }),
);

describe("the document imports contract", () => {
  it("documents a set, with and without a description or an importer", () => {
    const valid = validator("DocumentImport");

    expect(valid(importResource(row))).toBe(true);
    expect(valid(importResource({ ...row, description: null, importedBy: null }))).toBe(true);
    expect(importResource(row).locator).toBe("issue-index://support/churn-2026-q2");
  });

  it("documents the list and a set with its documents", () => {
    expect(validator("DocumentImportList")({ items: [importResource(row)] })).toBe(true);

    const detail = importDetailResource(row, [...items, { ...items[0], occurredAt: null }]);
    const valid = validator("DocumentImportDetail");

    expect(valid(detail)).toBe(true);
    expect(detail.items[1].locator).toBe("issue-index://support/churn-2026-q2/acct-02");
  });

  it("documents the request the route accepts, and refuses one it does not", () => {
    const valid = validator("DocumentImportCreateRequest");

    expect(valid({ ...CHURN_SET, format: "csv", content: CHURN_CSV })).toBe(true);
    expect(
      valid({ collection: "support", name: "notes", format: "markdown", content: "# N" }),
    ).toBe(true);
    expect(valid({ ...CHURN_SET, format: "pdf", content: "x" })).toBe(false);
    expect(valid({ ...CHURN_SET, collection: "Support", format: "csv", content: "x" })).toBe(false);
  });
});

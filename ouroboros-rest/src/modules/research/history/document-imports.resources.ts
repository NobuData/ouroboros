/**
 * Imported document sets' response shapes (CL.5, [#618](https://github.com/NobuData/ouroboros/issues/618)) —
 * `openapi.yaml`'s `DocumentImport`, `DocumentImportList`, `DocumentImportDetail` and
 * `DocumentImportItem`.
 */

import type { DocumentImportFormat } from "../../db/schema";
import type { DocumentImportItemRow, DocumentImportRow } from "./history-index.repository";

/** An imported set. */
export interface DocumentImportResource {
  readonly id: string;
  readonly collection: string;
  readonly name: string;
  /** What an investigation cites the whole set as — `issue-index://support/churn-2026-q2`. */
  readonly locator: string;
  readonly title: string;
  readonly description: string | null;
  readonly format: DocumentImportFormat;
  /** `sha256:<hex>` of the imported file. */
  readonly contentHash: string;
  /** How many documents it holds. */
  readonly documents: number;
  /** The user who imported it, by id. */
  readonly importedBy: string | null;
  readonly createdAt: string;
}

/** `GET /research/document-imports`. */
export interface DocumentImportListResource {
  readonly items: readonly DocumentImportResource[];
}

/** One document of a set. */
export interface DocumentImportItemResource {
  readonly key: string;
  /** `issue-index://support/churn-2026-q2/acct-07`. */
  readonly locator: string;
  readonly title: string;
  readonly text: string;
  readonly labels: readonly string[];
  /** When the document is from, as the file says. */
  readonly occurredAt: string | null;
  /** The file's other columns. */
  readonly meta: Readonly<Record<string, unknown>>;
}

/** `GET /research/document-imports/{importId}`. */
export interface DocumentImportDetailResource extends DocumentImportResource {
  readonly items: readonly DocumentImportItemResource[];
}

/**
 * A set's locator.
 *
 * @param set - Its collection and name.
 * @returns `issue-index://<collection>/<name>`.
 */
export function importLocator(set: Pick<DocumentImportRow, "collection" | "name">): string {
  return `issue-index://${set.collection}/${set.name}`;
}

/**
 * A set, as the API shows it.
 *
 * @param row - The set.
 * @returns The resource.
 */
export function importResource(row: DocumentImportRow): DocumentImportResource {
  return {
    id: row.id,
    collection: row.collection,
    name: row.name,
    locator: importLocator(row),
    title: row.title,
    description: row.description,
    format: row.format,
    contentHash: row.contentHash,
    documents: row.documents,
    importedBy: row.importedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A set with its documents.
 *
 * @param row - The set.
 * @param items - Its documents, in file order.
 * @returns The resource.
 */
export function importDetailResource(
  row: DocumentImportRow,
  items: readonly DocumentImportItemRow[],
): DocumentImportDetailResource {
  const locator = importLocator(row);

  return {
    ...importResource(row),
    items: items.map((item) => ({
      key: item.key,
      locator: `${locator}/${item.key}`,
      title: item.title,
      text: item.body,
      labels: item.labels,
      occurredAt: item.occurredAt === null ? null : item.occurredAt.toISOString(),
      meta: item.meta,
    })),
  };
}

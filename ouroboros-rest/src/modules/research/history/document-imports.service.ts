/**
 * Imported document sets — the institutional memory that is not a ticket (CL.5,
 * [#618](https://github.com/NobuData/ouroboros/issues/618)).
 *
 * **Who may do what.** Every member lists and reads the sets; only an **owner** imports or
 * removes one (the controller's `@Roles`) — an imported document is readable by every
 * investigation in the workspace and its excerpts are archived in their ledgers, so what goes in
 * is an owner's decision. The workspace is always the session's — another workspace's set is a
 * `404`.
 *
 * **A set is never edited.** Its documents are what investigations cited; replacing a set is
 * removing it and importing it again, and a ledger that cited the old one keeps its excerpt and
 * hash.
 */

import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { violatesConstraint } from "../../tenancy/constraints";
import { DocumentImportParseError, parseDocumentImport } from "./document-import.parse";
import type { CreateDocumentImportDto } from "./document-imports.dto";
import {
  importExists,
  importInvalid,
  importNotFound,
  titleRequired,
} from "./document-imports.errors";
import {
  importDetailResource,
  importResource,
  type DocumentImportDetailResource,
  type DocumentImportListResource,
} from "./document-imports.resources";
import { HistoryIndexRepository } from "./history-index.repository";

/** The constraint that keeps a workspace's set locators distinct. */
const LOCATOR_KEY = "document_imports_locator_key";

@Injectable()
export class DocumentImportsService {
  /** @param index - The history index's tables. */
  constructor(private readonly index: HistoryIndexRepository) {}

  /**
   * The workspace's imported sets, newest first.
   *
   * @param organizationId - The workspace.
   * @returns The sets.
   */
  async list(organizationId: string): Promise<DocumentImportListResource> {
    return { items: (await this.index.listImports(organizationId)).map(importResource) };
  }

  /**
   * One set and its documents.
   *
   * @param organizationId - The workspace.
   * @param importId - The set.
   * @returns The set.
   * @throws {NotFoundError} `document_import_not_found`.
   */
  async get(organizationId: string, importId: string): Promise<DocumentImportDetailResource> {
    const set = await this.index.findImport(organizationId, importId);
    if (set === undefined) throw importNotFound(importId);

    return importDetailResource(set, await this.index.listItems(organizationId, importId));
  }

  /**
   * Import a file as a set.
   *
   * @param organizationId - The workspace.
   * @param userId - Who is importing it.
   * @param body - Where it goes, what it is called, and the file.
   * @returns The set and its documents.
   * @throws {InvalidRequestError} `document_import_invalid` when the file cannot be read;
   *   `document_import_title_required` when neither the request nor the file names a title.
   * @throws {ConflictError} `document_import_exists` when the locator is taken.
   */
  async create(
    organizationId: string,
    userId: string,
    body: CreateDocumentImportDto,
  ): Promise<DocumentImportDetailResource> {
    let parsed;
    try {
      parsed = parseDocumentImport(body.format, body.content);
    } catch (error) {
      if (error instanceof DocumentImportParseError) throw importInvalid(error.reason);
      throw error;
    }

    const title = body.title?.trim() ?? parsed.title;
    if (title === null || title === undefined || title === "") throw titleRequired();

    let id: string;
    try {
      id = await this.index.insertImport({
        organizationId,
        collection: body.collection,
        name: body.name,
        title: title.slice(0, 300),
        description: body.description?.trim() ?? parsed.description,
        format: body.format,
        contentHash: `sha256:${createHash("sha256").update(body.content, "utf8").digest("hex")}`,
        importedBy: userId,
        documents: parsed.documents,
      });
    } catch (error) {
      if (violatesConstraint(error, LOCATOR_KEY)) throw importExists(body.collection, body.name);
      throw error;
    }

    return this.get(organizationId, id);
  }

  /**
   * Remove a set and its documents.
   *
   * @param organizationId - The workspace.
   * @param importId - The set.
   * @returns When it is gone.
   * @throws {NotFoundError} `document_import_not_found`.
   */
  async remove(organizationId: string, importId: string): Promise<void> {
    if (!(await this.index.deleteImport(organizationId, importId))) throw importNotFound(importId);
  }
}

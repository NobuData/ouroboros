/**
 * Imported document sets' request shapes (CL.5, [#618](https://github.com/NobuData/ouroboros/issues/618)).
 *
 * Shapes are checked here; what depends on the file — whether it parses, whether it carries a
 * title of its own — is the service's, so it can answer with a sentence naming the row.
 */

import { IsIn, IsString, IsUUID, Matches, MaxLength, ValidateIf } from "class-validator";

import type { DocumentImportFormat } from "../../db/schema";
import { present } from "../../routing/routing.dto";
import { MAX_DESCRIPTION_CHARS, MAX_IMPORT_BYTES, MAX_TITLE_CHARS } from "./document-import.parse";

/** Non-blank: at least one character that is not whitespace. */
const NON_BLANK = /\S/;

/** The formats a file may be in. */
export const DOCUMENT_IMPORT_FORMATS: readonly DocumentImportFormat[] = ["csv", "markdown"];

/** A locator's first segment — V119's `document_imports_collection_format`. */
export const COLLECTION = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** A locator's second segment — V119's `document_imports_name_format`. */
export const SET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export class DocumentImportParams {
  @IsUUID()
  importId!: string;
}

export class CreateDocumentImportDto {
  /** The locator's first segment — `support`. */
  @IsString()
  @Matches(COLLECTION, {
    message:
      "collection must start with a lower-case letter or digit and use only lower-case letters, digits, hyphens and underscores (at most 63)",
  })
  collection!: string;

  /** The locator's second segment — `churn-2026-q2`. */
  @IsString()
  @Matches(SET_NAME, {
    message:
      "name must start with a letter or digit and use only letters, digits, dots, hyphens and underscores (at most 100)",
  })
  name!: string;

  /** What a citation of the set is titled. A Markdown file's `# heading` is used when absent. */
  @ValidateIf(present)
  @IsString()
  @Matches(NON_BLANK, { message: "title must not be blank" })
  @MaxLength(MAX_TITLE_CHARS)
  title?: string;

  /** What the set is, in a paragraph — searched with the title. */
  @ValidateIf(present)
  @IsString()
  @Matches(NON_BLANK, { message: "description must not be blank" })
  @MaxLength(MAX_DESCRIPTION_CHARS)
  description?: string;

  /** How to read `content`. */
  @IsIn(DOCUMENT_IMPORT_FORMATS)
  format!: DocumentImportFormat;

  /** The file's text. At most 2 MiB; the parser measures bytes, this bounds characters. */
  @IsString()
  @Matches(NON_BLANK, { message: "content must not be blank" })
  @MaxLength(MAX_IMPORT_BYTES)
  content!: string;
}

/**
 * Reading an imported document set — a CSV or a Markdown file — into documents (CL.5,
 * [#618](https://github.com/NobuData/ouroboros/issues/618)).
 *
 * ```
 * CSV        one document per row. Columns, by header (any case):
 *              text      the document — required (also `body`, `content`)
 *              title     its title — otherwise its first line
 *              key       its locator segment — otherwise doc-001, doc-002, … (also `id`)
 *              date      when it is from — an ISO-8601 date or timestamp
 *              labels    names separated by `;`, `|` or `,`
 *              …         any other column is kept, as text, in the document's meta
 *
 * Markdown   one document per `## Heading`. The first `# Heading` is the set's title and the
 *            text under it, before the first `##`, its description. A document may open with
 *            `Name: value` lines — `Key:`, `Date:`, `Labels:` are read as above, any other is
 *            meta — ended by a blank line. A file with no `##` is one document.
 * ```
 *
 * Pure: text in, documents out. Every refusal is a {@link DocumentImportParseError} naming the
 * row or section, so the route can answer `422` with a sentence a person can act on.
 */

import type { DocumentImportFormat } from "../../db/schema";

/** The largest file an import reads, in bytes — 2 MiB. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** The most documents one set holds — V119's `document_import_items_position`. */
export const MAX_IMPORT_DOCUMENTS = 2000;

/** The largest document, in bytes — V119's `document_import_items_body_bounded`. */
export const MAX_DOCUMENT_BYTES = 65536;

/** The longest title — V119's and V108's 300 characters. */
export const MAX_TITLE_CHARS = 300;

/** The longest set description. */
export const MAX_DESCRIPTION_CHARS = 2000;

/** The most labels a document carries, and the longest — V030's bounds for a ticket. */
export const MAX_LABELS = 100;
export const MAX_LABEL_CHARS = 255;

/** The largest `meta`, as jsonb text — V119's `document_import_items_meta_shape`. */
export const MAX_META_BYTES = 8192;

/** A document's locator segment — V119's `document_import_items_key_format`. */
export const ITEM_KEY = /^[A-Za-z0-9][A-Za-z0-9._#-]{0,99}$/;

/** One document read from a file. */
export interface ParsedDocument {
  /** The locator's last segment. */
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  /** When the document is from, or null when the file does not say. */
  readonly occurredAt: Date | null;
  /** The file's other columns, as text. */
  readonly meta: Readonly<Record<string, string>>;
}

/** What a file held. */
export interface ParsedImport {
  /** The file's own title — a Markdown `# Heading` — or null. */
  readonly title: string | null;
  /** The file's own description — Markdown text before the first `##` — or null. */
  readonly description: string | null;
  readonly documents: readonly ParsedDocument[];
}

/** A file that cannot be imported, and why. */
export class DocumentImportParseError extends Error {
  /** @param reason - The sentence a person reads — it names the row or section. */
  constructor(readonly reason: string) {
    super(reason);
    this.name = "DocumentImportParseError";
  }
}

/** The CSV columns read as fields, by lower-cased header. Anything else is meta. */
const CSV_FIELDS: Readonly<Record<string, "text" | "title" | "key" | "date" | "labels">> = {
  text: "text",
  body: "text",
  content: "text",
  title: "title",
  key: "key",
  id: "key",
  date: "date",
  labels: "labels",
};

/**
 * Read a file.
 *
 * @param format - `csv` or `markdown`.
 * @param content - The file's text.
 * @returns Its documents, and — for Markdown — its own title and description.
 * @throws {DocumentImportParseError} For a file with no documents, too many, a malformed row,
 *   a duplicate or unusable key, an unreadable date, or a document outside the bounds above.
 */
export function parseDocumentImport(format: DocumentImportFormat, content: string): ParsedImport {
  if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_BYTES) {
    throw new DocumentImportParseError(
      `the file is larger than ${String(MAX_IMPORT_BYTES / 1024 / 1024)} MiB`,
    );
  }

  // A byte-order mark, which a spreadsheet's CSV export begins with.
  const unmarked = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const text = unmarked.replace(/\r\n?/g, "\n");
  const parsed = format === "csv" ? parseCsv(text) : parseMarkdown(text);

  if (parsed.documents.length === 0) {
    throw new DocumentImportParseError("the file holds no documents");
  }
  if (parsed.documents.length > MAX_IMPORT_DOCUMENTS) {
    throw new DocumentImportParseError(
      `a set holds at most ${String(MAX_IMPORT_DOCUMENTS)} documents; the file has ${String(parsed.documents.length)}`,
    );
  }

  const seen = new Set<string>();
  for (const document of parsed.documents) {
    if (seen.has(document.key)) {
      throw new DocumentImportParseError(`two documents share the key ${document.key}`);
    }
    seen.add(document.key);
  }

  return parsed;
}

/**
 * Split CSV text into records of fields (RFC 4180: quoted fields, doubled quotes, newlines
 * inside quotes).
 *
 * @param text - The file, with `\n` line ends.
 * @returns One array of fields per record; blank lines are skipped.
 * @throws {DocumentImportParseError} For a quote that never closes.
 */
export function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;

  const endField = (): void => {
    record.push(wasQuoted ? field : field.trim());
    field = "";
    wasQuoted = false;
  };
  const endRecord = (): void => {
    endField();
    if (record.some((value) => value !== "")) records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && field.trim() === "") {
      quoted = true;
      wasQuoted = true;
      field = "";
    } else if (char === ",") endField();
    else if (char === "\n") endRecord();
    else field += char;
  }

  if (quoted) throw new DocumentImportParseError("a quoted field is never closed");
  if (field !== "" || record.length > 0) endRecord();

  return records;
}

function parseCsv(text: string): ParsedImport {
  const [header, ...rows] = csvRecords(text);
  if (header === undefined) throw new DocumentImportParseError("the file is empty");

  const columns = header.map((name) => name.trim());
  const fields = columns.map((name) => CSV_FIELDS[name.toLowerCase()]);
  if (!fields.includes("text")) {
    throw new DocumentImportParseError(
      "the header row needs a text column (text, body or content)",
    );
  }
  for (const field of ["text", "title", "key", "date", "labels"] as const) {
    if (fields.filter((name) => name === field).length > 1) {
      throw new DocumentImportParseError(`the header row names the ${field} column twice`);
    }
  }

  const documents = rows.map((row, index) => {
    const where = `row ${String(index + 2)}`;
    if (row.length > columns.length) {
      throw new DocumentImportParseError(`${where} has more fields than the header row`);
    }

    const value = (field: string): string => row[fields.indexOf(field as never)] ?? "";
    const meta: Record<string, string> = {};
    columns.forEach((name, column) => {
      const cell = row[column] ?? "";
      if (fields[column] === undefined && name !== "" && cell !== "") meta[name] = cell;
    });

    return document(where, index + 1, {
      key: value("key"),
      title: value("title"),
      body: value("text"),
      date: value("date"),
      labels: value("labels"),
      meta,
    });
  });

  return { title: null, description: null, documents };
}

/** A `Name: value` line at the top of a Markdown section. */
const FRONT_LINE = /^([A-Za-z][A-Za-z0-9 _-]{0,39}):\s+(\S.*)$/;

function parseMarkdown(text: string): ParsedImport {
  const lines = text.split("\n");
  let title: string | null = null;
  const preamble: string[] = [];
  const sections: { heading: string; lines: string[] }[] = [];
  let fenced = false;

  for (const line of lines) {
    if (/^(```|~~~)/.test(line.trim())) fenced = !fenced;
    // Trailing space is cut first, so the pattern cannot backtrack over a long run of it.
    const heading = fenced ? null : /^(#{1,2})\s+(\S.*)$/.exec(line.trimEnd());

    if (heading?.[1] === "#" && title === null && sections.length === 0) {
      title = heading[2];
    } else if (heading?.[1] === "##") {
      sections.push({ heading: heading[2], lines: [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1].lines.push(line);
    } else {
      preamble.push(line);
    }
  }

  const lead = preamble.join("\n").trim();

  // No `##`: the file is one document.
  if (sections.length === 0) {
    return {
      title,
      description: null,
      documents:
        lead === ""
          ? []
          : [
              document("the file", 1, {
                key: "",
                title: title ?? "",
                body: lead,
                date: "",
                labels: "",
                meta: {},
              }),
            ],
    };
  }

  const taken = new Set<string>();
  const documents = sections.map((section, index) => {
    const where = `section "${section.heading}"`;
    const front: Record<string, string> = {};
    let start = 0;

    while (start < section.lines.length && section.lines[start].trim() === "") start += 1;
    let cursor = start;
    for (; cursor < section.lines.length; cursor += 1) {
      const match = FRONT_LINE.exec(section.lines[cursor]);
      if (match === null) break;
      front[match[1].trim()] = match[2].trim();
    }
    // Front lines count only when a blank line (or the end) closes them.
    const closed = cursor === section.lines.length || section.lines[cursor].trim() === "";
    const fields = closed ? front : {};
    const body = section.lines.slice(closed ? cursor : start).join("\n");

    const named: Record<string, string> = {};
    const meta: Record<string, string> = {};
    for (const [name, value] of Object.entries(fields)) {
      const field = CSV_FIELDS[name.toLowerCase()];
      if (field === "key" || field === "date" || field === "labels") named[field] = value;
      else meta[name] = value;
    }

    let key = named.key ?? "";
    if (key === "") {
      const base = headingKey(section.heading) || `doc-${String(index + 1).padStart(3, "0")}`;
      key = base;
      for (let copy = 2; taken.has(key); copy += 1) key = `${base.slice(0, 96)}-${String(copy)}`;
    }
    taken.add(key);

    return document(where, index + 1, {
      key,
      title: section.heading,
      body,
      date: named.date ?? "",
      labels: named.labels ?? "",
      meta,
    });
  });

  return {
    title,
    description: lead === "" ? null : lead.slice(0, MAX_DESCRIPTION_CHARS),
    documents,
  };
}

/**
 * A heading as a locator segment: `Northwind Survey — April` → `northwind-survey-april`.
 *
 * @param heading - The section's heading.
 * @returns The key, or an empty string when nothing usable is left.
 */
export function headingKey(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "");
}

/** A document's raw fields, as a file gave them. */
interface RawDocument {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly date: string;
  readonly labels: string;
  readonly meta: Readonly<Record<string, string>>;
}

/**
 * Check one document and give it its defaults.
 *
 * @param where - How to name it in a refusal — `row 7`.
 * @param position - Its place in the file, from 1.
 * @param raw - Its fields as read.
 * @returns The document.
 * @throws {DocumentImportParseError} When a field is unusable.
 */
function document(where: string, position: number, raw: RawDocument): ParsedDocument {
  const body = raw.body.trim();
  if (body === "") throw new DocumentImportParseError(`${where} has no text`);
  if (Buffer.byteLength(body, "utf8") > MAX_DOCUMENT_BYTES) {
    throw new DocumentImportParseError(
      `${where} is larger than ${String(MAX_DOCUMENT_BYTES / 1024)} KiB`,
    );
  }

  const key = raw.key.trim() === "" ? `doc-${String(position).padStart(3, "0")}` : raw.key.trim();
  if (!ITEM_KEY.test(key)) {
    throw new DocumentImportParseError(
      `${where}: the key "${key.slice(0, 40)}" must start with a letter or digit and use only letters, digits, ".", "_", "#" and "-" (at most 100)`,
    );
  }

  const firstLine = body.split("\n", 1)[0].trim();
  const title = (raw.title.trim() === "" ? firstLine : raw.title.trim()).slice(0, MAX_TITLE_CHARS);

  let occurredAt: Date | null = null;
  if (raw.date.trim() !== "") {
    const stamp = Date.parse(raw.date.trim());
    if (!/^\d{4}-\d{2}-\d{2}/.test(raw.date.trim()) || Number.isNaN(stamp)) {
      throw new DocumentImportParseError(
        `${where}: the date "${raw.date.trim().slice(0, 40)}" is not an ISO-8601 date (2026-04-08)`,
      );
    }
    occurredAt = new Date(stamp);
  }

  const labels = [
    ...new Set(
      raw.labels
        .split(/[;|,]/)
        .map((label) => label.trim())
        .filter((label) => label !== ""),
    ),
  ];
  if (labels.length > MAX_LABELS || labels.some((label) => label.length > MAX_LABEL_CHARS)) {
    throw new DocumentImportParseError(
      `${where} may carry at most ${String(MAX_LABELS)} labels of ${String(MAX_LABEL_CHARS)} characters`,
    );
  }

  // jsonb prints `": "` and `", "`; allow for both rather than measure the exact text.
  const metaBytes = Object.entries(raw.meta).reduce(
    (total, [name, value]) =>
      total + Buffer.byteLength(JSON.stringify(name) + JSON.stringify(value), "utf8") + 4,
    2,
  );
  if (metaBytes > MAX_META_BYTES) {
    throw new DocumentImportParseError(
      `${where}: its other columns are larger than ${String(MAX_META_BYTES / 1024)} KiB together`,
    );
  }

  return { key, title, body, labels, occurredAt, meta: raw.meta };
}

import {
  CHURN_CSV,
  CHURN_DOCKING,
  CHURN_DOCUMENTS,
  CHURN_MARKDOWN,
} from "./document-import.fixture";
import {
  DocumentImportParseError,
  MAX_DOCUMENT_BYTES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_DOCUMENTS,
  csvRecords,
  headingKey,
  parseDocumentImport,
} from "./document-import.parse";

/**
 * Reading an imported file (CL.5, #618). Every refusal names the row or section, because the
 * route's `422` is that sentence.
 */

/** Why a file is refused. */
function refusal(format: "csv" | "markdown", content: string): string {
  try {
    parseDocumentImport(format, content);
  } catch (error) {
    if (error instanceof DocumentImportParseError) return error.reason;
    throw error;
  }
  throw new Error("the file was accepted");
}

describe("a CSV import", () => {
  it("reads the churn interviews: fourteen documents, nine about docking", () => {
    const { title, description, documents } = parseDocumentImport("csv", CHURN_CSV);

    expect(title).toBeNull();
    expect(description).toBeNull();
    expect(documents).toHaveLength(CHURN_DOCUMENTS);
    expect(documents.filter((document) => document.labels.includes("docking"))).toHaveLength(
      CHURN_DOCKING,
    );
    expect(documents[1]).toEqual({
      key: "acct-02",
      title: "Churn interview — Harbor Inspection",
      body: "Coastal sites are windy every afternoon. The drone gives up after one docking abort, and nobody on site knew the recovery procedure.",
      labels: ["docking", "recovery"],
      occurredAt: new Date("2026-04-14T00:00:00Z"),
      meta: { account: "Harbor Inspection", seats: "30" },
    });
  });

  it("needs only a text column, and gives the rest defaults", () => {
    const { documents } = parseDocumentImport(
      "csv",
      'Body\nFirst line of the first.\n"Second document,\nover two lines."\n',
    );

    expect(documents).toEqual([
      {
        key: "doc-001",
        title: "First line of the first.",
        body: "First line of the first.",
        labels: [],
        occurredAt: null,
        meta: {},
      },
      {
        key: "doc-002",
        title: "Second document,",
        body: "Second document,\nover two lines.",
        labels: [],
        occurredAt: null,
        meta: {},
      },
    ]);
  });

  it("reads a spreadsheet's export: a byte-order mark, CRLF line ends, doubled quotes", () => {
    const bom = String.fromCharCode(0xfeff);
    const { documents } = parseDocumentImport(
      "csv",
      `${bom}id,text,labels\r\nA-1,"He said ""it gives up"".","a | b, a"\r\n`,
    );

    expect(documents).toEqual([
      expect.objectContaining({ key: "A-1", body: 'He said "it gives up".', labels: ["a", "b"] }),
    ]);
  });

  it("splits records on RFC 4180's rules and skips blank lines", () => {
    expect(csvRecords('a, b ,"c,d"\n\n"e\nf",,g\n')).toEqual([
      ["a", "b", "c,d"],
      ["e\nf", "", "g"],
    ]);
  });

  it.each([
    ["", "the file is empty"],
    ["title,date\nx,2026-01-01\n", "the header row needs a text column (text, body or content)"],
    ["text,body\na,b\n", "the header row names the text column twice"],
    ["text\n", "the file holds no documents"],
    ["text,title\n,Only a title\n", "row 2 has no text"],
    ["text\na,b\n", "row 2 has more fields than the header row"],
    ['text\n"never closed\n', "a quoted field is never closed"],
    ["key,text\nA,one\nA,two\n", "two documents share the key A"],
    [
      "text,date\na,next tuesday\n",
      'row 2: the date "next tuesday" is not an ISO-8601 date (2026-04-08)',
    ],
    [
      "text,date\na,2026-13-45\n",
      'row 2: the date "2026-13-45" is not an ISO-8601 date (2026-04-08)',
    ],
  ])("refuses %j", (content, reason) => {
    expect(refusal("csv", content)).toBe(reason);
  });

  it("refuses a key that cannot be a locator segment, naming the row", () => {
    expect(refusal("csv", "key,text\nok,one\nhas space,two\n")).toMatch(
      /^row 3: the key "has space"/,
    );
    expect(refusal("csv", "key,text\n../up,one\n")).toMatch(/^row 2: the key/);
  });

  it("refuses a document, a set and a file past their bounds", () => {
    expect(refusal("csv", `text\n${"x".repeat(MAX_DOCUMENT_BYTES + 1)}\n`)).toBe(
      "row 2 is larger than 64 KiB",
    );
    expect(refusal("csv", `text\n${"a\n".repeat(MAX_IMPORT_DOCUMENTS + 1)}`)).toBe(
      "a set holds at most 2000 documents; the file has 2001",
    );
    expect(refusal("csv", "x".repeat(MAX_IMPORT_BYTES + 1))).toBe("the file is larger than 2 MiB");
    expect(refusal("csv", `text,notes\na,${"n".repeat(9000)}\n`)).toBe(
      "row 2: its other columns are larger than 8 KiB together",
    );
    expect(refusal("csv", `text,labels\na,${"l".repeat(256)}\n`)).toBe(
      "row 2 may carry at most 100 labels of 255 characters",
    );
  });
});

describe("a Markdown import", () => {
  it("reads a document per ## heading, with the file's own title and description", () => {
    const parsed = parseDocumentImport("markdown", CHURN_MARKDOWN);

    expect(parsed.title).toBe("Support churn interviews Q2");
    expect(parsed.description).toBe("Exit interviews with accounts that churned in Q2 2026.");
    expect(parsed.documents).toEqual([
      {
        key: "acct-01",
        title: "Northwind Survey",
        body: "Docking reliability was the reason. In anything above a light breeze the drone aborts the\napproach and gives up.",
        labels: ["docking"],
        occurredAt: new Date("2026-04-08T00:00:00Z"),
        meta: { Seats: "12" },
      },
      {
        key: "cascade-timber",
        title: "Cascade Timber",
        body: "Battery estimates were wrong on cold mornings.",
        labels: [],
        occurredAt: null,
        meta: {},
      },
    ]);
  });

  it("keeps a `Name: value` opening as text unless a blank line closes it", () => {
    const { documents } = parseDocumentImport(
      "markdown",
      "## Note\n\nSummary: the dock retried\nand then gave up.\n",
    );

    expect(documents[0]).toMatchObject({
      body: "Summary: the dock retried\nand then gave up.",
      meta: {},
    });
  });

  it("gives repeated headings distinct keys, and ignores headings inside a code fence", () => {
    const { documents } = parseDocumentImport(
      "markdown",
      "## Interview\n\none\n\n## Interview\n\n```\n## not a heading\n```\n\n## Résumé — 日本\n\nthree\n",
    );

    expect(documents.map((document) => document.key)).toEqual([
      "interview",
      "interview-2",
      "r-sum",
    ]);
    expect(documents[1].body).toContain("## not a heading");
  });

  it("reads a file with no ## as one document", () => {
    expect(parseDocumentImport("markdown", "# Field notes\n\nThe dock gave up twice.\n")).toEqual({
      title: "Field notes",
      description: null,
      documents: [
        {
          key: "doc-001",
          title: "Field notes",
          body: "The dock gave up twice.",
          labels: [],
          occurredAt: null,
          meta: {},
        },
      ],
    });
  });

  it("refuses an empty file, an empty section and a bad date", () => {
    expect(refusal("markdown", "# Only a title\n")).toBe("the file holds no documents");
    expect(refusal("markdown", "## Empty\n\n## Full\n\ntext\n")).toBe(
      'section "Empty" has no text',
    );
    expect(refusal("markdown", "## A\n\nDate: soon\n\ntext\n")).toBe(
      'section "A": the date "soon" is not an ISO-8601 date (2026-04-08)',
    );
  });

  it("turns a heading into a locator segment", () => {
    expect(headingKey("Northwind Survey — April")).toBe("northwind-survey-april");
    expect(headingKey("日本")).toBe("");
    expect(headingKey("x".repeat(150))).toHaveLength(100);
  });
});

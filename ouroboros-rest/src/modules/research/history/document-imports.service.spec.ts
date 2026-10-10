import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";
import {
  CHURN_CSV,
  CHURN_DOCUMENTS,
  CHURN_LOCATOR,
  CHURN_MARKDOWN,
  CHURN_SET,
} from "./document-import.fixture";
import { DOCUMENT_IMPORT_ERRORS } from "./document-imports.errors";
import { DocumentImportsService } from "./document-imports.service";
import type {
  DocumentImportItemRow,
  DocumentImportRow,
  HistoryIndexRepository,
  NewDocumentImport,
} from "./history-index.repository";

/** Imported document sets (CL.5, #618): what is stored, and every refusal's code. */

const ORG = "org-acme";
const USER = "user-ken";
const ID = "5eed009a-0000-4000-8000-000000000001";
const AT = new Date("2026-09-19T00:00:00Z");

/** A repository that keeps what it is given. */
function build(overrides: Partial<Record<keyof HistoryIndexRepository, jest.Mock>> = {}) {
  const stored: { set?: NewDocumentImport } = {};
  const row = (): DocumentImportRow | undefined =>
    stored.set === undefined
      ? undefined
      : {
          id: ID,
          collection: stored.set.collection,
          name: stored.set.name,
          title: stored.set.title,
          description: stored.set.description,
          format: stored.set.format,
          contentHash: stored.set.contentHash,
          importedBy: stored.set.importedBy,
          createdAt: AT,
          documents: stored.set.documents.length,
        };
  const repository = {
    insertImport: jest.fn((set: NewDocumentImport) => {
      stored.set = set;
      return Promise.resolve(ID);
    }),
    findImport: jest.fn(() => Promise.resolve(row())),
    listImports: jest.fn(() => Promise.resolve(row() === undefined ? [] : [row()])),
    listItems: jest.fn(() =>
      Promise.resolve(
        (stored.set?.documents ?? []).map((document, index): DocumentImportItemRow => ({
          id: `item-${String(index)}`,
          position: index + 1,
          ...document,
        })),
      ),
    ),
    deleteImport: jest.fn().mockResolvedValue(true),
    ...overrides,
  };

  return {
    repository,
    stored,
    service: new DocumentImportsService(repository as unknown as HistoryIndexRepository),
  };
}

/** The code a call is refused with. */
async function refused(work: Promise<unknown>, type: new (...args: never[]) => Error) {
  const error: unknown = await work.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(type);
  return (
    error as { getResponse(): { code: string; message: string; details: unknown } }
  ).getResponse();
}

describe("importing a document set", () => {
  it("round-trips the churn interviews: fourteen documents, citable at the mockup's locator", async () => {
    const { service, stored } = build();
    const set = await service.create(ORG, USER, {
      ...CHURN_SET,
      format: "csv",
      content: CHURN_CSV,
    });

    expect(set).toMatchObject({
      id: ID,
      locator: CHURN_LOCATOR,
      title: "Support churn interviews Q2",
      format: "csv",
      documents: CHURN_DOCUMENTS,
      importedBy: USER,
      contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) as string,
    });
    expect(set.items).toHaveLength(CHURN_DOCUMENTS);
    expect(set.items[0]).toEqual({
      key: "acct-01",
      locator: `${CHURN_LOCATOR}/acct-01`,
      title: "Churn interview — Northwind Survey",
      text: expect.stringContaining("gives up") as string,
      labels: ["docking"],
      occurredAt: "2026-04-08T00:00:00.000Z",
      meta: { account: "Northwind Survey", seats: "12" },
    });
    expect(stored.set).toMatchObject({ organizationId: ORG, collection: "support" });
  });

  it("hashes the file as sent, so the same file is the same hash", async () => {
    const first = build();
    const second = build();
    const body = { ...CHURN_SET, format: "csv" as const, content: CHURN_CSV };

    await first.service.create(ORG, USER, body);
    await second.service.create(ORG, USER, { ...body, content: `${CHURN_CSV}\n` });

    expect(first.stored.set?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second.stored.set?.contentHash).not.toBe(first.stored.set?.contentHash);
  });

  it("takes a Markdown file's own title and description when the request gives none", async () => {
    const { service, stored } = build();

    await service.create(ORG, USER, {
      collection: "support",
      name: "churn-md",
      format: "markdown",
      content: CHURN_MARKDOWN,
    });

    expect(stored.set).toMatchObject({
      title: "Support churn interviews Q2",
      description: "Exit interviews with accounts that churned in Q2 2026.",
    });
  });

  it("prefers the request's title and description", async () => {
    const { service, stored } = build();

    await service.create(ORG, USER, {
      collection: "support",
      name: "churn-md",
      title: "  Mine  ",
      description: " Why ",
      format: "markdown",
      content: CHURN_MARKDOWN,
    });

    expect(stored.set).toMatchObject({ title: "Mine", description: "Why" });
  });

  it("refuses a CSV with no title — document_import_title_required", async () => {
    const { service, repository } = build();
    const answer = await refused(
      service.create(ORG, USER, {
        collection: "support",
        name: "untitled",
        format: "csv",
        content: "text\nA document.\n",
      }),
      InvalidRequestError,
    );

    expect(answer.code).toBe(DOCUMENT_IMPORT_ERRORS.titleRequired);
    expect(repository.insertImport).not.toHaveBeenCalled();
  });

  it("refuses a file it cannot read, naming the row — document_import_invalid", async () => {
    const { service, repository } = build();
    const answer = await refused(
      service.create(ORG, USER, {
        ...CHURN_SET,
        format: "csv",
        content: "key,text\nA,one\nA,two\n",
      }),
      InvalidRequestError,
    );

    expect(answer).toMatchObject({
      code: DOCUMENT_IMPORT_ERRORS.invalid,
      message: "The file cannot be imported: two documents share the key A.",
      details: { fields: { content: ["two documents share the key A"] } },
    });
    expect(repository.insertImport).not.toHaveBeenCalled();
  });

  it("refuses a locator the workspace already has — document_import_exists", async () => {
    const { service } = build({
      insertImport: jest.fn().mockRejectedValue(
        Object.assign(new Error("duplicate"), {
          code: "23505",
          constraint: "document_imports_locator_key",
        }),
      ),
    });
    const answer = await refused(
      service.create(ORG, USER, { ...CHURN_SET, format: "csv", content: CHURN_CSV }),
      ConflictError,
    );

    expect(answer).toMatchObject({
      code: DOCUMENT_IMPORT_ERRORS.exists,
      details: { collection: "support", name: "churn-2026-q2" },
    });
  });

  it("does not disguise another database failure", async () => {
    const failure = new Error("connection lost");
    const { service } = build({ insertImport: jest.fn().mockRejectedValue(failure) });

    await expect(
      service.create(ORG, USER, { ...CHURN_SET, format: "csv", content: CHURN_CSV }),
    ).rejects.toBe(failure);
  });
});

describe("reading and removing sets", () => {
  it("lists the workspace's sets with their locators", async () => {
    const { service, repository } = build();
    await service.create(ORG, USER, { ...CHURN_SET, format: "csv", content: CHURN_CSV });

    expect(await service.list(ORG)).toEqual({
      items: [expect.objectContaining({ locator: CHURN_LOCATOR, documents: CHURN_DOCUMENTS })],
    });
    expect(repository.listImports).toHaveBeenCalledWith(ORG);
  });

  it("answers 404 for a set the workspace does not have — reading or removing", async () => {
    const { service, repository } = build({ deleteImport: jest.fn().mockResolvedValue(false) });

    expect((await refused(service.get(ORG, ID), NotFoundError)).code).toBe(
      DOCUMENT_IMPORT_ERRORS.notFound,
    );
    expect((await refused(service.remove(ORG, ID), NotFoundError)).code).toBe(
      DOCUMENT_IMPORT_ERRORS.notFound,
    );
    expect(repository.findImport).toHaveBeenCalledWith(ORG, ID);
    expect(repository.deleteImport).toHaveBeenCalledWith(ORG, ID);
  });

  it("removes a set by workspace and id", async () => {
    const { service, repository } = build();

    await expect(service.remove(ORG, ID)).resolves.toBeUndefined();
    expect(repository.deleteImport).toHaveBeenCalledWith(ORG, ID);
  });
});

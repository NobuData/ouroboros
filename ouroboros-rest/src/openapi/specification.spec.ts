import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JSON_FILENAME, SpecificationError, document, readSpecification } from "./specification";

/**
 * The loader — everything about reading the committed document that is not about what
 * the document says. What it *says*, and whether the code agrees with it, is
 * `openapi.spec.ts`.
 */

/**
 * Write a file into a throwaway directory.
 *
 * @param contents - What to write.
 * @returns Its path.
 */
function fixture(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "ouroboros-rest-openapi-")), JSON_FILENAME);
  writeFileSync(path, contents, "utf8");
  return path;
}

describe("reading the specification", () => {
  it("parses the document committed at the module root", () => {
    const parsed = readSpecification();

    expect(parsed.openapi).toBe("3.1.0");
    expect(parsed.info.title).toBe("ouroboros-rest");
  });

  it("names every path it looked in when the document is missing", () => {
    const missing = join(tmpdir(), "ouroboros-rest-openapi-does-not-exist", JSON_FILENAME);

    // The answer differs for a checkout and for an image built without the file, so the
    // message has to carry the path rather than only the filename.
    expect(() => readSpecification(missing)).toThrow(SpecificationError);
    expect(() => readSpecification(missing)).toThrow(missing);
  });

  it("says so when the document is not JSON", () => {
    const path = fixture("openapi: 3.1.0\n");

    expect(() => readSpecification(path)).toThrow(SpecificationError);
    expect(() => readSpecification(path)).toThrow(path);
  });

  it.each([
    ["an array", "[]"],
    ["a string", '"openapi"'],
    ["null", "null"],
  ])("refuses %s, which is JSON but is not a document", (_description, contents) => {
    expect(() => readSpecification(fixture(contents))).toThrow(SpecificationError);
  });
});

describe("the document handed to a caller", () => {
  it("is a copy that editing cannot leak into the next one", () => {
    const first = document();
    first.info.title = "mutated";

    expect(document().info.title).toBe("ouroboros-rest");
  });

  it("is deep — a nested edit does not survive either", () => {
    const first = document();
    delete first.paths["/api/v1"];

    expect(document().paths["/api/v1"]).toBeDefined();
  });
});

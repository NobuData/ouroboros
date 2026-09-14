import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GoldenFile, UPDATE_GOLDENS, updatingGoldens } from "./golden.fixture";

/**
 * The golden-file helper — W.3 ([#179](https://github.com/NobuData/ouroboros/issues/179)).
 *
 * A golden that passed when it should fail would make every suite built on it vacuous, so the
 * helper's own promises are held here: it compares as JSON, fails naming the file, the case and
 * the command, rewrites only when asked, and refuses to rewrite in CI.
 */

/** The command a failure names. */
const REGENERATE = "OURO_UPDATE_GOLDENS=1 yarn jest example.spec.ts";

describe("updatingGoldens", () => {
  it("compares unless the variable is exactly 1", () => {
    expect(updatingGoldens({})).toBe(false);
    expect(updatingGoldens({ [UPDATE_GOLDENS]: "0" })).toBe(false);
    expect(updatingGoldens({ [UPDATE_GOLDENS]: "true" })).toBe(false);
    expect(updatingGoldens({ [UPDATE_GOLDENS]: "1" })).toBe(true);
  });

  it("refuses to rewrite where CI is set, so a pipeline cannot bless its own output", () => {
    expect(() => updatingGoldens({ [UPDATE_GOLDENS]: "1", CI: "true" })).toThrow(/CI is set/);
    expect(updatingGoldens({ [UPDATE_GOLDENS]: "1", CI: "false" })).toBe(true);
    expect(updatingGoldens({ [UPDATE_GOLDENS]: "1", CI: "" })).toBe(true);
  });

  it("does not look at CI when nothing asks to rewrite", () => {
    expect(updatingGoldens({ CI: "true" })).toBe(false);
  });
});

describe("GoldenFile", () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "ouro-golden-"));
    path = join(directory, "example.json");
    writeFileSync(
      path,
      JSON.stringify({ about: "An example.", cases: { first: { line: 3 }, second: [1, 2] } }),
    );
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("passes an answer equal to its case, compared as JSON", () => {
    const golden = new GoldenFile(path, "An example.", REGENERATE, false);

    expect(() => golden.hold("first", { line: 3, dropped: undefined })).not.toThrow();
    expect(() => golden.hold("second", [1, 2])).not.toThrow();
  });

  it("fails an answer that moved, naming the file, the case and the command above the diff", () => {
    const golden = new GoldenFile(path, "An example.", REGENERATE, false);

    let message = "";
    try {
      golden.hold("first", { line: 4 });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('example.json no longer matches its case "first"');
    expect(message).toContain(REGENERATE);
    expect(message).toMatch(/"line": 4/);
  });

  it("fails a case the file does not record, rather than passing it", () => {
    const golden = new GoldenFile(path, "An example.", REGENERATE, false);

    expect(() => golden.hold("third", {})).toThrow(/records no case "third".*OURO_UPDATE_GOLDENS/);
  });

  it("lists the recorded case names in the file's order", () => {
    expect(new GoldenFile(path, "An example.", REGENERATE, false).names()).toEqual([
      "first",
      "second",
    ]);
  });

  it("writes nothing when comparing", () => {
    const before = readFileSync(path, "utf8");
    const golden = new GoldenFile(path, "An example.", REGENERATE, false);

    golden.hold("first", { line: 3 });

    expect(golden.save()).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("rewrites exactly what the run held, in order, and the rewritten file then compares clean", () => {
    const writer = new GoldenFile(path, "Rewritten.", REGENERATE, true);

    writer.hold("b", { line: 7 });
    writer.hold("a", ["x"]);
    expect(writer.save()).toBe(true);

    expect(readFileSync(path, "utf8")).toBe(
      `${JSON.stringify({ about: "Rewritten.", cases: { b: { line: 7 }, a: ["x"] } }, null, 2)}\n`,
    );

    const reader = new GoldenFile(path, "Rewritten.", REGENERATE, false);
    expect(reader.names()).toEqual(["b", "a"]);
    expect(() => reader.hold("b", { line: 7 })).not.toThrow();
  });
});

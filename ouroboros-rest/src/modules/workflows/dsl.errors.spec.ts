import type { DslDiagnostic } from "./dsl.errors";
import {
  DslErrorCode,
  DslWarningCode,
  SCHEMA_STAGE_CODES,
  STRUCTURAL_STAGE_CODES,
  pointer,
  sortDiagnostics,
} from "./dsl.errors";

/** A diagnostic with only the two fields these tests are about. */
const at = (path: string, code: string): DslDiagnostic =>
  ({ path, code, message: "" }) as DslDiagnostic;

describe("pointer", () => {
  it("renders the document root as the empty pointer", () => {
    expect(pointer()).toBe("");
  });

  it("renders property names and array indices alike", () => {
    expect(pointer("nodes", 3, "config", "routing")).toBe("/nodes/3/config/routing");
  });

  it("escapes ~ before / so a literal slash does not become ~01", () => {
    // RFC 6901 § 3: the order matters. Escaping `/` first would turn it into `~1` and the
    // `~` pass would then turn that into `~01`, which points somewhere else entirely.
    expect(pointer("a/b")).toBe("/a~1b");
    expect(pointer("a~b")).toBe("/a~0b");
    expect(pointer("a~/b")).toBe("/a~0~1b");
  });

  it("escapes an undeclared property name, which is the one segment a document controls", () => {
    // Every other segment is a name from the schema, and none of them contains `/` or `~`.
    // An unknown key comes from the document, so this is where an unescaped pointer would
    // actually be produced.
    expect(pointer("nodes", 0, "config", "a/b")).toBe("/nodes/0/config/a~1b");
  });
});

describe("sortDiagnostics", () => {
  it("puts array indices in numeric order rather than lexical order", () => {
    const sorted = sortDiagnostics([
      at("/nodes/10", DslErrorCode.NODE_UNREACHABLE),
      at("/nodes/2", DslErrorCode.NODE_UNREACHABLE),
      at("/nodes/1", DslErrorCode.NODE_UNREACHABLE),
    ]);
    expect(sorted.map((d) => d.path)).toEqual(["/nodes/1", "/nodes/2", "/nodes/10"]);
  });

  it("puts a parent before its children", () => {
    const sorted = sortDiagnostics([
      at("/nodes/0/config/routing", DslErrorCode.CONFIG_ROUTING_MISSING),
      at("/nodes/0", DslErrorCode.NODE_UNREACHABLE),
    ]);
    expect(sorted.map((d) => d.path)).toEqual(["/nodes/0", "/nodes/0/config/routing"]);
  });

  it("orders two diagnostics at the same value by code, so the order is total", () => {
    const sorted = sortDiagnostics([
      at("/nodes/0/config/skill", DslWarningCode.REFERENCE_UNKNOWN_SKILL),
      at("/nodes/0/config/skill", DslErrorCode.CONFIG_SKILL_REQUIRED),
    ]);
    expect(sorted.map((d) => d.code)).toEqual([
      DslErrorCode.CONFIG_SKILL_REQUIRED,
      DslWarningCode.REFERENCE_UNKNOWN_SKILL,
    ]);
  });

  it("sorts sibling properties lexically", () => {
    const sorted = sortDiagnostics([
      at("/trigger/event", DslErrorCode.SCHEMA_ENUM),
      at("/trigger/conditions", DslErrorCode.SCHEMA_TYPE),
    ]);
    expect(sorted.map((d) => d.path)).toEqual(["/trigger/conditions", "/trigger/event"]);
  });

  it("leaves the caller's array alone", () => {
    const given = [at("/b", DslErrorCode.SCHEMA_TYPE), at("/a", DslErrorCode.SCHEMA_TYPE)];
    sortDiagnostics(given);
    expect(given.map((d) => d.path)).toEqual(["/b", "/a"]);
  });

  it("puts the document root first", () => {
    const sorted = sortDiagnostics([
      at("/nodes", DslErrorCode.DOCUMENT_NO_TRIGGER),
      at("", DslErrorCode.DOCUMENT_MALFORMED),
    ]);
    expect(sorted.map((d) => d.path)).toEqual(["", "/nodes"]);
  });
});

describe("the two stages' code sets", () => {
  it("partition every error code, so a new one has to be classified", () => {
    // `dsl.conformance.spec.ts` compares ajv's verdict against the schema stage's alone,
    // because the structural rules are deliberately outside the published schema. A code
    // that belonged to neither set — or to both — would make that comparison pass for the
    // wrong reason.
    const declared = Object.values(DslErrorCode);
    const classified = [...SCHEMA_STAGE_CODES, ...STRUCTURAL_STAGE_CODES];

    expect(classified).toHaveLength(declared.length);
    expect([...classified].sort()).toEqual([...declared].sort());
  });

  it("keeps a warning code out of both, because a warning is not a stage's verdict", () => {
    for (const code of Object.values(DslWarningCode)) {
      expect(SCHEMA_STAGE_CODES.has(code)).toBe(false);
      expect(STRUCTURAL_STAGE_CODES.has(code)).toBe(false);
    }
  });
});

describe("sortDiagnostics — the ordering the engine has to reproduce", () => {
  it("puts a digit segment before a name at the same position", () => {
    // The DSL's own shape cannot produce this — a position in a pointer is always an index
    // or always a property name — so it is fixed here to make the two implementations one
    // function rather than two that happen to agree.
    const sorted = sortDiagnostics([
      at("/nodes/config", DslErrorCode.SCHEMA_TYPE),
      at("/nodes/2", DslErrorCode.SCHEMA_TYPE),
    ]);
    expect(sorted.map((d) => d.path)).toEqual(["/nodes/2", "/nodes/config"]);
  });
});

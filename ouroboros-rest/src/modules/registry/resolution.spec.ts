import { PROVIDER_CONNECTION_KINDS, PROVIDER_CONNECTION_STATUSES } from "../db/schema";
import { toResolvedAlias, type AliasResolutionRow } from "./resolution";

/**
 * The one crossing point between a row and an answer.
 *
 * Small enough that it would be tempting to leave untested, and it is the file where a
 * credential would be *added* to the answer, so what it asserts is as much about what the
 * shape does not have as about what it copies.
 */

/** One row, as V015's join hands it back. */
const ROW = {
  alias: "coder-max",
  model_id: "claude-fable-5",
  params: { thinking: "max", temperature: 0.2 },
  connection_id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  kind: "anthropic",
  display_name: "Anthropic",
  base_url: null,
  status: "active",
} satisfies AliasResolutionRow;

describe("toResolvedAlias", () => {
  it("renames the database's columns and changes nothing else", () => {
    expect(toResolvedAlias(ROW)).toEqual({
      alias: "coder-max",
      modelId: "claude-fable-5",
      params: { thinking: "max", temperature: 0.2 },
      connection: {
        id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
        kind: "anthropic",
        displayName: "Anthropic",
        baseUrl: null,
        status: "active",
      },
    });
  });

  it("has no field a credential could occupy", () => {
    // Decision **P3**: a credential never leaves the control plane, and the way this module
    // keeps that is by resolving to an address and a model. Asserted on the *keys* rather
    // than on a value, because the failure this guards against is somebody widening the
    // shape — at which point the value would be there and correct.
    const resolved = toResolvedAlias(ROW);

    expect(Object.keys(resolved).sort()).toEqual(["alias", "connection", "modelId", "params"]);
    expect(Object.keys(resolved.connection).sort()).toEqual([
      "baseUrl",
      "displayName",
      "id",
      "kind",
      "status",
    ]);
  });

  it("keeps a null base URL as null rather than dropping the key", () => {
    // *This provider has no configured address* is a fact worth carrying: a missing key
    // would leave a reader unable to tell it from a field nobody set.
    const resolved = toResolvedAlias(ROW);

    expect("baseUrl" in resolved.connection).toBe(true);
    expect(resolved.connection.baseUrl).toBeNull();
  });

  it("carries an address through for the kinds that have one", () => {
    const resolved = toResolvedAlias({
      ...ROW,
      kind: "ollama",
      display_name: "Ollama",
      base_url: "http://workstation.local:11434",
    });

    expect(resolved.connection.baseUrl).toBe("http://workstation.local:11434");
  });

  it("does not default empty parameters into something else", () => {
    // V015 defaults the column to `{}` and constrains it to an object, so a `?? {}` here
    // would be this file disagreeing with the schema about what is possible — and would hide
    // a genuinely absent value if the schema ever stopped guaranteeing one.
    expect(toResolvedAlias({ ...ROW, params: {} }).params).toEqual({});
  });

  it("maps every kind and every status the schema admits", () => {
    // The unions are the CHECK constraints' counterpart, and a mapper that quietly narrowed
    // one would make a legitimate row unresolvable. Table-driven so a sixth kind or a fifth
    // status arrives here as a failing test rather than as a silent gap.
    for (const kind of PROVIDER_CONNECTION_KINDS) {
      expect(toResolvedAlias({ ...ROW, kind }).connection.kind).toBe(kind);
    }

    for (const status of PROVIDER_CONNECTION_STATUSES) {
      expect(toResolvedAlias({ ...ROW, status }).connection.status).toBe(status);
    }
  });
});

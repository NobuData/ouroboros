import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TICKET_SOURCE_KINDS } from "../db/schema";
import { sourceCatalog } from "./sources.catalog";
import { toSourceFormFields } from "./ticket-source.config";
import { FIXTURE_SCHEMA, NO_CAPABILITIES, scriptedProvider } from "./ticket-source.fixture";
import { TicketSourceRegistry } from "./ticket-source.registry";

/**
 * The add-source catalog ([#141](https://github.com/NobuData/ouroboros/issues/141)) — the
 * registry, crossing the wire as an ordered list of forms — and the property that makes it
 * worth having: no file on the management side names a kind.
 */

/** A management-side source, with its comments stripped: prose may name a kind, code may not. */
function codeOf(file: string): string {
  return readFileSync(join(__dirname, file), "utf8").replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
}

describe("the catalog", () => {
  it("answers one entry per registered kind, in the migration's order, with its form", () => {
    // Registered back to front, so the order is the registry's sort rather than the input's.
    const registry = new TicketSourceRegistry([
      scriptedProvider({ kind: "linear", capabilities: { labels: true } }),
      scriptedProvider({ kind: "github" }),
    ]);

    const catalog = sourceCatalog(registry);

    expect(catalog.kinds.map((entry) => entry.kind)).toStrictEqual(["github", "linear"]);
    expect(catalog.kinds[0]).toStrictEqual({
      kind: "github",
      title: FIXTURE_SCHEMA.title,
      fields: toSourceFormFields(FIXTURE_SCHEMA),
      capabilities: NO_CAPABILITIES,
    });
    expect(catalog.kinds[1]?.capabilities).toStrictEqual({ ...NO_CAPABILITIES, labels: true });
  });

  it("is empty for a build that registers nothing, rather than a failure", () => {
    expect(sourceCatalog(new TicketSourceRegistry([])).kinds).toStrictEqual([]);
  });

  it("renders a provider it has never heard of, which is the whole point", () => {
    // A `custom` provider — the kind a community provider registers as — comes out with a
    // working form and no line of catalog code mentioning it.
    const registry = new TicketSourceRegistry([scriptedProvider({ kind: "custom" })]);

    expect(sourceCatalog(registry).kinds[0]?.fields.map((field) => field.widget)).toStrictEqual([
      "url",
      "text",
      "select",
      "list",
      "secret",
    ]);
  });
});

describe("the management side", () => {
  it.each(["sources.catalog.ts", "sources.service.ts", "sources.controller.ts"])(
    "names no ticket source kind in %s",
    (file) => {
      // Decision P5, held on the side that serves the SPI: a `switch (kind)` here would be the
      // pluggable layer decaying in its own face. Comments are stripped first, because prose
      // explaining which tracker a rule came from is documentation rather than a branch.
      const code = codeOf(file);

      for (const kind of TICKET_SOURCE_KINDS) {
        expect(code).not.toMatch(new RegExp(`["'\`]${kind}["'\`]`));
      }
    },
  );
});

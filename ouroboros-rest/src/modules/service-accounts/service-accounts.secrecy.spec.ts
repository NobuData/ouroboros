import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **Hash-only, grep-tested** (#485). The token is shown once and stored nowhere: these checks read
 * the schema and this module's source, so a later change that started persisting or logging the
 * token fails here before it reaches a database.
 */

const V091 = readFileSync(
  join(__dirname, "../../../../ouroboros-db/migrations/V091__members_service_accounts.sql"),
  "utf8",
);

/** This module's non-test sources. */
const SOURCES = readdirSync(__dirname)
  .filter((file) => file.endsWith(".ts") && !/(spec|fixture)\.ts$/.test(file))
  .map((file) => ({ file, text: readFileSync(join(__dirname, file), "utf8") }));

describe("where a service token can live", () => {
  it("has no column for the token in V091 — only its hash and a sealed hint", () => {
    const table = /create table ouroboros\.service_tokens \(([\s\S]*?)\n\);/.exec(V091)?.[1] ?? "";
    const columns = [...table.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|timestamptz)/gm)].map(
      (match) => match[1],
    );

    expect(columns).toEqual([
      "id",
      "organization_id",
      "service_account_id",
      "token_hash",
      "hint_sealed",
      "created_by",
      "created_at",
      "last_used_at",
      "revoked_at",
    ]);
  });

  it("hands the minted value to nothing but the one response that shows it", () => {
    const uses = SOURCES.flatMap(({ file, text }) =>
      [...text.matchAll(/minted\.value/g)].map(() => file),
    );

    // Two: the create and rotate answers' `token:` field.
    expect(uses).toEqual(["service-accounts.service.ts", "service-accounts.service.ts"]);
    for (const { text } of SOURCES) {
      for (const line of text
        .split("\n")
        .filter((candidate) => candidate.includes("minted.value"))) {
        expect(line).toMatch(/token: token\.minted\.value/);
      }
    }
  });

  it("never logs from this module", () => {
    for (const { text } of SOURCES) {
      expect(text).not.toMatch(/console\.|Logger|\.log\(/);
    }
  });
});

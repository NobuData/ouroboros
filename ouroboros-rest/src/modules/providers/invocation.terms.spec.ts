import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PROVIDER_CONNECTION_KINDS } from "../db/schema";
import {
  INVOCATION_TERMS,
  invocationCleared,
  invocationEligibility,
  isSubscriptionCredential,
} from "./invocation.terms";

/**
 * DH.4 ([#1304](https://github.com/NobuData/ouroboros/issues/1304)) — the provider-terms record.
 *
 * Three properties: no row is cleared without a primary source and a date; eligibility is what
 * the issue's table says it is on filing day; and the record in code is the table in
 * `docs/MODEL_PROVIDERS.md`, row for row.
 */

/** The human-readable copy of the record. */
const document = (): string =>
  readFileSync(join(__dirname, "..", "..", "..", "..", "docs", "MODEL_PROVIDERS.md"), "utf8");

/** The words the doc table uses for each standing. */
const STANDING_WORDS = {
  cleared: "✓ cleared",
  refused: "✗ refused",
  unverified: "✗ unverified",
} as const;

describe("the record", () => {
  it("has an entry for every connection kind", () => {
    expect(Object.keys(INVOCATION_TERMS).sort()).toEqual([...PROVIDER_CONNECTION_KINDS].sort());
  });

  it.each(PROVIDER_CONNECTION_KINDS)(
    "clears no %s row without a primary source and a date",
    (kind) => {
      for (const row of INVOCATION_TERMS[kind].credentials) {
        if (row.standing === "cleared") {
          expect(row.source).toEqual(expect.any(String));
          expect(row.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }

        if (row.standing === "unverified") {
          expect(row.source).toBeNull();
        }
      }
    },
  );

  it("states a reason exactly where a kind is not cleared", () => {
    for (const kind of PROVIDER_CONNECTION_KINDS) {
      expect(INVOCATION_TERMS[kind].reason === null).toBe(invocationCleared(kind));
    }
  });
});

describe("eligibility", () => {
  it.each(["anthropic", "openai_compatible", "ollama"] as const)("clears %s", (kind) => {
    expect(invocationEligibility(kind)).toEqual({ eligible: true, reason: null });
  });

  it.each(["copilot", "cursor", "custom"] as const)("does not clear %s, and says why", (kind) => {
    const { eligible, reason } = invocationEligibility(kind);

    expect(eligible).toBe(false);
    expect(reason).toMatch(/\.$/);
  });
});

describe("recognising a claude.ai subscription credential", () => {
  it.each([
    "sk-ant-oat01-abcdefghijklmnop",
    "sk-ant-ort01-abcdefghijklmnop",
    "sk-ant-sid01-abcdefghijklmnop",
    "  sk-ant-oat01-padded-with-whitespace  ",
    "Bearer sk-ant-oat01-pasted-with-its-scheme",
  ])("refuses %s", (secret) => {
    expect(isSubscriptionCredential(secret)).toBe(true);
  });

  it.each([
    "sk-ant-api03-abcdefghijklmnop",
    "sk-ant-admin01-abcdefghijklmnop",
    "sk-proj-openai-style-key",
    "ollama",
    "a key that mentions sk-ant-oat01- in the middle",
  ])("accepts %s", (secret) => {
    expect(isSubscriptionCredential(secret)).toBe(false);
  });
});

describe("docs/MODEL_PROVIDERS.md", () => {
  it.each(PROVIDER_CONNECTION_KINDS)("carries %s's rows as the record states them", (kind) => {
    const rows = document()
      .split("\n")
      .filter((line) => line.startsWith(`| \`${kind}\` |`));

    expect(rows).toHaveLength(INVOCATION_TERMS[kind].credentials.length);

    INVOCATION_TERMS[kind].credentials.forEach((terms, index) => {
      const cells = rows[index].split("|").map((cell) => cell.trim());

      expect(cells[2]).toBe(terms.credential);
      expect(cells[3]).toBe(STANDING_WORDS[terms.standing]);
      expect(cells[5]).toBe(terms.read ?? "—");

      if (terms.source !== null) {
        expect(cells[4]).toContain(terms.source);
      }

      if (terms.sourceUrl !== null) {
        expect(cells[4]).toContain(terms.sourceUrl);
      }
    });
  });
});

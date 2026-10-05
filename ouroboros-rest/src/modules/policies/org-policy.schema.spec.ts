import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ORG_POLICY_DSL_DEFINITIONS, ORG_POLICY_SCHEMA } from "./org-policy.schema";
import { validPolicyDocument } from "./policy-publish.service";

/** The repository's published contracts. */
const SCHEMAS = join(__dirname, "..", "..", "..", "..", "schemas");

/**
 * The embedded grammar is the published one (BQ.2, #481) — an edit to either alone is red here —
 * and the publish flow's validator agrees with every committed fixture, which is what the CI
 * checker (`ouroboros-db/scripts/org-policy-schema.mjs`) holds the stored versions to.
 */
describe("the org policy grammar", () => {
  it("is embedded exactly as published", () => {
    expect(ORG_POLICY_SCHEMA).toEqual(
      JSON.parse(readFileSync(join(SCHEMAS, "org-policy", "v1.json"), "utf8")),
    );
  });

  it("embeds the three workflow DSL definitions it references, exactly", () => {
    const dsl = JSON.parse(readFileSync(join(SCHEMAS, "workflow-dsl", "v1.json"), "utf8")) as {
      $id: string;
      $schema: string;
      $defs: Record<string, unknown>;
    };

    expect(ORG_POLICY_DSL_DEFINITIONS).toEqual({
      $schema: dsl.$schema,
      $id: dsl.$id,
      $defs: { effort: dsl.$defs.effort, label: dsl.$defs.label, path_glob: dsl.$defs.path_glob },
    });
  });

  it.each(readdirSync(join(SCHEMAS, "org-policy", "fixtures", "valid")))(
    "accepts valid/%s",
    (name) => {
      const document: unknown = JSON.parse(
        readFileSync(join(SCHEMAS, "org-policy", "fixtures", "valid", name), "utf8"),
      );

      expect(validPolicyDocument(document)).toBe(document);
    },
  );

  it.each(readdirSync(join(SCHEMAS, "org-policy", "fixtures", "invalid")))(
    "refuses invalid/%s",
    (name) => {
      const document: unknown = JSON.parse(
        readFileSync(join(SCHEMAS, "org-policy", "fixtures", "invalid", name), "utf8"),
      );

      let refused: unknown;

      try {
        validPolicyDocument(document);
      } catch (error) {
        refused = error;
      }

      expect(refused).toMatchObject({ response: { code: "policy_document_invalid" } });
    },
  );
});

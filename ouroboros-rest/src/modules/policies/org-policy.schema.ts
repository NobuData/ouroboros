/**
 * `schemas/org-policy/v1.json` — the org policy document's grammar (BQ.1, #480) — and the three
 * `schemas/workflow-dsl/v1.json` definitions it references by `$id` (`effort`, `label`,
 * `path_glob`), embedded so the publish flow needs no file read at run time (`rootDir` is `src`, so
 * the JSON cannot be imported). The CI checker (`ouroboros-db/scripts/org-policy-schema.mjs`)
 * validates every fixture and stored version against the same two files.
 *
 * **The published files are the contract and these are their copies.** `org-policy.schema.spec.ts`
 * fails when they differ, so an edit to one without the other is a red suite rather than two
 * validators that quietly disagree.
 */

/** The org policy grammar, as JSON Schema 2020-12. */
export const ORG_POLICY_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ouroboros.build/schemas/org-policy/v1.json",
  title: "Ouroboros org-policy document, version 1",
  description:
    "The JSON document a published policy version stores in org_policy_versions.document (V092, #480 BQ.1): one map of rule_id to {enabled, conditions}. Conditions are the workflow DSL's predicate vocabulary (#133, decision P8) — the effort, label and path_glob definitions are referenced from schemas/workflow-dsl/v1.json rather than copied, so the policy card's chips and the studio's trigger chips are the same kind of object. Money is integer cents. The database holds the envelope (rule ids, the five core rules, {enabled, conditions}, spend cents); this file holds the grammar. A stored version is immutable, so a change that would refuse a document this file accepts is a v2.json beside it. See schemas/README.md.",
  type: "object",
  required: ["auto_merge", "human_review", "protected_paths", "spend_guard", "dry_run_new_repos"],
  properties: {
    auto_merge: {
      description:
        "Auto-merge when all gates are green — and these conditions hold. Mockup: `effort ≤ M` · `non-refactor`.",
      $ref: "#/$defs/predicate_rule",
    },
    human_review: {
      description:
        "A person must review when these conditions hold. Mockup: `label:refactor` · `OR effort ≥ L`.",
      $ref: "#/$defs/predicate_rule",
    },
    protected_paths: {
      description:
        "A change touching one of these globs needs an allow-once. Mockup: `boot/` · `keys/` · `.github/`.",
      type: "object",
      additionalProperties: false,
      required: ["enabled", "conditions"],
      properties: {
        enabled: {
          type: "boolean",
        },
        conditions: {
          type: "object",
          additionalProperties: false,
          required: ["path_globs"],
          properties: {
            path_globs: {
              $ref: "#/$defs/path_globs",
            },
          },
        },
      },
    },
    spend_guard: {
      description:
        "Pause a loop at a per-run cost; cap each provider's month. Mockup: `pause loop at $2.50/run` · `monthly cap $600/provider`. At least one cap.",
      type: "object",
      additionalProperties: false,
      required: ["enabled", "conditions"],
      properties: {
        enabled: {
          type: "boolean",
        },
        conditions: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            per_run_cap_cents: {
              $ref: "#/$defs/cents",
            },
            monthly_cap_cents: {
              $ref: "#/$defs/cents",
            },
          },
        },
      },
    },
    dry_run_new_repos: {
      description:
        "A new repository's first N loops open draft PRs. Mockup: `first 10 loops open draft PRs`.",
      type: "object",
      additionalProperties: false,
      required: ["enabled", "conditions"],
      properties: {
        enabled: {
          type: "boolean",
        },
        conditions: {
          type: "object",
          additionalProperties: false,
          required: ["first_n_loops"],
          properties: {
            first_n_loops: {
              $ref: "#/$defs/loop_count",
            },
          },
        },
      },
    },
  },
  patternProperties: {
    "^custom:[a-z0-9][a-z0-9_-]{0,62}$": {
      description:
        "The escape hatch: a rule this version of the product does not name, accepted without a schema change. Its conditions draw on the whole condition vocabulary.",
      type: "object",
      additionalProperties: false,
      required: ["enabled", "conditions"],
      properties: {
        enabled: {
          type: "boolean",
        },
        conditions: {
          $ref: "#/$defs/condition",
        },
      },
    },
  },
  additionalProperties: false,
  $defs: {
    effort: {
      $ref: "https://ouroboros.build/schemas/workflow-dsl/v1.json#/$defs/effort",
    },
    label: {
      $ref: "https://ouroboros.build/schemas/workflow-dsl/v1.json#/$defs/label",
    },
    path_glob: {
      $ref: "https://ouroboros.build/schemas/workflow-dsl/v1.json#/$defs/path_glob",
    },
    cents: {
      description:
        "Money, in integer cents: $2.50 is 250. Never a float, never dollars, never a string. Positive, and no larger than an integer column holds — the bound routes.max_cost_cents_per_run and provider_connections.monthly_cap_cents share.",
      type: "integer",
      minimum: 1,
      maximum: 2147483647,
    },
    loop_count: {
      description: "A number of loops. Zero is a rule that never applies.",
      type: "integer",
      minimum: 0,
      maximum: 100000,
    },
    path_globs: {
      description:
        "Globs over the paths a change touches, relative to the repository root: `boot/**`.",
      type: "array",
      maxItems: 64,
      uniqueItems: true,
      items: {
        $ref: "#/$defs/path_glob",
      },
    },
    predicate: {
      description:
        'One test over a loop\'s ticket, exactly one key: a comparison (`effort_lte`, `effort_gte`, `label`) or a composition (`not`, `any`, `all`). Recursive — `{"all": [{"effort_lte": "m"}, {"not": {"label": "refactor"}}]}` is `effort ≤ M` · `non-refactor`.',
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      maxProperties: 1,
      properties: {
        effort_lte: {
          $ref: "#/$defs/effort",
        },
        effort_gte: {
          $ref: "#/$defs/effort",
        },
        label: {
          $ref: "#/$defs/label",
        },
        not: {
          $ref: "#/$defs/predicate",
        },
        any: {
          $ref: "#/$defs/predicates",
        },
        all: {
          $ref: "#/$defs/predicates",
        },
      },
    },
    predicates: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: {
        $ref: "#/$defs/predicate",
      },
    },
    predicate_rule: {
      type: "object",
      additionalProperties: false,
      required: ["enabled", "conditions"],
      properties: {
        enabled: {
          type: "boolean",
        },
        conditions: {
          $ref: "#/$defs/predicate",
        },
      },
    },
    condition: {
      description:
        "A custom rule's conditions: any of the vocabulary's terms, all of which must hold. Empty is a rule with no conditions.",
      type: "object",
      additionalProperties: false,
      properties: {
        effort_lte: {
          $ref: "#/$defs/effort",
        },
        effort_gte: {
          $ref: "#/$defs/effort",
        },
        label: {
          $ref: "#/$defs/label",
        },
        not: {
          $ref: "#/$defs/predicate",
        },
        any: {
          $ref: "#/$defs/predicates",
        },
        all: {
          $ref: "#/$defs/predicates",
        },
        path_globs: {
          $ref: "#/$defs/path_globs",
        },
        per_run_cap_cents: {
          $ref: "#/$defs/cents",
        },
        monthly_cap_cents: {
          $ref: "#/$defs/cents",
        },
        first_n_loops: {
          $ref: "#/$defs/loop_count",
        },
      },
    },
  },
} as const;

/** The workflow DSL definitions the grammar references — the DSL's `$id`, and those three alone. */
export const ORG_POLICY_DSL_DEFINITIONS = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ouroboros.build/schemas/workflow-dsl/v1.json",
  $defs: {
    effort: {
      description:
        "How much work a ticket is, in the vocabulary issue_estimates.effort stores and the mockup's chips render.",
      enum: ["xs", "s", "m", "l", "xl"],
    },
    label: {
      type: "string",
      minLength: 1,
      maxLength: 64,
    },
    path_glob: {
      description:
        "A glob over the paths a loop's change touches, relative to the repository root: `drivers/can/**`. It may not start with `/`, no segment may be `..`, and it holds no whitespace. The pattern is written without lookaheads so every validator of this language can compile it.",
      type: "string",
      minLength: 1,
      maxLength: 256,
      pattern:
        "^(?:\\.|\\.\\.[^/\\s]+|\\.[^/\\s.][^/\\s]*|[^/\\s.][^/\\s]*)(?:/(?:\\.|\\.\\.[^/\\s]+|\\.[^/\\s.][^/\\s]*|[^/\\s.][^/\\s]*)?)*$",
    },
  },
} as const;

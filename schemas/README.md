# schemas

> Contracts that belong to no single module, because more than one module reads them.

Everything here is a **published artifact**: a versioned JSON Schema with an `$id`, the golden
fixtures that pin what it means, and the recorded verdicts every implementation of it has to
produce. A module's own shapes stay inside that module; a shape two modules have to agree about
letter for letter lives here, once.

The directory was opened by
[P.2](https://github.com/NobuData/ouroboros/issues/133) for the workflow definition language,
which is the case that forced the question: the canvas, the future code view, the REST
validator, the engine's dry-run simulator and the eventual interpreter all read one document,
and decision **P3** made it a canonical JSON document with a published schema precisely so that
every consumer reads the same artifact rather than each inventing a parser.

## Layout

```
schemas/
└── workflow-dsl/
    ├── v1.json                  # the contract — $id: …/workflow-dsl/v1.json, JSON Schema 2020-12
    └── fixtures/
        ├── expected.json        # the parity contract: one case per rule, and its verdict
        ├── valid/               # documents that validate
        ├── invalid/             # one document per rule, each breaking exactly that rule
        ├── catalogues/          # decision P7's vocabularies, for the reference-warning cases
        └── yaml/                # the YAML projection of each valid document (mockup 05)
```

`v1.json` describes the whole **1.x line**. Adding an optional field appends a minor to its
`dsl_version` enum in the same file; a change that would refuse a document this one accepts is a
`v2.json` beside it, and both stay committed for as long as a stored version needs them.

## Who reads this, and what proves they agree

| Reader | What it does | What holds it here |
|---|---|---|
| [`ouroboros-rest/src/modules/workflows/`](../ouroboros-rest/src/modules/workflows) | zod validator + YAML projection — save, publish, code view | `dsl.parity.spec.ts` (the recorded verdicts) and `dsl.conformance.spec.ts` (ajv over `v1.json`) |
| [`ouroboros-engine/src/ouroboros_engine/workflows/`](../ouroboros-engine/src/ouroboros_engine/workflows) | pydantic validator — R.2's `validate` and dry-run | `tests/test_workflows_parity.py` and `tests/test_workflows_conformance.py` |
| [`docs/WORKFLOW_DSL.md`](../docs/WORKFLOW_DSL.md) | the specification a person reads | Worked examples taken from these fixtures |

**Neither module imports the other, and no third process compares two outputs.** Each reads
this directory from its own suite and asserts against the same `expected.json`. A rule added to
one validator and forgotten in the other is a red check in the half that forgot it — which is
the whole reason the fixtures live above both modules rather than inside either.

Both `ci/rest` and `ci/engine` watch `schemas/**`
([`scripts/verify-ci.sh`](../scripts/verify-ci.sh) asserts it), so an edit here runs both halves
on the pull request that makes it.

## Changing a contract here

1. Edit `v1.json` **and** both validators, in one change.
2. Add or edit the fixture that demonstrates the rule, and its case in `expected.json`.
3. Run both suites. `expected.json` is reviewed and frozen, not regenerated: a change to it is a
   change to the contract, and both halves have to be green on the new one.

The fixture set is checked for completeness in both directions — every document on disk has a
case, and every code a validator can emit has a case behind it — so a rule added without a
fixture fails before it can quietly go unasserted.

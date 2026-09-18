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
├── plan/
│   ├── v0.json                  # the contract — $id: …/plan/v0.json, JSON Schema 2020-12
│   └── fixtures/
│       └── expected.json        # one case per parser rule, and the batch it must answer with
├── runner-protocol/
│   ├── v1.json                  # the contract — $id: …/runner-protocol/v1.json, JSON Schema 2020-12
│   └── fixtures/
│       ├── expected.json        # the parity contract: one case per rule, and its verdict
│       ├── valid/               # a worked example per message type, and the variants
│       ├── invalid/             # one document per rule, each breaking exactly that rule
│       └── sessions/            # ordered transcripts — each frame a path into valid/
└── workflow-dsl/
    ├── v1.json                  # the contract — $id: …/workflow-dsl/v1.json, JSON Schema 2020-12
    └── fixtures/
        ├── expected.json        # the parity contract: one case per rule, and its verdict
        ├── valid/               # documents that validate
        ├── invalid/             # one document per rule, each breaking exactly that rule
        ├── catalogues/          # decision P7's vocabularies, for the reference-warning cases
        ├── yaml/                # the YAML projection of each valid document (P.2's round-trip proof)
        ├── code/                # the TypeScript projection of each valid document (mockup 05, U.1)
        ├── code-invalid/        # workflow files the parser refuses, and expected.json: each one's errors (U.2)
        ├── code-symbols/        # the code editor's symbol table as served: completions and hover docs (W.1)
        └── code-intelligence/   # every seed's span map, diagnostics, Loop Checks rows and completion contexts (W.3)
```

`v1.json` describes the whole **1.x line**. Adding an optional field appends a minor to its
`dsl_version` enum in the same file; a change that would refuse a document this one accepts is a
`v2.json` beside it, and both stay committed for as long as a stored version needs them.

## Who reads this, and what proves they agree

| Reader | What it does | What holds it here |
|---|---|---|
| [`ouroboros-rest/src/modules/workflows/`](../ouroboros-rest/src/modules/workflows) | zod validator + YAML projection — save, publish, code view | `dsl.parity.spec.ts` (the recorded verdicts) and `dsl.conformance.spec.ts` (ajv over `v1.json`) |
| [`ouroboros-engine/src/ouroboros_engine/workflows/`](../ouroboros-engine/src/ouroboros_engine/workflows) | pydantic validator — R.2's `validate` and dry-run | `tests/test_workflows_parity.py` and `tests/test_workflows_conformance.py` |
| [`ouroboros-rest/src/modules/workflows/catalog.*`](../ouroboros-rest/src/modules/workflows) | the stage catalog (R.3) — serves each node type's config schema out of `v1.json` itself, at runtime | `catalog.schema.spec.ts` (served schemas classify every fixture's configs as `v1.json`'s definitions do) |
| [`ouroboros-rest/src/modules/workflows/code.*`](../ouroboros-rest/src/modules/workflows) | the code-view printer (U.1) and parser (U.2) — each valid document as mockup 05's TypeScript DSL, and back | `code.printer.spec.ts` (every print is exactly `fixtures/code/<name>.loop.ts`, parses, and gives back the document's graph), `code.parser.spec.ts` (every `code/` file parses back to its `valid/` document) and `code.parser.errors.spec.ts` (every `code-invalid/` file reports exactly the codes and ranges `code-invalid/expected.json` records) |
| [`ouroboros-rest/src/modules/workflows/code.symbols*`](../ouroboros-rest/src/modules/workflows) | the code editor's symbol table (W.1) — each word's type, enum values and doc, read from `v1.json` itself at boot | `code.symbols.spec.ts` (every doc is a `v1.json` description verbatim, and the served table is exactly `fixtures/code-symbols/table.json`) |
| [`ouroboros-rest/src/modules/workflows/code.intelligence.*`](../ouroboros-rest/src/modules/workflows) | the code view's editor intelligence under test (W.3) — span maps, merged diagnostics, Loop Checks rows and completion contexts for every seeded workflow | `code.intelligence.spec.ts` and `code.intelligence.integration-spec.ts` (every seed's answer, computed and served, is exactly `fixtures/code-intelligence/*.json`, which `OURO_UPDATE_GOLDENS=1` regenerates) |
| [`ouroboros-ui/app/workflows/code/`](../ouroboros-ui/app/workflows/code) | completions and hover docs in the code editor (W.1) | `__tests__/workflows/code/` (completion and hover fixtures over `code-symbols/table.json` and `code/standard-fix.loop.ts`) |
| [`docs/WORKFLOW_DSL.md`](../docs/WORKFLOW_DSL.md) | the specification a person reads | Worked examples taken from these fixtures |
| [`docs/WORKFLOW_CODE_DSL.md`](../docs/WORKFLOW_CODE_DSL.md) | the code-view language a person reads | Worked examples taken from `fixtures/code/` |
| [`ouroboros-db/scripts/workflow-dsl-drift.mjs`](../ouroboros-db/scripts/workflow-dsl-drift.mjs) | `ci/db`'s drift check (P.6) — every seeded workflow definition, as stored, validated against `v1.json` with ajv | `ouroboros-db/tests/workflow-dsl-drift.test.sh` (green over the valid fixtures, red over an invalid one and over a tightened copy of the schema) |
| [`ouroboros-engine/src/ouroboros_engine/planning/`](../ouroboros-engine/src/ouroboros_engine/planning) | `POST /v0/plan` (AL.1) — the outline parser, which is the contract's first implementation | `tests/test_planning_golden.py` (every recorded case's batch verbatim, every response valid against `plan/v0.json`, and the schema and the pydantic models agreeing field for field) |
| [`ouroboros-runner/internal/conn/`](../ouroboros-runner/internal/conn) | the Go agent's protocol codec and validator (AG.1) — the runner contract's first implementation | `protocol_test.go` (every case's diagnostics, code and path, in the contract's order; every transcript replayed; every message type and every code covered), `frame_test.go` (the encoder reproduces a committed frame byte for byte) and `limits_test.go` (the Go constants are the schema's published limits, and the two over-limit cases built from them) |
| [`docs/RUNNER_PROTOCOL.md`](../docs/RUNNER_PROTOCOL.md) | the runner wire contract a person reads | [`scripts/verify-runner-protocol.sh`](../scripts/verify-runner-protocol.sh) — every message type has a section, a fixture and a case; every example in the document is the committed fixture; every fixture is asserted against; the limits agree |

`plan/v0.json` is here for a reason the workflow DSL's `$id` neighbour is not: **it is one
contract with two implementations rather than two readers of one document.** AL.1's outline
parser answers it today and AN.1 ([#289](https://github.com/NobuData/ouroboros/issues/289))
answers the same shape with a real planner once the invocation gateway
([#235](https://github.com/NobuData/ouroboros/issues/235)) exists — so the file is what makes
*the response shape is identical* a checkable claim rather than an intention. What AN.1
inherits is the **shape**, not the recorded values: a planner that decomposes a narrative
properly will answer the `narrative-only` case with several drafts, which is the whole point
of it, so each case records its own `planner` provenance too.
`ouroboros-rest` becomes its third reader with AL.4
([#280](https://github.com/NobuData/ouroboros/issues/280)), which persists what comes back.

**Neither module imports the other, and no third process compares two outputs.** Each reads
this directory from its own suite and asserts against the same `expected.json`. A rule added to
one validator and forgotten in the other is a red check in the half that forgot it — which is
the whole reason the fixtures live above both modules rather than inside either.

Both `ci/rest` and `ci/engine` watch `workflow-dsl/**` and `plan/**`
([`scripts/verify-ci.sh`](../scripts/verify-ci.sh) asserts it), so an edit to either runs both
halves on the pull request that makes it. `ci/db` watches `workflow-dsl/v1.json` too, and only
that file: its drift check validates the seeded workflow definitions against the schema, so a
schema edit that leaves the seeds behind fails on the pull request that makes it rather than in
the studio later. `ci/runner` watches `runner-protocol/**`.

**Those filters name each contract rather than the directory**, and that changed when
`runner-protocol/` arrived ([#243](https://github.com/NobuData/ouroboros/issues/243)): both
TypeScript and Python workflows used to watch `schemas/**` wholesale, which queued two suites
for a contract neither module reads. The consequence is the rule below — **a contract here
reaches no workflow until its readers name it** — and it is the right consequence, because a
contract with an undeclared reader is the exact failure this directory exists to prevent.

## Changing a contract here

0. Add the contract's readers to their workflows' path filters, if it is a new contract. A
   contract nothing watches is one whose implementations can drift with every check green.
1. Edit `v1.json` **and** both validators, in one change.
2. Add or edit the fixture that demonstrates the rule, and its case in `expected.json`.
   A new **node type** also wants a presentation in
   `ouroboros-rest/src/modules/workflows/catalog.presentation.ts`: until it has one, the stage
   catalog serves it with a neutral glyph and `catalog.presentation.spec.ts` is red.
3. Run both suites. `expected.json` is reviewed and frozen, not regenerated: a change to it is a
   change to the contract, and both halves have to be green on the new one.

The fixture set is checked for completeness in both directions — every document on disk has a
case, and every code a validator can emit has a case behind it — so a rule added without a
fixture fails before it can quietly go unasserted.

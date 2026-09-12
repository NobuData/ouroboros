# The workflow definition language

> **Issue:** [#133](https://github.com/NobuData/ouroboros/issues/133) — *[P.2] Workflow DSL
> JSON Schema & shared validation* · **Roadmap:**
> [`ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md`](ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md), decisions
> **P3**, **P7**, **P8** and **P9** · **Schema:**
> [`schemas/workflow-dsl/v1.json`](../schemas/workflow-dsl/v1.json)
> (`$id: https://ouroboros.build/schemas/workflow-dsl/v1.json`) · **Written:** 2026-09-12

A workflow is one JSON document. The canvas draws it, the inspector edits one node of it, the
code view renders it, the validator judges it, the dry-run simulator walks it, and the
interpreter will eventually execute it — and **all six read the same artifact**. That sentence is
decision **P3**, and this document plus the schema beside it are what make it enforceable rather
than aspirational.

The document is stored in `workflow_versions.definition` (V029). A published version is
immutable; a run pins the version it executed. So the DSL is the most durable contract this
product defines: a field added carelessly today is a field every stored version carries forever.

**Two validators, one schema.** `ouroboros-rest` validates with zod, so a save or a publish can
be refused at the boundary; `ouroboros-engine` validates with pydantic, so `/v0/workflows/validate`
and the dry-run simulator can answer about the same document without trusting that somebody else
checked it. [§9](#9-two-validators-one-schema) is how the two are held to one answer.

---

## Contents

1. [The document at a glance](#1-the-document-at-a-glance)
2. [The root](#2-the-root)
3. [The trigger](#3-the-trigger)
4. [Nodes](#4-nodes)
5. [Predicates](#5-predicates)
6. [Edges](#6-edges)
7. [The structural rules](#7-the-structural-rules)
8. [Diagnostics](#8-diagnostics)
9. [Two validators, one schema](#9-two-validators-one-schema)
10. [The YAML projection](#10-the-yaml-projection)
11. [Versioning](#11-versioning)
12. [Known limits](#12-known-limits)

---

## 1. The document at a glance

The mockup's `standard-fix` loop — trigger, five model stages, two infra stages, a decision, a
gate, two terminals, and the ouroboros edge that takes a failed gate back to *implement*. The
whole document is [`fixtures/valid/standard-fix.json`](../schemas/workflow-dsl/fixtures/valid/standard-fix.json);
this is its shape with the bodies elided.

```json
{
  "dsl_version": "1.0",
  "trigger": { "event": "ticket_queued", "conditions": { "effort_lte": "m" } },
  "nodes": [
    { "id": "issue-queued", "type": "trigger", "title": "Issue queued",
      "position": { "x": 24, "y": 40 }, "config": {} },
    { "id": "implement", "type": "llm", "title": "Code the change",
      "position": { "x": 588, "y": 420 },
      "config": {
        "mode": "skill",
        "skill": "zephyr-conventions",
        "prompt_template": "Implement the approved plan.\n…",
        "routing": { "inherit_task": "implement" },
        "limits": { "max_retries": 2, "token_budget": 400000 },
        "permissions": { "push_fixup": true, "touch_ci": false }
      } },
    { "id": "checks-green", "type": "flow", "title": "Checks green?",
      "position": { "x": 306, "y": 630 },
      "config": {
        "kind": "gate",
        "predicate": { "kind": "checks", "op": "all_passed",
                       "names": ["build", "test", "review"] }
      } },
    { "id": "open-pr", "type": "term", "title": "Open PR & auto-merge",
      "position": { "x": 588, "y": 630 },
      "config": { "action": "open_pr_automerge",
                  "options": { "merge_method": "squash", "delete_branch": true } } }
  ],
  "edges": [
    { "from": "review", "to": "checks-green", "kind": "default" },
    { "from": "checks-green", "to": "open-pr", "kind": "branch", "label": "pass →",
      "condition": { "kind": "checks", "op": "all_passed" } },
    { "from": "checks-green", "to": "implement", "kind": "loop", "label": "fail ↺",
      "condition": { "kind": "checks", "op": "any_failed" } }
  ]
}
```

Everything the mockup draws is in there and nothing else is: the five node treatments, the four
edge labels, the inspector's exact field set, and the dashed loop edge.

---

## 2. The root

```
{ dsl_version, trigger, nodes[], edges[] }
```

| Field | Type | Required | Notes |
|---|---|:---:|---|
| `dsl_version` | `"1.0"` | yes | Which minor of the 1.x line. See [§11](#11-versioning). |
| `trigger` | object | yes | What starts a run. [§3](#3-the-trigger). |
| `nodes` | array, 1–200 | yes | Every stage. The array order is not the graph. |
| `edges` | array, 0–400 | yes | Every connection. [§6](#6-edges). |

**Every object in the DSL is closed.** An undeclared property is reported by name, never
dropped: a workflow that silently lost a field an author wrote would be a workflow whose stored
document and whose rendered canvas disagree.

**The graph is the edges, not the array order.** Nodes may be listed in any order; reachability,
loops and terminals are all computed from `edges`. What the array order *does* fix is the order
diagnostics come back in, which is why it is stable.

---

## 3. The trigger

Decision **P8**: structured, never free code — evaluable by the trigger service today and by the
interpreter later, and still readable in a text view.

```json
{ "event": "ticket_queued", "conditions": { "effort_lte": "m" } }
```

| Field | Values | Notes |
|---|---|---|
| `event` | `ticket_queued` | The only event there is. A second one is a schema minor. |
| `conditions.effort_lte` | `xs` `s` `m` `l` `xl` | The mockup's `effort ≤ M` chip. |
| `conditions.labels` | 1–32 labels | The ticket must carry **all** of them. |
| `conditions.source` | `github` `gitlab` `jira` `linear` | `ticket_sources.kind` (V030). |

All present conditions are ANDed. **An empty `conditions` object is legal** and means *every
occurrence of the event* — a thing an author may genuinely mean, and better said by an empty
object than by three fields set to wildcards.

**The trigger lives at the root, not in the trigger node.** The node has an id, a title and a
position, and its `config` is closed and empty. One home for the predicate; the canvas renders
the root's condition as the node's chip.

---

## 4. Nodes

Every node, whatever its type:

| Field | Type | Required | Notes |
|---|---|:---:|---|
| `id` | slug, ≤ 64 | yes | `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`. Unique in the document. Edges quote it and a run journal records it, so it is a slug rather than a generated id. |
| `type` | `trigger` `llm` `infra` `flow` `term` | yes | Picks the canvas treatment and the config schema. |
| `title` | string, 1–80 | yes | What the canvas prints. |
| `description` | string, ≤ 400 | no | The sentence under the title in the inspector. |
| `position` | `{x, y}`, ±100 000 | yes | Carried in the document because the canvas *is* the authored artifact: a re-layout is an edit, and two people opening one workflow must see one picture. Fractional, because dragging produces fractions. |
| `config` | object | yes | Per type, below. |

### 4.1 `trigger`

```json
{ "config": {} }
```

Closed and empty. Its predicate is the document's own `trigger` ([§3](#3-the-trigger)); a field
here would be a second place to look for the same thing.

### 4.2 `llm` — the inspector's exact field set

```json
{
  "mode": "skill",
  "skill": "zephyr-conventions",
  "prompt_template": "Implement the approved plan.\nIssue: {{issue.title}}\nPlan: {{plan}}",
  "routing": { "inherit_task": "implement" },
  "limits": { "max_retries": 2, "token_budget": 400000 },
  "permissions": { "push_fixup": true, "touch_ci": false }
}
```

| Field | Type | Required | Notes |
|---|---|:---:|---|
| `mode` | `prompt` \| `skill` | yes | The inspector's *Direct prompt / Skill* segment. |
| `skill` | reference, ≤ 128 | iff `mode: "skill"` | Loaded into context **before** the prompt. Present in `prompt` mode is an error, not a no-op. |
| `prompt_template` | string, 1–20 000 | yes | Required in both modes — the skill precedes the prompt, it does not replace it. `{{…}}` placeholders resolve from the run context. |
| `routing` | exactly one of `inherit_task` / `pinned_model` | yes | The inspector's two radios. Neither and both are two different mistakes, and each has its own code. |
| `limits.max_retries` | integer 0–10 | yes | |
| `limits.token_budget` | integer 1 000–10 000 000 | yes | A number of tokens. The inspector renders 400000 as `400k`; the formatting is the UI's and never the document's. |
| `permissions.push_fixup` | boolean | yes | Decision **P9**. |
| `permissions.touch_ci` | boolean | yes | Decision **P9**. |

**Both permissions are required and neither defaults.** A permission nobody decided is a
permission nobody can be held to. Storing the intent now keeps published versions
forward-compatible with enforcement, which lands with the interpreter (T.6) — and until it does,
the inspector must not imply an enforcement that does not exist.

`skill`, `inherit_task` and `pinned_model` are **validated strings, not foreign keys** — decision
**P7**, and [§8.2](#82-warnings) is what happens when one names something unknown.

### 4.3 `infra`

```json
{ "runner_pool": "pool-a", "command": "twister -p native_sim" }
```

Both optional. A stage with neither runs the repository's default command on the default pool,
and which pool that is belongs to a deployment rather than to a document a workspace publishes
once and runs everywhere.

### 4.4 `flow`

```json
{ "kind": "gate", "predicate": { "kind": "checks", "op": "all_passed" } }
```

`decision` diverges; `gate` holds. **The difference is topological — it is what the edges say —**
so neither restricts which predicate kinds it accepts. What the two words buy is the canvas
treatment and the code view, which is an honest thing for them to buy.

### 4.5 `term`

```json
{ "action": "open_pr_automerge",
  "options": { "merge_method": "squash", "delete_branch": true } }
```

| `action` | `options` |
|---|---|
| `open_pr_automerge` | `{ merge_method: "squash" \| "merge" \| "rebase", delete_branch: boolean }` — both required; the mockup's chip prints both |
| `back_to_queue` | `{}` — closed and empty |
| `needs_review` | `{}` — closed and empty |

`options` is required for every action and closed for every action, so adding one is an edit to
the published schema rather than a field that quietly appears in stored documents.

---

## 5. Predicates

One grammar, used by a flow node's `predicate` and by a branch or loop edge's `condition`, so
the dry-run simulator needs one evaluator.

| `kind` | Shape |
|---|---|
| `always` | `{ "kind": "always" }` |
| `effort` | `{ "kind": "effort", "op": "lt"\|"lte"\|"eq"\|"gte"\|"gt", "value": "xs".."xl" }` |
| `labels` | `{ "kind": "labels", "op": "any"\|"all"\|"none", "values": [label, …] }` |
| `source` | `{ "kind": "source", "op": "in"\|"not_in", "values": [source, …] }` |
| `checks` | `{ "kind": "checks", "op": "all_passed"\|"any_failed", "names"?: [check, …] }` |

Each kind is closed to its own members: `{"kind": "always", "value": "m"}` is an error, not a
value that is ignored.

**Flat by design — there is no `all`/`any` composition.** Recursion would have to be written
three times (schema, zod, pydantic) and kept anchoring-identical in all three, and the canvas
draws branches rather than boolean trees. A workflow that needs *A and B* draws two forks, which
is also what a reader of the canvas sees.

For a `checks` predicate, **an absent `names` means every check the run produced**. The mockup's
`required checks: 14` chip is a count of what a repository declares, not a list this document
pins — a workflow that hard-coded fourteen names would be wrong the first time a repository
added one.

---

## 6. Edges

```json
{ "from": "checks-green", "to": "implement", "kind": "loop", "label": "fail ↺",
  "condition": { "kind": "checks", "op": "any_failed" } }
```

| Field | Type | Required | Notes |
|---|---|:---:|---|
| `from`, `to` | node ids | yes | Must name nodes in this document. |
| `kind` | `default` \| `branch` \| `loop` | yes | Below. |
| `label` | string, 1–40 | no | The mockup's `≤ M ↓`, `> M ↘`, `pass →`, `fail ↺`. Presentation; never evaluated. |
| `condition` | predicate | per kind | Below. |

| `kind` | Condition | What it draws |
|---|---|---|
| `default` | **must not** carry one | the plain path; always taken |
| `branch` | **must** carry one | one outcome of a fork |
| `loop` | **may** carry one | the ouroboros edge — dashed, and back up the graph |

**An edge has no id: its ordered pair is its identity**, and at most one edge may join a given
pair. `a → b` and `b → a` are two different edges, not a duplicate.

---

## 7. The structural rules

JSON Schema describes *values*. It can say a node has an id and that the id is a slug; it cannot
say that two nodes may not share one, or that a loop edge has to point back up the graph. Those
are properties of the graph, so they are validators that run **after** the schema, on both sides,
and the published schema deliberately does not half-express them.

| Rule | Code | Anchored at |
|---|---|---|
| Exactly one trigger node | `document.no_trigger` / `document.multiple_triggers` | `/nodes` / the extra trigger |
| At least one terminal node | `document.no_terminal` | `/nodes` |
| Node ids are unique | `node.duplicate_id` | the repeat's own `id` |
| Every node is reachable from the trigger | `node.unreachable` | the node |
| Both endpoints name a node | `edge.unknown_from` / `edge.unknown_to` | the endpoint |
| At most one edge per ordered pair | `edge.duplicate` | the second edge |
| No edge joins a node to itself | `edge.self_reference` | the edge |
| Nothing arrives at the trigger | `edge.into_trigger` | the edge |
| Nothing leaves a terminal | `edge.out_of_terminal` | the edge |
| A `branch` edge carries a condition | `edge.branch_without_condition` | the absent condition |
| A `default` edge carries none | `edge.unexpected_condition` | the condition |
| A `loop` edge targets an upstream node | `edge.loop_not_upstream` | the edge |

Three things about *when* these run, because they are as much the contract as the rules are:

* **Only over a document the schema stage accepted.** A half-parsed graph is a graph whose edges
  may have no endpoints and whose nodes may have no types, and every answer computed over one
  would be about the validator's guesses rather than the author's document.
* **Reachability is asked only when there is exactly one trigger.** With none there is nowhere to
  start; with two, a walk from either reports the other's subgraph as unreachable, which is an
  artefact of the choice of start rather than a fact about the document.
* **An edge whose endpoints do not resolve gets no further endpoint diagnostics.** It is already
  reported, and a second diagnostic derived from a name that means nothing would crowd the first
  out of the inspector.

*Upstream*, precisely: a loop edge `A → B` is legal when `B` can reach `A` by following edges
forward **without using that loop edge**. In `standard-fix`, `checks-green → implement` is legal
because `implement → build → test → review → checks-green`.

---

## 8. Diagnostics

Every diagnostic is anchored. There is no bare *invalid document*.

```json
{
  "code": "config.routing_ambiguous",
  "path": "/nodes/6/config/routing",
  "node": "implement",
  "message": "Routing inherits a task's route or pins a model, never both — …"
}
```

| Field | Notes |
|---|---|
| `code` | Which rule broke. The tables in [§7](#7-the-structural-rules) and [§8.1](#81-errors). |
| `path` | An RFC 6901 JSON Pointer to the offending value. `""` is the document itself. |
| `node` | The node id, when the diagnostic anchors to one — so the canvas selects the stage rather than showing a banner. Carried even when the id is the thing that is wrong, because that is the id the canvas keyed the node by. |
| `edge` | `{from, to}`, when it anchors to an edge. |
| `message` | A sentence for a person. **Presentation, not contract** — see [§9](#9-two-validators-one-schema). |

Diagnostics come back in **document order**: by `path`, with numeric path segments compared as
numbers (`/nodes/2` before `/nodes/10`) and a parent before its children, then by `code` for two
diagnostics at one value. A total order, because two validators that agreed on a set but not a
sequence would still be two validators a client could tell apart.

Errors and warnings are **separate lists**, not one list with a severity field: a caller who has
to filter by severity to learn that an unknown skill does not block a save is a caller who will
forget to.

### 8.1 Errors

Beyond the structural codes in [§7](#7-the-structural-rules):

| Code | Meaning |
|---|---|
| `document.malformed` | The document is not a JSON object at all. |
| `document.dsl_version_unsupported` | Written in a language this build does not implement. |
| `schema.required` | A property the schema requires is absent. |
| `schema.type` | A value is of the wrong JSON type. |
| `schema.enum` | A value is outside a closed vocabulary. |
| `schema.range` | A number is outside its bounds. |
| `schema.length` | A string or array is shorter or longer than allowed. |
| `schema.pattern` | A string does not match its pattern. |
| `schema.unknown_property` | A property the schema does not declare. |
| `config.skill_required` | `mode: "skill"` with no skill to load. |
| `config.skill_not_allowed` | A skill in `prompt` mode, which would never be loaded. |
| `config.routing_missing` | Routing names neither a task nor a model. |
| `config.routing_ambiguous` | Routing names both. |

A document written in an unsupported `dsl_version` is reported and **nothing else is**: the rules
this build would report against are not the rules the document was written to.

### 8.2 Warnings

Decision **P7**, in full. The model registry (mockups 06/21) and the skills catalogue (mockup 14)
do not exist. A foreign key to a table nobody has written is not a stricter design; it is a
design that cannot be built, and refusing to save a workflow because it names a skill the
workspace has not defined yet would make the editor unusable during exactly the period the skill
is being defined.

| Code | Fires when |
|---|---|
| `reference.unknown_skill` | `config.skill` is not in the caller's catalogue |
| `reference.unknown_model` | `routing.pinned_model` is not in it |
| `reference.unknown_task` | `routing.inherit_task` is not in it |

**The caller supplies the vocabulary.** Neither validator holds a list of skills or models, so
neither can invent one; a caller that supplies no catalogue gets no warnings of this kind, which
is the honest answer to *is this reference known?* when nothing in the system knows. A catalogue
member left out (`{skills: […]}` with no `models`) means *not checked*, which is different from
an empty list meaning *nothing is known*.

`runner_pool` is deliberately not checked: which pools exist is a property of a deployment's
build farm (mockup 08), not of a workspace's catalogues.

Warnings are reported only for a document that is otherwise valid. Advice about a document
somebody cannot save would bury the reason they cannot.

---

## 9. Two validators, one schema

Two validators that can disagree are worse than one. Three mechanisms hold these two to one
answer, and all three run in CI.

**1. The published schema.** [`schemas/workflow-dsl/v1.json`](../schemas/workflow-dsl/v1.json) is
JSON Schema 2020-12 with an `$id`, and it is the artifact an outside reader is handed. Each
service compiles it in its own suite — ajv in `ouroboros-rest`, `jsonschema` in
`ouroboros-engine` — and asserts that the schema and its own validator classify every golden
document the same way, and that its own diagnostics are anchored where the schema's are. The
comparison is over the **schema stage** alone: a document that is schema-clean and structurally
broken is *expected* to satisfy the schema, because [§7](#7-the-structural-rules)'s rules are
deliberately outside it.

**2. The golden fixture set.**
[`fixtures/expected.json`](../schemas/workflow-dsl/fixtures/expected.json) holds one case per
rule and the verdict both validators must produce for it. Each side asserts against that file
from its own suite; neither module imports the other and no third process compares two outputs,
so a rule added to one and forgotten in the other is a red check in the half that forgot it. The
set is checked for completeness in both directions — every fixture on disk has a case, and every
code a validator can emit has a case behind it.

**What the verdict is, exactly:** `valid`, plus the ordered list of `(code, path, node, edge)`.
The `message` is **not** part of it. Each validator writes its own prose in its own idiom, and a
contract over English sentences is a contract nobody can translate; what each suite does assert
is that every diagnostic it produces carries one.

**3. The two implementations are written to mirror each other**, file for file —
`dsl.errors.ts`/`errors.py`, `dsl.schema.ts`/`dsl.py`, `dsl.issues.ts`/`issues.py`,
`dsl.structure.ts`/`structure.py`, `dsl.references.ts`/`references.py`,
`dsl.validator.ts`/`validate.py` — so they can be read side by side. That is the defence a test
suite cannot provide.

### The stages, in order

Both validators run the same four stages in the same order, and the order is part of the contract
because it decides *which* diagnostics a broken document gets:

1. **The document is an object**, and `dsl_version` is a language this build implements. Both
   short-circuit.
2. **The schema stage** — the frame, then each node and each edge, then each node's
   type-dependent config and each edge's condition. The pieces are applied separately, so a
   mistake in one node does not hide a different one in the next: a canvas that reports one
   error, is corrected, and then reports another is a canvas an author stops trusting.
3. **The structural stage**, only over a document stage 2 accepted.
4. **The reference stage**, only over a document stage 3 accepted.

### Why the discriminated dispatch is hand-written

zod and pydantic can both express *the shape of `config` depends on `type`* — `discriminatedUnion`
and a tagged `Union`. They anchor the resulting errors at different places: zod reports an unknown
discriminator at the discriminator, pydantic at the object, with the matched tag prepended to
every path underneath it. Since the anchor is half of what the two validators have to agree on,
both sides validate the skeleton first and dispatch on the tag by hand. The cost is a dozen lines
each; the alternative is a contract whose anchoring depends on which library read the document.

---

## 10. The YAML projection

Mockup 05's code view is a **view**. `ouroboros-rest` renders a document as YAML and parses it
back, and the suite asserts that every golden document survives the round trip value for value —
so editing in the text view cannot lose something the canvas held. The rendered form of each valid
fixture is committed under
[`fixtures/yaml/`](../schemas/workflow-dsl/fixtures/yaml), which makes a change that silently
reformats the code view a diff a reviewer sees.

```yaml
dsl_version: "1.0"
trigger:
  event: ticket_queued
  conditions:
    effort_lte: m
nodes:
  - id: implement
    type: llm
    title: Code the change
    position:
      x: 588
      y: 420
    config:
      mode: skill
      skill: zephyr-conventions
      prompt_template: |-
        Implement the approved plan.

        Issue: {{issue.title}}
        Plan:  {{plan}}
      routing:
        inherit_task: implement
      limits:
        max_retries: 2
        token_budget: 400000
      permissions:
        push_fixup: true
        touch_ci: false
edges:
  - from: checks-green
    to: implement
    kind: loop
    label: fail ↺
    condition:
      kind: checks
      op: any_failed
```

Keys are emitted in the document's own reading order rather than whatever order the object
happened to carry, so two workflows that differ only in property order render identically and a
diff of the code view is a diff of the workflow. Losslessness is about *values*; JSON object key
order is not one. Prompt templates stay literal blocks rather than quoted strings full of `\n`,
because a reader comparing the code view with the inspector's prompt box has to see the same
text in both.

The projection renders the **document**, never the verdict: a code view that showed diagnostics
inline would be a second renderer of the diagnostic shape to keep in step with the inspector's.

---

## 11. Versioning

`v1.json` describes the whole **1.x line**, and `dsl_version` is an enum of the minors it knows —
today, exactly `"1.0"`.

* **Adding an optional field** appends a minor to that enum, in the same file. Documents written
  to an earlier minor keep validating.
* **A change that would refuse a document `v1.json` accepts** is `v2.json` beside it. Both stay
  committed for as long as a stored version needs them, because a published version is immutable
  and a run pins the version it executed.
* **The `$id` is the contract's identity.** Changing it is a new file, never an edit to this one.

A document naming a version this build does not implement is reported as
`document.dsl_version_unsupported` and nothing else — a build that reported *its* rules against a
language it does not speak would be reporting fiction.

---

## 12. Known limits

Stated rather than discovered.

* **String bounds are counted in the host language's units.** `title`'s 80 is UTF-16 code units
  in `ouroboros-rest` and code points in `ouroboros-engine`, so a title of exactly 80 characters
  containing astral-plane characters (emoji, some CJK extensions) could be accepted by one and
  refused by the other. Real titles are nowhere near the bound; if that stops being true, the
  bound moves into a shared normalisation rather than being counted twice.
* **The structural rules are not in the published schema**, by design ([§7](#7-the-structural-rules)).
  A third-party tool that validates against `v1.json` alone gets the value rules and not the
  graph rules. This document is the rest of the contract, and the fixture set is its executable
  form.
* **`permissions` is a stored declaration, not an enforcement.** Decision **P9**: enforcement
  lands with the interpreter (T.6). Until it does, nothing may present these toggles as though
  they restrain anything.
* **Predicates do not compose** ([§5](#5-predicates)). A workflow needing *A and B* draws two
  forks.

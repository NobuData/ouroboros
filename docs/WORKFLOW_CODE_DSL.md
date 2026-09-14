# The workflow code language

> **Issues:** [#165](https://github.com/NobuData/ouroboros/issues/165) — *[U.1] TS-DSL grammar spec
> & deterministic printer* and [#166](https://github.com/NobuData/ouroboros/issues/166) — *[U.2]
> TS-DSL parser* · **Roadmap:**
> [`ROADMAP_MOCKUP_05_WORKFLOW_CODE.md`](ROADMAP_MOCKUP_05_WORKFLOW_CODE.md), decisions **C2**
> and **C4** · **Builds on:** [`WORKFLOW_DSL.md`](WORKFLOW_DSL.md) (#133) · **Design:**
> [`mockups/05-workflow-code.html`](mockups/05-workflow-code.html) · **Implementation:**
> [`ouroboros-rest/src/modules/workflows/code.*`](../ouroboros-rest/src/modules/workflows) ·
> **Golden files:** [`schemas/workflow-dsl/fixtures/code/`](../schemas/workflow-dsl/fixtures/code)
> and [`code-invalid/`](../schemas/workflow-dsl/fixtures/code-invalid) · **Written:** 2026-09-13

Mockup 05 shows a workflow as TypeScript: `defineLoop("standard-fix", { trigger, stages })`. This
document is that language. It is **closed**: it says exactly which TypeScript a workflow file may
contain, and how every construct of the canonical JSON document ([`WORKFLOW_DSL.md`](WORKFLOW_DSL.md))
is written in it. Anything else is out of grammar.

It is a **view**, not a second authoring format. The canonical JSON document stays the one
artifact every consumer reads (decision **P3**); a `.loop.ts` file is that document rendered, and
the parser (#166) turns an edited file back into it. Nothing in this language is ever
evaluated — decision **C2** — so the arrow functions below are *spellings* of structured data,
read as syntax, and there is no sandbox because there is nothing to run.

Three later pieces inherit this grammar: the parser (#166), the editor's completions (#177) and
the diagnostics span map (#178). The vocabulary they share lives in one file,
[`code.grammar.ts`](../ouroboros-rest/src/modules/workflows/code.grammar.ts), as tables.

---

## Contents

1. [A file at a glance](#1-a-file-at-a-glance)
2. [What the grammar promises](#2-what-the-grammar-promises)
3. [The file](#3-the-file)
4. [The trigger](#4-the-trigger)
5. [Stages](#5-stages)
6. [Predicates](#6-predicates)
7. [Edges](#7-edges)
8. [The layout block](#8-the-layout-block)
9. [Formatting](#9-formatting)
10. [Against mockup 05](#10-against-mockup-05)
11. [What builds on this](#11-what-builds-on-this)
12. [Known limits](#12-known-limits)
13. [Reading a file back](#13-reading-a-file-back)

---

## 1. A file at a glance

The seeded `standard-fix`, abridged. The whole file is
[`fixtures/code/standard-fix.loop.ts`](../schemas/workflow-dsl/fixtures/code/standard-fix.loop.ts),
printed from [`fixtures/valid/standard-fix.json`](../schemas/workflow-dsl/fixtures/valid/standard-fix.json).

```ts
import { defineLoop, effort, route, trigger, llm, infra, decision, gate, openPr, backToQueue } from "@ouroboros/sdk";

export default defineLoop("standard-fix", {
  dsl: "1.0",
  trigger: {
    on: "issue.queued",
    when: (i) => i.effort.lte(effort.M),
  },
  stages: [
    trigger("issue-queued", {
      title: "Issue queued",
      description: "Runs when a sized issue with effort at most M reaches the queue.",
      next: "analyze",
    }),
    …
    llm("implement", {
      title: "Code the change",
      description: "Writes the change described by the attack plan onto a fresh branch.",
      skill: "zephyr-conventions",
      model: route.task("implement"),
      retries: 2,
      tokenBudget: 400_000,
      permissions: { pushFixup: true, touchCi: false },
      prompt: `Implement the approved plan.

Issue: {{issue.title}}
Plan:  {{plan}}
Rules: touch only files named in the plan; follow the skill.`,
      next: "build",
    }),
    …
    gate("checks-green", {
      title: "Checks green?",
      description: "Holds until build, test and review all pass; a failure returns to implement.",
      require: ["build", "test", "review"],
      branches: [
        { to: "open-pr", when: (i) => i.checks.allPassed() },
      ],
      onFail: "implement",
    }), // the loop bites its tail
    openPr("open-pr", {
      title: "Open PR & auto-merge",
      description: "Opens the pull request and lets it merge itself once the required checks are green.",
      merge: "squash",
      deleteBranch: true,
    }),
  ],
});

// Round-trips with the visual canvas: every node on the graph is one
// stage call above, and `onFail` is the declared back-edge that
// closes the loop. Publishing writes the next version for both editors.

// @ouroboros/layout v1 — generated; the canvas owns these lines
// node issue-queued 24 40
// …
// edge effort-recheck plan "≤ M ↓"
// …
// edge checks-green implement "fail ↺"
```

**One stage call per node, in the document's node order.** What the workflow *does* is in the
calls; where the canvas *draws* it is in the layout block at the foot.

---

## 2. What the grammar promises

**A bijection over valid documents.** Every document has exactly one spelling, and every
canonical spelling names exactly one document. Where two spellings would be possible — a list
with one member or a bare string, a `when` or a `require` — the rules below pick one, and the
parser reads only that one as canonical. So `parse(print(doc))` is `doc` (#168 property-tests it),
and `print(parse(code))` is `code` whenever `code` is canonical.

**Determinism.** The printed text depends on the workflow's slug and on the document's *values*,
and on nothing else. The same document prints the same bytes every time. That includes the same
document with its object keys in a different order: JSON key order is not a value
([`WORKFLOW_DSL.md` §10](WORKFLOW_DSL.md#10-the-yaml-projection)), so it can't change the
output.

**Losslessness.** Every value in the document has exactly one place in the file: the node ids,
titles, descriptions and configs; the trigger; each edge's endpoints, kind, condition and label;
the order of both lists; every position.

**The input is a valid document.** The printer takes what `validateWorkflowDocument` accepts,
as the YAML projection does. A document that breaks an invariant validation guarantees (a model
stage routed by both a task and a model, a branch edge with no condition) has no spelling, and
`printWorkflowCode` refuses it with `WorkflowCodePrintError` rather than printing something it
is not.

**How it is held to all four.** `code.printer.spec.ts` prints every valid golden document and
every seeded workflow, and asks the **TypeScript compiler** about the result: the file must parse
with no syntax error, and the graph the compiler reads back must be the document's. It checks the
positions, and each edge's kind, condition, label and place in the order, as well as the trigger,
the slug, every title, description and prompt, and every flow predicate. Each golden print must
also match the committed `.loop.ts` byte for byte.

---

## 3. The file

A workflow file is exactly these parts, in this order:

```ts
import { … } from "@ouroboros/sdk";          // 1. the header

export default defineLoop("<slug>", {          // 2. the one call
  dsl: "1.0",
  trigger: { … },
  stages: [ … ],
});

// Round-trips with the visual canvas: …      // 3. the round-trip comment

// @ouroboros/layout v1 — …                   // 4. the layout block
```

**The header** is one named import from `"@ouroboros/sdk"`. It imports exactly the names the
file uses, in this fixed order:

```
defineLoop, effort, route, trigger, llm, infra, decision, gate, openPr, backToQueue, needsReview
```

`effort` only when something compares one (`effort.M`), `route` only when there is a model
stage, and each stage callee only when a node is written with it. Any other import, any other
module, and any statement besides the header and the call is out of grammar.

**`defineLoop`** takes the workflow's **slug** and an options object with exactly three keys, in
this order:

| Key | Holds | Notes |
|---|---|---|
| `dsl` | `dsl_version` | `"1.0"`. The language of the *document*, not of this file. |
| `trigger` | the root `trigger` | [§4](#4-the-trigger). |
| `stages` | `nodes`, and through them `edges` | [§5](#5-stages), [§7](#7-edges). |

The slug is not part of the canonical document, because it names the workflow entity rather than
the definition. It is written here because a file has to say which workflow it is. The printer
refuses a slug that `workflows_slug_format` would refuse (`^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64
characters), and #167 checks that it matches the workflow being saved.

**The round-trip comment** is three constant lines, the promise mockup 05 prints under its
listing. It is generated text, not document data: the parser ignores it.

---

## 4. The trigger

```ts
trigger: {
  on: "issue.queued",
  when: (i) => i.effort.lte(effort.M),
},
```

| Key | Holds | Spelling |
|---|---|---|
| `on` | `trigger.event` | `ticket_queued` is written `"issue.queued"`, mockup 05's word. |
| `when` | `trigger.conditions` | Omitted exactly when `conditions` is `{}`. |

`when` is one arrow function whose body joins the present conditions with `&&`, **always in this
order**:

| Condition | Conjunct |
|---|---|
| `effort_lte: "m"` | `i.effort.lte(effort.M)` |
| `labels: ["bug", "p0"]` | `i.labels.all(["bug", "p0"])` |
| `source: "github"` | `i.source.is("github")` |

```ts
// { effort_lte: "l", labels: ["bug", "regression"], source: "github" }
when: (i) => i.effort.lte(effort.L) && i.labels.all(["bug", "regression"]) && i.source.is("github"),
```

The conditions are ANDed in the document, so their order is only presentation. That is why it is
fixed: two orders would be two spellings of one document. An empty `conditions` fires on every
occurrence of the event, and is written by leaving `when` out, never as `() => true`, which would
be a second spelling of the same thing. `is` exists only here, because a trigger's source is a
single value; a predicate's source is a list ([§6](#6-predicates)).

---

## 5. Stages

`stages` is an array of **stage calls**, one per node, in the document's node order:

```ts
<callee>("<node id>", {
  title: "…",
  description: "…",   // only when the node has one
  …                    // the callee's own options
  next: …,             // edges — §7
  branches: [ … ],
  onFail: …,
}),
```

**The callee names the node's type**, and the node id is always the first argument. The callee
is never the id. The set of callees is closed, so no id a workspace picks can collide with the
grammar, and ids stay the exact slugs edges quote.

| Callee | Node |
|---|---|
| `trigger` | `type: "trigger"` |
| `llm` | `type: "llm"` |
| `infra` | `type: "infra"` |
| `decision` | `type: "flow"`, `config.kind: "decision"` |
| `gate` | `type: "flow"`, `config.kind: "gate"` |
| `openPr` | `type: "term"`, `config.action: "open_pr_automerge"` |
| `backToQueue` | `type: "term"`, `config.action: "back_to_queue"` |
| `needsReview` | `type: "term"`, `config.action: "needs_review"` |

**Every stage's options are written in one fixed order**, the callee's row below. The printer
emits them by walking this table, `STAGE_OPTIONS` in `code.grammar.ts`, and the spec asserts
every printed stage follows it.

| Callee | Options, in order |
|---|---|
| `trigger` | `title` `description` · `next` `branches` `onFail` |
| `llm` | `title` `description` · `skill` `model` `retries` `tokenBudget` `permissions` `prompt` · `next` `branches` `onFail` |
| `infra` | `title` `description` · `farm` `cmd` · `next` `branches` `onFail` |
| `decision`, `gate` | `title` `description` · `require` `when` · `next` `branches` `onFail` |
| `openPr` | `title` `description` · `merge` `deleteBranch` |
| `backToQueue`, `needsReview` | `title` `description` |

Terminals take no edge options, because nothing may leave a terminal (`edge.out_of_terminal`).

### 5.1 `trigger`

```ts
trigger("issue-queued", {
  title: "Issue queued",
  description: "Runs when a sized issue with effort at most M reaches the queue.",
  next: "analyze",
}),
```

The node's config is closed and empty; its predicate is the root `trigger`
([§4](#4-the-trigger)). So the call carries only the node's name and its outgoing edges.

### 5.2 `llm`

```ts
llm("analyze", {
  title: "Understand & scope",
  description: "Reads the issue against a map of the repository and states what the change touches.",
  skill: "repo-map",
  model: route.model("claude-sonnet-5"),
  retries: 2,
  tokenBudget: 200_000,
  permissions: { pushFixup: false, touchCi: false },
  prompt: `Scope the issue.

Issue: {{issue.title}}
Body:  {{issue.body}}

Name the files the change will touch and the risks you can see.`,
  next: "effort-recheck",
}),
```

| Option | Holds | Spelling |
|---|---|---|
| `skill` | `config.skill` | A string. **Present exactly when `mode` is `"skill"`**, so `mode` is not written: validation guarantees the two agree in both directions. |
| `model` | `config.routing` | `route.task("<task>")` for `inherit_task`, `route.model("<model>")` for `pinned_model`. |
| `retries` | `limits.max_retries` | An integer. |
| `tokenBudget` | `limits.token_budget` | An integer with `_` separators every three digits: `400_000`, `1_000`, `10_000_000`. |
| `permissions` | `config.permissions` | `{ pushFixup: <bool>, touchCi: <bool> }`, both, always, in that order. |
| `prompt` | `prompt_template` | A template literal ([§9](#9-formatting)). |

A prompt-mode stage simply has no `skill` line:

```ts
llm("plan", {
  title: "Write attack plan",
  description: "Turns the scope into an ordered plan the implement stage is held to.",
  model: route.model("claude-fable-5"),
  retries: 2,
  tokenBudget: 200_000,
  permissions: { pushFixup: false, touchCi: false },
  prompt: `Write the attack plan.

Scope: {{analyze}}

Order the steps and name every file each one touches.`,
  next: "implement",
}),
```

### 5.3 `infra`

```ts
infra("test", {
  title: "Run test suite",
  description: "Runs the suite the repository declares for a native build.",
  farm: "pool-a",
  cmd: "twister -p native_sim",
  next: "review",
}),
```

`farm` holds `runner_pool` and `cmd` holds `command`. Both are optional, as they are in the
document. A stage with neither is a title and its edges
([`fixtures/code/infra-bare.loop.ts`](../schemas/workflow-dsl/fixtures/code/infra-bare.loop.ts)).

### 5.4 `decision` and `gate`

```ts
decision("effort-recheck", {
  title: "Effort re-check",
  description: "Re-estimates after scoping; work that grew past M is split rather than attempted.",
  when: (i) => i.effort.lte(effort.M),
  branches: [
    { to: "plan", when: (i) => i.effort.lte(effort.M) },
    { to: "split", when: (i) => i.effort.gt(effort.M) },
  ],
}),
```

The flow node's predicate is written one of two ways, and exactly one applies:

| Predicate | Written |
|---|---|
| `{kind: "checks", op: "all_passed", names: [...]}`, *all of these named checks passed* | `require: ["build", "test", "review"]`, mockup 05's gate |
| anything else | `when: <predicate>` ([§6](#6-predicates)) |

So `checks all_passed` **without** names is `when: (i) => i.checks.allPassed()`, and a `when`
spelling of a named `all_passed` is non-canonical. `decision` and `gate` accept the same
predicates; the difference is topological, as in the DSL.

```ts
gate("checks-green", {
  title: "Checks green?",
  description: "Holds until build, test and review all pass; a failure returns to implement.",
  require: ["build", "test", "review"],
  branches: [
    { to: "open-pr", when: (i) => i.checks.allPassed() },
  ],
  onFail: "implement",
}), // the loop bites its tail
```

### 5.5 `openPr`, `backToQueue`, `needsReview`

```ts
openPr("open-pr", {
  title: "Open PR & auto-merge",
  description: "Opens the pull request and lets it merge itself once the required checks are green.",
  merge: "squash",
  deleteBranch: true,
}),
backToQueue("back-to-queue", {
  title: "Back to queue",
  description: "The split subtasks are queued and this run ends.",
}),
needsReview("done", {
  title: "Needs review",
}),
```

`merge` holds `options.merge_method` (`"squash"`, `"merge"` or `"rebase"`) and `deleteBranch`
holds `options.delete_branch`. The other two actions' options are closed and empty, so their
calls carry only the node's name.

---

## 6. Predicates

One spelling per structured predicate ([`WORKFLOW_DSL.md` §5](WORKFLOW_DSL.md#5-predicates)),
used by a flow node's `when` and by an edge's `when`. Each spelling is an arrow function over the
ticket `i`, and none of them is ever called.

| Predicate | Spelling |
|---|---|
| `{kind: "always"}` | `() => true` |
| `{kind: "effort", op: "lt", value: "xs"}` | `(i) => i.effort.lt(effort.XS)` |
| `{kind: "effort", op: "lte", value: "s"}` | `(i) => i.effort.lte(effort.S)` |
| `{kind: "effort", op: "eq", value: "m"}` | `(i) => i.effort.eq(effort.M)` |
| `{kind: "effort", op: "gte", value: "l"}` | `(i) => i.effort.gte(effort.L)` |
| `{kind: "effort", op: "gt", value: "xl"}` | `(i) => i.effort.gt(effort.XL)` |
| `{kind: "labels", op: "any", values: ["regression"]}` | `(i) => i.labels.any(["regression"])` |
| `{kind: "labels", op: "all", values: ["bug", "p0"]}` | `(i) => i.labels.all(["bug", "p0"])` |
| `{kind: "labels", op: "none", values: ["wontfix"]}` | `(i) => i.labels.none(["wontfix"])` |
| `{kind: "source", op: "in", values: ["github", "gitlab"]}` | `(i) => i.source.in(["github", "gitlab"])` |
| `{kind: "source", op: "not_in", values: ["jira"]}` | `(i) => i.source.notIn(["jira"])` |
| `{kind: "checks", op: "all_passed"}` | `(i) => i.checks.allPassed()` |
| `{kind: "checks", op: "all_passed", names: ["build"]}` | `(i) => i.checks.allPassed(["build"])` |
| `{kind: "checks", op: "any_failed"}` | `(i) => i.checks.anyFailed()` |
| `{kind: "checks", op: "any_failed", names: ["build", "test"]}` | `(i) => i.checks.anyFailed(["build", "test"])` |

* **Effort values are constants**: `effort.XS`, `effort.S`, `effort.M`, `effort.L`, `effort.XL`.
* **Lists are always arrays**, even with one member, so `labels`, `source` and `names` read alike.
* **An absent `names` is an empty argument list**, never `[]`: an empty `names` is not a valid
  document, so `allPassed()` and `allPassed([...])` can't be confused.
* **`in` is a legal property name** in TypeScript, so `i.source.in([...])` parses.

`code.predicates.spec.ts` spells every row, has the compiler read each spelling back into the
structure it came from, and asserts no two structures share a spelling.

---

## 7. Edges

**An edge is written on the stage it leaves**, under one option per edge kind:

| Kind | Option | Canonical form |
|---|---|---|
| `default` | `next` | `next: "id"` for one edge; `next: ["a", "b"]` for several |
| `branch` | `branches` | always a list: `{ to: "id", when: <predicate> }` per edge |
| `loop` | `onFail` | `onFail: "id"` exactly when the stage has **one** loop edge and its condition is `checks any_failed` with no names; otherwise a list of `{ to: "id" }` or `{ to: "id", when: <predicate> }` |

Within each option, edges are in document order.

```ts
next: ["done", "other"],                           // two default edges

branches: [
  { to: "plan", when: (i) => i.effort.lte(effort.M) },
  { to: "split", when: (i) => i.effort.gt(effort.M) },
],

onFail: "implement",                                // the mockup's back-edge

onFail: [
  { to: "a" },                                      // a loop edge with no condition
  { to: "b", when: (i) => i.checks.anyFailed(["build"]) },
],
```

**`onFail: "implement"` is mockup 05's idiom, and it means exactly one thing:** the stage's only
loop edge, taken when any check failed. That is the ouroboros edge of `standard-fix`,
`hotfix-p0` and `feature-loop`. Every other loop edge is spelled out in the list form. A
default edge never carries a condition and a branch edge always does, so neither needs a second
form.

**A stage with any loop edge closes with a trailing comment**, generated, never data:

```ts
}), // the loop bites its tail
```

**What the stage calls do not say** is the order of the document's whole `edges` list, and each
edge's `label`. Grouping edges under their source stage can't keep the list's order on its own:
`standard-fix` lists `split → back-to-queue` before `plan → implement`, although `plan` precedes
`split` among the nodes. Both facts ride in the layout block.

---

## 8. The layout block

```ts
// @ouroboros/layout v1 — generated; the canvas owns these lines
// node issue-queued 24 40
// node analyze 306 40
// …
// edge issue-queued analyze
// edge effort-recheck plan "≤ M ↓"
// edge effort-recheck split "> M ↘"
// …
```

The canvas's presentation, at the foot of the file, one line per fact:

| Line | Holds | Rules |
|---|---|---|
| `// @ouroboros/layout v1 — generated; the canvas owns these lines` | the marker | Exactly this text. The block runs from here to the end of the file. |
| `// node <id> <x> <y>` | one node's `position` | One per node, **in node order**. |
| `// edge <from> <to>` · `// edge <from> <to> "<label>"` | one edge's place in `edges`, and its `label` | One per edge, **in document edge order**. The label, when there is one, is a JSON string. |

**Why these facts, and why a comment.** A position is presentation, and so is a label
([`WORKFLOW_DSL.md` §6](WORKFLOW_DSL.md#6-edges): *"Presentation; never evaluated"*). Both
still have to survive, because the canvas is an authored artifact and two people opening one
workflow must see one picture. Keeping them out of the stage calls keeps the calls about what the
workflow does. Keeping them in the file, rather than in a sidecar, makes a `.loop.ts`
self-contained: #167's `PUT` carries one body, and a file copied out of the editor keeps its
canvas. One line per fact means moving a node on the canvas is a one-line diff.

**Coordinates** are written as `String(n)`, the shortest text `Number()` reads back as the same
double, so a dragged `306.25` survives exactly. The one value that rule loses is negative zero,
which is written `-0`.

**Labels** are JSON strings, so a label stays on its line whatever it contains: quotes, line
breaks, `//`. `readLayout` in `code.layout.ts` reads the block back, and reports each line it
can't read with its line number rather than throwing.

---

## 9. Formatting

Formatting is part of the grammar, because determinism is about bytes.

* **Indentation** is two spaces: `defineLoop`'s keys at 2, stage calls at 4, stage options at 6,
  list entries at 8.
* **Stage calls are always multi-line**, one option per line, each followed by a comma. The
  trigger object is multi-line too.
* **These stay on one line:** `next` lists, `require` lists, `permissions`, and each `branches`
  or `onFail` entry. The `branches` and `onFail` lists themselves open with `[` on the key's line
  and close with `],` on their own.
* **No line is wrapped.** A long description is a long line, as a long prompt is a long line in
  the inspector.
* **Line feeds only**, and the file ends with one. The header, the call, the round-trip comment
  and the layout block are separated by one blank line each.
* **Strings** are double-quoted JSON strings with non-ASCII kept as written (`"≤ M ↓"`), plus
  one addition: U+2028 and U+2029 are escaped. JSON leaves both raw, and the TypeScript scanner
  treats both as line breaks.
* **Prompts** are template literals whose line feeds are real line breaks, so the code view shows
  the text the inspector's prompt box shows. Continuation lines start at column zero, since
  indenting them would change the prompt. Escaped: `\`, `` ` ``, `$` where it would open `${`, the
  carriage return (a template literal would otherwise normalise it away), U+2028 and U+2029, lone
  surrogates, and every other control character except tab. **The only character that breaks a
  line in a printed file is the line feed**, so the span map's line numbers and the compiler's
  agree.
* **Numbers:** `retries` as plain digits, `tokenBudget` with separators ([§5.2](#52-llm)),
  coordinates as [§8](#8-the-layout-block) says.
* **Booleans** are `true` and `false`.

### Why not the compiler's printer

The issue's technical stack names the TypeScript compiler API for the printer, and
`ts.createPrinter` was tried first (TypeScript 5.9.3). It can't produce this format. It indents
with four spaces, rewrites `≤ M ↓` as Unicode escapes, and writes a synthetic trailing comment
*before* the comma that follows it: `}) // the loop bites its tail,`, which is not valid
TypeScript. So `code.printer.ts` is a small string emitter whose rules are the ones above, and the
compiler API is the **checker**: every print in the suite is parsed by `ts.createSourceFile`, and
the graph is read back from that syntax tree.

---

## 10. Against mockup 05

**The seeded `standard-fix` can't print to mockup 05's 32-line listing, and this section records
where and why**, in the spirit of the seed's `12 stages` and `used by 42% of runs` notes. The
listing is drawn from a different, simpler document than the one `schemas/workflow-dsl` froze
(#133) and the development seed writes (#136). It folds the canvas's twelve nodes into nine
calls, names values DSL v1 has no field for, routes stages the seeded document pins to a model,
and leaves out every title, prompt, limit, permission and position. A byte-exact listing would
therefore be a lossy one. Losslessness is the requirement, so the golden file is the real
print, [`fixtures/code/standard-fix.loop.ts`](../schemas/workflow-dsl/fixtures/code/standard-fix.loop.ts),
and every idiom the mockup uses that the document can carry is kept.

| Mockup line | Printed | Why |
|---|---|---|
| 1 `import { defineLoop, effort, route } from "@ouroboros/sdk";` | `import { defineLoop, effort, route, trigger, llm, infra, decision, gate, openPr, backToQueue } from "@ouroboros/sdk";` | Stage callees are SDK names too, and a file imports exactly what it uses. |
| 2 `import { zephyrConventions, repoMap } from "../skills";` | *(no line)*; `skill: "zephyr-conventions"` on the stage | A skill is a validated string (decision **P7**), not a module. There is no skills subsystem to import from (**C6**, X.2), and `repo-map` → `repoMap` can't be reversed in general. |
| 4 `export default defineLoop("standard-fix", {` | identical | |
| *(none)* | `dsl: "1.0",` | `dsl_version` has to survive the trip. |
| 5–8, the trigger | identical, byte for byte | `on: "issue.queued"`, `when: (i) => i.effort.lte(effort.M)` |
| 10 `analyze({ skill: repoMap, model: route.task("analyze") }),` | `llm("analyze", { … skill: "repo-map", model: route.model("claude-sonnet-5"), … })` | The callee is the node type, never the id. The seeded stage **pins** `claude-sonnet-5` rather than inheriting the `analyze` route, and it has a title, description, prompt, limits and permissions the listing leaves out. |
| 11–13 `recheckEffort({ escalate: { over: effort.M, to: "split-subtasks" } })` | `decision("effort-recheck", { … when: (i) => i.effort.lte(effort.M), branches: [plan, split] })`, then `llm("split", …)` and `backToQueue("back-to-queue", …)` | The canvas is a decision, two branch edges, a model stage and a terminal. `escalate` folds all five into an option no DSL construct has, and `split-subtasks` is not a node. |
| 14 `plan({ template: "attack-plan@v3", model: route.task("plan") })` | `llm("plan", { … model: route.model("claude-fable-5"), prompt: \`Write the attack plan.…\` })` | DSL v1 has no prompt-template registry; `prompt_template` is the text itself. The seeded stage pins its model. |
| 15–20, `implement` | `skill`, `model: route.task("implement")`, `retries: 2`, `tokenBudget: 400_000` kept exactly | Plus the title, description, permissions and prompt the document holds. |
| 21 `build({ farm: "pool-a", cache: "ccache" })` | `infra("build", { … farm: "pool-a", next: "test" })` | An infra stage has no cache field. |
| 22 `test({ cmd: "twister -p native_sim", flakes: "retry-once" })` | `infra("test", { … farm: "pool-a", cmd: "twister -p native_sim", … })` | No flake policy exists in DSL v1; the seeded stage also names its pool. |
| 23 `review({ template: "self-review@v2", model: route.task("review") })` | `llm("review", { … model: route.model("claude-fable-5"), prompt: … })` | As `plan`. |
| 24 `gate({ require: ["build", "test", "review"], onFail: "implement" }), // the loop bites its tail` | `gate("checks-green", { … require: ["build", "test", "review"], branches: [{ to: "open-pr", … }], onFail: "implement", }), // the loop bites its tail` | `require`, `onFail` and the comment are kept. The pass edge to `open-pr` is written because the graph is the edges, not the order of the calls ([`WORKFLOW_DSL.md` §2](WORKFLOW_DSL.md#2-the-root)). |
| 25 `openPr({ merge: "auto-squash", deleteBranch: true })` | `openPr("open-pr", { … merge: "squash", deleteBranch: true })` | `merge_method` is `squash`, `merge` or `rebase`. *Auto-* is the action itself (`open_pr_automerge`), so repeating it on the value would add nothing. |
| 26–27 `],` `});` | identical | |
| 29–31, the round-trip comment | first line identical; `` `gate.onFail` `` → `` `onFail` ``; *"Publishing writes v15"* → *"Publishing writes the next version"* | The block is constant, so it holds for a workflow with no gate. The version number is not in the document, and the printer is a function of the document. |
| *(none)* | the layout block | Positions, labels and edge order ([§8](#8-the-layout-block)). |

**The call order is the document's node order**, not the mockup's primary path. `split` and
`back-to-queue` sit between `plan` and `implement` because that is where the document lists them.

**The status bar is not printed code.** Its `LSP ready` becomes `DSL analyzer` under decision
**C5**, which is the editor's (#174) and not this grammar's.

**Neither is the Types card.** Its `route.task(name: TaskKind): ModelRoute` is served by #177,
with the schema's first sentence as its doc. The mockup's second, *"Falls back to the tenant
default chain"*, describes a fallback routing does not have: an unrouted task kind is
`route_not_found`.

---

## 11. What builds on this

| Issue | Inherits |
|---|---|
| **#166**, the parser | This grammar, and `code.grammar.ts`'s tables read backwards, as `parseWorkflowCode`. [§13](#13-reading-a-file-back) records what it accepts and normalises, what it refuses and with which code, and what a stale layout line means. |
| **#167**, the endpoints | `printWorkflowCode(slug, document)` for `GET /api/v1/workflows/{slug}/code` and `parseWorkflowCode(text)` for its `PUT`. A draft is not validated, so the code view shows a document only when `parse(print(doc))` is `doc` (`code.projection.ts`), and answers `409 workflow_code_unprojectable` with the validator's findings otherwise. A saved file whose `defineLoop` names another slug is refused at the slug (`slugRangeOf`). |
| **#168**, the property tests | The bijection in [§2](#2-what-the-grammar-promises), over generated documents. |
| **#170**, highlighting | The token classes: keywords, strings, numbers, callees, comments. |
| **#177**, completions and hover docs | `STAGE_CALLEES`, `STAGE_OPTIONS`, `PREDICATE_METHODS`, `EFFORT_CONSTANTS`, `ROUTE_METHODS`, and the schema pointers `code.grammar.ts` keeps beside them (`STAGE_OPTION_FIELDS`, `ROUTE_SIGNATURES` and the rest). `GET /api/v1/workflows/code-symbols` reads each word's type, values and doc from `v1.json` through them (`code.symbols.ts`). |
| **#178**, the span map and diagnostics | `PrintedWorkflowCode.spans`: for each node, in node order, the 1-based first and last line of its stage call. `code.diagnostics.ts` puts each validation finding and reference check on its stage's lines: a `/nodes/N` pointer takes the N-th span, an edge's pointer the span of the stage it leaves, and a finding about the whole document the `defineLoop` line. `GET /api/v1/workflows/{slug}/code` serves both as `spans` and `diagnostics`, and `code.checks.ts` derives the Loop Checks rows from them. |

```ts
const { text, spans } = printWorkflowCode("standard-fix", document);
// spans[6] → { node: "implement", startLine: 71, endLine: 85 }
```

---

## 12. Known limits

Stated rather than discovered.

* **The printer takes valid documents.** A draft is saved as the canvas holds it, and a
  half-built model stage with no routing has no spelling. The code view (#167) then shows no file:
  `GET /api/v1/workflows/{slug}/code` answers `409 workflow_code_unprojectable` with the
  validator's findings for any document that does not read back as itself.
* **Comments a person adds are not document data.** The document is the artifact, and a file is
  its rendering, so a save followed by a print drops any comment the generator didn't write.
  Keeping them would need somewhere in the document to put them, which is a DSL change.
* **`@ouroboros/sdk` is not a package.** The file is parsed, never type-checked against real
  declarations or run. A real SDK is the X.1 ADR (#180).
* **Lines are not wrapped**, so long descriptions and long conjunctions of trigger conditions make
  long lines.
* **`print(parse(code)) === code` holds for canonical code only.** Whitespace, key order and the
  forms [§5.4](#54-decision-and-gate) and [§7](#7-edges) pick between are the printer's to fix, and
  a file an author reformatted prints back in canonical form after its next save.
* **String bounds are the DSL's**, counted in UTF-16 code units in `ouroboros-rest`
  ([`WORKFLOW_DSL.md` §12](WORKFLOW_DSL.md#12-known-limits)). Escaping never changes a string's
  value, only its spelling.

---

## 13. Reading a file back

`parseWorkflowCode(text)` in
[`code.parser.ts`](../ouroboros-rest/src/modules/workflows/code.parser.ts) is the printer run
backwards (#166). It returns the workflow's slug and the canonical document the text spells, or
every error that stopped it. It never throws.

```ts
const { slug, document, errors } = parseWorkflowCode(text);
// errors empty: slug "standard-fix", document { dsl_version, trigger, nodes, edges }
// otherwise:    [{ code: "code_out_of_grammar", line: 13, column: 5, endLine: 13, endColumn: 11,
//                  message: "`review` is not a stage call. A stage is `trigger`, `llm`, …",
//                  hint: "Supported in the full SDK (v2) — see …/issues/180" }]
```

**Nothing is evaluated.** `ts.createSourceFile` builds a syntax tree and the parser walks it.
Nothing is emitted, run, resolved or imported, and a predicate's arrow function is read as syntax,
never called. `code.parser.static.spec.ts` scans the parser's own module graph for `eval`,
`Function`, `require`, dynamic `import()` and any package besides `typescript` and `zod`. It also
parses a file whose every statement would leave a mark if it ran, and checks that none is left.
`typescript` is a runtime dependency of `ouroboros-rest` for this parser alone.

### 13.1 Shape, not semantics

The parser answers *what document does this text spell?* `validateWorkflowDocument` then answers
*is that a workflow?*, with the codes and JSON Pointers the canvas already gets. The line between
the two:

| The parser refuses | The parser reads, and the validator reports |
|---|---|
| A construct the grammar has no spelling for: an unknown callee, an option its callee does not take, a second import | A stage nothing reaches, a duplicate id, an edge to a stage that doesn't exist |
| A value spelled as the wrong kind of literal: `retries: "2"`, `title: issueTitle` | A value of the right kind that the schema refuses: `retries: 99`, `merge: "fast-forward"`, `require: []` |
| A call with the wrong number of arguments | An absent option: no `title`, a model stage with no `model`, a branch with no `when` |
| A spelling a closed table lacks: `effort.XXL`, `route.pool(…)`, `on: "issue.closed"` | An unsupported `dsl`, a source outside the vocabulary |

So a missing option is left out of the document rather than reported. The validator names it
with a JSON Pointer, and #178's span map takes it to the stage's lines.

### 13.2 Errors

| Code | Means | `hint` |
|---|---|---|
| `code_syntax_error` | The text is not TypeScript. The message is the compiler's. | none |
| `code_out_of_grammar` | The text is TypeScript that the closed grammar has no spelling for. | always: *Supported in the full SDK (v2)*, pointing at #180 |
| `code_layout_invalid` | The layout block is missing, has a line it can't read, or gives a stage no position. | none |

Every error is anchored to a range: a 1-based `line` and `column`, and `endLine` and `endColumn`
just past its last character. **Lines count line feeds only**, as the span map does, and `\r\n` or
`\r` endings read as `\n`, so a file saved on Windows reports the same positions. Columns count
UTF-16 code units. Errors are listed in the order a reader meets them.

**Every problem comes back from one pass.** The compiler recovers from a syntax error and reports
each one, and the walk records each grammar error and carries on with the next sibling. When the
compiler fills a gap and the filler is out of grammar, the grammar error is dropped rather than
reported as a second problem. A missing layout block isn't reported alongside a syntax error,
because the tree can't then say where the code ends. A file nested so deeply that the compiler's
recursive parser runs out of stack (thousands of brackets) gets one `code_syntax_error` at line 1,
rather than an exception.
[`fixtures/code-invalid/`](../schemas/workflow-dsl/fixtures/code-invalid) holds one file per kind of
mistake, three of them together in one, and `expected.json` records each error's code and range.

### 13.3 Accepted and normalised

A file an author has edited rarely stays canonical. Where a spelling names the same document as
the canonical one, it is accepted, and the next print writes the canonical form:

* whitespace, comments, parentheses, trailing commas, and a stray `;`;
* keys in any order: `defineLoop`'s, the trigger's, a stage's and an edge entry's;
* strings in any quotes, backticks included when there is no `${…}`, string-literal keys, and a
  prompt written as a quoted string;
* numbers spelled any way the scanner reads them: `400000`, `400_000`, `0x61a80`;
* the header's names in any order, unused names, missing names, or no header at all, since nothing
  resolves them;
* `next: ["a"]` for `next: "a"`;
* `onFail: [{ to: "a", when: (i) => i.checks.anyFailed() }]` for `onFail: "a"`;
* `when: (i) => i.checks.allPassed([…])` on a decision or gate for `require: […]`;
* trigger conditions in any order or grouping, and `when: () => true` or `(i) => true` for a
  trigger with no conditions;
* a predicate's parameter under another name or without parentheses:
  `ticket => ticket.effort.lte(effort.S)`.

Everything else that §3 to §8 don't write is `code_out_of_grammar`. That includes `&&` or `||`
inside a predicate, a block body, a typed or destructured parameter, `async`, optional chaining, an
identifier where a literal belongs, a template substitution, a spread, a shorthand property, a
computed key, `as`, and both `require` and `when` on one stage.

### 13.4 The layout block, read

The layout block gives each stage its position, and each edge its label and its place in the
document's `edges`.

* **The block is looked for after the last statement only**, so a prompt containing the marker
  line is never mistaken for it.
* **Lines may come in any order.** A node line is matched to its stage by id, and an edge line to
  its edge by `from` and `to`.
* **A stale line is ignored.** A node line for a stage the code no longer calls, or an edge line for
  an edge no stage declares, describes nothing in the document. Deleting a stage or an edge in code
  needs no edit to the block, and the next print drops the line.
* **A stage with no node line is `code_layout_invalid`**, anchored at its id, because a position
  has no default that wouldn't be invented. The author adds `// node <id> <x> <y>`. A file with no
  block at all gets one error at its end, not one per stage.
* **An edge with no edge line** has no label. It is placed after every edge that has a line, in the
  order the stages declare edges: stage order, then `next`, `branches` and `onFail`.
* **Two stages with one id, or two edges joining one pair,** take the lines that name them in order.
  Both are validation errors, but each still gets a place.

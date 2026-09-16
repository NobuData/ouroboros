# ouroboros-engine

> **Status:** scaffolded by [#50](https://github.com/NobuData/ouroboros/issues/50);
> liveness, `/v0/status` and the internal-key guard landed with
> [#51](https://github.com/NobuData/ouroboros/issues/51); the versioned contract — the
> echo round trip and the error envelope — with
> [#52](https://github.com/NobuData/ouroboros/issues/52). It ships as a container since
> [#53](https://github.com/NobuData/ouroboros/issues/53). The work it will eventually
> broker is [#54](https://github.com/NobuData/ouroboros/issues/54).

## Purpose

The **Python backend** — the service that executes the work `ouroboros-rest` brokers
(and, in time, the autonomous loops the product is named for).

It is **internal only**. Nothing outside the cluster reaches it: every request arrives
through `ouroboros-rest`, authenticated with a shared secret on the
`X-Ouro-Internal-Key` header. The browser never calls it directly.

That is a deployment claim, so the service enforces it itself rather than trusting it:
**every path but `/healthz` requires the key**, the comparison is constant time, and a
request without it is refused before routing — so a misrouted engine port answers a
probe and nothing else.

## Stack

| Concern | Choice |
|---|---|
| Language | Python 3.12 |
| Framework | FastAPI + uvicorn |
| Package manager | [uv](https://docs.astral.sh/uv/) (locked via `uv.lock`) |
| Config | pydantic-settings, `OURO_*` validated at import |
| API spec | **Spec-first**: [`openapi.yaml`](openapi.yaml) is authoritative and is served verbatim; [`openapi.json`](openapi.json) is rendered from it |
| Lint & format | ruff |
| Tests | pytest + the FastAPI test client (httpx2) |
| Container | Multi-stage `python:3.12-slim`, non-root, `HEALTHCHECK` on `/healthz` — [#53](https://github.com/NobuData/ouroboros/issues/53) |

## Run

```bash
uv sync                                                # create .venv, install from uv.lock
OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me uv run dev   # :8000
uv run openapi                                         # re-render openapi.json from openapi.yaml
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

The shared secret is **mandatory** — without it the service would answer nothing but
liveness, so it refuses to start rather than serve a wall of 401s. Any value works in
development as long as `ouroboros-rest` is configured with the same one;
[`.env.example`](../.env.example) documents the placeholder used above. Putting it in an
`.env` once — `cp .env.example .env`, then edit — is what makes a bare `uv run dev` and
`yarn dev` from the repo root work, with nothing exported.

Those three, after `uv sync --locked`, are what `ci/engine` runs on every pull request
touching this directory — see [conventions](../docs/CONVENTIONS.md#9-ci).

`yarn dev` from the repo root starts this service alongside the rest of the stack,
against a database that is already up and migrated
([conventions § 1](../docs/CONVENTIONS.md#1-repository-shape)). The
[`package.json`](package.json) beside `pyproject.toml` is what makes that possible and
is nothing more: three scripts, each one line, each delegating to the `uv run` command
above. **`pyproject.toml` is this module's manifest** — the dependencies, the version and
the tool configuration are there, and the adapter deliberately carries no version of its
own so there is one place to change it.

`uv run dev` reloads on a change under `src/` and binds **127.0.0.1 only**, because a
development server on every interface is reachable from whatever network the machine is
on and this service is internal by design. Production runs uvicorn against the
application directly, without the reloader, and chooses its own host:

```bash
uv run uvicorn ouroboros_engine.main:app --host 0.0.0.0 --port "${PORT:-8000}"
```

That is the command the image runs, minus the `uv` — see [Container](#container).

## The HTTP surface

| Path | Key required | Answers |
|---|:---:|---|
| `GET /healthz` | no | `{"status":"ok"}` — liveness, for a container platform's probe |
| `GET /` | yes | The service name and its installed version |
| `GET /v0/status` | yes | Version and uptime — what `ouroboros-rest`'s readiness probe reads |
| `POST /v0/tasks/echo` | yes | The contract exemplar: `{task_kind, payload}` back as `{accepted, echo, engine_version}` |
| `POST /v0/estimate` | yes | Size one issue: `{issue, context}` in, one version of K.2's estimate row out |
| `POST /v0/workflows/validate` | yes | The engine's findings on a workflow definition — the publish gate's second opinion |
| `POST /v0/workflows/dry-run` | yes | Walk a definition for one ticket: ordered steps, a verdict per stage, the path to highlight — no model or provider call |
| `POST /v0/plan` | yes | Draft a batch of tickets: `{narrative, outline?, context}` in, drafts with dependencies and provenance out |
| `/openapi.json`, `/docs` | yes | The committed specification, served verbatim. A map of the internal surface is not something a misrouted port should hand out |

```console
$ curl -s localhost:8000/healthz && echo
{"status":"ok"}

$ curl -s localhost:8000/v0/status && echo
{"code":"unauthenticated","message":"Unauthorized.","details":{}}

$ curl -s -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" localhost:8000/v0/status && echo
{"service":"ouroboros-engine","version":"0.7.0","uptime_seconds":42.5}

$ curl -s -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" \
    -H 'content-type: application/json' \
    -d '{"task_kind":"echo","payload":{"note":"hello"}}' \
    localhost:8000/v0/tasks/echo && echo
{"accepted":true,"echo":{"task_kind":"echo","payload":{"note":"hello"}},"engine_version":"0.7.0"}

$ curl -s -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" \
    -H 'content-type: application/json' \
    -d '{"task_kind":"Echo","payload":{}}' \
    localhost:8000/v0/tasks/echo && echo
{"code":"validation_failed","message":"The request is not valid. See `details` for each field.","details":{"task_kind":["String should match pattern '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'"]}}
```

`/healthz` is deliberately shallow: it opens no connection and reads no configuration,
so it cannot fail for a reason restarting the container will not fix. *Readiness* — are
the dependencies reachable — is REST's probe
([#29](https://github.com/NobuData/ouroboros/issues/29)), which asks `/v0/status` with
the key.

Everything else is behind the guard, and a rejection is one constant body whether the
path exists or not — status codes are how a surface gets mapped from outside, so an
unauthenticated caller cannot tell `/v0/status` from `/v0/anything-else`. The rejection
is logged with the path and the method; the key that was offered never is, right or
wrong. `ouroboros-rest` never forwards that `401` to a browser: a key its own deployment
holds wrongly is its problem, so it logs the mismatch and answers `502`.

`/v0` is the versioned internal prefix, and it is unstable by definition — it changes
with the two services that share it, which deploy together. A field may be added to a
response and a route may be added to the prefix; a field that disappears, changes type or
changes meaning is a `/v1` served alongside this one, not an edit to it. The rule is
written down in [`api/v0.py`](src/ouroboros_engine/api/v0.py), which is where a router
under the prefix reads it from rather than restating it.

### Every error has one shape

`{code, message, details}` — the same envelope `ouroboros-rest` answers a browser with
([`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) § 5.3), so a failure crossing the
gateway does not change form on the way out. `code` is stable and machine-readable and is
what a caller branches on; `message` is written for a person; `details` carries what is
specific to the failure, which for a `422` is one entry per field that was refused, keyed
the way the caller wrote it.

It covers the answers no route produced, too — a path nothing claims, a method a path does
not allow, a body that could not be parsed, an exception nobody expected — so the gateway
parses one shape rather than one per layer. Two rules hold for what it may say:
**anything `5xx` carries one constant sentence**, because the real diagnosis names the
inside of this process and belongs in a log; and **a refusal never echoes what was
refused**, which is why FastAPI's own `422` (it returns the rejected input under
`detail[].input`) is replaced rather than reshaped.

### Sizing an issue

`POST /v0/estimate` is the first operation that does work rather than demonstrating the
shape of it ([#105](https://github.com/NobuData/ouroboros/issues/105)). It takes the issue
and the vocabularies the installation has, and answers with **one version of K.2's
`issue_estimates` row** ([#100](https://github.com/NobuData/ouroboros/issues/100)) — so the
caller persists the answer rather than translating it.

```console
$ curl -s -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" \
    -H 'content-type: application/json' \
    -d '{"issue":{"number":485,"title":"I2C bus lockup","body":null,"labels":["bug"],
         "repo":"acme-robotics/helios-firmware"},
         "context":{"workflow_tags":["standard-fix"],
                    "model_defaults":{"default":"claude-fable-5"}}}' \
    localhost:8000/v0/estimate && echo
{"effort":"m","confidence":59,"suggested_workflow":"standard-fix","routed_model":"claude-fable-5","breakdown":{"files":[],"est_tokens":180000,"cycle_min":12,"cycle_max":32,"est_minutes":23},"risk":"medium","risk_note":"M-sized work starts at medium regression risk. heuristic-v0 reads an issue's labels and text only — …","trace":{"estimator":"heuristic-v0","tokens_used":0,"signals":["label-effort: the \"bug\" label -> m","body-length: no description -> xs","effort: strongest of 2 signals -> m","confidence: 1 of 2 agree, spread 2, no description -> 59","workflow: no docs, dependency or feature signal -> standard-fix","routed-model: model_defaults[\"default\"] -> resolved, not invoked","risk: m effort -> medium","needs-human: 59 is below the 70 confidence floor"]}}
```

That answer is `heuristic-v0`, L.2's rule engine
([#106](https://github.com/NobuData/ouroboros/issues/106)) — and it is worth reading
line by line, because the trace is the whole of how it was reached. Four things about it
are the contract rather than this build's behaviour.

**The caller supplies the vocabularies.** `context.workflow_tags` and
`context.model_defaults` are what the installation has, and `suggested_workflow` and
`routed_model` are always drawn from them — roadmap decisions **K5** and **K6**. This
service holds no list of workflow tags and no list of models, so it cannot invent one, and
an estimator that names something outside the offer is a `500` here rather than a value
that reaches a row.

**`trace.estimator` is required** — decision **K10**, enforced at this boundary and not
only by the column's `not null`. Provenance checked at the last hop is provenance the hops
before it can lose. It is why the answer above says `heuristic-v0` and never a model name:
the estimator that produced it read a label and a character count, it invoked nothing, and
`tokens_used: 0` says the same thing a second way. The LLM estimator
([#123](https://github.com/NobuData/ouroboros/issues/123)) answers the same shape with the
heuristic retained behind it as the fallback path, and swapping one for another is a single
line in `create_app`.

**`breakdown.files` is empty, and the key is there anyway.** A rule engine cannot know
which files an issue touches, so it returns none — and returns them as `[]` rather than by
omitting the field, because N.5's panel renders the absence and a missing key reads as an
older schema. **A low confidence is an answer, not a failure**, for the same reason: the
estimate above is under the floor the engine publishes
(`estimation.heuristic.NEEDS_HUMAN_CONFIDENCE_FLOOR`, currently `70`) and says so in its
own trace, so L.3 moves the issue to `needs_human` rather than `sized`. That is a real
outcome of sizing, and the trace is what a person reads when they pick it up.

**v0 answers synchronously, and the escalation for when that stops being possible is
already written down.** An LLM estimator is not something to hold a gateway's socket open
for, so the operation's `x-async-escalation` block specifies the `202`-plus-poll path now:
`202` with `{estimation_id, status: "accepted"}` and a `Retry-After` header, then
`GET /v0/estimate/{estimation_id}`, which answers `202` while the estimate is in flight and
**the same `Estimate` body, unchanged** when it is done. It is an extension rather than a
documented `202` response because this build cannot answer one, and a `responses` entry is
a promise a caller may hold it to. Specifying it now is what keeps O.2 from rewriting a
contract that L.3, M.1 and N.3 are built on.

## The workflow DSL

**A workflow is one JSON document, and this is the half of its validator that answers this
service** ([#133](https://github.com/NobuData/ouroboros/issues/133)). The language is specified
in [`docs/WORKFLOW_DSL.md`](../docs/WORKFLOW_DSL.md) and published as
[`schemas/workflow-dsl/v1.json`](../schemas/workflow-dsl/v1.json), above both modules because
neither owns it. `ouroboros_engine.workflows` is that schema written in pydantic, plus the
structural rules a schema cannot express.

Two routes read it — R.2's ([#144](https://github.com/NobuData/ouroboros/issues/144)),
[below](#validating-and-simulating-a-workflow) — and both are routers over this validator rather
than validators of their own.

```python
verdict = validate_workflow_document(definition, catalogue)
verdict.as_dict()  # {"valid": …, "errors": [...], "warnings": [...]}
```

Every diagnostic carries an RFC 6901 pointer and, where there is one, the node id or the edge
endpoints — there is no bare *invalid document*. Errors and warnings are separate lists rather
than one list with a severity: decision **P7** says an unknown skill reference must not fail a
save, and a caller who has to filter by severity to learn that is a caller who will forget to.

**The models are strict and closed.** `strict=True` because pydantic's lax mode would accept
`"12"` where the document says a number and `ouroboros-rest`'s zod would not — a validator that
accepts what the other refuses is exactly the divergence this design exists to prevent.
`extra="forbid"` because every object in the DSL is closed. The one relaxation is the `Integer`
annotation, and it exists for the opposite reason: JSON's `2.0` *is* an integer, JavaScript
cannot tell it from `2`, and Python's `json` module makes it a `float`.

### What keeps the two validators honest

| Suite | What it asserts |
|---|---|
| `tests/test_workflows_parity.py` | Every case in [`fixtures/expected.json`](../schemas/workflow-dsl/fixtures/expected.json) — one document per rule, and the verdict both validators must produce. `ouroboros-rest`'s `dsl.parity.spec.ts` asserts the same file. |
| `tests/test_workflows_conformance.py` | `jsonschema` compiles the published schema, and the schema and these models classify every fixture alike. |

Neither module imports the other and no third process compares two outputs: each reads
`schemas/workflow-dsl/` from its own suite, so a rule added to one validator and forgotten in
the other is a red check in the half that forgot it. `ci/engine` and `ci/rest` both watch
`schemas/**` for that reason.

The two implementations are also written to **mirror each other file for file** —
`errors.py`/`dsl.errors.ts`, `dsl.py`/`dsl.schema.ts`, `issues.py`/`dsl.issues.ts`,
`structure.py`/`dsl.structure.ts`, `references.py`/`dsl.references.ts`,
`validate.py`/`dsl.validator.ts` — so they can be read side by side. That is the defence a test
suite cannot provide.

### Validating and simulating a workflow

`POST /v0/workflows/validate` is the publish gate's second opinion
([#134](https://github.com/NobuData/ouroboros/issues/134)): `ouroboros-rest` validates with zod,
then asks the component that will execute a definition whether it reads it the same way.
`POST /v0/workflows/dry-run` is the studio's *Dry run with issue #485* — a real walk of the graph
for one ticket, with **zero model calls and zero provider calls**
([#144](https://github.com/NobuData/ouroboros/issues/144)).

```console
$ curl -s -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" \
    -H 'content-type: application/json' \
    -d '{"definition":{"dsl_version":"1.0","trigger":{"event":"ticket_queued","conditions":{}},
         "nodes":[{"id":"start","type":"trigger","title":"Issue queued",
                   "position":{"x":0,"y":0},"config":{}}],"edges":[]}}' \
    localhost:8000/v0/workflows/validate && echo
{"findings":[{"code":"document.no_terminal","message":"A workflow needs at least one terminal node; no path through this one ends.","path":"/nodes"}]}
```

**Findings are the verdict's errors, anchored.** Each carries the DSL's `code` and an RFC 6901
`path`, plus `node_id` or `edge` when it is about a stage or a connection — omitted, never `null`,
when it is not — so the canvas can select what a finding is about. An invalid definition is a
`200` with findings; a `422` means the *request* was not one. Decision **P7**'s warnings are not
findings, because neither operation takes a catalogue.

**The dry run** validates first and, for a valid definition, walks it for the ticket the caller
sends — `{external_key, source, labels, estimate: {effort} | null}`; nothing is fetched. It answers
`steps` (the ordered walk), `verdicts` (one per stage, in document order) and `highlight_path`
(the edges the canvas draws in the accent treatment), and every decision carries a sentence
saying why.

| Rule | What the walk does |
|---|---|
| Trigger | Every present condition, ANDed, tested against the ticket and its estimate. When it does not fire, no run starts and the trigger is the only step. |
| Order | Breadth-first from the trigger, each stage's edges in document order — the same input is the same walk in every process. |
| `default` and `branch` edges | A `default` edge is taken; a `branch` edge when its condition holds. A stage two taken edges reach is walked once. |
| Decisions | Every branch is reported, taken or not, with the reason — the road not taken, explained. |
| Gates | Annotated with what they require. |
| Loops | Reported with `outcome: "loop"` and never walked. `max_retries` is the `limits.max_retries` of the model stage the loop returns to, or `null` when that stage declares none. |
| `checks` predicates | Check results come from a run, so the walk assumes the green path and marks the evaluation `assumed: true`. |
| Effort | Ordered `xs` < `s` < `m` < `l` < `xl`. An unsized ticket (`estimate: null`) satisfies no comparison. |
| Labels | Compared exactly as the tracker spells them. |

For the seeded `standard-fix` and `#485` the walk is `issue-queued → analyze → effort-recheck →
plan → implement → build → test → review → checks-green → open-pr` — mockup 04's accent path, then
on to the terminal — with `split` explained as not taken (*#485 is effort M, and M is not > M*) and
the `fail ↺` loop reported with its bound of 2.

**"No calls" is asserted, not claimed.** `tests/test_workflows_simulate.py` fails if any module a
dry run executes imports the control-plane client, the estimator, a socket, an HTTP library or
`subprocess`, and `tests/test_api_workflows.py` runs both operations with `ControlPlaneClient`,
`socket` and the installed estimator replaced by spies that fail the request if touched. The walk
is also what the Build Analyzer's counterfactual simulation (#523) and the deep dry run's pre-check
(#562) reuse, which is why it is a function of the typed document and the ticket and nothing else.

## Drafting a batch of tickets

`POST /v0/plan` turns an outcome into drafted tickets with their dependencies
([#277](https://github.com/NobuData/ouroboros/issues/277)). It is the second operation whose
implementation is expected to be swapped out from under it, and the reason it exists in this
form is roadmap decision **N2**: the planning page's promise needs a model, a model needs the
invocation gateway ([#235](https://github.com/NobuData/ouroboros/issues/235)), and that is v2.
Rather than block the page or fake the magic, **the contract is specified once and implemented
twice**. The parser answers it today; the LLM planner
([#289](https://github.com/NobuData/ouroboros/issues/289)) answers the same shape later, and
the API, the UI, the sizing pipeline and the push path are unchanged by its arrival.

```console
$ curl -s -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" \
    -H 'content-type: application/json' \
    -d '{"narrative":"OTA updates must survive power loss mid-flash.",
         "outline":"- Partition table for A/B slots  blocks: OTA-3\n- Checksum before commit\n- Rollback on failure\n- Write it up  [docs]",
         "context":{"workflow_tags":["feature-loop","docs-loop"],
                    "milestone":"Helios 2.1","local_key_prefix":"OTA"}}' \
    localhost:8000/v0/plan && echo
{"drafts":[{"local_key":"OTA-1","title":"Partition table for A/B slots","body":"","suggested_workflow":"feature-loop","dependencies":[]},{"local_key":"OTA-2","title":"Checksum before commit","body":"","suggested_workflow":"feature-loop","dependencies":[]},{"local_key":"OTA-3","title":"Rollback on failure","body":"","suggested_workflow":"feature-loop","dependencies":["OTA-1"]},{"local_key":"OTA-4","title":"Write it up","body":"","suggested_workflow":"docs-loop","dependencies":[]}],"planner":"outline-v0","notes":[]}
```

**What the parser reads**, and the whole of it:

| You write | It becomes |
|---|---|
| a top-level bullet | a ticket |
| anything indented under it | that ticket's body, nesting preserved |
| `blocks: KEY` / `after: KEY` | a dependency edge, in either direction |
| a **numbered** list | a sequence — each item after the one before it |
| `[marker]` | a workflow-tag hint, matched against the tags you offered |

**Narrative-only input degrades honestly, and that is the point.** With no outline the parser
cannot decompose anything, so it answers with **one** draft carrying the narrative and a note
recommending an outline. It does not invent five plausible-sounding tickets — output that
looks like planning and is actually a guess is the exact failure this staging exists to
avoid — and the page renders that note as designed guidance rather than as an error
([#284](https://github.com/NobuData/ouroboros/issues/284)).

**Nothing is inferred that was not written, and nothing is dropped in silence.** An unordered
list gets no edges it was not given: the order somebody typed their bullets in is not a claim
that one blocks another. A numbered list is the one place sequencing *is* read, because
writing `1. 2. 3.` is itself the statement that there is an order — and the batch says so in
`notes`. Everything the parser saw and could not use says so there too: an annotation naming a
key that is not in the batch, a marker matching no workflow, a `blocks:` written on an indented
line, prose before the first bullet, a bullet with no text.

**The caller supplies the vocabulary** (decision **K5**, as with sizing): `suggested_workflow`
is always one of `context.workflow_tags`, and a draft with no marker of its own takes the
first tag you offered — not a default this service holds, because it holds no list of tags at
all. **`planner` is always recorded** (decision **K10**), so a deployment that believes it has
the LLM planner can find out from a response which one it actually has. And **nothing here is
sized**: decision **N3** sends drafts through the same estimation pipeline every other ticket
uses, so `✓ all sized` on the page means what it says.

The contract is published as [`schemas/plan/v0.json`](../schemas/plan/v0.json) with one
recorded case per rule beside it, because AN.1 implements the *same* contract and `ouroboros-rest`
([#280](https://github.com/NobuData/ouroboros/issues/280)) persists what comes back —
`tests/test_planning_golden.py` holds this implementation to both.

## The API specification

**[`openapi.yaml`](openapi.yaml) is the specification, and the service serves it.** This
module is spec-first: FastAPI does not derive a document from whatever routes it happens
to have — the application loads the committed file and hands it back at `/openapi.json`
unchanged. What a catalogue holds, what `/docs` renders and what the process answers with
are the same bytes, so the document can carry things no framework has a field for (the
`X-Ouro-Internal-Key` scheme, the `401` every guarded operation shares, prose written for
a reader) and cannot be rewritten by a docstring nobody meant as a contract.

Two files, one document, both committed at this directory's root — the paths to hand a
catalogue, a linter or a diff tool:

| File | What it is |
|---|---|
| [`openapi.yaml`](openapi.yaml) | **Authoritative.** The one to edit — comments, block text, no escaping |
| [`openapi.json`](openapi.json) | Rendered from it by `uv run openapi`. What the process loads, and what a JSON-only tool wants |

```bash
uv run openapi           # re-render openapi.json from the YAML
uv run openapi --check   # report drift without writing; exits non-zero
```

The JSON is committed rather than built on demand because the container serves it: both
files are packaged beside the module, so an image carries the document it answers with.
Reading the JSON at runtime is also why the served process needs no YAML parser — PyYAML
is a development dependency, used by the renderer and the tests and by nothing that
handles a request.

Being spec-first costs the one thing a generated document gave away free: the guarantee
that it describes the routes that actually exist. `uv run pytest` is that guarantee, and
`ci/engine` runs it on every pull request. It fails when

- the two files have drifted apart, or `openapi.json` was hand-edited;
- `info.version` is not the version `pyproject.toml` declares;
- the application serves a path or method the document does not describe — **or the
  document promises one the application does not serve**;
- a response model gained or lost a field the schema does not have;
- `/healthz` is not exactly the set of operations exempt from the key, which is the same
  claim `_PUBLIC_PATHS` in `main.py` makes;
- a documented example is not a body the service could actually send;
- the document is not valid OpenAPI 3.1.

So adding a route is now two edits — the router module and `openapi.yaml` — and forgetting
the second one is a red pipeline rather than a specification that quietly lies.

## Configuration

Development default port: **8000** (`PORT`).

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP listen port (unprefixed by convention — see [conventions](../docs/CONVENTIONS.md)) | `8000` |
| `OURO_ENGINE_SHARED_SECRET` | Expected value of `X-Ouro-Internal-Key`; compared in constant time | **required** |
| `OURO_LOG_LEVEL` | Log verbosity — `debug`, `info`, `warning` or `error` | `info` |

Values come from the **process environment layered over `.env` files** — the repo-root
one, then this module's, then the real environment, later winning
([conventions § 4](../docs/CONVENTIONS.md#4-configuration--environment-variables)). Every
variable is documented with its development default in the repo-root
[`.env.example`](../.env.example), and those three — and only those three — again in
[`.env.example`](.env.example) here, for copying:

```bash
cp .env.example .env
uv run dev                   # the copy is read directly; nothing to export
```

The repo-root template stays the complete list and this one is a subset of it; the values
in the two are identical. `yarn dev` from the repo root reads the same files, so a
checkout with either `.env` in place needs nothing exported.

The process environment winning last is what keeps this honest in a container: what it is
started with is exactly what it runs with, regardless of any file in its image. It is
also how one run is overridden without editing anything:

```bash
OURO_LOG_LEVEL=debug uv run dev
```

The files are read by [`settings.py`](src/ouroboros_engine/settings.py), not by turbo —
`turbo.json`'s `globalDependencies` only puts `.env` in the task hash, and `globalEnv`
only decides which variables survive its strict environment filter. Neither loads a file.

Configuration is validated while the application is being built, which happens at import
of `ouroboros_engine.main` — so a bad value stops the process before it binds a port,
and names the variable rather than raising on the first request:

```console
$ OURO_LOG_LEVEL=chatty uv run dev
ouroboros-engine: invalid configuration (1 problem)
  OURO_LOG_LEVEL: Input should be 'debug', 'info', 'warning' or 'error'
$ echo $?
2
```

Values are never echoed back in that report — one of these variables is a secret.

`OURO_ENGINE_SHARED_SECRET` has no default and no fallback:

```console
$ uv run dev
ouroboros-engine: invalid configuration (1 problem)
  OURO_ENGINE_SHARED_SECRET: Field required
$ echo $?
2
```

It must match the value `ouroboros-rest` is configured with. A mismatch is logged by the
engine and surfaced to clients by REST as a `502`, never a `401` — the internal boundary
is not something the caller can probe.

## Logging

One JSON object per line, at `OURO_LOG_LEVEL`, on stderr. uvicorn's own records go
through the same formatter, so a served process emits one format rather than two:

```json
{"timestamp": "2026-08-10T23:54:26.158925+00:00", "level": "WARNING", "logger": "ouroboros_engine.core.security", "message": "rejected an internal request without a valid key", "path": "/v0/status", "method": "GET", "key_present": false}
```

Whatever a call site passes as `extra` becomes a top-level key, so an event is
filterable by `path` rather than by substring. Nothing is logged that was not passed
explicitly — no environment, no headers, no bodies — because this process holds a
credential and a logger that helpfully dumps context is how one reaches a log index.

## Container

[`Dockerfile`](Dockerfile) is the production image
([#53](https://github.com/NobuData/ouroboros/issues/53)) — `deps` → `build` → a runtime
that carries no toolchain, per [conventions § 5](../docs/CONVENTIONS.md#5-containers).
**Build it from this directory**, unlike the two Yarn workspaces:

```bash
docker build -t ouroboros-engine ouroboros-engine          # from the repo root

docker run --rm -p 8000:8000 \
  -e OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me \
  ouroboros-engine
```

The context is this directory because nothing here installs through the root lockfile:
`package.json` beside `pyproject.toml` is a workspace adapter over a `uv` project, and
every file the build reads is committed in this module. So the ignore file is a plain
[`.dockerignore`](.dockerignore) — with the context set here, that is the one BuildKit
reads — and it is an **allow-list**: `*`, then the manifest, the lockfile, `src/`, the
declared readme and the two specification files. Nothing else enters the context, `.env`
and `tests/` included.

| Property | Value |
|---|---|
| Base image | `python:3.12-slim`, every stage |
| User | `engine`, created in the runtime stage; nothing runs as root |
| Port | 8000 (`PORT`), bound on `0.0.0.0` — a container bound to loopback is unreachable |
| Healthcheck | the venv's own `python` against `/healthz` every 30 s, after a 10 s grace |
| Size | 55 MB to pull, 233 MB of layers unpacked — against a 250 MB budget |
| Runtime config | every `OURO_*` variable, supplied per environment — never baked into a layer |

**What moves between stages is one directory:** `/app/.venv`, holding the locked
dependencies and this project installed into it. `deps` runs `uv sync --locked --no-dev
--no-install-project`, so the expensive half is keyed on `pyproject.toml` and `uv.lock`
alone and editing a route does not re-resolve the tree; `build` re-runs the same sync
with the sources present and `--no-editable`, which adds just this project. `--locked` is
the `yarn install --immutable` of this toolchain and the same flag `ci/engine` installs
with: a lockfile that has drifted from the manifest fails the build rather than being
refreshed into an image whose dependencies the repository never committed.

**The project is installed, not copied**, and three documented behaviours depend on it.
`__version__` reads installed distribution metadata and refuses to import without it;
`openapi.json` is force-included beside the package by the wheel build, which is the
first path [`openapi.py`](src/ouroboros_engine/openapi.py) looks in, so the container
serves the committed document rather than hunting for a checkout; and `_ENV_FILES` in
[`settings.py`](src/ouroboros_engine/settings.py) is empty for a non-editable install,
because there is no `src` directory above the package to find an `.env` beside. **A
container is configured by the environment it was started with and by nothing else** —
by construction, not only because the ignore file keeps `.env` out.

The venv is copied in as root and the process runs as `engine`, so the service cannot
rewrite its own dependencies. It never needs to: `UV_COMPILE_BYTECODE` compiles
everything at build time, and the engine writes no cache, no bytecode and no uploads.

The healthcheck is the interpreter that is already in the image — `python:3.12-slim`
carries neither `curl` nor `wget`, and installing one would mean an apt layer and a
second HTTP client in an image whose only job is to answer through the first. It probes
**liveness only**: `/healthz` is the one path the internal-key guard lets through, so the
check holds no secret, and a Docker healthcheck is read by restart policies and by
compose's `condition: service_healthy` — pointing it at anything under `/v0` would
restart a healthy container over a dependency's problem. It expands `$PORT` at run time,
so it follows the port the container was actually given.

`OURO_ENGINE_SHARED_SECRET` is set **nowhere** in the image. It is the key every route
but liveness is checked against; a default in a layer would be a published image carrying
the credential that unlocks it. Started without it, the process names the variable and
exits before binding a port, which is the behaviour a baked default would replace.

[`tests/test_container.py`](tests/test_container.py) asserts every one of these
properties that is decided in the repository, because `ci/engine` cannot run a
`docker build`. It reads the probe path from `api/health.py`, the port from
`settings.py`, and the files the build has to copy from `pyproject.toml`'s own packaging
table — so a probe that moves, a port that changes or a newly force-included file fails
*here* rather than in a container that is already running.

The compose service that runs this image is
[#55](https://github.com/NobuData/ouroboros/issues/55); until then the repo-root
[`docker-compose.yml`](../docker-compose.yml) is the data tier only.

## Layout

```
ouroboros-engine/
├── src/ouroboros_engine/
│   ├── api/            # one module per router
│   │   ├── health.py   #   GET /healthz — the one public path
│   │   ├── root.py     #   GET /
│   │   ├── status.py   #   GET /v0/status
│   │   ├── tasks.py    #   POST /v0/tasks/echo — the contract exemplar
│   │   ├── estimate.py #   POST /v0/estimate — size one issue                   · #105
│   │   ├── workflows.py#   POST /v0/workflows/validate · /dry-run               · #144
│   │   ├── plan.py     #   POST /v0/plan — draft a batch of tickets             · #277
│   │   └── v0.py       #   the versioned prefix and the rule that governs it
│   ├── core/           # process-wide concerns, not routes
│   │   ├── errors.py   #   the {code, message, details} envelope, for every failure
│   │   ├── logging.py  #   JSON records at OURO_LOG_LEVEL
│   │   ├── security.py #   the internal-key guard
│   │   └── uptime.py   #   the stopwatch /v0/status reports from
│   ├── control_plane/  # what this service may ask ouroboros-rest for        · #224
│   │   ├── contract.py #   ouroboros-rest's internal OpenAPI document, mirrored
│   │   └── client.py   #   builds the requests, reads the answers — no transport yet
│   ├── estimation/     # sizing an issue — the contract, and what is behind it · #105
│   │   ├── contract.py #   the shapes; one version of K.2's issue_estimates row
│   │   ├── estimator.py#   the seam an estimator plugs into, and the K5/K6 check
│   │   ├── signals.py  #   the rules heuristic-v0 reads an issue with          · #106
│   │   └── heuristic.py#   heuristic-v0 itself: the arithmetic over those rules · #106
│   ├── workflows/      # the workflow DSL, validated with pydantic              · #133
│   │   ├── errors.py   #   the diagnostic vocabulary, the anchors, the ordering
│   │   ├── dsl.py      #   the shapes — strict, closed, dispatched by hand
│   │   ├── issues.py   #   pydantic's error types → the DSL's codes
│   │   ├── structure.py#   the graph rules a JSON Schema cannot express
│   │   ├── references.py#  decision P7's warnings, over a catalogue the caller gives
│   │   ├── validate.py #   the four stages, in the order both validators run them
│   │   ├── contract.py #   R.2's wire shapes — findings, the ticket, the walk   · #144
│   │   ├── predicates.py#  one evaluator for the trigger, forks and edges      · #144
│   │   └── simulate.py #   the dry-run walk — deterministic, and spends nothing · #144
│   ├── planning/       # drafting a batch of tickets from an outcome             · #277
│   │   ├── contract.py #   the shapes; published as schemas/plan/v0.json
│   │   ├── planner.py  #   the seam a planner plugs into, and the K5 check
│   │   ├── outline.py  #   the five rules a markdown outline is read by
│   │   └── outline_planner.py  # outline-v0: what that reading means
│   ├── dev.py          # `uv run dev` entry point; not imported by the application
│   ├── main.py         # create_app() and the `app` uvicorn serves
│   ├── openapi.py      # loads the committed spec; `uv run openapi` renders the JSON
│   └── settings.py     # pydantic-settings, OURO_*
├── tests/              # pytest; conftest.py isolates the environment
├── openapi.yaml        # the API specification — authoritative, hand-written
├── openapi.json        # rendered from it; the copy the service loads
├── Dockerfile          # the production image; the context is this directory
├── .dockerignore       # allow-list — only what the build reads
├── pyproject.toml      # deps, task names, ruff & pytest config
└── uv.lock             # committed; CI installs with --locked
```

`create_app()` builds an application from settings handed to it, or from the environment
when they are omitted, and puts them on `app.state.settings` — so a router or a
middleware reads configuration from the application rather than re-reading the
environment. `app` at module scope is what `ouroboros_engine.main:app` resolves to for
uvicorn, in development and in the container.

Adding a router is a module under `api/`, one `include_router` line in `create_app`, and
the operation written into `openapi.yaml` — the suite fails on a route that is served but
not described, so the third step is not one anyone has to remember.
**A route added that way is guarded by default**: the key check is middleware, installed
before any router, so a new path requires the key without anything being remembered.
Exempting one is an edit to `_PUBLIC_PATHS` in `main.py`, which is deliberately the only
place a public path can be declared — and a test asserts liveness is still the only
entry in it.
`control_plane/` is the direction the internal boundary now also runs in
([#224](https://github.com/NobuData/ouroboros/issues/224), roadmap decision **P3**). Until
now `X-Ouro-Internal-Key` has meant *`ouroboros-rest` calling this service*; this package is
this service calling back, over the same header and the same
`OURO_ENGINE_SHARED_SECRET`. Two surfaces, and the asymmetry between them is the whole of
the design:

```
POST /internal/llm/invoke          the control plane makes the model call — keys never cross
POST /internal/credentials/lease   local providers only — an address, TTL'd and audited
```

**A worker never holds a provider credential.** For every cloud provider the control plane
holds the key for the duration of one request and streams the answer back; a **local**
provider — an Ollama daemon on the same box — is reached directly, so a lease returns a base
URL and there is no field in it a credential could arrive in. A lease naming a cloud provider
is a `403` by policy, enforced on the control plane's side rather than trusted to this one.

**It opens no socket, and that is a decision rather than an omission.** There is no executor
yet — AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)) is what walks a resolved
chain, and the workers that would take a lease are
[#123](https://github.com/NobuData/ouroboros/issues/123) and
[#160](https://github.com/NobuData/ouroboros/issues/160). Adding an HTTP library to this
service's runtime dependencies for a caller that does not exist would be shipping a
dependency on speculation, and choosing sync or async on its behalf would be making that
executor's first architectural decision from outside it. So `ControlPlaneClient` builds a
complete request — absolute URL, the key, the body in the control plane's `camelCase` — and
reads what comes back, and whoever writes the executor brings the transport.

`contract.py` mirrors
[`ouroboros-rest/openapi.internal.yaml`](../ouroboros-rest/openapi.internal.yaml), and
`tests/test_control_plane_contract.py` reads that committed document and compares the paths,
the header, the provider kinds and AB.1's error taxonomy against this module's copy — so the
mirror is checked rather than asserted. The naming convention changes in that one file: the
control plane writes `camelCase` and this service writes `snake_case`, so nothing beneath it
carries `runCtx` or `ttlSeconds`.

`estimation/` is the first thing under `api/` that is not a router
([#105](https://github.com/NobuData/ouroboros/issues/105)), and the split inside it is the
design. `contract.py` is what `ouroboros-rest` is written against and is not allowed to
change. `estimator.py` is the seam — a one-method protocol, and the check that holds every
answer to the caller's own vocabularies. `signals.py` and `heuristic.py` are what is behind
it today ([#106](https://github.com/NobuData/ouroboros/issues/106)): the first is the rules,
one table and one threshold each, so a heuristic is something a reviewer can argue with a
line at a time; the second is the arithmetic that combines them, and the tables that turn an
effort into a breakdown and a risk. The route reaches the estimator through `app.state`
rather than importing one, so installing a different estimator is a line in `create_app` and
a test installs its own without patching a module. See
[Sizing an issue](#sizing-an-issue) above.

`Dockerfile` and `.dockerignore` are the production image — see [Container](#container)
above. They are read by `docker build` and by
[`tests/test_container.py`](tests/test_container.py), and by nothing else in this module.

## Related issues

Scaffold [#50](https://github.com/NobuData/ouroboros/issues/50) ·
internal auth [#51](https://github.com/NobuData/ouroboros/issues/51) ·
API contract [#52](https://github.com/NobuData/ouroboros/issues/52) ·
container [#53](https://github.com/NobuData/ouroboros/issues/53) ·
task execution [#54](https://github.com/NobuData/ouroboros/issues/54) ·
estimation contract [#105](https://github.com/NobuData/ouroboros/issues/105) ·
heuristic estimator [#106](https://github.com/NobuData/ouroboros/issues/106) ·
the workflow DSL and its shared validation [#133](https://github.com/NobuData/ouroboros/issues/133) ·
workflow validation and the dry-run simulator [#144](https://github.com/NobuData/ouroboros/issues/144) ·
the plan contract and its outline parser [#277](https://github.com/NobuData/ouroboros/issues/277) ·
the gateway that calls it [#35](https://github.com/NobuData/ouroboros/issues/35) ·
full epic [#6](https://github.com/NobuData/ouroboros/issues/6).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.

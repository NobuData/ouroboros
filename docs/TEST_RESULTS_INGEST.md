# Test results ingest

> How uploaded result files become the test-results tree: the `TestResultParser` SPI, the
> `ouro-hil-results.json` schema, the flake policy and the malformed-input taxonomy. Filed as
> AT.1 ([#329](https://github.com/NobuData/ouroboros/issues/329)). The code is in
> [`ouroboros-rest/src/modules/test-results/`](../ouroboros-rest/src/modules/test-results).

## 1. The pipeline

```
upload manifest complete (#330)
  └─ TestResultIngestService.parseAttempt({ organizationId, testRunId, files, flakePolicy })
       ├─ registry.detect(file)   → the first parser that recognises the file, or a format_unrecognized warning
       ├─ parser.parse(file, ctx) → suites · cases (raw attempts) · measurements · coverage counts · warnings
       ├─ assembleTree            → suites merged by (name, platform); JUnit + HIL joined; flake policy applied
       ├─ replaceTree             → one transaction: upsert by durable key, delete what is stale, recount
       └─ summarizeCoverage       → percent, and the delta against the prior attempt (absent when there is none)
```

The service declares no HTTP route. The upload path (#330) calls it, and the read APIs (#333) read
what it wrote.

## 2. The SPI

```ts
interface TestResultParser {
  readonly id: string;                                // "junit", "hil", "coverage", …
  detect(file: ResultFile): boolean;                  // cheap: name + first 4 KB
  parse(file: ResultFile, ctx: ParseContext): ParseOutput; // never throws on bad input
}
```

**Adding a format** (TAP, ctest JSON, pytest-json) means implementing the interface and adding the
instance to `TEST_RESULT_PARSERS` in `test-results.module.ts`. Nothing else changes.
`parser.registry.spec.ts` proves this by registering a stub TAP parser that exists only in the test
suite.

A parser reports **raw attempts** (`["failed", "passed"]`), never a status. Which retries count is
the flake policy's decision (section 4), and the orchestrator applies it once for every format.

## 3. Built-in parsers

| Parser | Detects | Reads |
|---|---|---|
| `hil` | `ouro-hil-results*.json`, or a head naming the schema | [`schemas/hil-results/v1.json`](../schemas/hil-results/v1.json) (section 5) |
| `coverage` | `*.info` / `lcov*` / a head opening an lcov record; a `<coverage>` root | lcov `LF`/`LH` (or `DA:` lines); cobertura `lines-valid`/`lines-covered` (or counted `<line hits>`) |
| `junit` | a `<testsuites>` or `<testsuite>` root | `testsuite` › `testcase`; `failure` / `error` / `skipped`; retry markers; platform; failure payload |

**JUnit retry markers.** Markers are read the way modern emitters write them:

- `flakyFailure` / `flakyError` are earlier attempts that failed before the recorded outcome.
- `rerunFailure` / `rerunError` are later attempts after it.
- A `testcase` repeated with the same classname and name in one suite (or across two reports of one
  suite) is a successive attempt.

**Platform.** Taken from the twister `platform` property on the case, then on the suite, then from a
`platform` attribute on the suite. It is normalised to V051's shape (`nrf52840dk/nrf52840` →
`nrf52840dk_nrf52840`). A `rig:` platform makes the suite physical. A suite with no platform is
recorded under `unknown`, with a warning.

**Failure payload.** `message`, `log_excerpt` (capped at 4000 characters) and `path` (pytest's
`file:line`). Anything the tree has no column for goes into `meta`.

## 4. The flake policy (decision T5)

A pass-on-retry is `flaky` **only** when the pinned workflow's `flakes:` policy sanctioned that
retry. Attempts past the budget are cut from `retry_outcomes`, and the status is read from the last
sanctioned attempt. The cut outcomes are kept in `meta.unsanctioned_outcomes`.

| Spelling | Sanctioned retries |
|---|---|
| `none` (the default) | 0 |
| `retry-once` | 1 |
| `retry-twice` | 2 |
| `retry-<n>` | n, where 0 ≤ n ≤ 10 |

With `retry-once`, `["failed", "passed"]` is `flaky`, and `["failed", "failed", "passed"]` is
`failed` with `unsanctioned_outcomes: ["passed"]`.

The workflow DSL has no `flakes:` key yet, so the policy is a parse input from the caller. When no
policy is given, nothing is ever marked flaky.

## 5. `ouro-hil-results.json` (option 2-A)

JUnit cannot express a value, a unit and a limit, so a rig uploads this beside its JUnit report. A rig
that emits only JUnit degrades to plain case rows.

```json
{
  "schema": "ouro-hil-results",
  "schema_version": 1,
  "rig": "helios-rig-02",
  "bench": "CAN bus + motor + power-cycler",
  "suites": [{
    "name": "PHYSICAL · HIL rig",
    "cases": [{
      "classname": "hil.motor",
      "name": "estop_release_overshoot",
      "procedure": "dyno bench releases e-stop under 2 Nm load, 3 trials",
      "measurements": [{
        "metric": "overshoot_pct", "value": 2.4, "unit": "%", "limit": 2.0, "direction": "max",
        "trials": [{ "trial": 1, "overshoot_pct": 2.1 }, { "trial": 2, "overshoot_pct": 2.4 }]
      }]
    }]
  }]
}
```

- **The suite** becomes `results_format = 'hil'` on platform `rig:<rig>`. It merges with a JUnit
  suite of the same name on the same rig: cases keep **JUnit's** retry truth and failure and gain
  **HIL's** procedure and measurements. A HIL case matches by classname and name, or by name alone
  when it has no classname and the name is unambiguous.
- **The verdict is computed, never uploaded.** `max` passes when `value <= limit`, and `min` passes
  when `value >= limit` (V053's `hil_verdict()`).
- **A case with no `status`** is `failed` when a measurement fails, `passed` when all pass, and
  `error` when none survived validation.
- **The comparative** (`was 37 in build 1`) is composed by V053's trigger from earlier attempts, and
  is never written by the parser.

## 6. Malformed input: partial results, never silent

Every class keeps whatever parsed successfully and attaches a typed warning to
`test_runs.parse_warnings`:

```json
{ "code": "…", "file": "…", "message": "…", "at": "…" }
```

| Code | Input | What is kept |
|---|---|---|
| `format_unrecognized` | no parser detects the file | the rest of the set |
| `xml_truncated` | XML ends mid-document | every element that closed |
| `xml_malformed` | XML not well-formed | every element before the fault |
| `junit_platform_missing` | a suite names no platform | its cases, under `unknown` |
| `hil_json_malformed` | the HIL file is not JSON | the rest of the set |
| `hil_schema_version_unknown` | a `schema_version` this build does not read | the rest of the set |
| `hil_schema_invalid` | a document, suite, case or bench breaks the schema | everything outside the smallest enclosing element |
| `hil_measurement_incomplete` | a measurement is missing a field, holds a bad one, or repeats a metric | the case's other measurements |
| `coverage_unreadable` | a report gives no line counts | other reports' counts |

A re-parse replaces the warnings along with the tree.

## 7. Re-parse is idempotent

Uploads get retried, so the write is a transactional **replacement by durable key**. The
`test_runs` row is locked `for update`, and the rows are upserted on these keys:

- suites on `(test_run_id, name, platform)`;
- cases on `(test_suite_id, case_key)`;
- measurements on `(test_case_id, metric)`.

Whatever the new parse no longer contains is deleted, then `ouroboros.test_run_recount()` rewrites
the totals from V051's counting views. Parsing the same set twice leaves the same ids and counts,
with no duplicates. Rows that cascade from a case (V055 classifications, V057 evidence) survive a
re-parse. A suite whose `results_format` changed is replaced whole, because the database freezes
that column.

`case_key` is computed with V051's recipe (`case-key.ts`), so it is stable across re-parses,
attempts and runs of one repository. The database re-derives it and refuses any disagreement.

## 8. Coverage

Each report reduces to `lines_covered` and `lines_total`. The parse **returns** them instead of
storing them, because V059 keeps them on the coverage `test_artifacts` row, which #330 inserts and
the database freezes. The summary uses V059's arithmetic:

- `percent` is `round(100 × covered / total, 1)` over all reports in the set.
- `delta` is the difference of the unrounded ratios against the latest earlier attempt of the run
  with coverage, rounded once.
- `delta` is **absent** (not zero) when there is no prior attempt.

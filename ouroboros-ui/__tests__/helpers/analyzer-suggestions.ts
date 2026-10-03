import type { AnalysisSuggestion, AnalysisSuggestions } from "@/app/api/analyzer";

/**
 * The Build Analyzer's seeded suggestion cards (#518) — what `GET /api/v1/analyzer/suggestions`
 * answers over the dev seed for `acme-robotics/helios-firmware`
 * (`R__dev_seed_workspace_metrics_analyzer.sql`, suggestions 11–16), transcribed from the service's
 * own answer and dated for the day these fixtures stand on (`ANALYZER_NOW` in `./analyzer`).
 *
 * Six rows, most confident first: mockup 18's four **build-process** suggestions (the test-gate
 * split, the ccache re-warm, the runner move and the link spike) and its two **workflow** ones
 * (review-first and the flake-retry stage) — each with its confidence basis, its impact basis, the
 * findings it cites and the first three of each finding's resolved evidence. `standard-fix` is at
 * v14 in the seed, so a workflow draft would become **v15**.
 *
 * Kept as the service's JSON, verbatim, rather than rebuilt from helpers: the cards' honesty
 * rules are about what the payload says, and a fixture assembled by the same hands as the view
 * would agree with it by construction.
 */

/** The seeded answer. Never handed out itself — {@link seededSuggestions} copies it. */
const SEEDED: AnalysisSuggestions = {
  "repo": "acme-robotics/helios-firmware",
  "runId": "5eed0065-0000-4000-8000-000000000002",
  "analyzedAt": "2026-10-02T18:00:00.000Z",
  "suggestions": [
    {
      "id": "5eed0067-0000-4000-8000-000000000011",
      "kind": "build_process",
      "title": "Split the test gate: native_sim every build, QEMU + HIL only before merge",
      "evidenceLine": "qemu_cortex_m3 caught 0 unique failures in 214 builds; HIL caught 9 — all at merge gates",
      "confidence": 91,
      "confidenceBasis": {
        "formula": "composer v1: round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target))",
        "inputs": {
          "template": "test_gate_split",
          "n": 62,
          "scale": 20,
          "support": 0.9549507976064422,
          "stability": 0.95,
          "effectSize": null,
          "effectTarget": null,
          "effect": 1
        }
      },
      "impact": {
        "estimate": -220,
        "unit": "seconds",
        "appliesTo": "per loop",
        "share": null,
        "basis": {
          "method": "extrapolated",
          "description": "the gated stages' measured pre-merge seconds per commit, which a PR stops paying, scaled by the workflow model's calibration",
          "sampleSize": null,
          "formula": "test_gate_split v1: -sum(pr_seconds_per_commit of the gated stages)",
          "inputs": {
            "HIL.pr_seconds_per_commit": 48,
            "qemu_cortex_m3.pr_seconds_per_commit": 158
          },
          "window": {
            "from": "2026-07-04",
            "to": "2026-10-01",
            "days": 90
          },
          "calibration": {
            "analyzer": "workflow_outcome",
            "impactClass": "duration_delta",
            "factor": 1.0682
          },
          "raw": -206
        }
      },
      "needsSpike": false,
      "plane": "test_gate",
      "workflow": null,
      "status": "open",
      "resolution": null,
      "measurement": null,
      "findings": [
        {
          "id": "5eed0066-0000-4000-8000-000000000172",
          "analyzer": "workflow_outcome",
          "analyzerVersion": 1,
          "findingType": "workflow_outcome",
          "subjectKey": "standard-fix/stage HIL/unique_failures",
          "data": {
            "unit": "count",
            "scope": "stage HIL",
            "value": 9,
            "metric": "unique_failures",
            "sample": 62,
            "workflow": "standard-fix",
            "co_stages": [
              "native_sim"
            ],
            "at_merge_gate": 9,
            "pr_seconds_per_commit": 48
          },
          "confidence": 90,
          "confidenceBasis": {
            "method": "workflow_outcome v1: failures a stage caught that no other stage of the same commit did",
            "sampleSize": 62,
            "effectSize": 0.145,
            "stability": 0.95
          },
          "evidence": [
            {
              "kind": "build",
              "id": "5eed0062-0000-4000-8000-000000010804",
              "label": "#10804 · HIL test rig",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "build",
              "id": "5eed0062-0000-4000-8000-000000010830",
              "label": "#10830 · HIL test rig",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "build",
              "id": "5eed0062-0000-4000-8000-000000010916",
              "label": "#10916 · HIL test rig",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 9
        },
        {
          "id": "5eed0066-0000-4000-8000-000000000171",
          "analyzer": "workflow_outcome",
          "analyzerVersion": 1,
          "findingType": "workflow_outcome",
          "subjectKey": "standard-fix/stage qemu_cortex_m3/unique_failures",
          "data": {
            "unit": "count",
            "scope": "stage qemu_cortex_m3",
            "value": 0,
            "metric": "unique_failures",
            "sample": 214,
            "workflow": "standard-fix",
            "co_stages": [
              "native_sim"
            ],
            "at_merge_gate": 0,
            "pr_seconds_per_commit": 158
          },
          "confidence": 91,
          "confidenceBasis": {
            "method": "workflow_outcome v1: failures a stage caught that no other stage of the same commit did",
            "sampleSize": 214,
            "effectSize": 0,
            "stability": 0.95
          },
          "evidence": [
            {
              "kind": "build",
              "id": "5eed0062-0000-4000-8000-000000010850",
              "label": "#10850 · qemu_cortex_m3",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "build",
              "id": "5eed0062-0000-4000-8000-000000010861",
              "label": "#10861 · qemu_cortex_m3",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "build",
              "id": "5eed0062-0000-4000-8000-000000010921",
              "label": "#10921 · qemu_cortex_m3",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 10
        }
      ]
    },
    {
      "id": "5eed0067-0000-4000-8000-000000000015",
      "kind": "workflow",
      "title": "standard-fix: run self-review BEFORE the build stage",
      "evidenceLine": "34% of failed builds in standard-fix loops contained defects the later self-review flagged anyway — reordering catches them pre-build",
      "confidence": 89,
      "confidenceBasis": {
        "formula": "composer v1: round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target))",
        "inputs": {
          "template": "review_first",
          "n": 50,
          "scale": 10,
          "support": 0.9932620530009145,
          "stability": 0.896,
          "effectSize": 0.34,
          "effectTarget": 0.3,
          "effect": 1
        }
      },
      "impact": {
        "estimate": -125,
        "unit": "seconds",
        "appliesTo": "per failed attempt",
        "share": null,
        "basis": {
          "method": "extrapolated",
          "description": "a failed build attempt's wall-clock, for the share review would have caught first",
          "sampleSize": null,
          "formula": "review_first v1: -attempt_seconds * share",
          "inputs": {
            "share": 0.34,
            "attempt_seconds": 368
          },
          "window": {
            "from": "2026-07-04",
            "to": "2026-10-01",
            "days": 90
          },
          "calibration": {
            "analyzer": "workflow_outcome",
            "impactClass": "attempt_duration",
            "factor": 1
          },
          "raw": -125.12
        }
      },
      "needsSpike": false,
      "plane": "workflow",
      "workflow": {
        "slug": "standard-fix",
        "nextVersion": 15,
        "studioPath": "/workflows/standard-fix"
      },
      "status": "open",
      "resolution": null,
      "measurement": null,
      "findings": [
        {
          "id": "5eed0066-0000-4000-8000-000000000173",
          "analyzer": "workflow_outcome",
          "analyzerVersion": 1,
          "findingType": "workflow_outcome",
          "subjectKey": "standard-fix/stage build→review/failed_builds_flagged_by_review",
          "data": {
            "unit": "share",
            "scope": "stage build → review",
            "value": 0.34,
            "metric": "failed_builds_flagged_by_review",
            "sample": 50,
            "workflow": "standard-fix",
            "build_stage": "build",
            "review_stage": "self-review",
            "attempt_seconds": 368
          },
          "confidence": 89,
          "confidenceBasis": {
            "method": "workflow_outcome v1: a stage's outcome over the window's loops",
            "sampleSize": 50,
            "effectSize": 0.34,
            "stability": 0.896
          },
          "evidence": [
            {
              "kind": "workflow_version",
              "id": "5eed001c-0000-4000-8000-010000000014",
              "label": "standard-fix v14",
              "surface": "workflow",
              "pullRequestId": null,
              "workflowSlug": "standard-fix",
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 1
        }
      ]
    },
    {
      "id": "5eed0067-0000-4000-8000-000000000012",
      "kind": "build_process",
      "title": "Re-warm ccache right after deps-refresh merges",
      "evidenceLine": "cache hit rate drops 78%→31% for ~6h after every deps-refresh merge (14 occurrences)",
      "confidence": 88,
      "confidenceBasis": {
        "formula": "composer v1: round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target))",
        "inputs": {
          "template": "ccache_rewarm",
          "n": 577,
          "scale": 50,
          "support": 0.9999902671130528,
          "stability": 0.936,
          "effectSize": 0.47,
          "effectTarget": 0.5,
          "effect": 0.94
        }
      },
      "impact": {
        "estimate": -110,
        "unit": "seconds",
        "appliesTo": "builds after a deps-refresh merge",
        "share": 0.2,
        "basis": {
          "method": "measured",
          "description": "the slowdown measured inside each window, scaled by the cache model's calibration",
          "sampleSize": 14,
          "formula": "ccache_rewarm v1: -slowdown_seconds",
          "inputs": {
            "slowdown_seconds": 168
          },
          "window": {
            "from": "2026-07-04",
            "to": "2026-10-01",
            "days": 90
          },
          "calibration": {
            "analyzer": "cache_window",
            "impactClass": "duration_delta",
            "factor": 0.6545
          },
          "raw": -168
        }
      },
      "needsSpike": false,
      "plane": "job_hook",
      "workflow": null,
      "status": "open",
      "resolution": null,
      "measurement": null,
      "findings": [
        {
          "id": "5eed0066-0000-4000-8000-000000000141",
          "analyzer": "cache_window",
          "analyzerVersion": 1,
          "findingType": "cache_window",
          "subjectKey": "deps-refresh merge",
          "data": {
            "share": 0.2,
            "pool_id": "5eed0024-0000-4000-8000-000000000001",
            "trigger": "deps-refresh merge",
            "occurrences": 14,
            "window_hours": 6,
            "trigger_title": "deps: refresh west manifest",
            "hit_rate_after": 0.31,
            "hit_rate_before": 0.78,
            "slowdown_seconds": 168
          },
          "confidence": 93,
          "confidenceBasis": {
            "method": "cache_window v1: the hit rate inside each trigger's window against the rest",
            "sampleSize": 577,
            "effectSize": 0.47,
            "stability": 0.936
          },
          "evidence": [
            {
              "kind": "merge",
              "id": "6aaacc1b11ff88fa9b1fbf688df9974565b34876",
              "label": "deps: refresh west manifest",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "merge",
              "id": "52f30bfadd1f01d1d69da9ecea11ca75136d9f85",
              "label": "deps: refresh west manifest",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "merge",
              "id": "37e2e5d2dace042bcabd31023a828a7bf22af4f2",
              "label": "deps: refresh west manifest",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 14
        }
      ]
    },
    {
      "id": "5eed0067-0000-4000-8000-000000000013",
      "kind": "build_process",
      "title": "Move forge-02 to pool-a during 14:00–16:00 UTC",
      "evidenceLine": "pool-a queue exceeds 5 min in that window on 11 of last 14 weekdays; pool-b sits idle 82% of it",
      "confidence": 84,
      "confidenceBasis": {
        "formula": "composer v1: round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target))",
        "inputs": {
          "template": "runner_move",
          "n": 14,
          "scale": 5,
          "support": 0.9391899373747821,
          "stability": 0.895,
          "effectSize": 0.786,
          "effectTarget": 0.75,
          "effect": 1
        }
      },
      "impact": {
        "estimate": -240,
        "unit": "seconds",
        "appliesTo": "queue p95",
        "share": null,
        "basis": {
          "method": "extrapolated",
          "description": "pool-a's window waits with forge-02 taking the backlog",
          "sampleSize": null,
          "formula": "runner_move v1: -wait_reduction_seconds",
          "inputs": {
            "wait_reduction_seconds": 240
          },
          "window": {
            "from": "2026-07-04",
            "to": "2026-10-01",
            "days": 90
          },
          "calibration": {
            "analyzer": "queue_correlation",
            "impactClass": "queue_wait",
            "factor": 1
          },
          "raw": -240
        }
      },
      "needsSpike": false,
      "plane": "farm_config",
      "workflow": null,
      "status": "open",
      "resolution": null,
      "measurement": null,
      "findings": [
        {
          "id": "5eed0066-0000-4000-8000-000000000151",
          "analyzer": "queue_correlation",
          "analyzerVersion": 1,
          "findingType": "queue_correlation",
          "subjectKey": "pool-a@14:00-16:00",
          "data": {
            "pool": "pool-a",
            "metric": "queue_wait",
            "window": {
              "to": "16:00",
              "from": "14:00"
            },
            "pool_id": "5eed0024-0000-4000-8000-000000000001",
            "idle_pool": "pool-b",
            "idle_share": 0.82,
            "idle_pool_id": "5eed0024-0000-4000-8000-000000000002",
            "days_exceeded": 11,
            "days_observed": 14,
            "move_runner_id": "5eed0025-0000-4000-8000-000000000002",
            "queue_p95_seconds": 420,
            "threshold_seconds": 300,
            "wait_reduction_seconds": 240
          },
          "confidence": 84,
          "confidenceBasis": {
            "method": "queue_correlation v1: weekdays whose longest pool-a wait in the window crossed the threshold, against the other pool's idle share",
            "sampleSize": 14,
            "effectSize": 0.786,
            "stability": 0.895
          },
          "evidence": [
            {
              "kind": "runner_pool",
              "id": "5eed0024-0000-4000-8000-000000000001",
              "label": "pool-a",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "runner_pool",
              "id": "5eed0024-0000-4000-8000-000000000002",
              "label": "pool-b",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "runner",
              "id": "5eed0025-0000-4000-8000-000000000002",
              "label": "forge-02",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 14
        }
      ]
    },
    {
      "id": "5eed0067-0000-4000-8000-000000000016",
      "kind": "workflow",
      "title": "Loops touching drivers/can/: add a 'flake-retry under load profile' test stage",
      "evidenceLine": "merges touching drivers/can are 3.1× more likely to flake the telemetry suite within 7 days (21 cases)",
      "confidence": 77,
      "confidenceBasis": {
        "formula": "composer v1: round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target))",
        "inputs": {
          "template": "flake_retry_stage",
          "n": 21,
          "scale": 10,
          "support": 0.8775435717470181,
          "stability": 0.878,
          "effectSize": 3.1,
          "effectTarget": 2,
          "effect": 1
        }
      },
      "impact": {
        "estimate": -1,
        "unit": "interventions",
        "appliesTo": "per week",
        "share": null,
        "basis": {
          "method": "extrapolated",
          "description": "the excess flakes over the baseline that reach a person each week, retried under load first",
          "sampleSize": null,
          "formula": "flake_retry_stage v1: -(rate - baseline) * cases * 7 / window days",
          "inputs": {
            "rate": 0.62,
            "cases": 21,
            "baseline": 0.2,
            "window_days": 90
          },
          "window": {
            "from": "2026-07-04",
            "to": "2026-10-01",
            "days": 90
          },
          "calibration": {
            "analyzer": "workflow_outcome",
            "impactClass": "interventions",
            "factor": 1
          },
          "raw": -0.686
        }
      },
      "needsSpike": false,
      "plane": "workflow",
      "workflow": {
        "slug": "standard-fix",
        "nextVersion": 15,
        "studioPath": "/workflows/standard-fix"
      },
      "status": "open",
      "resolution": null,
      "measurement": null,
      "findings": [
        {
          "id": "5eed0066-0000-4000-8000-000000000174",
          "analyzer": "workflow_outcome",
          "analyzerVersion": 1,
          "findingType": "workflow_outcome",
          "subjectKey": "standard-fix/drivers-can/telemetry_flake_ratio_7d",
          "data": {
            "rate": 0.62,
            "unit": "ratio",
            "scope": "merges touching drivers/can",
            "suite": "telemetry",
            "value": 3.1,
            "metric": "telemetry_flake_ratio_7d",
            "sample": 21,
            "baseline": 0.2,
            "workflow": "standard-fix"
          },
          "confidence": 77,
          "confidenceBasis": {
            "method": "workflow_outcome v1: a stage's outcome over the window's loops",
            "sampleSize": 21,
            "effectSize": 3.1,
            "stability": 0.878
          },
          "evidence": [
            {
              "kind": "merge",
              "id": "070ef9d63545abdd57c654192a002912dd2ecf91",
              "label": "can: bus-off recovery with backoff",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "merge",
              "id": "1ad1ba5cb805810baf727abc1e6c7d0eb94300eb",
              "label": "can: driver timeout tweak",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "merge",
              "id": "2f2c0397ff0ae462fb859af368006509ac952974",
              "label": "can: filter table for the telemetry IDs",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 4
        }
      ]
    },
    {
      "id": "5eed0067-0000-4000-8000-000000000014",
      "kind": "build_process",
      "title": "Link zephyr.elf incrementally (partial link cache)",
      "evidenceLine": "link step grew from 18% to 42% of build time since v2.3 (LTO enabled)",
      "confidence": 72,
      "confidenceBasis": {
        "formula": "composer v1: round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target))",
        "inputs": {
          "template": "link_cache",
          "n": 525,
          "scale": 50,
          "support": 0.9999724635506503,
          "stability": 0.751,
          "effectSize": 0.24,
          "effectTarget": 0.25,
          "effect": 0.96
        }
      },
      "impact": {
        "estimate": -55,
        "unit": "seconds",
        "appliesTo": "per build",
        "share": null,
        "basis": {
          "method": "extrapolated",
          "description": "the link step's growth, if a partial link cache won half of it back",
          "sampleSize": null,
          "formula": "link_cache v1: -step_seconds_delta * 0.5",
          "inputs": {
            "step_seconds_delta": 110
          },
          "window": {
            "from": "2026-07-04",
            "to": "2026-10-01",
            "days": 90
          },
          "calibration": {
            "analyzer": "workflow_outcome",
            "impactClass": "build_duration",
            "factor": 1
          },
          "raw": -55
        }
      },
      "needsSpike": true,
      "plane": "planning",
      "workflow": null,
      "status": "open",
      "resolution": null,
      "measurement": null,
      "findings": [
        {
          "id": "5eed0066-0000-4000-8000-000000000175",
          "analyzer": "workflow_outcome",
          "analyzerVersion": 1,
          "findingType": "workflow_outcome",
          "subjectKey": "zephyr build/step link/link_share",
          "data": {
            "unit": "share",
            "scope": "step link",
            "since": "v2.3 (LTO enabled)",
            "value": 0.42,
            "before": 0.18,
            "metric": "link_share",
            "sample": 525,
            "artifact": "zephyr.elf",
            "workflow": "zephyr build",
            "step_seconds_delta": 110
          },
          "confidence": 72,
          "confidenceBasis": {
            "method": "workflow_outcome v1: a stage's outcome over the window's loops",
            "sampleSize": 525,
            "effectSize": 0.24,
            "stability": 0.751
          },
          "evidence": [
            {
              "kind": "merge",
              "id": "9569e4611741397c7b1eead4593e36cc09f43556",
              "label": "v2.3: enable LTO for release images",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 1
        }
      ]
    }
  ],
  "calibration": [
    {
      "analyzer": "cache_window",
      "impactClass": "duration_delta",
      "factor": 0.6545,
      "sampleCount": 1,
      "updatedAt": "2026-09-17T03:00:00.000Z",
      "history": [
        {
          "fromFactor": 1,
          "toFactor": 0.6545,
          "sampleCount": 1,
          "measuredSum": -72,
          "predictedSum": -110,
          "measurementIds": [
            "5eed0069-0000-4000-8000-000000000002"
          ],
          "addedMeasurementIds": [
            "5eed0069-0000-4000-8000-000000000002"
          ],
          "createdAt": "2026-09-17T03:00:00.000Z"
        }
      ]
    },
    {
      "analyzer": "workflow_outcome",
      "impactClass": "duration_delta",
      "factor": 1.0682,
      "sampleCount": 1,
      "updatedAt": "2026-09-10T03:00:00.000Z",
      "history": [
        {
          "fromFactor": 1,
          "toFactor": 1.0682,
          "sampleCount": 1,
          "measuredSum": -235,
          "predictedSum": -220,
          "measurementIds": [
            "5eed0069-0000-4000-8000-000000000001"
          ],
          "addedMeasurementIds": [
            "5eed0069-0000-4000-8000-000000000001"
          ],
          "createdAt": "2026-09-10T03:00:00.000Z"
        }
      ]
    }
  ]
};

/** The six seeded suggestions' ids, by what each is about. */
export const SUGGESTION = {
  gate: "5eed0067-0000-4000-8000-000000000011",
  ccache: "5eed0067-0000-4000-8000-000000000012",
  move: "5eed0067-0000-4000-8000-000000000013",
  link: "5eed0067-0000-4000-8000-000000000014",
  review: "5eed0067-0000-4000-8000-000000000015",
  flake: "5eed0067-0000-4000-8000-000000000016",
} as const;

/**
 * The seeded suggestion cards, or a variant.
 *
 * @param change Rewrites one suggestion — return it changed — or leaves it alone.
 * @returns A fresh copy of the seeded answer, every suggestion passed through `change`.
 */
export function seededSuggestions(
  change: (suggestion: AnalysisSuggestion) => AnalysisSuggestion = (suggestion) => suggestion,
): AnalysisSuggestions {
  const copy = structuredClone(SEEDED);

  return { ...copy, suggestions: copy.suggestions.map(change) };
}

/**
 * One seeded suggestion.
 *
 * @param id Its id — one of {@link SUGGESTION}.
 * @param over Fields to replace.
 * @returns A fresh copy of it.
 */
export function seededSuggestion(id: string, over: Partial<AnalysisSuggestion> = {}): AnalysisSuggestion {
  const found = structuredClone(SEEDED).suggestions.find((suggestion) => suggestion.id === id);
  if (found === undefined) throw new Error(`no seeded suggestion ${id}`);

  return { ...found, ...over };
}

/**
 * The cards of a repository no analysis has composed a suggestion for.
 *
 * @param repo The repository.
 * @returns The empty answer.
 */
export function emptySuggestions(repo: string = SEEDED.repo): AnalysisSuggestions {
  return { repo, runId: null, analyzedAt: null, suggestions: [], calibration: [] };
}

/**
 * A suggestion as resolved — applied with its measurement, dismissed, or drafted.
 *
 * @param id The seeded suggestion.
 * @param status How it was resolved.
 * @param over Fields of the resolution to replace.
 * @returns The seeded answer with that one suggestion resolved.
 */
export function resolvedSuggestions(
  id: string,
  status: "applied" | "dismissed" | "drafted",
  over: Partial<NonNullable<AnalysisSuggestion["resolution"]>> = {},
): AnalysisSuggestions {
  return seededSuggestions((suggestion) =>
    suggestion.id !== id
      ? suggestion
      : {
          ...suggestion,
          status,
          resolution: {
            at: "2026-10-02T19:00:00.000Z",
            by: "Ken Suenobu",
            reason: null,
            draftBatchId: status === "drafted" ? "5eed006a-0000-4000-8000-000000000002" : null,
            ...over,
          },
          measurement:
            status === "applied"
              ? {
                  id: "5eed0069-0000-4000-8000-000000000013",
                  appliedOn: "2026-10-02",
                  day: 0,
                  windowDays: 14,
                  windowEndsOn: "2026-10-16",
                  verdict: "pending",
                }
              : null,
        },
  );
}

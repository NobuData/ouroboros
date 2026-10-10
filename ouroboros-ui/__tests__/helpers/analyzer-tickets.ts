import type {
  AnalysisTicketBatch,
  AnalysisTickets,
  AnalysisUndraftedTicket,
  AnalyzerPushReport,
} from "@/app/api/analyzer";
import type { PlanningBatch, PlanningDraft } from "@/app/api/planning";

/**
 * The Build Analyzer's seeded drafted-tickets card (#519) — what `GET /api/v1/analyzer/tickets`
 * answers over the dev seed for `acme-robotics/helios-firmware`
 * (`R__dev_seed_workspace_metrics_analyzer.sql`, the `analyzer-v1` batch), transcribed from the
 * service's own answer and dated for the day these fixtures stand on (`ANALYZER_NOW` in
 * `./analyzer`).
 *
 * One batch, `sized`, of mockup 18's four drafts — `BA-1` M, `BA-2` XS, `BA-3` L, `BA-4` S, every
 * one selected and none pushed — whose estimates sum to 2,160 minutes: the mockup's `~1.5 days`.
 * Each draft's body is the one the composer writes, and beside each is the evidence the service
 * read back out of it.
 *
 * Kept as the service's JSON rather than rebuilt from helpers, with one cut made for length: each
 * body's reference list and each draft's resolved `evidence` hold their **first three**, while
 * `evidenceTotal` keeps the real count (31, 118, 3 and 5) — which is also what a capped read
 * looks like.
 */

/** The seeded answer. Never handed out itself — {@link seededTickets} copies it. */
const SEEDED: AnalysisTickets = {
  "repo": "acme-robotics/helios-firmware",
  "undrafted": [],
  "batches": [
    {
      "batch": {
        "id": "5eed006a-0000-4000-8000-000000000001",
        "status": "sized",
        "planner": "analyzer-v1",
        "prompt": "Build Analyzer: tickets drafted from the patterns in acme-robotics/helios-firmware's last 90 days of builds",
        "outline": null,
        "targetSourceId": "5eed001a-0000-4000-8000-000000000001",
        "milestone": null,
        "epicId": null,
        "autoSize": true,
        "queueSmall": false,
        "createdAt": "2026-10-02T18:00:00.000Z",
        "updatedAt": "2026-10-02T18:01:20.000Z",
        "drafts": [
          {
            "id": "5eed006b-0000-4000-8000-000000000001",
            "localKey": "BA-1",
            "title": "Refactor tests/ota fixtures — shared setup times out under load",
            "body": "**Evidence:** 7.2% of OTA suite failures share one fixture timeout signature (31 builds)\n\n**References:**\n- build `5eed0062-0000-4000-8000-000000010521`\n- build `5eed0062-0000-4000-8000-000000010522`\n- build `5eed0062-0000-4000-8000-000000010543`\n\nDrafted by the Build Analyzer from suggestion `5eed0067-0000-4000-8000-000000000021` (confidence 86%) over acme-robotics/helios-firmware, analysis run `5eed0065-0000-4000-8000-000000000002`.",
            "selected": true,
            "suggestedWorkflow": "standard-fix",
            "provenance": "planned",
            "milestone": null,
            "labels": [],
            "research": null,
            "dependencies": [],
            "blockedByTicketIds": [],
            "pushState": "pending",
            "pushedTicketId": null,
            "pushedTicket": null,
            "pushError": null,
            "estimate": {
              "effort": "m",
              "confidence": 84,
              "estMinutes": 660,
              "estTokens": 600000,
              "routedModel": "claude-sonnet-5",
              "estimator": "heuristic-v0",
              "version": 1
            }
          },
          {
            "id": "5eed006b-0000-4000-8000-000000000002",
            "localKey": "BA-2",
            "title": "Bump ccache 4.9 → 4.11 — upstream fixes the hash misses in our logs",
            "body": "**Evidence:** cache-miss signature matches ccache issue #1412 in 118 builds\n\n**References:**\n- build `5eed0062-0000-4000-8000-000000010631`\n- build `5eed0062-0000-4000-8000-000000010636`\n- build `5eed0062-0000-4000-8000-000000010641`\n\nDrafted by the Build Analyzer from suggestion `5eed0067-0000-4000-8000-000000000022` (confidence 90%) over acme-robotics/helios-firmware, analysis run `5eed0065-0000-4000-8000-000000000002`.",
            "selected": true,
            "suggestedWorkflow": "deps-refresh",
            "provenance": "planned",
            "milestone": null,
            "labels": [],
            "research": null,
            "dependencies": [],
            "blockedByTicketIds": [],
            "pushState": "pending",
            "pushedTicketId": null,
            "pushedTicket": null,
            "pushError": null,
            "estimate": {
              "effort": "xs",
              "confidence": 95,
              "estMinutes": 120,
              "estTokens": 40000,
              "routedModel": "qwen3-coder:32b",
              "estimator": "heuristic-v0",
              "version": 1
            }
          },
          {
            "id": "5eed006b-0000-4000-8000-000000000003",
            "localKey": "BA-3",
            "title": "Add thermal chamber to rig helios-rig-02",
            "body": "**Evidence:** 3 verification waivers in 60 days cite missing thermal coverage\n\n**References:**\n- waiver `5eed006d-0000-4000-8000-000000000290`\n- waiver `5eed006d-0000-4000-8000-000000000292`\n- waiver `5eed006d-0000-4000-8000-000000000294`\n\nDrafted by the Build Analyzer from suggestion `5eed0067-0000-4000-8000-000000000023` (confidence 82%) over acme-robotics/helios-firmware, analysis run `5eed0065-0000-4000-8000-000000000002`.",
            "selected": true,
            "suggestedWorkflow": "feature-loop",
            "provenance": "planned",
            "milestone": null,
            "labels": [],
            "research": null,
            "dependencies": [],
            "blockedByTicketIds": [],
            "pushState": "pending",
            "pushedTicketId": null,
            "pushedTicket": null,
            "pushError": null,
            "estimate": {
              "effort": "l",
              "confidence": 71,
              "estMinutes": 1020,
              "estTokens": 500000,
              "routedModel": "claude-fable-5",
              "estimator": "heuristic-v0",
              "version": 1
            }
          },
          {
            "id": "5eed006b-0000-4000-8000-000000000004",
            "localKey": "BA-4",
            "title": "Delete 12 dead Kconfig options — never set in any build since July",
            "body": "**Evidence:** 0 of 1,284 builds toggled them; 4 caused config-drift warnings\n\n**References:**\n- build `5eed0062-0000-4000-8000-000000010114`\n- build `5eed0062-0000-4000-8000-000000010217`\n- build `5eed0062-0000-4000-8000-000000010309`\n\nDrafted by the Build Analyzer from suggestion `5eed0067-0000-4000-8000-000000000024` (confidence 93%) over acme-robotics/helios-firmware, analysis run `5eed0065-0000-4000-8000-000000000002`.",
            "selected": true,
            "suggestedWorkflow": "standard-fix",
            "provenance": "planned",
            "milestone": null,
            "labels": [],
            "research": null,
            "dependencies": [],
            "blockedByTicketIds": [],
            "pushState": "pending",
            "pushedTicketId": null,
            "pushedTicket": null,
            "pushError": null,
            "estimate": {
              "effort": "s",
              "confidence": 90,
              "estMinutes": 360,
              "estTokens": 200000,
              "routedModel": "claude-sonnet-5",
              "estimator": "heuristic-v0",
              "version": 1
            }
          }
        ],
        "summary": {
          "draftCount": 4,
          "selectedCount": 4,
          "sizedCount": 4,
          "allSized": true,
          "estimators": [
            "heuristic-v0"
          ],
          "estMinutes": 2160,
          "loopDays": 1.5,
          "spend": {
            "cents": 660,
            "display": "$6.60",
            "partial": false
          }
        }
      },
      "drafts": [
        {
          "localKey": "BA-1",
          "evidenceLine": "7.2% of OTA suite failures share one fixture timeout signature (31 builds)",
          "evidence": [
            {
              "kind": "build",
              "id": "5eed0062-0000-4000-8000-000000010521",
              "label": "#10521 · native_sim",
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
              "id": "5eed0062-0000-4000-8000-000000010522",
              "label": "#10522 · native_sim",
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
              "id": "5eed0062-0000-4000-8000-000000010543",
              "label": "#10543 · native_sim",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 31
        },
        {
          "localKey": "BA-2",
          "evidenceLine": "cache-miss signature matches ccache issue #1412 in 118 builds",
          "evidence": [
            {
              "kind": "build",
              "id": "5eed0062-0000-4000-8000-000000010631",
              "label": "#10631 · qemu_cortex_m3",
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
              "id": "5eed0062-0000-4000-8000-000000010636",
              "label": "#10636 · zephyr build",
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
              "id": "5eed0062-0000-4000-8000-000000010641",
              "label": "#10641 · zephyr build",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 118
        },
        {
          "localKey": "BA-3",
          "evidenceLine": "3 verification waivers in 60 days cite missing thermal coverage",
          "evidence": [
            {
              "kind": "waiver",
              "id": "5eed006d-0000-4000-8000-000000000290",
              "label": "helios-rig-02 has no thermal chamber — littlefs superblock recovery on a cold boot is unverified",
              "surface": "test_results",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": "5eed0009-0000-4000-8000-000000000290",
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "waiver",
              "id": "5eed006d-0000-4000-8000-000000000292",
              "label": "thermal coverage missing on helios-rig-02: BLE pairing at 70 °C cannot be run on the bench",
              "surface": "test_results",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": "5eed0009-0000-4000-8000-000000000292",
              "attempt": null,
              "suiteName": null,
              "caseName": null
            },
            {
              "kind": "waiver",
              "id": "5eed006d-0000-4000-8000-000000000294",
              "label": "no thermal chamber on helios-rig-02 — the MCUboot swap at −20 °C was not exercised",
              "surface": "test_results",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": "5eed0009-0000-4000-8000-000000000294",
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 3
        },
        {
          "localKey": "BA-4",
          "evidenceLine": "0 of 1,284 builds toggled them; 4 caused config-drift warnings",
          "evidence": [
            {
              "kind": "build",
              "id": "5eed0062-0000-4000-8000-000000010114",
              "label": "#10114 · zephyr build",
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
              "id": "5eed0062-0000-4000-8000-000000010217",
              "label": "#10217 · zephyr build",
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
              "id": "5eed0062-0000-4000-8000-000000010309",
              "label": "#10309 · zephyr build",
              "surface": "farm",
              "pullRequestId": null,
              "workflowSlug": null,
              "runId": null,
              "attempt": null,
              "suiteName": null,
              "caseName": null
            }
          ],
          "evidenceTotal": 5
        }
      ]
    }
  ]
};

/** The seeded analyzer batch's id. */
export const TICKETS_BATCH_ID = "5eed006a-0000-4000-8000-000000000001";

/** The seeded GitHub source the batch targets — `SEEDED_GITHUB_ID` in `./sources`. */
export const TICKETS_SOURCE_ID = "5eed001a-0000-4000-8000-000000000001";

/** The four drafts' titles, by key, as mockup 18 prints them. */
export const TICKET_TITLES = {
  "BA-1": "Refactor tests/ota fixtures — shared setup times out under load",
  "BA-2": "Bump ccache 4.9 → 4.11 — upstream fixes the hash misses in our logs",
  "BA-3": "Add thermal chamber to rig helios-rig-02",
  "BA-4": "Delete 12 dead Kconfig options — never set in any build since July",
} as const;

/** The four drafts' evidence lines, by key, as mockup 18 prints them. */
export const TICKET_EVIDENCE = {
  "BA-1": "7.2% of OTA suite failures share one fixture timeout signature (31 builds)",
  "BA-2": "cache-miss signature matches ccache issue #1412 in 118 builds",
  "BA-3": "3 verification waivers in 60 days cite missing thermal coverage",
  "BA-4": "0 of 1,284 builds toggled them; 4 caused config-drift warnings",
} as const;

/**
 * The seeded card, or a variant.
 *
 * @param change Changes the copy in place — a tick, a push state, an un-drafted suggestion.
 * @returns A fresh copy of the seeded answer, changed.
 */
export function seededTickets(change: (tickets: AnalysisTickets) => void = () => {}): AnalysisTickets {
  const copy = structuredClone(SEEDED);

  change(copy);

  return copy;
}

/**
 * The card of a repository no analysis has composed a ticket for.
 *
 * @param repo The repository.
 * @returns The empty card.
 */
export function emptyTickets(repo: string = SEEDED.repo): AnalysisTickets {
  return { repo, undrafted: [], batches: [] };
}

/**
 * The seeded batch with its drafts changed — and its footer kept true to them: the counts and the
 * summed minutes are recomputed the way the service computes them, so a fixture never shows a
 * total its rows do not add up to.
 *
 * The seeded `spend` is left off the recomputed footer: it is the planning page's to draw, and
 * this card draws the loop time alone.
 *
 * @param change What changes about each draft; return nothing to leave one alone.
 * @param over Fields of the batch itself to replace — its `status`, say.
 * @returns The batch as planning would answer it.
 */
export function seededBatch(
  change: (draft: PlanningDraft) => Partial<PlanningDraft> | undefined = () => undefined,
  over: Partial<PlanningBatch> = {},
): PlanningBatch {
  const batch = structuredClone(SEEDED.batches[0]!.batch);
  const drafts = batch.drafts.map((draft) => ({ ...draft, ...change(draft) }));
  const selected = drafts.filter((draft) => draft.selected);
  const sized = selected.filter((draft) => draft.estimate !== null);
  const estMinutes = sized.reduce((sum, draft) => sum + (draft.estimate?.estMinutes ?? 0), 0);

  return {
    ...batch,
    drafts,
    summary: {
      draftCount: drafts.length,
      selectedCount: selected.length,
      sizedCount: sized.length,
      allSized: selected.length > 0 && sized.length === selected.length,
      estimators: sized.length === 0 ? [] : ["heuristic-v0"],
      estMinutes,
      loopDays: Math.round((estMinutes / 1440) * 10) / 10,
    },
    ...over,
  };
}

/**
 * The seeded card with its batch replaced — the evidence beside each draft kept as seeded.
 *
 * @param batch The batch to draw.
 * @returns The card.
 */
export function ticketsWith(batch: PlanningBatch): AnalysisTickets {
  return seededTickets((tickets) => {
    tickets.batches[0]!.batch = batch;
  });
}

/**
 * One entry of the card for another batch — a second group.
 *
 * @param id The batch's id.
 * @param createdAt When it was drafted.
 * @returns The seeded batch under that id and date, with its evidence.
 */
export function anotherBatch(id: string, createdAt: string): AnalysisTicketBatch {
  const entry = structuredClone(SEEDED.batches[0]!);

  return { ...entry, batch: { ...entry.batch, id, createdAt } };
}

/** A ticket suggestion nobody has drafted yet — or a variant. */
export function undraftedTicket(over: Partial<AnalysisUndraftedTicket> = {}): AnalysisUndraftedTicket {
  return {
    id: "5eed0067-0000-4000-8000-000000000025",
    title: "Pin the west manifest — nightly fetches drift between runners",
    evidenceLine: "9 builds in 30 days failed on a manifest revision another runner never saw",
    confidence: 77,
    evidence: structuredClone(SEEDED.batches[0]!.drafts[0]!.evidence).slice(0, 2),
    evidenceTotal: 9,
    ...over,
  };
}

/**
 * What a pushed draft carries: its state, and the tracker's ticket.
 *
 * @param number The issue's number in the tracker — `621`.
 * @returns The fields a push sets on a draft.
 */
export function landed(number: number): Partial<PlanningDraft> {
  return {
    pushState: "pushed",
    pushedTicketId: `5eed0030-0000-4000-8000-${String(number).padStart(12, "0")}`,
    pushedTicket: {
      externalId: String(number),
      externalKey: `#${number}`,
      url: `https://github.com/acme-robotics/helios-firmware/issues/${number}`,
    },
    pushError: null,
  };
}

/**
 * What a draft the tracker refused carries.
 *
 * @param message The tracker's sentence.
 * @returns The fields a failed push sets on a draft.
 */
export function refused(message: string): Partial<PlanningDraft> {
  return { pushState: "failed", pushError: { code: "provider_refused", message } };
}

/**
 * The report of a push that left a batch as given — every selected draft with the state the batch
 * holds for it, so a report and the batch beside it never disagree.
 *
 * @param batch The batch after the push.
 * @param over Fields to replace — `outcome: "throttled"` with its `retryAt`, say.
 * @returns The report.
 */
export function pushReport(batch: PlanningBatch, over: Partial<AnalyzerPushReport> = {}): AnalyzerPushReport {
  const selected = batch.drafts.filter((draft) => draft.selected);
  const pushed = selected.filter((draft) => draft.pushState === "pushed");

  return {
    batchId: batch.id,
    outcome: pushed.length === selected.length ? "pushed" : "partial",
    batchStatus: batch.status,
    pushedThisRun: pushed.length,
    links: { native: 0, fallback: 0 },
    retryAt: null,
    milestone: null,
    epic: null,
    drafts: selected.map((draft) => ({
      draftId: draft.id,
      localKey: draft.localKey,
      pushState: draft.pushState,
      ticketId: draft.pushedTicketId,
      ticket: draft.pushedTicket,
      error: draft.pushError,
    })),
    ...over,
  };
}

#!/usr/bin/env node
/**
 * Open a **live-origin** run for the run-console screenshots (DJ.4, #1317).
 *
 * `user-guide.run.live` describes a live loop, so it is captured from a run whose origin is
 * `live` — opened through the real ingestion contract (AP.1) by the executor's principal, the
 * way a real executor opens one — not from the seed's demo run or the run simulator's (which
 * refuses to drive a run the control plane records as real).
 *
 * **A throwaway, seeded stack only** (`yarn screenshots` runs against one). The run it opens is
 * scripted here, so it is made only where nothing else reads it.
 *
 * Usage, against the isolated stack's REST:
 *
 *   OURO_REST_URL=http://localhost:4116 OURO_ENGINE_SHARED_SECRET=… node screenshots/live-run.mjs
 *
 * It prints the run id; point the manifest entry's route at `/runs/<id>?from=dashboard`. The run
 * is left on attempt 2 of `implement`, running, so the console draws its controls.
 */

import { randomUUID } from "node:crypto";

const REST = process.env.OURO_REST_URL ?? "http://localhost:4000";
const SECRET = process.env.OURO_ENGINE_SHARED_SECRET;

if (!SECRET) {
  console.error("live-run: OURO_ENGINE_SHARED_SECRET is required — the executor's secret.");
  process.exit(2);
}

/** The seeded #482 and the workflow it pins (R__dev_seed*.sql). */
const TARGET = {
  ticket: { source: "5eed001a-0000-4000-8000-000000000001", externalKey: "#482" },
  repository: "5eed0006-0000-4000-8000-000000000001",
  workflow: { tag: "standard-fix", version: 14 },
  model: "claude-fable-5",
  branchName: "loop/482-canbus-flake",
};

/**
 * POST one ingestion write as the executor.
 *
 * @param {string} path The internal path.
 * @param {Record<string, unknown>} body The request, without its idempotency key.
 * @returns {Promise<Record<string, unknown>>} The answer.
 */
async function post(path, body) {
  const response = await fetch(`${REST}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ouro-internal-key": SECRET },
    body: JSON.stringify({ idempotencyKey: `docs-live-${randomUUID()}`, ...body }),
  });
  const text = await response.text();

  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${text}`);

  return text === "" ? {} : JSON.parse(text);
}

const run = await post("/internal/runs", TARGET);
const id = String(run.id);
const stage = (stageKey, status, attempt) =>
  post(`/internal/runs/${id}/stage-transitions`, { stageKey, status, ...(attempt ? { attempt } : {}) });
let hint = 0;
const say = (events) =>
  post(`/internal/runs/${id}/events`, {
    events: events.map((event) => ({ hint: ++hint, ...event })),
  });

await stage("issue-queued", "active");
await stage("issue-queued", "succeeded");
await stage("analyze", "active");
await say([
  { actor: "system", stageKey: "analyze", attempt: 1, body: "Picked up #482 from the queue." },
  { actor: "tool", stageKey: "analyze", attempt: 1, toolTag: "read_file", body: "drivers/can/telemetry_buf.c" },
  {
    actor: "model",
    stageKey: "analyze",
    attempt: 1,
    modelId: TARGET.model,
    body: "The telemetry ring buffer is written from the ISR without a barrier; frames reorder under load.",
  },
]);
await stage("analyze", "succeeded");
await stage("effort-recheck", "active");
await stage("effort-recheck", "succeeded");
await stage("split", "skipped");
await stage("back-to-queue", "skipped");
await stage("plan", "active");
await say([
  {
    actor: "plan",
    stageKey: "plan",
    attempt: 1,
    body: "Order frame writes with a release barrier in the ISR fast path, and add a regression test.",
  },
]);
await stage("plan", "succeeded");
await stage("implement", "active", 1);
await say([
  { actor: "tool", stageKey: "implement", attempt: 1, toolTag: "edit_file", body: "drivers/can/isr_fastpath.c" },
  { actor: "gate", stageKey: "implement", attempt: 1, body: "Tests failed: test_telemetry_order (1 of 48)." },
]);
await stage("implement", "failed", 1);
await stage("implement", "active", 2);
await say([
  {
    actor: "model",
    stageKey: "implement",
    attempt: 2,
    modelId: TARGET.model,
    body: "The failure is the consumer side: read the head index with acquire ordering before the payload.",
  },
  { actor: "tool", stageKey: "implement", attempt: 2, toolTag: "edit_file", body: "drivers/can/telemetry_buf.c" },
]);

console.log(id);

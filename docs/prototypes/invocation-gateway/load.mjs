/**
 * The load generator: many concurrent streamed calls against one path, timed per token.
 *
 * Closed loop: `--concurrency` workers each start a call, read it to the end, and start the
 * next, for `--seconds`. Every call records its time to first token (TTFT) and its total
 * time; the run reports their percentiles, the aggregate token throughput, and the CPU the
 * gateway processes spent (read from `/proc`, so Linux only).
 *
 * Usage:
 *   node load.mjs --url URL --format sse|ndjson --concurrency N --seconds S [--pids 1,2] [--label L]
 *
 *   sse     an OpenAI-compatible `/chat/completions` stream — the provider itself, or LiteLLM
 *   ndjson  the relay's `/internal/llm/invoke` stream, in `invoke.contract.ts`'s events
 *
 * Prints one JSON line with the figures, so `run.sh` can collect them into a table.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Agent, setGlobalDispatcher } from "undici";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    format: { type: "string", default: "sse" },
    concurrency: { type: "string", default: "1" },
    seconds: { type: "string", default: "10" },
    pids: { type: "string", default: "" },
    label: { type: "string", default: "" },
    model: { type: "string", default: "bench" },
  },
});

const CONCURRENCY = Number(values.concurrency);
const SECONDS = Number(values.seconds);
const PIDS = values.pids === "" ? [] : values.pids.split(",").map(Number);
const CLOCK_TICKS = 100; // USER_HZ on Linux

setGlobalDispatcher(new Agent({ keepAliveTimeout: 60_000, connections: null }));

/**
 * CPU seconds a process and its threads have used so far.
 *
 * @param {number} pid - The process.
 * @returns {number} User plus system time, in seconds; 0 when the process is gone.
 */
function cpuSeconds(pid) {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");

    return (Number(fields[11]) + Number(fields[12])) / CLOCK_TICKS;
  } catch {
    return 0;
  }
}

/**
 * The value at a percentile of a sorted list.
 *
 * @param {number[]} sorted - Ascending values.
 * @param {number} p - The percentile, 0–100.
 * @returns {number | null} The value, or null for an empty list.
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;

  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/**
 * Make one streamed call and time it.
 *
 * @returns {Promise<{ ttft: number, total: number, tokens: number } | { error: string }>}
 *   The call's timings, or why it failed.
 */
async function oneCall() {
  const started = performance.now();
  const body =
    values.format === "ndjson"
      ? { payload: { messages: [{ role: "user", content: "hi" }] }, runCtx: { run: "bench" } }
      : {
          model: values.model,
          stream: true,
          stream_options: { include_usage: true },
          messages: [{ role: "user", content: "hi" }],
        };

  try {
    const response = await fetch(values.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-bench" },
      body: JSON.stringify(body),
    });

    if (!response.ok || response.body === null) return { error: `status ${response.status}` };

    const decoder = new TextDecoder();
    let buffer = "";
    let ttft = null;
    let tokens = 0;
    let failed = null;

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });

      const separator = values.format === "ndjson" ? "\n" : "\n\n";
      const parts = buffer.split(separator);

      buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (values.format === "ndjson") {
          if (part === "") continue;

          const event = JSON.parse(part);

          if (event.kind === "delta") tokens += 1;
          if (event.kind === "error") failed = event.code;
        } else {
          const line = part.split("\n").find((one) => one.startsWith("data:"));

          if (line === undefined) continue;

          const payload = line.slice(5).trim();

          if (payload === "[DONE]") continue;

          const content = JSON.parse(payload).choices?.[0]?.delta?.content;

          if (typeof content === "string" && content !== "") tokens += 1;
        }

        if (tokens === 1 && ttft === null) ttft = performance.now() - started;
      }
    }

    if (failed !== null) return { error: failed };
    if (tokens === 0) return { error: "no tokens" };

    return { ttft, total: performance.now() - started, tokens };
  } catch (error) {
    return { error: String(error?.cause?.code ?? error?.message ?? error) };
  }
}

const deadline = performance.now() + SECONDS * 1000;
const cpuBefore = PIDS.map(cpuSeconds);
const wallStarted = performance.now();
const results = [];

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (performance.now() < deadline) results.push(await oneCall());
  }),
);

const wall = (performance.now() - wallStarted) / 1000;
const cpu = PIDS.reduce((sum, pid, index) => sum + cpuSeconds(pid) - cpuBefore[index], 0);
const ok = results.filter((result) => !("error" in result));
const errors = results.length - ok.length;
const ttfts = ok.map((result) => result.ttft).sort((a, b) => a - b);
const totals = ok.map((result) => result.total).sort((a, b) => a - b);
const tokens = ok.reduce((sum, result) => sum + result.tokens, 0);
const round = (value) => (value === null ? null : Math.round(value * 10) / 10);

console.log(
  JSON.stringify({
    label: values.label,
    concurrency: CONCURRENCY,
    calls: ok.length,
    errors,
    firstError: errors > 0 ? results.find((result) => "error" in result).error : null,
    ttftP50: round(percentile(ttfts, 50)),
    ttftP95: round(percentile(ttfts, 95)),
    ttftP99: round(percentile(ttfts, 99)),
    totalP50: round(percentile(totals, 50)),
    totalP95: round(percentile(totals, 95)),
    tokensPerSecond: Math.round(tokens / wall),
    gatewayCpuPercent: PIDS.length === 0 ? null : Math.round((cpu / wall) * 100),
  }),
);

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { CHAIN_FAILURE } from "@/app/registry/chain";

import { analyzeSimulation, latestResolution, seededSnapshot } from "../helpers/registry";

/**
 * The chain card's server hop (#595): where the rail comes from, in order.
 *
 * The order is the card's honesty — a stored run first, Simulate only when there is none, and
 * *nothing to simulate* only when the routes were read and name nothing — so each step is
 * asserted along with the calls it does **not** make.
 */

/** What the latest-resolution read answers this case with. */
const latest = vi.fn();

/** What Simulate answers this case with. */
const simulate = vi.fn();

vi.mock("@/app/api/registry", () => ({
  registry: { latestResolution: (alias: string) => latest(alias) },
}));
vi.mock("@/app/api/routing", () => ({
  routing: { simulate: (request: unknown) => simulate(request) },
}));

const { readChain } = await import("@/app/registry/chain-actions");

beforeEach(() => {
  latest.mockReset().mockResolvedValue(latestResolution("coder-std"));
  simulate.mockReset().mockResolvedValue(analyzeSimulation());
});

describe("a stored run", () => {
  it("is the answer when there is one, and Simulate is not asked", async () => {
    latest.mockResolvedValue(latestResolution("coder-max", seededSnapshot()));

    const reading = await readChain("coder-max", { kind: "routed", taskKind: "plan" });

    expect(reading).toEqual({ ok: true, source: { kind: "snapshot", snapshot: seededSnapshot() } });
    expect(latest).toHaveBeenCalledWith("coder-max");
    expect(simulate).not.toHaveBeenCalled();
  });

  it("wins even when the routes could not be read, because it needs no route", async () => {
    latest.mockResolvedValue(latestResolution("coder-max", seededSnapshot()));

    const reading = await readChain("coder-max", { kind: "unknown", reason: "routing away" });

    expect(reading.ok).toBe(true);
  });
});

describe("no stored run", () => {
  it("simulates the alias's task kind, asking about nothing else", async () => {
    const reading = await readChain("coder-std", { kind: "routed", taskKind: "analyze" });

    expect(simulate).toHaveBeenCalledOnce();
    expect(simulate).toHaveBeenCalledWith({ taskKind: "analyze" });
    expect(reading).toEqual({ ok: true, source: { kind: "simulated", resolution: analyzeSimulation() } });
  });

  it("answers unrouted for an alias no route names, and simulates nothing", async () => {
    const reading = await readChain("gpt5-experiments", { kind: "unrouted" });

    expect(reading).toEqual({ ok: true, source: { kind: "unrouted" } });
    expect(simulate).not.toHaveBeenCalled();
  });

  it("says the page's reason when the routes were refused, rather than guessing unrouted", async () => {
    const reading = await readChain("coder-std", { kind: "unknown", reason: "routing away" });

    expect(reading).toEqual({ ok: false, reason: "routing away" });
    expect(simulate).not.toHaveBeenCalled();
  });
});

describe("a refusal", () => {
  it("from the snapshot read is the service's sentence, as a value", async () => {
    latest.mockRejectedValue(new ApiError(503, "upstream_unavailable", "snapshots away"));

    await expect(readChain("coder-max", { kind: "routed", taskKind: "plan" })).resolves.toEqual({
      ok: false,
      reason: "snapshots away",
    });
  });

  it("from Simulate is the service's sentence, as a value", async () => {
    simulate.mockRejectedValue(new ApiError(404, "route_not_found", "No route for analyze."));

    await expect(readChain("coder-std", { kind: "routed", taskKind: "analyze" })).resolves.toEqual({
      ok: false,
      reason: "No route for analyze.",
    });
  });

  it("without a sentence of its own is the card's", async () => {
    latest.mockRejectedValue(new ApiError(500, "internal", ""));

    await expect(readChain("coder-max", { kind: "unrouted" })).resolves.toEqual({
      ok: false,
      reason: CHAIN_FAILURE,
    });
  });

  it("is only an ApiError — anything else keeps travelling", async () => {
    // Next.js's redirect signal above all.
    latest.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readChain("coder-max", { kind: "unrouted" })).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

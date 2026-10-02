import { createHash } from "node:crypto";

import type { CalibrationFactors, ComposerRepository } from "./composer.repository";
import { SEEDED_FACTORS, SEEDED_FINDINGS, FORGE_02_ID, POOL_A_ID } from "./composer.seed.fixture";
import { SuggestionComposer } from "./composer.service";
import type { ComposedSuggestion, ComposerFinding } from "./composer.types";

const RUN = {
  id: "5eed0065-0000-4000-8000-000000000002",
  organization_id: "org",
  repo_ref: "acme/helios",
};
const WINDOW = { from: "2026-05-10", to: "2026-08-07", days: 90 };

/** A stored suggestion in the fake, as V081/V087 keep one. */
interface StoredSuggestion {
  id: string;
  identity: string;
  status: "open" | "dismissed";
  composed: ComposedSuggestion;
  lastRunId: string;
  findingIds: Set<string>;
}

/**
 * A repository with `record_analysis_suggestion()`'s semantics: upsert on
 * `kind:sha256(sorted distinct identity keys)`, an open suggestion takes the new composition, a
 * resolved one keeps its content and only moves `last_run_id`, citations accumulate.
 */
class FakeComposerRepository {
  readonly suggestions = new Map<string, StoredSuggestion>();
  findings: ComposerFinding[] = [...SEEDED_FINDINGS];
  factors: CalibrationFactors = SEEDED_FACTORS;
  refuse?: (composed: ComposedSuggestion) => boolean;

  findingsOf(): Promise<ComposerFinding[]> {
    return Promise.resolve(this.findings);
  }

  calibration(): Promise<CalibrationFactors> {
    return Promise.resolve(this.factors);
  }

  names() {
    return Promise.resolve({
      pools: new Map([[POOL_A_ID, "pool-a"]]),
      runners: new Map([[FORGE_02_ID, "forge-02"]]),
    });
  }

  record(runId: string, composed: ComposedSuggestion): Promise<string> {
    if (this.refuse?.(composed) === true) {
      return Promise.reject(new Error("analysis_suggestions_impact_shape"));
    }
    const keys = [
      ...new Set(
        composed.findingIds.map(
          (id) => this.findings.find((finding) => finding.id === id)?.identityKey ?? id,
        ),
      ),
    ].sort();
    const identity = `${composed.kind}:${createHash("sha256").update(keys.join("\n")).digest("hex")}`;
    const existing = this.suggestions.get(identity);

    if (existing === undefined) {
      const id = `s${String(this.suggestions.size + 1)}`;
      this.suggestions.set(identity, {
        id,
        identity,
        status: "open",
        composed,
        lastRunId: runId,
        findingIds: new Set(composed.findingIds),
      });
      return Promise.resolve(id);
    }
    existing.lastRunId = runId;
    if (existing.status === "open") existing.composed = composed;
    composed.findingIds.forEach((id) => existing.findingIds.add(id));
    return Promise.resolve(existing.id);
  }
}

function harness() {
  const repository = new FakeComposerRepository();
  const composer = new SuggestionComposer(repository as unknown as ComposerRepository);
  return { repository, composer };
}

describe("composing a run", () => {
  it("records every composed suggestion", async () => {
    const { composer, repository } = harness();

    const result = await composer.compose(RUN, WINDOW);

    expect(result.failed).toEqual([]);
    expect(result.recorded).toHaveLength(10);
    expect(repository.suggestions.size).toBe(10);
  });

  it("re-analysis over an unchanged corpus updates — no duplicate suggestions", async () => {
    const { composer, repository } = harness();

    const first = await composer.compose(RUN, WINDOW);
    const second = await composer.compose({ ...RUN, id: "next-run" }, WINDOW);

    expect(second.recorded).toEqual(first.recorded);
    expect(repository.suggestions.size).toBe(10);
    expect([...repository.suggestions.values()].every((s) => s.lastRunId === "next-run")).toBe(
      true,
    );
  });

  it("keeps a dismissed suggestion dismissed, as it was composed", async () => {
    const { composer, repository } = harness();
    await composer.compose(RUN, WINDOW);
    const cache = [...repository.suggestions.values()].find(
      (stored) => stored.composed.template === "ccache_rewarm",
    );
    if (cache === undefined) throw new Error("no cache suggestion");
    cache.status = "dismissed";
    const asDismissed = cache.composed;

    // Calibration moved since: an open suggestion would take the new estimate.
    repository.factors = new Map();
    await composer.compose({ ...RUN, id: "next-run" }, WINDOW);

    expect(cache.status).toBe("dismissed");
    expect(cache.composed).toBe(asDismissed);
    expect(cache.composed.impact?.estimate).toBe(-110);
    const open = [...repository.suggestions.values()].find(
      (stored) => stored.composed.template === "test_gate_split",
    );
    expect(open?.composed.impact?.estimate).toBe(-206);
  });

  it("stores the composed text, so a later reword cannot rewrite a resolved suggestion", async () => {
    const { composer, repository } = harness();
    await composer.compose(RUN, WINDOW);
    const stored = [...repository.suggestions.values()].find(
      (suggestion) => suggestion.composed.template === "review_first",
    );
    if (stored === undefined) throw new Error("no review-first suggestion");
    stored.status = "dismissed";
    const title = stored.composed.title;

    // A reworded finding (as if a template changed its slots) on the next run.
    repository.findings = repository.findings.map((finding) => ({
      ...finding,
      data: { ...finding.data, workflow: "renamed" },
    }));
    await composer.compose({ ...RUN, id: "next-run" }, WINDOW);

    expect(stored.composed.title).toBe(title);
    expect(title).toBe("standard-fix: run self-review BEFORE the build stage");
  });

  it("logs and skips a suggestion the database refuses; the rest are recorded", async () => {
    const { composer, repository } = harness();
    repository.refuse = (composed) => composed.template === "runner_move";

    const result = await composer.compose(RUN, WINDOW);

    expect(result.failed).toEqual(["runner_move"]);
    expect(result.recorded).toHaveLength(9);
  });

  it("composes nothing from a run without findings", async () => {
    const { composer, repository } = harness();
    repository.findings = [];

    expect(await composer.compose(RUN, WINDOW)).toEqual({ recorded: [], failed: [] });
  });
});

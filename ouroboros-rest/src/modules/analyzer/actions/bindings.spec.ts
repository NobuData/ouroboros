import type { Workflow } from "../../db/schema";
import { readFixture } from "../../workflows/dsl.golden.fixture";
import type { WorkflowDocument } from "../../workflows/dsl.schema";
import type { DraftBase } from "../../workflows/workflows.service";
import {
  changeNoteOf,
  daysPhrase,
  planFingerprint,
  planOf,
  workflowPlan,
  type PlanSubject,
} from "./bindings";

/**
 * Binding → plan (BV.5, #514): every preview names the concrete change, the payload is exactly
 * what the plane will be handed, and the planes that cannot take a change say so.
 * The payloads are the seeded suggestions' (R__dev_seed_workspace_metrics_analyzer.sql, 11–16).
 */

/** A suggestion with a binding. */
function subject(
  binding: PlanSubject["binding"],
  overrides: Partial<PlanSubject> = {},
): PlanSubject {
  return {
    id: "5eed0067-0000-4000-8000-000000000013",
    repoRef: "acme-robotics/helios-firmware",
    title: "Move forge-02 to pool-a during 14:00–16:00 UTC",
    evidenceLine: "pool-a queue exceeds 9 min in that window on 9 of last 10 weekdays",
    needsSpike: false,
    kind: "build_process",
    binding,
    ...overrides,
  };
}

describe("the farm pool move", () => {
  const binding = {
    plane: "farm_config" as const,
    change: {
      runner: "forge-02",
      pool: "pool-a",
      days_of_week: [5, 4, 3, 2, 1],
      starts_at: "14:00",
      ends_at: "16:00",
    },
  };

  it("previews the runner, the pool, the window and the days — and hands the farm exactly that", () => {
    const plan = planOf(subject(binding));

    expect(plan).toEqual({
      kind: "pool_window",
      plane: "farm_config",
      summary:
        "forge-02 joins pool-a between 14:00–16:00 UTC on weekdays (Mon–Fri); outside that " +
        "window it stays in its own pool.",
      lands: "Build farm · pool windows",
      change: {
        runner: "forge-02",
        pool: "pool-a",
        daysOfWeek: [1, 2, 3, 4, 5],
        startsAt: "14:00",
        endsAt: "16:00",
      },
    });
  });

  it("refuses a window across midnight rather than guessing", () => {
    const plan = planOf(subject({ ...binding, change: { ...binding.change, ends_at: "02:00" } }));

    expect(plan).toMatchObject({ kind: "unavailable", plane: "farm_config" });
  });

  it.each([
    [[1, 2, 3, 4, 5], "on weekdays (Mon–Fri)"],
    [[6, 7], "on weekends"],
    [[1, 2, 3, 4, 5, 6, 7], "every day"],
    [[1, 3], "on Mon, Wed"],
  ])("says %j as %s", (days, phrase) => {
    expect(daysPhrase(days)).toBe(phrase);
  });
});

describe("the job hook", () => {
  const binding = {
    plane: "job_hook" as const,
    change: {
      on: "merge",
      run: "west build -t ccache-warm",
      title: "deps-refresh",
      pool: "pool-a",
    },
  };

  it("previews the repository, the title filter, the command and the pool", () => {
    const plan = planOf(
      subject(binding, { title: "Re-warm ccache right after deps-refresh merges" }),
    );

    expect(plan).toMatchObject({
      kind: "job_hook",
      summary:
        "On every merge into acme-robotics/helios-firmware whose title contains “deps-refresh”, " +
        "the farm submits `west build -t ccache-warm` in pool-a, at the merged commit of the base branch.",
      change: {
        repo: "acme-robotics/helios-firmware",
        pool: "pool-a",
        event: "merge",
        titleContains: "deps-refresh",
        command: ["west", "build", "-t", "ccache-warm"],
      },
    });
  });

  it("refuses a hook with no pool to run in", () => {
    const { pool: _pool, ...change } = binding.change;

    expect(planOf(subject({ ...binding, change }))).toMatchObject({
      kind: "unavailable",
      reason: "the binding names no pool for the job to run in",
    });
  });
});

describe("the planes that are not applied", () => {
  it("describes the test-gate split and says no plane owns it", () => {
    const plan = planOf(
      subject({
        plane: "test_gate",
        change: {
          pr_builds: ["native_sim"],
          merge_gate: ["native_sim", "qemu_cortex_m3", "HIL"],
        },
      }),
    );

    expect(plan).toMatchObject({
      kind: "unavailable",
      plane: "test_gate",
      summary:
        "PR builds run native_sim; native_sim, qemu_cortex_m3, HIL run only at the merge gate.",
    });
    expect(plan?.kind === "unavailable" && plan.reason).toContain("no plane owns");
  });

  it("sends a spike to drafting, not applying", () => {
    const plan = planOf(
      subject(
        { plane: "planning", change: { spike: "partial link cache for zephyr.elf" } },
        { needsSpike: true, title: "Link zephyr.elf incrementally (partial link cache)" },
      ),
    );

    expect(plan).toMatchObject({
      kind: "unavailable",
      summary: "Draft a spike ticket: Link zephyr.elf incrementally (partial link cache)",
    });
  });
});

describe("the workflow draft", () => {
  const review = {
    plane: "workflow" as const,
    change: { workflow: "standard-fix", move: "self-review", before: "build" },
  };
  const base: DraftBase = {
    workflow: { id: "wf-1", slug: "standard-fix", current_version: 15 } as Workflow,
    definition: null,
    from: "version",
    version: 15,
    etag: "none",
  };
  const document = readFixture("valid/standard-fix.json") as WorkflowDocument;

  it("names the workflow, the stage delta and the version it becomes when published", () => {
    const plan = workflowPlan(
      subject(review, {
        kind: "workflow",
        title: "standard-fix: run self-review BEFORE the build stage",
      }),
      base,
      document,
    );

    expect(plan).toMatchObject({
      kind: "workflow_draft",
      summary:
        "standard-fix: a draft on v15 moves `review` (Self-review diff) to run before `build` " +
        "(Build farm · pool A). It becomes v16 only when a person publishes it.",
      lands: "Workflow studio · standard-fix draft",
      change: { workflowId: "wf-1", slug: "standard-fix", ifMatch: "none", nextVersion: 16 },
    });
  });

  it("refuses a delta the document cannot carry, with the reason", () => {
    const plan = workflowPlan(
      subject({ ...review, change: { ...review.change, move: "lint" } }),
      base,
      document,
    );

    expect(plan).toMatchObject({
      kind: "unavailable",
      reason: "no stage of this workflow is named lint",
    });
  });

  it("cites the suggestion and its evidence in a change note V029 can store", () => {
    const note = changeNoteOf(subject(review, { evidenceLine: "x".repeat(900) }));

    expect(note.length).toBeLessThanOrEqual(500);
    expect(note).toContain("Proposed by the Build Analyzer (suggestion 5eed0067-");
  });
});

describe("the fingerprint", () => {
  it("is stable for one plan and moves when the payload does", () => {
    const binding = {
      plane: "farm_config" as const,
      change: {
        runner: "forge-02",
        pool: "pool-a",
        days_of_week: [1],
        starts_at: "14:00",
        ends_at: "16:00",
      },
    };
    const one = planOf(subject(binding));
    const again = planOf(subject(binding));
    const other = planOf(subject({ ...binding, change: { ...binding.change, pool: "pool-b" } }));

    if (one === undefined || again === undefined || other === undefined) throw new Error("no plan");
    expect(planFingerprint(one)).toBe(planFingerprint(again));
    expect(planFingerprint(one)).not.toBe(planFingerprint(other));
    expect(planFingerprint(one)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

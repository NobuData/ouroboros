import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RunConsole } from "@/app/api/runs";
import {
  CHANGES_TITLE,
  COMMITS_LABEL,
  EVIDENCE_LABEL,
  FILES_LABEL,
  GUARDRAILS_TITLE,
  NO_COMMITS,
  NO_FILES,
  NO_VERDICTS,
  RESOURCES_TITLE,
  changesView,
  commitSource,
  guardrailsView,
  resourcesView,
} from "@/app/runs/cards";
import { ChangesCard } from "@/app/runs/changes-card";
import { GuardrailsCard } from "@/app/runs/guardrails-card";
import { ResourcesCard } from "@/app/runs/resources-card";
import { type RunElapsed, runElapsed } from "@/app/runs/view";

import { SEEDED_SECRETS, guardrailCheck, runConsole } from "../helpers/runs";

/**
 * The right column, rendered (#313): each card at parity with the mockup's seed, and each honest
 * fallback drawn — unpriced, budget-less, unreserved, unlinked, violated.
 */

/** A finished run's clock, so no test here depends on the one-second tick. */
const STILL: RunElapsed = { live: false, seconds: 760 };

/**
 * Draw *Changes so far*.
 *
 * @param snapshot The snapshot.
 * @returns The card.
 */
function drawChanges(snapshot: RunConsole = runConsole()): HTMLElement {
  render(<ChangesCard view={changesView(snapshot.changes, commitSource(snapshot.head.repository))} />);
  return screen.getByRole("region", { name: CHANGES_TITLE });
}

/**
 * Draw *Resources*.
 *
 * @param snapshot The snapshot.
 * @param elapsed The clock.
 * @returns The card.
 */
function drawResources(snapshot: RunConsole = runConsole(), elapsed: RunElapsed = STILL): HTMLElement {
  render(<ResourcesCard elapsed={elapsed} view={resourcesView(snapshot.resources)} />);
  return screen.getByRole("region", { name: RESOURCES_TITLE });
}

/**
 * Draw *Guardrails*.
 *
 * @param snapshot The snapshot.
 * @returns The card.
 */
function drawGuardrails(snapshot: RunConsole = runConsole()): HTMLElement {
  render(<GuardrailsCard view={guardrailsView(snapshot.guardrails)} />);
  return screen.getByRole("region", { name: GUARDRAILS_TITLE });
}

/**
 * A resources row's figure, by its label.
 *
 * @param card The card.
 * @param label The row's label.
 * @returns The figure's text, or `null` when there is no such row.
 */
function figure(card: HTMLElement, label: string): string | null {
  const line = [...card.querySelectorAll(".run-resources__line")].find(
    (element) => element.querySelector(".run-resources__label")?.textContent === label,
  );
  return line?.querySelector(".run-resources__figure")?.textContent ?? null;
}

describe("changes so far", () => {
  it("matches the mockup: three files with counts, two commits, the squash tag", () => {
    const card = drawChanges();

    expect(within(card).getByText("3 files")).toBeInTheDocument();

    const files = within(within(card).getByRole("region", { name: FILES_LABEL })).getAllByRole("listitem");
    expect(files.map((file) => file.textContent)).toEqual([
      "drivers/can/telemetry_buf.c+38−12",
      "drivers/can/isr_fastpath.c+9−3",
      "tests/telemetry/test_frame_order.c+21−0",
    ]);
    expect(files[0]).toHaveAccessibleName("drivers/can/telemetry_buf.c, 38 added, 12 removed");
    expect(files[0]!.querySelector(".run-changes__plus")).toHaveTextContent("+38");
    expect(files[0]!.querySelector(".run-changes__minus")).toHaveTextContent("−12");

    const commits = within(within(card).getByRole("region", { name: COMMITS_LABEL })).getAllByRole("listitem");
    expect(commits.map((commit) => commit.textContent)).toEqual([
      "a41c9e2can: replace telemetry k_fifo with k_msgq + frame seq",
      "7f03b8dcan: assign frame seq in ISR before enqueue",
    ]);

    expect(within(card).getByText("will squash on merge")).toBeInTheDocument();
  });

  it("links each sha to its commit on the source, in a new tab", () => {
    const card = drawChanges();
    const link = within(card).getByRole("link", { name: "a41c9e2" });

    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/helios-firmware/commit/a41c9e2f0b7d3c5e8a1f6b2d4c9e7a3f5b8d1c0e",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("draws the sha as text when the source cannot produce a commit URL", () => {
    const card = drawChanges(runConsole({ head: { repository: undefined } }));

    expect(within(card).queryByRole("link")).toBeNull();
    expect(within(card).getByText("a41c9e2")).toBeInTheDocument();
  });

  it("links a non-GitHub source's commit", () => {
    const snapshot = runConsole();
    render(<ChangesCard view={changesView(snapshot.changes, { kind: "gitlab", path: "acme/helios" })} />);

    expect(screen.getByRole("link", { name: "7f03b8d" })).toHaveAttribute(
      "href",
      "https://gitlab.com/acme/helios/-/commit/7f03b8d1e6c2a9f4b0d5e3c8a7f1b6d2e9c4a0f3",
    );
  });

  it("scrolls a long list inside the card, in a region a keyboard can reach", () => {
    const files = Array.from({ length: 200 }, (_, index) => ({
      path: `src/very/deeply/nested/directory/structure/that/goes/on/and/on/file_${index}.c`,
      status: "modified" as const,
      additions: index,
      deletions: 1,
    }));
    const card = drawChanges(runConsole({ changes: { files } }));
    const region = within(card).getByRole("region", { name: FILES_LABEL });

    expect(region).toHaveClass("run-changes__scroll");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getAllByRole("listitem")).toHaveLength(200);
    expect(within(card).getByText("200 files")).toBeInTheDocument();
  });

  it("says nothing has changed yet rather than drawing an empty list", () => {
    const card = drawChanges(runConsole({ changes: { files: [], commits: [], mergeStrategy: null } }));

    expect(within(card).getByText(NO_FILES)).toBeInTheDocument();
    expect(within(card).getByText(NO_COMMITS)).toBeInTheDocument();
    expect(within(card).getByText("0 files")).toBeInTheDocument();
    expect(within(card).queryByText(/on merge/)).toBeNull();
  });
});

describe("resources", () => {
  it("matches the mockup: both meters at its fills, forge-02 reserved, the wall clock", () => {
    const card = drawResources();

    expect(figure(card, "Tokens")).toBe("212k / 400k budget");
    expect(figure(card, "Est. cost")).toBe("$1.14 / $2.50 cap");
    expect(figure(card, "Build farm")).toBe("forge-02 reserved");
    expect(figure(card, "Wall clock")).toBe("12m 40s");

    const fills = [...card.querySelectorAll<HTMLElement>(".ou-meter__fill")].map((fill) =>
      fill.style.getPropertyValue("--ou-meter-fill"),
    );
    expect(fills).toEqual(["53%", "45.6%"]);
    expect(card.querySelector(".run-resources__dot--idle")).not.toBeNull();
  });

  it("renders — · N tokens for unpriced rates, and never $0", () => {
    const card = drawResources(
      runConsole({ resources: { cost: { costCents: null, unpricedEvents: 12, capCents: 250, routeTag: null } } }),
    );

    expect(figure(card, "Est. cost")).toBe("— · 212k tokens");
    expect(card).not.toHaveTextContent("$0");
    expect(card.querySelectorAll(".ou-meter")).toHaveLength(1);
  });

  it("renders a count without a meter when no budget is pinned", () => {
    const card = drawResources(
      runConsole({
        resources: {
          tokens: { used: 212_000, tokensIn: 180_000, tokensOut: 32_000, budget: null, budgetStageKey: null },
          cost: { costCents: null, unpricedEvents: 1, capCents: null, routeTag: null },
        },
      }),
    );

    expect(figure(card, "Tokens")).toBe("212k tokens");
    expect(card.querySelector(".ou-meter")).toBeNull();
  });

  it("omits the farm row entirely when the run holds no reservation", () => {
    const card = drawResources(runConsole({ resources: { farm: undefined } }));

    expect(figure(card, "Build farm")).toBeNull();
    expect(card).not.toHaveTextContent("Build farm");
    expect(card).not.toHaveTextContent("forge-02");
  });

  it("notes a lower bound when some calls were not priced", () => {
    const card = drawResources(
      runConsole({ resources: { cost: { costCents: "114", unpricedEvents: 2, capCents: 250, routeTag: null } } }),
    );

    expect(within(card).getByText("lower bound — 2 calls unpriced")).toBeInTheDocument();
  });

  it("prints a finished run's wall clock from its stage history, still", () => {
    const finished = runConsole({
      head: { live: false },
      wallClock: { finishedAt: "2026-09-19T12:30:05.000Z", elapsedSeconds: 1805 },
    });
    const card = drawResources(finished, runElapsed(finished));

    expect(figure(card, "Wall clock")).toBe("30m 05s");
  });
});

describe("guardrails", () => {
  it("matches the mockup: four marks, the clean pill, the ○ caption, the policy footer", () => {
    const card = drawGuardrails();
    const rows = within(card).getAllByRole("listitem");

    expect(rows.map((row) => row.querySelector(".run-guard__mark")?.textContent)).toEqual(["✓", "✓", "✓", "○"]);
    expect(rows[0]).toHaveAccessibleName("Diff confined to allowed paths: passed");
    expect(rows[1]).toHaveTextContent("No CI config touched");
    expect(rows[2]).toHaveTextContent("Secrets scan clean");
    expect(rows[3]).toHaveTextContent("Human review not required (auto-merge eligible)");
    expect(rows[3]!.querySelector(".run-guard__mark--idle")).not.toBeNull();

    const pill = card.querySelector(".ou-card__head .ou-chip");
    expect(pill).toHaveTextContent("clean");
    expect(within(card).getByText("Policy: standard-fix v14 · tenant acme-robotics")).toBeInTheDocument();
  });

  it("states the secrets ruleset's recall limitation, as a tooltip and as text", () => {
    const card = drawGuardrails();
    const info = card.querySelector(".run-guard__info") as HTMLElement;

    expect(info).toHaveAttribute("title", expect.stringContaining(SEEDED_SECRETS.limitation));
    expect(info).toHaveTextContent("not that the diff holds no secrets");
    expect(card.querySelectorAll(".run-guard__info")).toHaveLength(1);
  });

  it("renders a violation with its evidence expanded and flips the pill", () => {
    const card = drawGuardrails(
      runConsole({
        guardrails: {
          status: "clean",
          checks: [
            guardrailCheck("allowed_paths", "pass"),
            guardrailCheck("ci_config", "pass"),
            guardrailCheck("secrets", "fail", {
              path: "drivers/can/config.c",
              line: 42,
              rule_id: "aws-access-key-id",
              detail: "1 finding in 1 file.",
            }),
            guardrailCheck("review_required", "not_applicable"),
          ],
        },
      }),
    );

    expect(card.querySelector(".ou-card__head .ou-chip")).toHaveTextContent("violations");
    expect(card).not.toHaveTextContent(/\bclean\b/);

    const failing = within(card).getByRole("listitem", { name: "Possible secret in the diff: failed" });
    expect(failing.querySelector(".run-guard__mark--err")).toHaveTextContent("✗");

    const evidence = failing.querySelector("details") as HTMLDetailsElement;
    expect(evidence.open).toBe(true);
    expect(within(failing).getByText(EVIDENCE_LABEL)).toBeInTheDocument();
    expect(within(failing).getByText("drivers/can/config.c:42")).toBeInTheDocument();
    expect(within(failing).getByText("aws-access-key-id")).toBeInTheDocument();
  });

  it("draws the pill from the verdicts, not from a stored status", () => {
    const card = drawGuardrails(runConsole({ guardrails: { status: "clean", checks: [] } }));

    expect(card.querySelector(".ou-card__head .ou-chip")).toHaveTextContent("not evaluated");
    expect(within(card).getByText(NO_VERDICTS)).toBeInTheDocument();
  });

  it("keeps a passing row's evidence collapsed", () => {
    const card = drawGuardrails(
      runConsole({
        guardrails: { checks: [guardrailCheck("secrets", "not_applicable", { detail: "No diff hunks were reported." })] },
      }),
    );

    expect((card.querySelector("details") as HTMLDetailsElement).open).toBe(false);
    expect(within(card).getByRole("listitem")).toHaveTextContent("Secrets not scanned");
  });
});

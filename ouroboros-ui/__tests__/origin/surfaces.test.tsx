import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { newestJob, selectedJob } from "@/app/farm/live";
import { RunnerJobCell } from "@/app/farm/runner-cells";
import { runnerRow } from "@/app/farm/runners";
import { PrHead } from "@/app/prs/pr-head";
import { prHead } from "@/app/prs/view";
import { RunHead } from "@/app/runs/run-head";
import { runHead } from "@/app/runs/view";

import { FARM_READ_AT, farmRunner, liveBuild, seededFarm } from "../helpers/farm";
import { prPage } from "../helpers/pull-requests";
import { runConsole } from "../helpers/runs";

/**
 * The rows that show one run, PR or build carry its origin badge (DJ.3, #1316): a farm job, the run
 * console head and the PR page head. A demo row reads **Demo data**; a live one carries nothing.
 */

const JOB = {
  id: "5eed0400-0000-4000-8000-0000000004f9",
  number: 479,
  label: "zephyr build",
  title: "Add OTA rollback on failed checksum",
  startedAt: "2026-09-19T13:58:19.000Z",
};

describe("a build farm job", () => {
  it("carries its origin into the runners table's row", () => {
    const seeded = farmRunner({ currentJob: { ...JOB, runId: null, origin: "seeded" } });

    expect(runnerRow(seeded, FARM_READ_AT).jobOrigin).toBe("seeded");
    expect(runnerRow(farmRunner({ currentJob: null }), FARM_READ_AT).jobOrigin).toBeNull();
  });

  it("badges a demo build's current-job cell, beside its button", () => {
    render(
      <RunnerJobCell
        jobId={JOB.id}
        note="zephyr build"
        number="#479"
        onOpen={() => undefined}
        origin="seeded"
        runId={null}
        title={JOB.title}
      />,
    );

    expect(screen.getByRole("button", { name: "#479 zephyr build" })).toBeInTheDocument();
    expect(screen.getByText("Demo data")).toBeInTheDocument();
  });

  it("badges a simulated loop's build beside its links", () => {
    render(
      <RunnerJobCell
        jobId={JOB.id}
        note="zephyr build"
        number="#479"
        onOpen={() => undefined}
        origin="simulated"
        runId="5eed0009-0000-4000-8000-000000000482"
        title={JOB.title}
      />,
    );

    expect(screen.getByText("Simulated")).toBeInTheDocument();
  });

  it("leaves a live build's cell as it was", () => {
    render(
      <RunnerJobCell
        jobId={JOB.id}
        note="zephyr build"
        number="#479"
        onOpen={() => undefined}
        origin="live"
        runId={null}
        title={JOB.title}
      />,
    );

    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
    expect(screen.queryByText("Simulated")).not.toBeInTheDocument();
  });

  it("hands the live card the build's origin, from the page or the selected runner", () => {
    expect(newestJob(seededFarm({ live: liveBuild({ origin: "seeded" }) }))?.origin).toBe("seeded");

    const runner = farmRunner({ currentJob: { ...JOB, runId: null, origin: "simulated" } });
    expect(selectedJob(seededFarm({ runners: [runner] }), runner.id)?.origin).toBe("simulated");
  });
});

describe("the run console head", () => {
  it("badges a demo run beside its status", () => {
    render(<RunHead view={runHead(runConsole({ head: { origin: "seeded" } }))} />);

    expect(screen.getByText("Demo data")).toBeInTheDocument();
  });

  it("carries no badge for a live run", () => {
    render(<RunHead view={runHead(runConsole())} />);

    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
    expect(screen.queryByText("Simulated")).not.toBeInTheDocument();
  });
});

describe("the PR page head", () => {
  it("badges a demo pull request in its meta row", () => {
    const { container } = render(
      <PrHead view={prHead(prPage({ pullRequest: { origin: "seeded" } }), "dashboard")} />,
    );

    const meta = container.querySelector(".prv-head__meta") as HTMLElement;
    expect(within(meta).getByText("Demo data")).toBeInTheDocument();
  });

  it("carries no badge for a live pull request", () => {
    render(<PrHead view={prHead(prPage(), "dashboard")} />);

    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
  });
});

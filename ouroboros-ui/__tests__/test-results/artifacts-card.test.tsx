import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TestRunPage } from "@/app/api/test-results";
import type { ArtifactReader } from "@/app/test-results/artifact-viewer";
import {
  ARTIFACTS_LIST_LABEL,
  ARTIFACTS_TITLE,
  type ArtifactText,
  CLOSE_VIEWER,
  DOWNLOAD_FILE,
  EXPIRED,
  FILE_EMPTY,
  FILE_EXPIRED,
  FILE_FAILED_HEADLINE,
  FILE_UNREADABLE,
  NO_ARTIFACTS,
  READING_ARTIFACTS,
  READING_FILE,
  TRUNCATED,
  artifactsView,
  clippedNote,
} from "@/app/test-results/artifacts";
import { ArtifactsCard } from "@/app/test-results/artifacts-card";
import { RETRY_LABEL } from "@/app/ui";

import {
  CAPTURE_ARTIFACT_ID,
  COVERAGE_ARTIFACT_ID,
  LOG_ARTIFACT_ID,
  artifact,
  coverage,
  firstCoverage,
  mockupArtifacts,
  page,
} from "../helpers/test-results";

/**
 * The artifacts card, drawn (#341): mockup 11's four rows under the real retention tag, a text
 * artifact read in place and a binary saved, the tombstone with nothing to open, the truncation
 * reason, and the coverage delta absent for a first attempt.
 */

/** A log's text, with markup in it. */
const LOG = "[00:00:01] boot ok\n<script>alert(1)</script>\n[00:00:02] e-stop released\n";

/**
 * A reader answering one result, and recording what it was asked for.
 *
 * @param answer What to answer.
 * @returns The reader.
 */
function reading(answer: ArtifactText) {
  return vi.fn<ArtifactReader>(() => Promise.resolve(answer));
}

/**
 * Draw the card.
 *
 * @param drawn The page, or `null` for one not yet read. Defaults to the mockup's.
 * @param read How the viewer reads.
 * @returns What redraws the card with another page.
 */
function draw(
  drawn: TestRunPage | null = page({ artifacts: mockupArtifacts(), coverage: coverage() }),
  read: ArtifactReader = reading({ state: "read", text: LOG, clipped: false }),
) {
  const { rerender } = render(<ArtifactsCard read={read} view={drawn === null ? null : artifactsView(drawn)} />);

  return (next: TestRunPage) => rerender(<ArtifactsCard read={read} view={artifactsView(next)} />);
}

/** The card. */
function card() {
  return within(screen.getByRole("region", { name: ARTIFACTS_TITLE }));
}

/** The rows. */
function rows(): HTMLElement[] {
  return within(card().getByRole("list", { name: ARTIFACTS_LIST_LABEL })).getAllByRole("listitem");
}

/** A row's visible text, without the words only a screen reader is given. */
function text(row: HTMLElement): string {
  const copy = row.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();

  return copy.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

describe("the mockup's rows", () => {
  it("are drawn name, size when notable, and the open affordance", () => {
    draw();

    expect(rows().map(text)).toEqual([
      "junit-build3.xml↗",
      "rig-capture-estop.csv 2.1 MB↗",
      "serial-console.log↗",
      "coverage 87.4% (+0.6%)↗",
    ]);
  });

  it("colour the coverage delta by its direction", () => {
    const redraw = draw();

    expect(card().getByText("(+0.6%)")).toHaveClass("tests-artifacts__delta--ok");

    redraw(
      page({
        artifacts: [
          artifact({
            id: COVERAGE_ARTIFACT_ID,
            name: "coverage.info",
            kind: "coverage",
            coverage: coverage({ delta: -0.6 }),
          }),
        ],
      }),
    );

    expect(card().getByText("(−0.6%)")).toHaveClass("tests-artifacts__delta--err");
  });

  it("say each row's kind to a screen reader, where a sighted reader has the icon", () => {
    draw();

    expect(rows().map((row) => row.querySelector(".sr-only")?.textContent)).toEqual([
      "JUnit report: ",
      "rig capture: ",
      "log: ",
      "coverage report: ",
    ]);
    for (const row of rows()) expect(row.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("the retention tag", () => {
  it("is the payload's policy", () => {
    draw();

    expect(card().getByText("retained 30d")).toBeInTheDocument();
  });

  it("follows a non-default policy", () => {
    draw(page({ artifacts: mockupArtifacts().map((each) => ({ ...each, retentionDays: 7 })) }));

    expect(card().getByText("retained 7d")).toBeInTheDocument();
    expect(card().queryByText("retained 30d")).toBeNull();
  });

  it("is not drawn where nothing is retained", () => {
    draw(page({ artifacts: [artifact({ state: "expired" })] }));

    expect(card().queryByText(/^retained/)).toBeNull();
  });
});

describe("the coverage delta", () => {
  it("is absent for a first attempt, never +0.0%", () => {
    draw(
      page({
        artifacts: [artifact({ id: COVERAGE_ARTIFACT_ID, name: "coverage.info", kind: "coverage", coverage: firstCoverage() })],
        coverage: firstCoverage(),
      }),
    );

    expect(rows().map(text)).toEqual(["coverage 86.8%↗"]);
    expect(card().queryByText(/0\.0%/)).toBeNull();
  });
});

describe("a tombstone", () => {
  it("keeps its name, says expired, and has no open affordance", () => {
    draw(
      page({
        artifacts: [
          artifact(),
          artifact({ id: LOG_ARTIFACT_ID, name: "serial-console.log", kind: "log", state: "expired" }),
        ],
      }),
    );

    const [live, tombstone] = rows();

    expect(text(tombstone!)).toBe(`serial-console.log${EXPIRED}`);
    expect(tombstone).toHaveAttribute("data-expired", "true");
    expect(within(tombstone!).queryByRole("button")).toBeNull();
    expect(within(tombstone!).queryByRole("link")).toBeNull();
    expect(within(live!).getByRole("button", { name: "Open junit-build3.xml" })).toBeInTheDocument();
  });
});

describe("a truncated upload", () => {
  it("says so on its row, with the reason", () => {
    draw(
      page({
        artifacts: [
          artifact({
            id: CAPTURE_ARTIFACT_ID,
            name: "rig-capture-estop.csv",
            kind: "capture",
            preview: "download",
            sizeBytes: 26_214_400,
            truncated: true,
            truncationNote: "exceeded the 25 MB per-file cap; kept the first 25 MB",
          }),
        ],
      }),
    );

    const [row] = rows();

    expect(row).toHaveAttribute("data-truncated", "true");
    expect(within(row!).getByText(TRUNCATED)).toBeInTheDocument();
    expect(
      within(row!).getByText("Cut short on upload — exceeded the 25 MB per-file cap; kept the first 25 MB"),
    ).toBeInTheDocument();
    expect(within(row!).getByRole("link", { name: "Download rig-capture-estop.csv" })).toBeInTheDocument();
  });
});

describe("opening", () => {
  it("saves a binary through this origin, and draws no viewer for it", () => {
    draw();

    const link = card().getByRole("link", { name: "Download rig-capture-estop.csv" });

    expect(link).toHaveAttribute("href", `/api/artifacts/${CAPTURE_ARTIFACT_ID}`);
    expect(link).toHaveAttribute("download");
  });

  it("reads a text artifact in place, as text", async () => {
    const read = reading({ state: "read", text: LOG, clipped: false });
    draw(undefined, read);

    const open = card().getByRole("button", { name: "Open serial-console.log" });
    expect(open).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(open);

    expect(open).toHaveAttribute("aria-expanded", "true");
    const viewer = within(card().getByRole("region", { name: "Contents of serial-console.log" }));
    expect(viewer.getByRole("status")).toHaveTextContent(READING_FILE);
    expect(read).toHaveBeenCalledWith(`/api/artifacts/${LOG_ARTIFACT_ID}`, expect.any(AbortSignal));

    const file = await viewer.findByRole("group", { name: "serial-console.log" });

    expect(file.textContent).toBe(LOG);
    // Markup in a log is characters, never elements.
    expect(file.querySelector("script")).toBeNull();
    expect(file).toHaveAttribute("tabindex", "0");
    expect(open).toHaveAttribute("aria-controls", viewer.getByRole("group").closest("section")!.id);
    expect(viewer.getByRole("link", { name: DOWNLOAD_FILE })).toHaveAttribute(
      "href",
      `/api/artifacts/${LOG_ARTIFACT_ID}`,
    );
  });

  it("opens the coverage report from the coverage row, named as the file", async () => {
    draw();

    fireEvent.click(card().getByRole("button", { name: "Open coverage.info" }));

    expect(await card().findByRole("region", { name: "Contents of coverage.info" })).toBeInTheDocument();
  });

  it("closes from the row and from the viewer, and aborts a read in flight", () => {
    let signal: AbortSignal | null = null;
    const read: ArtifactReader = (_url, given) => {
      signal = given;

      return new Promise(() => {});
    };
    draw(undefined, read);

    const open = card().getByRole("button", { name: "Open junit-build3.xml" });
    fireEvent.click(open);
    expect(signal!.aborted).toBe(false);

    fireEvent.click(card().getByRole("button", { name: CLOSE_VIEWER }));

    expect(card().queryByRole("region", { name: /^Contents of/ })).toBeNull();
    expect(signal!.aborted).toBe(true);
    expect(open).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(open);
    fireEvent.click(open);

    expect(card().queryByRole("region", { name: /^Contents of/ })).toBeNull();
  });

  it("keeps one viewer open at a time", () => {
    draw();

    fireEvent.click(card().getByRole("button", { name: "Open junit-build3.xml" }));
    fireEvent.click(card().getByRole("button", { name: "Open serial-console.log" }));

    expect(card().getAllByRole("region", { name: /^Contents of/ })).toHaveLength(1);
    expect(card().getByRole("region", { name: "Contents of serial-console.log" })).toBeInTheDocument();
  });

  it("says a long file was read from its start only", async () => {
    draw(undefined, reading({ state: "read", text: "abc", clipped: true }));

    fireEvent.click(card().getByRole("button", { name: "Open serial-console.log" }));

    expect(await card().findByText(clippedNote())).toBeInTheDocument();
  });

  it("says an empty file is empty", async () => {
    draw(undefined, reading({ state: "read", text: "", clipped: false }));

    fireEvent.click(card().getByRole("button", { name: "Open serial-console.log" }));

    expect(await card().findByText(FILE_EMPTY)).toBeInTheDocument();
    expect(card().queryByRole("group")).toBeNull();
  });

  it("says a file expired while the page was open", async () => {
    draw(undefined, reading({ state: "expired" }));

    fireEvent.click(card().getByRole("button", { name: "Open serial-console.log" }));

    expect(await card().findByRole("alert")).toHaveTextContent(FILE_EXPIRED);
  });

  it("says why a read failed, and reads again on retry", async () => {
    const read = vi
      .fn<ArtifactReader>()
      .mockResolvedValueOnce({ state: "failed", reason: "No such artifact." })
      .mockResolvedValueOnce({ state: "read", text: LOG, clipped: false });
    draw(undefined, read);

    fireEvent.click(card().getByRole("button", { name: "Open serial-console.log" }));

    expect(await card().findByText(FILE_FAILED_HEADLINE)).toBeInTheDocument();
    expect(card().getByText("No such artifact.")).toBeInTheDocument();

    fireEvent.click(card().getByRole("button", { name: RETRY_LABEL }));

    expect((await card().findByRole("group", { name: "serial-console.log" })).textContent).toBe(LOG);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reports a reader that threw as a failure rather than hanging", async () => {
    draw(undefined, () => Promise.reject(new Error("boom")));

    fireEvent.click(card().getByRole("button", { name: "Open serial-console.log" }));

    expect(await card().findByText(FILE_UNREADABLE)).toBeInTheDocument();
  });

  it("closes a viewer whose artifact the sweep took while it was open", async () => {
    const redraw = draw();

    fireEvent.click(card().getByRole("button", { name: "Open serial-console.log" }));
    await card().findByRole("group", { name: "serial-console.log" });

    redraw(
      page({
        artifacts: mockupArtifacts().map((each) =>
          each.id === LOG_ARTIFACT_ID ? artifact({ ...each, state: "expired", href: null }) : each,
        ),
      }),
    );

    expect(card().queryByRole("region", { name: /^Contents of/ })).toBeNull();
    expect(card().queryByRole("button", { name: "Open serial-console.log" })).toBeNull();
    expect(card().getByText("serial-console.log")).toBeInTheDocument();
  });
});

describe("the card's other states", () => {
  it("says it is reading until the attempt's page has been read", () => {
    draw(null);

    expect(card().getByText(READING_ARTIFACTS)).toBeInTheDocument();
    expect(card().queryByRole("list")).toBeNull();
  });

  it("says so when the build uploaded nothing", () => {
    draw(page());

    expect(card().getByText(NO_ARTIFACTS)).toBeInTheDocument();
    expect(card().queryByRole("list")).toBeNull();
  });
});

describe("what reaches the page", () => {
  it("is nothing about where a file is kept — and not the service's own path", () => {
    const { container } = render(
      <ArtifactsCard view={artifactsView(page({ artifacts: mockupArtifacts(), coverage: coverage() }))} />,
    );

    expect(container.innerHTML).not.toMatch(/storage|driver|s3:|\/api\/v1\/|sha256/i);
    expect(container.innerHTML).toContain(`/api/artifacts/${CAPTURE_ARTIFACT_ID}`);
  });
});

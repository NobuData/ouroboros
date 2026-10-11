import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CAPTURE_LABEL,
  CAPTURE_READ_ONLY,
  CAPTURE_RELEASE_LABEL,
  CAPTURE_REPOSITORY_LABEL,
  CAPTURE_SUBMIT,
  CLOSE,
  DISMISS_READ_ONLY,
  DISMISS_REASON_LABEL,
  DISMISS_SUBMIT,
  DISMISS_TITLE,
  NO_BASELINES_TITLE,
  NO_DRIFT,
  WATCH_CAPTION,
  WATCH_UNREADABLE,
} from "@/app/research/side";
import type { WatchCardProps } from "@/app/research/watch-card";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { emptyWatch, needsReproItem, seededWatch, seededWatchItems, watchItem } from "../helpers/research";

/**
 * The regression watch card as it is drawn (CN.3, #629). The acceptance criteria this suite
 * holds, in the ticket's words: **the seeded card matches the mockup row-for-row**; **watch rows
 * link correctly: the commit, the run (`#512`) and the PR (`#641`)**; **a `needs repro` item
 * renders with its explanation**; **dismiss records and removes the row; the no-baselines empty
 * state offers capture to owners only**; the caption verbatim; both palettes.
 */

const dismissWatchItem = vi.fn();
const captureBaselines = vi.fn();
const onChanged = vi.fn();

vi.mock("@/app/research/side-actions", () => ({
  dismissWatchItem: (id: unknown, reason: unknown) => dismissWatchItem(id, reason),
  captureBaselines: (repository: unknown, releaseTag: unknown) => captureBaselines(repository, releaseTag),
}));

const { WatchCard } = await import("@/app/research/watch-card");

const HOVER = "5eed0096-0000-4000-8000-000000000101";

function card(over: Partial<WatchCardProps> = {}) {
  return (
    <WatchCard mayAdminister onChanged={onChanged} reading={{ ok: true, value: seededWatch() }} {...over} />
  );
}

function region(): HTMLElement {
  return screen.getByRole("region", { name: "Regression watch" });
}

/** The card's rows, as `[severity, title, sub-line, pill]`. */
function rows(): string[][] {
  return within(region())
    .getAllByRole("listitem")
    .map((row) => [
      within(row).getByRole("img").className.replace("research__dot research__dot--", ""),
      row.querySelector(".research__side-name")?.textContent ?? "",
      row.querySelector(".research__side-sub")?.textContent ?? "",
      row.querySelector(".ou-chip")?.textContent ?? "",
    ]);
}

beforeEach(() => {
  dismissWatchItem.mockReset();
  captureBaselines.mockReset();
  onChanged.mockReset();
});

describe("the seeded card", () => {
  it("draws mockup 22's three rows: severity, drift, composed sub-line and pill", () => {
    render(card());

    expect(rows()).toEqual([
      ["err", "Hover drift +14% since v2.0.4", "bisected → a41f2c9 · fix loop running · #512", "fixing"],
      ["warn", "Boot time +230 ms since v2.1.0-rc1", "bisected → 7c03d1e · fix ticket drafted · #517", "queued"],
      ["ok", "Soc error +2.8% since v2.0.4", "root-caused, fixed & merged · PR #641", "✓ merged"],
    ]);
  });

  it("names the baseline in its tag and prints the caption verbatim", () => {
    render(card({ reading: { ok: true, value: seededWatch({ headline: "nightly vs. v2.0.4 baseline" }) } }));

    expect(within(region()).getByText("nightly vs. v2.0.4 baseline")).toBeInTheDocument();
    expect(within(region()).getByText(WATCH_CAPTION)).toBeInTheDocument();
  });

  it("pulses the pill of a fix in flight and of nothing else", () => {
    render(card());

    const pulsing = [...region().querySelectorAll(".ou-chip")].map(
      (chip) => chip.querySelector(".ou-chip__dot--pulse") !== null,
    );

    expect(pulsing).toEqual([true, false, false]);
  });

  it("is the same card in both palettes", () => {
    const [light, dark] = renderInBothPalettes(card()).map(maskIds);

    expect(light).toBe(dark);
  });
});

describe("where a row leads", () => {
  it("links the bisect's commit to its page on the code host", () => {
    render(card());

    const commit = within(region()).getByRole("link", { name: "a41f2c9" });

    expect(commit).toHaveAttribute(
      "href",
      "https://github.com/acme-robotics/helios-firmware/commit/a41f2c95d0b7e31c8a64f20e9d1b37c55a8f06e2",
    );
    expect(commit).toHaveAttribute("target", "_blank");
    expect(commit).toHaveAttribute("rel", "noreferrer");
  });

  it("links #512 to its run console, keeping Research lit", () => {
    render(card());

    const run = within(region()).getByRole("link", { name: "#512" });

    expect(run).toHaveAttribute("href", "/runs/5eed0009-0000-4000-8000-000000000512?from=research");
    expect(run).not.toHaveAttribute("target");
  });

  it("links a ticket with no run to its tracker page", () => {
    render(card());

    expect(within(region()).getByRole("link", { name: "#517" })).toHaveAttribute(
      "href",
      "https://github.com/acme-robotics/helios-firmware/issues/517",
    );
  });

  it("links PR #641 to its verification page", () => {
    render(card());

    expect(within(region()).getByRole("link", { name: "PR #641" })).toHaveAttribute(
      "href",
      "/prs/5eed0098-0000-4000-8000-000000000641?from=research",
    );
  });
});

describe("a needs-repro item", () => {
  it("is its own row, with the service's explanation and its detected pill", () => {
    render(card({ reading: { ok: true, value: seededWatch({ items: [...seededWatchItems(), needsReproItem()] }) } }));

    const row = rows()[3];

    expect(row).toEqual([
      "warn",
      "Fan rpm variance +9% since v2.0.4",
      "needs repro: no replayable test is configured for this metric, so it cannot be bisected",
      "detected",
    ]);
    expect(within(region()).getAllByRole("listitem")[3].className).toContain("research__side-row--repro");
    expect(screen.getByRole("button", { name: "Dismiss Fan rpm variance +9% since v2.0.4" })).toBeInTheDocument();
  });
});

describe("dismiss", () => {
  it("is offered on open items only", () => {
    render(card());

    expect(within(region()).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Dismiss Hover drift +14% since v2.0.4",
      "Dismiss Boot time +230 ms since v2.1.0-rc1",
    ]);
  });

  it("asks for a reason, records it, removes the row and asks the card to re-read", async () => {
    dismissWatchItem.mockResolvedValue({ ok: true, value: HOVER });
    render(card());

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Hover drift +14% since v2.0.4" }));
    const dialog = screen.getByRole("dialog", { name: DISMISS_TITLE });
    const submit = within(dialog).getByRole("button", { name: DISMISS_SUBMIT });

    // No reason, no dismissal: the audit log would have nothing to say.
    fireEvent.click(submit);
    expect(dismissWatchItem).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(DISMISS_REASON_LABEL), {
      target: { value: "  bench sensor was swapped — not a regression  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: DISMISS_SUBMIT }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(dismissWatchItem).toHaveBeenCalledWith(HOVER, "bench sensor was swapped — not a regression");
    expect(rows().map((row) => row[1])).toEqual(["Boot time +230 ms since v2.1.0-rc1", "Soc error +2.8% since v2.0.4"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("prints the service's refusal and keeps the row", async () => {
    dismissWatchItem.mockResolvedValue({
      ok: false,
      refusal: { code: "conflict", message: "This item is already closed.", details: {} },
    });
    render(card());

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Hover drift +14% since v2.0.4" }));
    const dialog = screen.getByRole("dialog", { name: DISMISS_TITLE });
    fireEvent.change(within(dialog).getByLabelText(DISMISS_REASON_LABEL), { target: { value: "noise" } });
    fireEvent.click(within(dialog).getByRole("button", { name: DISMISS_SUBMIT }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This item is already closed.");
    expect(rows()).toHaveLength(3);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("is inert, with the reason, for a reader who may not administer", () => {
    render(card({ mayAdminister: false }));

    const button = screen.getByRole("button", { name: "Dismiss Hover drift +14% since v2.0.4" });
    fireEvent.click(button);

    expect(button).toHaveAttribute("title", DISMISS_READ_ONLY);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not draw an item somebody already dismissed", () => {
    render(
      card({
        reading: { ok: true, value: seededWatch({ items: [watchItem({ status: "dismissed" }), ...seededWatchItems().slice(1)] }) },
      }),
    );

    expect(rows().map((row) => row[1])).toEqual(["Boot time +230 ms since v2.1.0-rc1", "Soc error +2.8% since v2.0.4"]);
  });
});

describe("a workspace with no baseline", () => {
  it("offers an administrator a baseline to capture, instead of an empty box", () => {
    render(card({ reading: { ok: true, value: emptyWatch() } }));

    expect(within(region()).getByText(NO_BASELINES_TITLE)).toBeInTheDocument();
    expect(within(region()).getByRole("button", { name: CAPTURE_LABEL })).toBeInTheDocument();
    expect(within(region()).queryByRole("list")).toBeNull();
  });

  it("tells everyone else who may, and offers no button", () => {
    render(card({ mayAdminister: false, reading: { ok: true, value: emptyWatch() } }));

    expect(within(region()).getByText(CAPTURE_READ_ONLY)).toBeInTheDocument();
    expect(within(region()).queryByRole("button")).toBeNull();
  });

  it("captures the named release, says what was stored, and re-reads on close", async () => {
    captureBaselines.mockResolvedValue({
      ok: true,
      value: {
        repository: "acme-robotics/helios-firmware",
        releaseTag: "v2.0.4",
        captured: [{}, {}],
        skipped: [{ metric: "boot_time_ms", reason: "too few samples" }],
      },
    });
    render(card({ reading: { ok: true, value: emptyWatch() } }));

    fireEvent.click(screen.getByRole("button", { name: CAPTURE_LABEL }));
    const dialog = screen.getByRole("dialog", { name: CAPTURE_LABEL });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(CAPTURE_REPOSITORY_LABEL)), {
      target: { value: " acme-robotics/helios-firmware " },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(CAPTURE_RELEASE_LABEL)), {
      target: { value: "v2.0.4" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: CAPTURE_SUBMIT }));

    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "Captured 2 baselines. Skipped: boot_time_ms (too few samples).",
    );
    expect(captureBaselines).toHaveBeenCalledWith("acme-robotics/helios-firmware", "v2.0.4");
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: CLOSE }));

    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("prints the service's refusal of a capture", async () => {
    captureBaselines.mockResolvedValue({
      ok: false,
      refusal: { code: "regression_watch_nothing_watched", message: "No metric is watched for that repository.", details: {} },
    });
    render(card({ reading: { ok: true, value: emptyWatch() } }));

    fireEvent.click(screen.getByRole("button", { name: CAPTURE_LABEL }));
    const dialog = screen.getByRole("dialog", { name: CAPTURE_LABEL });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(CAPTURE_REPOSITORY_LABEL)), {
      target: { value: "acme-robotics/helios-firmware" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(CAPTURE_RELEASE_LABEL)), { target: { value: "v9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: CAPTURE_SUBMIT }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No metric is watched for that repository.");
  });
});

describe("when there is nothing drifting, or nothing to read", () => {
  it("says nothing has drifted when baselines exist and no item does", () => {
    render(card({ reading: { ok: true, value: seededWatch({ items: [] }) } }));

    expect(within(region()).getByText(NO_DRIFT)).toBeInTheDocument();
    expect(within(region()).queryByRole("button", { name: CAPTURE_LABEL })).toBeNull();
  });

  it("says the watch could not be read, in the service's words, with no caption", () => {
    render(card({ reading: { ok: false, reason: "The service failed." } }));

    expect(within(region()).getByText(WATCH_UNREADABLE)).toBeInTheDocument();
    expect(within(region()).getByText("The service failed.")).toBeInTheDocument();
    expect(within(region()).queryByText(WATCH_CAPTION)).toBeNull();
  });
});

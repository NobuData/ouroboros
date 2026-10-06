import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReceiptCard } from "@/app/get-started/receipt-card";
import { receiptView } from "@/app/get-started/view";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { completed, launchReceipt, mirrored } from "../helpers/onboarding";

/**
 * The completion state (BC.6, #395): the receipt card says what the service answered — position
 * and dry-run note fresh from the press, the rail's evidence after a reload — links the
 * dashboard, the queue and the console (or says why not yet), and re-enters for another repository.
 */

/** The card. */
const card = () => screen.getByRole("region", { name: "Your first loop is queued" });

afterEach(() => {
  cleanup();
});

describe("fresh from the press", () => {
  it("prints the receipt: issue, workflow and version, queue position, dry-run note, and the three links", () => {
    const receipt = launchReceipt({
      queue: {
        id: "q-1",
        issueNumber: 488,
        issueTitle: "Bootloader: verify image CRC before jump",
        effort: "xs",
        workflowTag: "quick-fixes",
        workflowVersion: 1,
        workflowPinReason: "explicit",
        position: 13,
        estMinutes: 6,
        enqueuedAt: "2026-10-05T09:00:00.000Z",
        playbookId: null,
      },
      links: { dashboard: "/dashboard", queue: "/dashboard#dash-up-next-title", console: "/runs/run-1" },
    });

    render(<ReceiptCard view={receiptView(receipt, completed(), mirrored())} />);

    expect(within(card()).getByText("✓ step 4 done")).toBeInTheDocument();
    expect(card()).toHaveTextContent("#488 queued under quick-fixes@v1 · queue position 13");
    expect(card()).toHaveTextContent("Dry-run is on: the PR opens as a draft and nothing merges until you say so.");

    const links = within(card()).getByRole("list", { name: "Where to go next" });
    expect(within(links).getByRole("link", { name: "Open the dashboard →" })).toHaveAttribute("href", "/dashboard");
    expect(within(links).getByRole("link", { name: "See it in the queue →" })).toHaveAttribute("href", "/dashboard#dash-up-next-title");
    expect(within(links).getByRole("link", { name: "Open the run console →" })).toHaveAttribute("href", "/runs/run-1");
  });

  it("says next in the queue for position 1, and says — rather than links — a console that does not exist yet", () => {
    const receipt = launchReceipt({
      queue: {
        id: "q-1",
        issueNumber: 488,
        issueTitle: "Bootloader: verify image CRC before jump",
        effort: "xs",
        workflowTag: "quick-fixes",
        workflowVersion: 1,
        workflowPinReason: "explicit",
        position: 1,
        estMinutes: null,
        enqueuedAt: "2026-10-05T09:00:00.000Z",
        playbookId: null,
      },
    });

    render(<ReceiptCard view={receiptView(receipt, completed(), mirrored())} />);

    expect(card()).toHaveTextContent("· next in the queue");
    expect(within(card()).queryByRole("link", { name: "Open the run console →" })).toBeNull();
    expect(card()).toHaveTextContent("The run console opens once a loop claims the issue");
    expect(within(card()).getByRole("link", { name: "Runs →" })).toHaveAttribute("href", "/runs");
  });
});

describe("after a reload", () => {
  it("prints the rail's own evidence and no position or note the service did not answer", () => {
    render(<ReceiptCard view={receiptView(null, completed(), mirrored())} />);

    expect(card()).toHaveTextContent("#488 · queued");
    expect(card()).not.toHaveTextContent(/queue position|Dry-run is on/);
    expect(within(card()).getByRole("link", { name: "Open the dashboard →" })).toHaveAttribute("href", "/dashboard");
    expect(within(card()).getByRole("link", { name: "See it in the queue →" })).toHaveAttribute("href", "/dashboard#dash-up-next-title");
  });
});

describe("re-enter", () => {
  it("offers the workspace's other mirrored repositories, each the address of its own wizard", () => {
    render(<ReceiptCard view={receiptView(null, completed(), mirrored())} />);

    const others = within(card()).getByRole("list", { name: "Set up another repository" });
    expect(within(others).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["acme-robotics/helios-console →", "/get-started?repo=acme-robotics%2Fhelios-console"],
    ]);
  });

  it("says so when there is no other repository, and points at Settings → Sources", () => {
    render(<ReceiptCard view={receiptView(null, completed(), null)} />);

    expect(card()).toHaveTextContent("Every repository this workspace mirrors is this one.");
    expect(within(card()).getByRole("link", { name: "Connect more in Settings → Sources ↗" })).toHaveAttribute("href", "/settings/sources");
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<ReceiptCard view={receiptView(launchReceipt(), completed(), mirrored())} />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("wizard-receipt");
  });
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReadinessCard } from "@/app/get-started/readiness-card";
import {
  DISABLED_LINK,
  DISABLED_TITLE,
  DRY_RUN_LINE,
  LIVE_EXECUTION_ADMIN_DOCS,
  READINESS_PENDING,
  UNKNOWN_NOTE,
} from "@/app/get-started/readiness-view";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { DEPLOYMENT_OFF, NO_RUNNER, PUSH_UNCONFIRMED, readiness } from "../helpers/readiness";

/**
 * Step 4's readiness card (DK.2, #1319): each state's design — passes collapsed, failures expanded
 * with their fix, unknowns explained, the execution-disabled notice, the labelled estimate.
 */

/** The card. */
const card = () => screen.getByRole("region", { name: "Ready to run?" });

/** The rows' list. */
const rows = () => within(card()).getByRole("list", { name: "What a live loop needs" });

afterEach(() => {
  cleanup();
});

describe("the readiness card", () => {
  it("says it is checking before the preflight is heard, and why when it cannot be", () => {
    const { rerender } = render(<ReadinessCard failure={null} readiness={null} />);

    expect(within(card()).getByRole("status")).toHaveTextContent(READINESS_PENDING);

    rerender(<ReadinessCard failure="Readiness could not be checked." readiness={null} />);

    expect(within(card()).getByRole("alert")).toHaveTextContent("Readiness could not be checked.");
  });

  it("collapses every pass behind a toggle when ready, and says the safety and the estimate", () => {
    render(<ReadinessCard failure={null} readiness={readiness()} />);

    expect(card()).toHaveTextContent("acme-robotics/helios-firmware · #488 Typo sweep in operator manual + pairing guide · size S");
    expect(within(rows()).getByText("✓ 12 checks passed")).toBeInTheDocument();
    expect(within(rows()).queryByText("A runner is online in pool-a.")).not.toBeInTheDocument();
    expect(card()).toHaveTextContent(DRY_RUN_LINE);
    expect(card()).toHaveTextContent("Estimate cap $2.00 per run · issue sized S (heuristic-v0)");
  });

  it("opens and closes the passes from the keyboard-reachable toggle", () => {
    render(<ReadinessCard failure={null} readiness={readiness()} />);

    const toggle = within(rows()).getByRole("button", { name: "show" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(within(rows()).getByRole("button", { name: "hide" })).toHaveAttribute("aria-expanded", "true");
    expect(within(rows()).getByText("A runner is online in pool-a.")).toBeInTheDocument();
    expect(within(rows()).getAllByRole("img", { name: "Passed" })).toHaveLength(12);
  });

  it("expands a failure with its reason and its fix link", () => {
    render(<ReadinessCard failure={null} readiness={readiness(NO_RUNNER)} />);

    expect(within(rows()).getByRole("img", { name: "Failed" })).toBeInTheDocument();
    expect(within(rows()).getByText(NO_RUNNER.reason)).toBeInTheDocument();
    expect(within(rows()).getByRole("link", { name: "Build Farm · enrol a runner →" })).toHaveAttribute("href", "/build-farm");
    expect(within(rows()).getByText("✓ 11 checks passed")).toBeInTheDocument();
  });

  it("explains an unknown beside its reason", () => {
    render(<ReadinessCard failure={null} readiness={readiness(PUSH_UNCONFIRMED)} />);

    expect(within(rows()).getByRole("img", { name: "Could not be confirmed" })).toBeInTheDocument();
    expect(within(rows()).getByText(PUSH_UNCONFIRMED.reason)).toBeInTheDocument();
    expect(within(rows()).getByText(UNKNOWN_NOTE)).toBeInTheDocument();
    expect(within(rows()).getByRole("link", { name: "Sources · check the token →" })).toHaveAttribute(
      "href",
      "/settings/sources",
    );
  });

  it("opens a documentation fix in a new tab", () => {
    render(
      <ReadinessCard
        failure={null}
        readiness={readiness({
          id: "concurrency",
          state: "fail",
          code: "concurrency_ceiling",
          reason: "All 1 live-run slots are in use.",
          fix: { label: "Live execution · the concurrency ceiling", href: "https://docs.ouroboros.build/administration/live-execution#limits" },
        })}
      />,
    );

    const link = within(rows()).getByRole("link", { name: "Live execution · the concurrency ceiling →" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("leads with the execution-disabled design, names the switch, links the administration page, and drops the row it restates", () => {
    render(<ReadinessCard failure={null} readiness={readiness(DEPLOYMENT_OFF, NO_RUNNER)} />);

    const note = within(card()).getByRole("note");
    expect(note).toHaveTextContent(DISABLED_TITLE);
    expect(note).toHaveTextContent("OURO_LIVE_EXECUTION_ENABLED");
    expect(within(note).getByRole("link", { name: DISABLED_LINK })).toHaveAttribute("href", LIVE_EXECUTION_ADMIN_DOCS);
    expect(within(rows()).queryByText(DEPLOYMENT_OFF.reason)).not.toBeInTheDocument();
    expect(within(rows()).getByText(NO_RUNNER.reason)).toBeInTheDocument();
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<ReadinessCard failure={null} readiness={readiness(NO_RUNNER, PUSH_UNCONFIRMED)} />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("readiness-card");
  });
});

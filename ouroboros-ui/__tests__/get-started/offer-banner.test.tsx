import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { settle } from "../helpers/settle";
import { REPO } from "../helpers/onboarding";

/**
 * The dashboard's *Get started* banner (#390): shown while the fresh-org rule offers the wizard,
 * dismissible by anyone, and gone the moment the service stops offering it.
 */

const dismissWizard = vi.fn();

vi.mock("@/app/get-started/actions", () => ({ dismissWizard: (repo: string) => dismissWizard(repo) }));

const { GetStartedBanner } = await import("@/app/get-started/offer-banner");

beforeEach(() => {
  dismissWizard.mockReset();
});

describe("the Get Started banner", () => {
  it("links to the wizard for the repository it opens on", () => {
    render(<GetStartedBanner offer={{ repo: REPO }} />);

    expect(screen.getByRole("region", { name: "Get started" })).toHaveTextContent(
      "New workspace — your first loop in about 4 minutes.",
    );
    expect(screen.getByRole("link", { name: "Get started →" })).toHaveAttribute(
      "href",
      "/get-started?repo=acme-robotics%2Fhelios-firmware",
    );
  });

  it("goes once dismissed — the service stopped offering it", async () => {
    dismissWizard.mockResolvedValue({ ok: true, value: false });
    render(<GetStartedBanner offer={{ repo: REPO }} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await settle();

    expect(dismissWizard).toHaveBeenCalledWith(REPO);
    expect(screen.queryByRole("region", { name: "Get started" })).toBeNull();
  });

  it("stays, and says why, when the dismissal is refused", async () => {
    dismissWizard.mockResolvedValue({ ok: false, reason: "That did not go through. Try again." });
    render(<GetStartedBanner offer={{ repo: REPO }} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("That did not go through. Try again.");
  });

  it("links bare and cannot dismiss when no repository is mirrored yet — said, not hidden", () => {
    render(<GetStartedBanner offer={{ repo: null }} />);

    expect(screen.getByRole("link", { name: "Get started →" })).toHaveAttribute("href", "/get-started");

    const dismiss = screen.getByRole("button", { name: "Dismiss" });

    expect(dismiss).toHaveAttribute("aria-disabled", "true");
    expect(dismiss).toHaveAccessibleDescription(/until a repository is connected/);
    fireEvent.click(dismiss);
    expect(dismissWizard).not.toHaveBeenCalled();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { enablement, membership, org, repo } from "../helpers/login";

// The switches submit to Server Actions, whose module reaches for `next/cache`,
// `next/navigation` and the server-only client. Replacing it keeps this suite about the
// markup; what the actions do is `__tests__/login/actions.test.ts`.
vi.mock("@/app/login/actions", () => ({
  chooseWorkspace: vi.fn(),
  setOrgEnabled: vi.fn(),
  setRepoEnabled: vi.fn(),
}));

const { EnablementCard } = await import("@/app/login/enablement-card");

/**
 * Step 2 in its working form: organisations, their repositories, and who may change either.
 *
 * The acceptance criteria run through here — "toggle a repo" and "land on the dashboard" are
 * both this card — so the cases below are the mockup's row anatomy, the repository level the
 * mockup does not draw, the read-only state for a role that may only look, and the counts
 * saying what they actually know.
 */

const ADMIN = membership({ role: "admin" });
const VIEWER = membership({ role: "viewer" });

/** The seeded world: one organisation, one repository, both on. */
const SEEDED = enablement([[org(), [repo()]]]);

describe("<EnablementCard>", () => {
  it("keeps the mockup's head, naming the workspace being configured", () => {
    render(<EnablementCard membership={ADMIN} enablement={SEEDED} />);

    expect(
      screen.getByRole("heading", { name: "Choose where the loop runs" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Step 2 · acme-robotics/)).toBeInTheDocument();
  });

  it("renders one switch for the organisation and one for each repository under it", () => {
    render(<EnablementCard membership={ADMIN} enablement={SEEDED} />);

    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(
      screen.getByRole("switch", { name: "Disable the acme-robotics organisation" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("switch", { name: "Disable acme-robotics/helios-firmware" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("names what pressing a switch would do, which flips with the state", () => {
    render(
      <EnablementCard
        membership={ADMIN}
        enablement={enablement([[org({ enabled: false }), [repo({ enabled: false })]]])}
      />,
    );

    expect(
      screen.getByRole("switch", { name: "Enable the acme-robotics organisation" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("switch", { name: "Enable acme-robotics/helios-firmware" }),
    ).toBeInTheDocument();
  });

  it("writes the mockup's summary line under the organisation", () => {
    render(<EnablementCard membership={ADMIN} enablement={SEEDED} />);

    expect(screen.getByText("1 repo enabled · incl. helios-firmware")).toBeInTheDocument();
  });

  it("shows a repository's default branch when one is known, and nothing when it is not", () => {
    const { container } = render(
      <EnablementCard
        membership={ADMIN}
        enablement={enablement([
          [org(), [repo(), repo({ id: "2", name: "orbital-sim", defaultBranch: null })]],
        ])}
      />,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(container.querySelectorAll(".login-repo__branch")).toHaveLength(1);
  });

  it("offers the way out to the dashboard", () => {
    render(<EnablementCard membership={ADMIN} enablement={SEEDED} />);

    expect(screen.getByRole("link", { name: /Enter mission control/ })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("keeps the least-privilege note", () => {
    render(<EnablementCard membership={ADMIN} enablement={SEEDED} />);

    expect(screen.getByText(/least-privilege scopes/)).toBeInTheDocument();
  });
});

describe("<EnablementCard>, for a role that may only read", () => {
  it("marks every switch unavailable rather than hiding them", () => {
    // A list with the switches hidden would look like a list with no settings.
    render(<EnablementCard membership={VIEWER} enablement={SEEDED} />);

    const switches = screen.getAllByRole("switch");

    expect(switches).toHaveLength(2);
    for (const control of switches) {
      expect(control).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("says once, in the card, which role it is and why nothing moves", () => {
    render(<EnablementCard membership={VIEWER} enablement={SEEDED} />);

    expect(screen.getByText(/You are a viewer in Acme Robotics/)).toBeInTheDocument();
    expect(screen.getAllByRole("switch")[0]).toHaveAccessibleDescription(
      /Only an owner or admin/,
    );
  });

  it("keeps the switches showing the real state, so the page is still a report", () => {
    render(
      <EnablementCard
        membership={VIEWER}
        enablement={enablement([[org(), [repo({ enabled: false })]]])}
      />,
    );

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("switch")[1]).toHaveAttribute("aria-checked", "false");
  });

  it("lets an owner press them", () => {
    render(<EnablementCard membership={membership({ role: "owner" })} enablement={SEEDED} />);

    for (const control of screen.getAllByRole("switch")) {
      expect(control).not.toHaveAttribute("aria-disabled");
    }
  });
});

describe("<EnablementCard>, with nothing to show", () => {
  it("explains an empty list instead of leaving a blank region", () => {
    render(<EnablementCard membership={ADMIN} enablement={enablement([])} />);

    expect(screen.getByText(/No GitHub organisations are recorded/)).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("still offers the way out, because an empty list is not a dead end", () => {
    render(<EnablementCard membership={ADMIN} enablement={enablement([])} />);

    expect(screen.getByRole("link", { name: /Enter mission control/ })).toBeInTheDocument();
  });

  it("says how many organisations it is not showing", () => {
    // No silent caps: a hundred rows presented as all of them is a claim, not a page.
    render(<EnablementCard membership={ADMIN} enablement={enablement([[org(), []]], 340)} />);

    expect(screen.getByText("Showing 1 of 340 organisations.")).toBeInTheDocument();
  });

  it("says nothing about totals when it is showing all of them", () => {
    render(<EnablementCard membership={ADMIN} enablement={SEEDED} />);

    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });
});

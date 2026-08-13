import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { membership, seededWorkspaces } from "../helpers/login";

// The switches and the CTA submit to Server Actions, whose module reaches for `next/cache`,
// `next/navigation` and the server-only client. Replacing it keeps this suite about the
// markup; what the actions do is `__tests__/login/actions.test.ts`.
vi.mock("@/app/login/actions", () => ({
  enterMissionControl: vi.fn(),
  setWorkspaceEnabled: vi.fn(),
}));

const { EnablementCard } = await import("@/app/login/enablement-card");

/**
 * Step 2 in its working form — the mockup's second card, row for row.
 *
 * **The rows are workspaces since
 * [#719](https://github.com/NobuData/ouroboros/issues/719)**, drawn from
 * `GET /api/v1/orgs`'s row model rather than from one chosen workspace's GitHub
 * organisations and their repositories. So the acceptance criteria run straight through
 * here: *seeded data reproduces the mockup's three rows exactly — counts, pill, switch
 * states*, *as a member the switch is disabled*, and *the CTA lands on the dashboard with
 * the active org set*.
 *
 * The last of those is only half here. What this card can be asked is whether the press
 * submits the workspace that is selected; what happens then is `actions.test.ts`.
 */

/** The mockup's three rows, and the first of them. */
const SEEDED = seededWorkspaces();
const [ACME, LABS, PERSONAL] = SEEDED;

/**
 * The card, around whichever rows a case is about.
 *
 * @param memberships The workspaces to draw. Defaults to the mockup's three.
 * @param active Which row starts selected. Defaults to the first.
 * @param total How many exist. Defaults to the number drawn.
 * @returns Nothing; renders into the suite's DOM.
 */
function card(
  memberships: readonly ReturnType<typeof membership>[] = SEEDED,
  active = memberships[0],
  total = memberships.length,
) {
  render(<EnablementCard memberships={memberships} active={active} total={total} />);
}

/**
 * One row of the card, by the workspace it names.
 *
 * @param slug The workspace's slug, as the row prints it.
 * @returns The `li` the row is drawn in.
 */
function row(slug: string): HTMLElement {
  const found = screen.getByText(slug).closest("li");
  if (found === null) throw new Error(`no row for ${slug}`);
  return found;
}

describe("<EnablementCard>, against the mockup", () => {
  it("keeps the mockup's head", () => {
    card();

    expect(screen.getByText("After sign-in · Step 2")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Choose where the loop runs" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Enable the GitHub orgs Ouroboros may work in.")).toBeInTheDocument();
  });

  it("reproduces the three rows the seed writes, exactly as the drawing has them", () => {
    // The acceptance criterion, in one case: three names, three summary lines, three
    // switches in the states the mockup draws them in.
    card();

    expect(screen.getAllByRole("switch")).toHaveLength(3);

    expect(within(row("acme-robotics")).getByText("AR")).toBeInTheDocument();
    expect(
      within(row("acme-robotics")).getByText("4 repos enabled · incl. helios-firmware"),
    ).toBeInTheDocument();

    expect(within(row("acme-labs")).getByText("AL")).toBeInTheDocument();
    expect(within(row("acme-labs")).getByText("0 repos enabled")).toBeInTheDocument();

    expect(within(row("kensuenobu")).getByText("KS")).toBeInTheDocument();
    // The drawing prints "2 repos enabled" here and the seed has two enabled repositories
    // under `kensuenobu`, so the service names the earliest of them — `openapi.yaml`'s own
    // example for this very row. The mockup's line is the drawing being terse rather than
    // the rule being different, and a row that hid a repository the service named would be
    // less honest than the one that shows it.
    expect(
      within(row("kensuenobu")).getByText("2 repos enabled · incl. dotfiles"),
    ).toBeInTheDocument();
  });

  it("draws the switches in the states the seeded data puts them in", () => {
    card();

    expect(
      screen.getByRole("switch", { name: "Disable Ouroboros in acme-robotics" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("switch", { name: "Enable Ouroboros in acme-labs" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("switch", { name: "Disable Ouroboros in kensuenobu" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("names what pressing a switch would do, which flips with the state", () => {
    card([membership({ enabled: false })]);

    expect(
      screen.getByRole("switch", { name: "Enable Ouroboros in acme-robotics" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("wears the personal pill on the one workspace the service flagged", () => {
    card();

    expect(within(row("kensuenobu")).getByText("personal")).toBeInTheDocument();
    expect(within(row("acme-robotics")).queryByText("personal")).not.toBeInTheDocument();
  });

  it("ticks the enabled rows, and hides the tick from a screen reader", () => {
    // The switch on the same row already announces the state; a second reading of it would
    // be noise, and hue is never the only signal.
    card();

    const tick = within(row("acme-robotics")).getByText("✓");

    expect(tick).toHaveAttribute("aria-hidden", "true");
    expect(within(row("acme-labs")).queryByText("✓")).not.toBeInTheDocument();
  });

  it("draws the monogram the service derived rather than one of its own", () => {
    // `OrgRow.monogram` is computed where the name is, on purpose: a browser deriving it
    // would be a second place the rule lives.
    card([membership({ name: "Acme Robotics", monogram: "ZZ" })]);

    expect(screen.getByText("ZZ")).toBeInTheDocument();
  });

  it("keeps the least-privilege note", () => {
    card();

    expect(screen.getByText(/least-privilege scopes/)).toBeInTheDocument();
  });

  it("offers the way out, as a control that acts rather than a link that only navigates", () => {
    // The press is what writes the session's active organization; a link could not have.
    card();

    expect(screen.getByRole("button", { name: /Enter mission control/ })).toHaveAttribute(
      "type",
      "submit",
    );
  });
});

describe("<EnablementCard>, choosing which workspace to enter", () => {
  it("offers one radio per workspace, in the form the CTA submits", () => {
    const { container } = render(
      <EnablementCard memberships={SEEDED} active={ACME} total={3} />,
    );

    const radios = screen.getAllByRole("radio");
    const form = container.querySelector("form#login-enter");

    expect(radios).toHaveLength(3);
    expect(form).not.toBeNull();
    for (const radio of radios) {
      expect(radio).toHaveAttribute("name", "workspace");
      // Associated by `form=` rather than by nesting: a form may not contain another form,
      // and every switch on this card is one.
      expect(radio).toHaveAttribute("form", "login-enter");
    }
  });

  it("starts on the workspace the session is acting in", () => {
    card(SEEDED, PERSONAL);

    expect(within(row("kensuenobu")).getByRole("radio")).toBeChecked();
    expect(within(row("acme-robotics")).getByRole("radio")).not.toBeChecked();
  });

  it("submits the slug of whichever row is chosen", () => {
    card(SEEDED, LABS);

    expect(within(row("acme-labs")).getByRole("radio")).toHaveAttribute("value", "acme-labs");
  });

  it("labels the radio with the workspace, so the choice is announced as one", () => {
    card();

    expect(
      screen.getByRole("radio", { name: /acme-robotics/ }),
    ).toBeInTheDocument();
  });

  it("draws no radio at all when there is only one workspace to enter", () => {
    // A radio group of one is a control that cannot be changed. The form still carries the
    // workspace, so the press is unchanged.
    const { container } = render(
      <EnablementCard memberships={[ACME]} active={ACME} total={1} />,
    );

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(container.querySelector('input[type="hidden"][name="workspace"]')).toHaveAttribute(
      "value",
      "acme-robotics",
    );
  });
});

describe("<EnablementCard>, for a role that may only read", () => {
  it("marks the member's switch unavailable rather than hiding it", () => {
    // A list with the switches hidden would look like a list with no settings. The seeded
    // world has exactly this shape: an owner of two workspaces, a member of the third.
    card();

    expect(
      screen.getByRole("switch", { name: "Enable Ouroboros in acme-labs" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("switch", { name: "Disable Ouroboros in acme-robotics" }),
    ).not.toHaveAttribute("aria-disabled");
  });

  it("says once, in the card, why a switch will not move", () => {
    card();

    expect(screen.getByText(/Only an owner or admin can change/)).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Enable Ouroboros in acme-labs" }),
    ).toHaveAccessibleDescription(/Only an owner or admin/);
  });

  it("says nothing about roles when every row is one this person administers", () => {
    card([ACME, PERSONAL]);

    expect(screen.queryByText(/Only an owner or admin can change/)).not.toBeInTheDocument();
  });

  it("keeps a read-only switch showing the real state, so the page is still a report", () => {
    card([membership({ roles: ["viewer"], enabled: true })]);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true");
  });

  it("refuses a membership carrying no role the service recognises", () => {
    card([membership({ roles: [] })]);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true");
  });

  it("lets a viewer still choose which workspace to enter", () => {
    // Reading a workspace is what a viewer may do; entering one is reading it.
    card([membership({ roles: ["viewer"] }), LABS]);

    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });
});

describe("<EnablementCard>, with nothing under a workspace to enable", () => {
  it("marks the switch unavailable and says why", () => {
    // There is nothing for a press to act on: the flag the row summarises belongs to the
    // GitHub organisations under it, and there are none.
    card([membership({ githubOrgs: [], enabled: false })]);

    const control = screen.getByRole("switch");

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("title", expect.stringContaining("GitHub App installation"));
  });

  it("still draws the row, the count and the way out", () => {
    card([
      membership({
        githubOrgs: [],
        enabled: false,
        repoCounts: { enabled: 0, total: 0 },
        featuredRepo: null,
      }),
    ]);

    expect(screen.getByText("acme-robotics")).toBeInTheDocument();
    expect(screen.getByText("0 repos enabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enter mission control/ })).toBeInTheDocument();
  });
});

describe("<EnablementCard>, and what it does not claim", () => {
  it("says how many workspaces it is not showing", () => {
    // No silent caps: a hundred rows presented as all of them is a claim, not a page.
    card(SEEDED, ACME, 340);

    expect(screen.getByText("Showing 3 of 340 workspaces.")).toBeInTheDocument();
  });

  it("says nothing about totals when it is showing all of them", () => {
    card();

    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });
});

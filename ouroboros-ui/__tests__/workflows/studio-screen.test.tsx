import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WORKFLOWS_PATH, workflowPath } from "@/app/paths";
import {
  CANVAS_SOON_TITLE,
  DEV_SEED_NOTE,
  EMPTY_TITLE,
  FAILED_TITLE,
  MISSING_TITLE,
  RAIL_FAILED_HEADLINE,
  SEAT_FAILED_NOTE,
  WORKFLOW_FAILED_HEADLINE,
} from "@/app/workflows/states";
import {
  BROWSE_TEMPLATES_LABEL,
  BROWSE_TEMPLATES_SOON,
  CODE_SOON_NOTE,
  COPILOT_SOON_NOTE,
  DRY_RUN_LABEL,
  DRY_RUN_SOON,
  NEW_WORKFLOW_LABEL,
  NEW_WORKFLOW_MEMBER_REASON,
  PUBLISH_SOON,
  RAIL_LABEL,
  STUDIO_EYEBROW,
} from "@/app/workflows/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { railEntry, readings, seededRail, unpublishedEntry } from "../helpers/workflows";

/**
 * The studio frame as it is drawn (#147) — `docs/mockups/04-workflow-builder.html`'s head,
 * segmented control, actions and rail, from the seeded workspace.
 *
 * The acceptance criteria this suite exists for, in the ticket's words: **head values are
 * real**; **actions are role-gated — a member sees no Publish**; **Code and Copilot are
 * visibly disabled with an honest "soon" label**; **both themes**; and **shell: mounts in the
 * content pane, header and sidebar do not scroll with content** — the last of which is the
 * absence of any chrome of its own. The rail's parity is `workflow-rail.test.tsx`'s; the
 * decisions behind every sentence are `view.test.ts`'s and `states.test.ts`'s.
 */

// The tile's dialog and the failed banner both want the App Router, and the dialog's action
// sits on the server-only client; each is another suite's subject.
vi.mock("@/app/workflows/create-actions", () => ({ createWorkflow: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { StudioScreen } = await import("@/app/workflows/studio-screen");

/** The head's `<h1>`. */
function title(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

/** The segmented control. */
function segments(): HTMLElement {
  return screen.getByRole("navigation", { name: STUDIO_EYEBROW });
}

/** The rail. */
function rail(): HTMLElement {
  return screen.getByRole("navigation", { name: RAIL_LABEL });
}

describe("the page head, on the seeded standard-fix", () => {
  it("prints the eyebrow, the workflow's name, and the composed subline", () => {
    // Every value real: the name from the entity, the trigger derived from the definition,
    // last-edited measured from the draft's stamp, the version and the usage served.
    render(<StudioScreen mayAdminister readings={readings()} role="owner" />);

    expect(screen.getByText(STUDIO_EYEBROW, { selector: ".ou-eyebrow" })).toBeInTheDocument();
    expect(title()).toHaveTextContent("standard-fix");
    expect(screen.getByText(/^Runs when a sized issue/)).toHaveTextContent(
      "Runs when a sized issue with effort ≤ M is queued. Last edited 2h ago · v14 · used by 42% of runs.",
    );
  });

  it("draws the mockup's three actions, each inert with the issue it waits for", () => {
    render(<StudioScreen mayAdminister readings={readings()} role="owner" />);

    const browse = screen.getByRole("button", { name: BROWSE_TEMPLATES_LABEL });
    const dryRun = screen.getByRole("button", { name: DRY_RUN_LABEL });
    const publish = screen.getByRole("button", { name: "Publish v15" });

    for (const [control, reason] of [
      [browse, BROWSE_TEMPLATES_SOON],
      [dryRun, DRY_RUN_SOON],
      [publish, PUBLISH_SOON],
    ] as const) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("title", reason);
      expect(control.getAttribute("title")).toMatch(/#\d+/);
      // `aria-disabled` rather than `disabled`, so the explanation stays reachable.
      expect(control).not.toBeDisabled();
    }
  });

  it("counts the publish label from the version in force", () => {
    render(
      <StudioScreen
        mayAdminister
        readings={readings({ selected: { entry: unpublishedEntry(), detail: { ok: false, reason: "r" } } })}
        role="owner"
      />,
    );

    expect(screen.getByRole("button", { name: "Publish v1" })).toBeInTheDocument();
  });
});

describe("the segmented control", () => {
  it("is Visual, current and linking to this workflow, then Code and Copilot marked soon", () => {
    render(<StudioScreen mayAdminister readings={readings()} role="owner" />);

    const visual = within(segments()).getByRole("link", { name: "Visual" });

    expect(visual).toHaveAttribute("aria-current", "page");
    expect(visual).toHaveAttribute("href", workflowPath("standard-fix"));
    expect(within(segments()).getAllByRole("link")).toHaveLength(1);
  });

  it("labels Code and Copilot honestly — a span, out of the tab order, naming what builds each", () => {
    // The ticket's own honesty obligation: *they ship visibly disabled and labelled, not as
    // buttons that quietly do nothing.*
    render(<StudioScreen mayAdminister readings={readings()} role="owner" />);

    for (const [label, note] of [
      ["Code", CODE_SOON_NOTE],
      ["Copilot", COPILOT_SOON_NOTE],
    ] as const) {
      const segment = within(segments()).getByTitle(`${label} — ${note}`);

      expect(segment.tagName).toBe("SPAN");
      expect(segment).toHaveTextContent(/soon/);
      expect(within(segments()).queryByRole("link", { name: label })).toBeNull();
      expect(within(segments()).queryByRole("button", { name: label })).toBeNull();
    }
  });
});

describe("the rail and the seat", () => {
  it("draws the seeded rail with standard-fix selected, and the seat where the canvas will be", () => {
    render(<StudioScreen mayAdminister readings={readings()} role="owner" />);

    expect(within(rail()).getAllByRole("link")).toHaveLength(5);
    expect(within(rail()).getByRole("link", { current: "page" })).toHaveTextContent("standard-fix");
    expect(screen.getByText(CANVAS_SOON_TITLE)).toBeInTheDocument();
  });
});

describe("the role", () => {
  it("draws no Publish for a member, and explains the role once", () => {
    // Read-only as a rendering mode, not as a page of disabled controls — and said out loud,
    // so a page that draws less reads as scoped rather than broken.
    render(<StudioScreen mayAdminister={false} readings={readings()} role="member" />);

    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Viewing the studio as a member.");
    expect(within(rail()).getByRole("button", { name: NEW_WORKFLOW_LABEL })).toHaveAttribute(
      "title",
      NEW_WORKFLOW_MEMBER_REASON,
    );
  });

  it("defaults to the member's page when told nothing, rather than to controls the service would refuse", () => {
    render(<StudioScreen readings={readings()} />);

    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Viewing the studio as a viewer.");
  });

  it("draws the note for nobody who may publish", () => {
    render(<StudioScreen mayAdminister readings={readings()} role="owner" />);

    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("a refused rail", () => {
  const failed = readings({ rail: { ok: false, reason: "Down." }, selected: null });

  it("wears the banner with the service's reason and the page's one retry", () => {
    render(<StudioScreen mayAdminister readings={failed} role="owner" />);

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent(RAIL_FAILED_HEADLINE);
    expect(banner).toHaveTextContent("Down.");
    expect(within(banner).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("keeps the frame, names the failure in the head, and points the seat at the banner", () => {
    render(<StudioScreen mayAdminister readings={failed} role="owner" />);

    expect(title()).toHaveTextContent(FAILED_TITLE);
    expect(screen.getByText(SEAT_FAILED_NOTE)).toBeInTheDocument();
    expect(within(rail()).queryByRole("link")).toBeNull();
    expect(within(rail()).getByRole("button", { name: NEW_WORKFLOW_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
  });
});

describe("a workspace with no workflows", () => {
  const empty = readings({ rail: { ok: true, value: [] }, selected: null });

  it("says so in the head, guides toward the tile, and names the seeded workspace for a developer", () => {
    render(<StudioScreen mayAdminister readings={empty} role="owner" />);

    expect(title()).toHaveTextContent(EMPTY_TITLE);
    expect(screen.getByText(DEV_SEED_NOTE)).toBeInTheDocument();
    expect(within(rail()).getByRole("button", { name: NEW_WORKFLOW_LABEL })).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("draws no Publish even for an owner, because there is nothing to publish", () => {
    render(<StudioScreen mayAdminister readings={empty} role="owner" />);

    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
  });
});

describe("a URL naming a workflow the rail does not hold", () => {
  const missing = readings({ requested: "gone", selected: null });

  it("names the slug it could not find, lights nothing, and links Visual to the landing", () => {
    render(<StudioScreen mayAdminister readings={missing} role="owner" />);

    expect(title()).toHaveTextContent(MISSING_TITLE);
    expect(screen.getByText(/no workflow called "gone"/)).toBeInTheDocument();
    expect(within(rail()).getAllByRole("link")).toHaveLength(5);
    expect(within(rail()).queryByRole("link", { current: "page" })).toBeNull();
    expect(within(segments()).getByRole("link", { name: "Visual" })).toHaveAttribute(
      "href",
      WORKFLOWS_PATH,
    );
  });
});

describe("a workflow whose own read was refused", () => {
  const unread = readings({
    selected: { entry: railEntry(), detail: { ok: false, reason: "Refused." } },
  });

  it("keeps the rail's facts in the head, and says which read failed", () => {
    render(<StudioScreen mayAdminister readings={unread} role="owner" />);

    expect(title()).toHaveTextContent("standard-fix");
    expect(screen.getByText(/could not be read/, { selector: ".studio__sub" })).toHaveTextContent(
      "v14 · used by 42% of runs.",
    );

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent(WORKFLOW_FAILED_HEADLINE);
    expect(banner).toHaveTextContent("Refused.");
    expect(within(rail()).getByRole("link", { current: "page" })).toHaveTextContent("standard-fix");
    expect(screen.getByRole("button", { name: "Publish v15" })).toBeInTheDocument();
  });
});

describe("the shell", () => {
  it("mounts in the content pane and draws no chrome of its own", () => {
    // Design system § 2: the mockup's topbar and sidebar markup is superseded; the page starts
    // at its head. The header and sidebar are the shell's, and are what does not scroll.
    const { container } = render(<StudioScreen mayAdminister readings={readings()} role="owner" />);

    expect(screen.getByRole("main")).toHaveClass("studio");
    expect(container.querySelector(".topbar, .sidebar, .appshell")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("MAIN");
  });

  it("names its three navigation regions apart, so a rotor can tell them from the sidebar's", () => {
    render(<StudioScreen mayAdminister readings={readings()} role="owner" />);

    expect(screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label"))).toEqual([
      STUDIO_EYEBROW,
      RAIL_LABEL,
    ]);
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <StudioScreen mayAdminister readings={readings()} role="owner" />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(title()).toHaveTextContent("standard-fix");
    expect(within(rail()).getAllByRole("link")).toHaveLength(seededRail().length);
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <StudioScreen mayAdminister readings={readings()} role="owner" />,
    );

    expect(light).toBe(dark);
  });
});

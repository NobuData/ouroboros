import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { membership } from "../helpers/login";

// The picker submits to a Server Action, and that module reaches for `next/cache`,
// `next/navigation` and the server-only client. Replacing it here keeps this suite about the
// markup; the action's own behaviour — which is where the security is — is
// `__tests__/login/actions.test.ts`.
vi.mock("@/app/login/actions", () => ({
  chooseWorkspace: vi.fn(),
  setOrgEnabled: vi.fn(),
  setRepoEnabled: vi.fn(),
}));

const { NoWorkspaceCard, WorkspacePicker, WorkspacePreview } = await import(
  "@/app/login/workspace-card"
);

/**
 * Step 2 in the three shapes that come before anything can be enabled.
 *
 * The thread running through all three is honesty: the preview shows no organisations because
 * it cannot know any, the picker offers only what was passed to it, and the "nowhere yet"
 * card tells apart *no workspace* from *a workspace that is suspended* — because those are
 * different facts and only one of them is a reason to talk to somebody.
 */

describe("<WorkspacePreview>", () => {
  it("keeps the mockup's head and its least-privilege note", () => {
    render(<WorkspacePreview />);

    expect(
      screen.getByRole("heading", { name: "Choose where the loop runs" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Enable the GitHub orgs Ouroboros may work in/)).toBeInTheDocument();
    expect(screen.getByText(/least-privilege scopes/)).toBeInTheDocument();
  });

  it("names itself as the step that comes after sign-in", () => {
    render(<WorkspacePreview />);

    expect(screen.getByText(/After sign-in · Step 2/)).toBeInTheDocument();
  });

  it("invents no organisations, and offers nothing to press", () => {
    // The mockup fills this card with three examples. Real ones cannot be known before
    // sign-in, and invented ones would tell somebody they have workspaces they do not.
    render(<WorkspacePreview />);

    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/appear here once you have signed in/)).toBeInTheDocument();
  });
});

describe("<WorkspacePicker>", () => {
  it("renders one pressable row per workspace, naming it and the role held there", () => {
    render(
      <WorkspacePicker
        memberships={[
          membership(),
          membership({
            tenantId: "2",
            slug: "acme-labs",
            displayName: "Acme Labs",
            role: "admin",
          }),
        ]}
      />,
    );

    const rows = screen.getAllByRole("button");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Acme Robotics");
    expect(rows[0]).toHaveTextContent("owner");
    expect(rows[0]).toHaveTextContent("acme-robotics");
    expect(rows[1]).toHaveTextContent("Acme Labs");
    expect(rows[1]).toHaveTextContent("admin");
  });

  it("submits the slug rather than the workspace's id, in a hidden field", () => {
    // The action re-derives everything else from the session; the form carries the smallest
    // possible reference to what was pressed.
    const { container } = render(<WorkspacePicker memberships={[membership()]} />);

    const field = container.querySelector('input[name="workspace"]');

    expect(field).toHaveAttribute("type", "hidden");
    expect(field).toHaveAttribute("value", "acme-robotics");
  });

  it("asks for confirmation rather than a choice when there is only one", () => {
    render(<WorkspacePicker memberships={[membership()]} />);

    expect(screen.getByText(/Confirm the workspace/)).toBeInTheDocument();
  });

  it("asks for a choice when there is more than one", () => {
    render(
      <WorkspacePicker
        memberships={[membership(), membership({ tenantId: "2", slug: "acme-labs" })]}
      />,
    );

    expect(screen.getByText(/Pick the workspace/)).toBeInTheDocument();
  });
});

describe("<NoWorkspaceCard>", () => {
  it("explains the empty case and how an invitation reaches this account", () => {
    render(<NoWorkspaceCard suggestion={null} memberships={[]} />);

    expect(screen.getByRole("heading", { name: "No workspace yet" })).toBeInTheDocument();
    expect(screen.getByText(/do not belong to a workspace yet/)).toBeInTheDocument();
  });

  it("names the workspace the email domain points at, and says it is not membership", () => {
    render(
      <NoWorkspaceCard
        suggestion={{ tenantId: "1", slug: "acme-robotics", displayName: "Acme Robotics" }}
        memberships={[]}
      />,
    );

    expect(screen.getByText("Acme Robotics")).toBeInTheDocument();
    expect(screen.getByText(/Matching a domain is not membership/)).toBeInTheDocument();
  });

  it("lists a suspended workspace with its status, rather than pretending there is none", () => {
    render(
      <NoWorkspaceCard
        suggestion={null}
        memberships={[membership({ status: "suspended" })]}
      />,
    );

    expect(screen.getByText("suspended")).toBeInTheDocument();
    expect(screen.getByText("acme-robotics")).toBeInTheDocument();
  });

  it("offers no way to select one, because there is nothing selectable", () => {
    render(
      <NoWorkspaceCard
        suggestion={null}
        memberships={[membership({ status: "suspended" })]}
      />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("calls a deleted workspace closed, which is what it is to whoever is reading", () => {
    render(
      <NoWorkspaceCard suggestion={null} memberships={[membership({ status: "deleted" })]} />,
    );

    expect(screen.getByText("closed")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NoWorkspaceCard, WorkspacePreview } from "@/app/login/workspace-card";

/**
 * Step 2 in the two shapes that have nothing to list.
 *
 * The thread running through both is honesty: the preview shows no workspaces because it
 * cannot know any before somebody has signed in, and the "nowhere yet" card explains rather
 * than drawing an empty list.
 *
 * *The workspace picker was here and is gone*
 * ([#719](https://github.com/NobuData/ouroboros/issues/719)). It existed because choosing a
 * workspace and enabling organisations inside it were two steps; `GET /api/v1/orgs` answers
 * both in one row model, so the mockup's single card does both and choosing is a radio on a
 * row. Its cases moved to `enablement-card.test.tsx`, which is where the rows live now —
 * they were not deleted, and neither was the rule they covered: the form carries the
 * smallest possible reference, and the action re-derives everything else.
 *
 * Neither shape here submits anything, so unlike that card this suite needs no stand-in for
 * the Server Actions module.
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

  it("invents no workspaces, and offers nothing to press", () => {
    // The mockup fills this card with three examples. Real ones cannot be known before
    // sign-in, and invented ones would tell somebody they have workspaces they do not.
    render(<WorkspacePreview />);

    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText(/appear here once you have signed in/)).toBeInTheDocument();
  });
});

describe("<NoWorkspaceCard>", () => {
  it("explains the empty case and how an invitation reaches this account", () => {
    render(<NoWorkspaceCard suggestion={null} />);

    expect(screen.getByRole("heading", { name: "No workspace yet" })).toBeInTheDocument();
    expect(screen.getByText(/do not belong to a workspace yet/)).toBeInTheDocument();
  });

  it("names the workspace the email domain points at, and says it is not membership", () => {
    render(
      <NoWorkspaceCard
        suggestion={{ tenantId: "1", slug: "acme-robotics", displayName: "Acme Robotics" }}
      />,
    );

    expect(screen.getByText("Acme Robotics")).toBeInTheDocument();
    expect(screen.getByText(/Matching a domain is not membership/)).toBeInTheDocument();
  });

  it("keeps the least-privilege note, which every shape of step 2 carries", () => {
    render(<NoWorkspaceCard suggestion={null} />);

    expect(screen.getByText(/least-privilege scopes/)).toBeInTheDocument();
  });

  it("offers nothing to press, because there is nothing to choose", () => {
    // *Lists a suspended workspace with its status* was here, and cannot be composed any
    // more: `OrgRow` publishes no lifecycle, so a workspace the listing returns is one you
    // can work in and one it does not return is not this screen's to describe.
    render(<NoWorkspaceCard suggestion={null} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});

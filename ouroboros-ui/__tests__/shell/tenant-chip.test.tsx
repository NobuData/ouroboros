import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { menuWorkspaces, signedIn, signedOut, stillLoading } from "../helpers/account";

/**
 * The tenant chip ([#643](https://github.com/NobuData/ouroboros/issues/643)) — the workspace
 * the session is acting in, immediately right of the brand (design system § 1.1).
 *
 * Three of the four cases are about the em dash, and that is the point of the component: the
 * chip has a value only when the session has answered *and* the listing has arrived *and* the
 * workspace it points at is one of them, and every other state is a state where writing
 * anything else would be writing something nobody knows to be true (§ 3.5).
 *
 * The fourth is that it is not a control. The specification draws a caret on this chip and
 * [#77](https://github.com/NobuData/ouroboros/issues/77) is the issue that earns one; until
 * then a chip that looked pressable would be the shell's own honesty violation.
 */

vi.mock("@/app/api/auth-client", async () =>
  (await import("../helpers/account")).authClientModule(),
);

const { TenantChip } = await import("@/app/shell/tenant-chip");

/** The three seeded workspaces; the first is the one a fresh session acts in. */
const WORKSPACES = menuWorkspaces();

beforeEach(() => {
  signedIn();
});

describe("the tenant chip", () => {
  it("names the workspace the session is acting in", () => {
    render(<TenantChip />);

    expect(screen.getByText(WORKSPACES[0].slug)).toBeInTheDocument();
  });

  it("carries the word its value needs, for a reader who cannot see where it sits", () => {
    // Off-screen rather than printed: the header is a 56px row and the chip's whole content is
    // one slug. `.sr-only` is app/globals.css's.
    render(<TenantChip />);

    expect(screen.getByText("Workspace")).toHaveClass("sr-only");
  });

  it("says where a workspace is switched today", () => {
    // The chip cannot switch — #77 — but the product can, from the account menu. A tooltip
    // that only said "not yet" would leave a reader hunting for something that exists.
    render(<TenantChip />);

    expect(screen.getByTitle(/#77/)).toHaveTextContent(WORKSPACES[0].slug);
  });

  it("is a statement rather than a control", () => {
    render(<TenantChip />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("when there is nothing true to write", () => {
  it("shows an em dash while the session is still answering", () => {
    stillLoading();
    render(<TenantChip />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an em dash when nobody is signed in", () => {
    // Unreachable from inside the shell, and real for the moment between a sign-out and the
    // navigation after it — the same window `app/shell/account.ts` describes.
    signedOut();
    render(<TenantChip />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an em dash when the session points at a workspace the listing does not hold", () => {
    // A pointer is a reference rather than a fact (`app/api/identity.ts`): somebody removed
    // from a workspace still has a session naming it.
    signedIn("org_gone");
    render(<TenantChip />);

    expect(screen.getByText("—")).toBeInTheDocument();
    for (const workspace of WORKSPACES) {
      expect(screen.queryByText(workspace.slug)).toBeNull();
    }
  });
});

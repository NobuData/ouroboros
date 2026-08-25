import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE_ITEM,
  IN_USE_NOTE,
  OPEN_ROUTING,
  deleteTitle,
  inUseTitle,
  menuLabel,
} from "@/app/providers/keys";
import { REGISTRY_PATH } from "@/app/paths";

/**
 * The card's overflow menu and its delete (#229).
 *
 * Delete carries the dependency guard: the service refuses while routes resolve through the
 * connection, and this surface turns that `409` into a dialog that **names the routes and
 * links to routing** rather than a bare failure. The pre-flight does not replace the answer —
 * the delete is attempted and it is the service's `409` that blocks it.
 */

const removeProvider = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/providers/key-actions", () => ({
  removeProvider: (id: string) => removeProvider(id),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { CardMenu } = await import("@/app/providers/card-menu");

const ID = "5eed000c-0000-4000-8000-000000000001";
const NAME = "Anthropic Claude";

beforeEach(() => {
  removeProvider.mockReset();
  refresh.mockReset();
});

/** Open the menu and click Delete, landing on the confirmation. */
function toConfirm() {
  render(<CardMenu connectionId={ID} displayName={NAME} />);
  fireEvent.click(screen.getByRole("button", { name: menuLabel(NAME) }));
  fireEvent.click(screen.getByRole("menuitem", { name: DELETE_ITEM }));
}

describe("the overflow menu", () => {
  it("opens a menu with a single Delete item", () => {
    render(<CardMenu connectionId={ID} displayName={NAME} />);

    fireEvent.click(screen.getByRole("button", { name: menuLabel(NAME) }));

    expect(screen.getByRole("menuitem", { name: DELETE_ITEM })).toBeInTheDocument();
  });
});

describe("deleting", () => {
  it("removes the connection and re-reads on a clean delete", async () => {
    removeProvider.mockResolvedValue({ ok: true });
    toConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Delete provider" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(removeProvider).toHaveBeenCalledWith(ID);
  });

  it("renders the dependent routes and a link to routing when the service refuses", async () => {
    removeProvider.mockResolvedValue({ ok: false, kind: "in-use", aliases: ["coder-max", "local-docs"] });
    toConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Delete provider" }));

    const dialog = await screen.findByRole("dialog", { name: inUseTitle(NAME) });
    expect(within(dialog).getByText(IN_USE_NOTE)).toBeInTheDocument();
    expect(within(dialog).getByText("coder-max")).toBeInTheDocument();
    expect(within(dialog).getByText("local-docs")).toBeInTheDocument();

    const link = within(dialog).getByRole("link", { name: OPEN_ROUTING });
    expect(link).toHaveAttribute("href", REGISTRY_PATH);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says why on any other refusal", async () => {
    removeProvider.mockResolvedValue({ ok: false, kind: "refused", reason: "The provider could not be deleted just now. Nothing was changed." });
    toConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Delete provider" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be deleted");
  });

  it("changes nothing when the confirmation is cancelled", () => {
    toConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(removeProvider).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: deleteTitle(NAME) })).toBeNull();
  });
});

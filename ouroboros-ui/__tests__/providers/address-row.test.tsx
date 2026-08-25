import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AddressRow as AddressRowModel } from "@/app/providers/cards";
import { ADDRESS_KEPT, ADDRESS_READ_ONLY, ADDRESS_SAVED, ADDRESS_UNCHANGED } from "@/app/providers/keys";

/**
 * The editable address row (#229): validate-on-save, and a bad endpoint does not overwrite a
 * working one.
 *
 * The criterion is *a bad base URL or host does not overwrite the working value*. The service
 * enforces it; this row states it — its failed state stands {@link ADDRESS_KEPT} beside the
 * reason. Save is inert until the field differs from what is stored, because a save that
 * re-sends the current value is a live validation nobody asked for.
 */

const saveProviderAddress = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/providers/key-actions", () => ({
  saveProviderAddress: (id: string, value: string) => saveProviderAddress(id, value),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { AddressRow } = await import("@/app/providers/address-row");

const ID = "5eed000c-0000-4000-8000-000000000004";
const ADDRESS: AddressRowModel = { label: "Base URL", value: "http://10.0.4.20:8000/v1" };

beforeEach(() => {
  saveProviderAddress.mockReset();
  refresh.mockReset();
});

describe("an administrator's address", () => {
  it("cannot save until the field differs from what is stored", () => {
    render(<AddressRow address={ADDRESS} connectionId={ID} mayAdminister />);

    const save = screen.getByRole("button", { name: "Save Base URL" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAttribute("title", ADDRESS_UNCHANGED);
  });

  it("saves an edited address and re-reads the route", async () => {
    saveProviderAddress.mockResolvedValue({ ok: true, value: "http://10.0.4.21:8000/v1" });
    render(<AddressRow address={ADDRESS} connectionId={ID} mayAdminister />);

    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://10.0.4.21:8000/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Base URL" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(saveProviderAddress).toHaveBeenCalledWith(ID, "http://10.0.4.21:8000/v1");
    expect(screen.getByText(ADDRESS_SAVED)).toBeInTheDocument();
  });

  it("on failure says why and that the working address is unchanged", async () => {
    saveProviderAddress.mockResolvedValue({ ok: false, reason: "The provider could not be reached at that address." });
    render(<AddressRow address={ADDRESS} connectionId={ID} mayAdminister />);

    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Base URL" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be reached");
    expect(screen.getByText(ADDRESS_KEPT)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("a member's address", () => {
  it("is read-only, with no Save, and says why (#232)", () => {
    render(<AddressRow address={ADDRESS} connectionId={ID} mayAdminister={false} />);

    const field = screen.getByLabelText("Base URL");
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveAttribute("title", ADDRESS_READ_ONLY);
    expect(field).toHaveAccessibleDescription(ADDRESS_READ_ONLY);
    expect(screen.queryByRole("button", { name: "Save Base URL" })).toBeNull();
  });
});

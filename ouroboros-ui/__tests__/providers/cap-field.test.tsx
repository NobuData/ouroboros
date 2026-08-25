import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderMonthlySpendRow } from "@/app/api/providers";
import {
  CAP_INVALID,
  CAP_READ_ONLY,
  CAP_SAVED,
  CAP_TOO_LARGE,
  CAP_WARNING_ONLY,
  NO_CAP,
} from "@/app/providers/caps";
import { CAP_LABEL } from "@/app/providers/cards";

import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { spendRow } from "../helpers/providers";

/**
 * The cap island (#232): the field commits on blur and on Enter, the meter moves before the
 * server has answered, and null and zero are two different saves.
 *
 * The three parts are rendered together, the way the card mounts them, because the whole
 * point of the scope is that a save in the foot redraws the meter above it. What the
 * action itself does is `card-actions.test.ts`; it is replaced here.
 */

/** What the write answers, per case. */
const setProviderCap = vi.fn();

/** What tells the server's own render that the cap moved. */
const refresh = vi.fn();

vi.mock("@/app/providers/card-actions", () => ({
  setProviderCap: (id: string, cents: number | null) => setProviderCap(id, cents),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { CapField, CapMeter, CapScope } = await import("@/app/providers/cap-field");

/** The seed's Copilot card — the ≥ 80% warn meter, with seats. */
const ID = "5eed000c-0000-4000-8000-000000000003";

/** The seed's Copilot month: `$76.00`. */
const COPILOT: ProviderMonthlySpendRow = spendRow({ kind: "copilot", spendCents: 7_600 });

/**
 * The island as the card mounts it.
 *
 * @param capCents The stored cap.
 * @param mayAdminister Whether the reader may change it. Defaults to an owner's.
 * @param row The month's row. Defaults to the seed's Copilot month.
 */
function island(capCents: number | null, mayAdminister = true, row: ProviderMonthlySpendRow | null = COPILOT) {
  return (
    <CapScope connectionId={ID} spend={{ capCents, row, seats: 4 }}>
      <CapMeter />
      <CapField connectionId={ID} mayAdminister={mayAdminister} />
    </CapScope>
  );
}

/** The field. */
function field(): HTMLInputElement {
  return screen.getByLabelText(CAP_LABEL);
}

/** What the meter line reads. */
function meterReads(): string {
  return document.querySelector(".providers-card__meter-figure")?.textContent?.trim() ?? "";
}

/** The bar, or null when the line has none. */
function bar(): HTMLElement | null {
  return document.querySelector(".ou-meter");
}

/** Type a value and leave the field. */
function typeAndBlur(value: string): void {
  fireEvent.change(field(), { target: { value } });
  fireEvent.blur(field());
}

beforeEach(() => {
  setProviderCap.mockReset().mockImplementation((_, cents: number | null) =>
    Promise.resolve({ ok: true, cents }),
  );
  refresh.mockReset();
});

describe("the meter", () => {
  it("draws the stored cap's line — the seed's warn meter at 80% — with P7's tooltip on it", () => {
    render(island(9_500));

    expect(meterReads()).toBe("$76.00 of $95 cap · 4 seats");
    expect(bar()).toHaveClass("ou-meter--warn");
    expect(bar()).toHaveAttribute("aria-hidden", "true");

    const warning = document.querySelector(".providers-card__meter-warning") as HTMLElement;
    expect(warning).toHaveAttribute("title", CAP_WARNING_ONLY);
    expect(warning).toHaveTextContent(CAP_WARNING_ONLY);
  });

  it("draws no tooltip and no bar for an uncapped connection", () => {
    render(island(null));

    expect(meterReads()).toBe("$76.00");
    expect(bar()).toBeNull();
    expect(document.querySelector(".providers-card__meter-warning")).toBeNull();
  });
});

describe("an administrator's field", () => {
  it("reads the stored cap, with the em-dash as its placeholder and P7's sentence as its description", () => {
    render(island(9_500));

    expect(field()).toHaveValue("$95");
    expect(field()).not.toHaveAttribute("readonly");
    expect(field()).toHaveAttribute("placeholder", NO_CAP);
    expect(field()).toHaveAttribute("title", CAP_WARNING_ONLY);
    expect(field()).toHaveAccessibleDescription(CAP_WARNING_ONLY);
    expect(field()).toHaveAttribute("inputmode", "decimal");
  });

  it("is empty for no cap — a box to type into, not a glyph to delete first", () => {
    render(island(null));

    expect(field()).toHaveValue("");
    expect(field()).toHaveAttribute("placeholder", NO_CAP);
  });

  it("saves on blur and moves the meter before the server has answered", async () => {
    // The ticket's first criterion: the edit round-trips and the meter re-renders at once.
    // `$76.00 of $120` is 63% — the accent hue — and the line says so before the write lands.
    const { rerender } = render(island(9_500));

    typeAndBlur("120");

    expect(meterReads()).toBe("$76.00 of $120 cap · 4 seats");
    expect(bar()).toHaveClass("ou-meter");
    expect(bar()).not.toHaveClass("ou-meter--warn");
    expect(field()).toHaveValue("$120");

    await waitFor(() => expect(setProviderCap).toHaveBeenCalledWith(ID, 12_000));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent(CAP_SAVED);

    // The route re-reads and the stored cap arrives as a changed prop.
    rerender(island(12_000));
    expect(field()).toHaveValue("$120");
    expect(meterReads()).toBe("$76.00 of $120 cap · 4 seats");
  });

  it("saves on Enter as well", async () => {
    render(island(9_500));

    fireEvent.change(field(), { target: { value: "$150" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    await waitFor(() => expect(setProviderCap).toHaveBeenCalledWith(ID, 15_000));
  });

  it("stores null for an emptied field and zero for $0 — two different saves", async () => {
    // The ticket's second criterion. Cleared, the meter loses its note and its bar; at `$0`
    // it is a real cap, full and red the moment anything is priced.
    const { rerender } = render(island(9_500));

    typeAndBlur("");
    expect(meterReads()).toBe("$76.00");
    expect(bar()).toBeNull();
    await waitFor(() => expect(setProviderCap).toHaveBeenCalledWith(ID, null));

    rerender(island(null));
    typeAndBlur("0");
    expect(meterReads()).toBe("$76.00 of $0 cap · 4 seats");
    expect(bar()).toHaveClass("ou-meter--err");
    await waitFor(() => expect(setProviderCap).toHaveBeenCalledWith(ID, 0));
  });

  it("refuses a value that is not an amount, in the browser, with no round trip", () => {
    render(island(9_500));

    typeAndBlur("ninety");

    expect(screen.getByRole("alert")).toHaveTextContent(CAP_INVALID);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(setProviderCap).not.toHaveBeenCalled();
    expect(meterReads()).toBe("$76.00 of $95 cap · 4 seats");
  });

  it("refuses a cap past the service's ceiling the same way", () => {
    render(island(9_500));

    typeAndBlur("99999999999");

    expect(screen.getByRole("alert")).toHaveTextContent(CAP_TOO_LARGE);
    expect(setProviderCap).not.toHaveBeenCalled();
  });

  it("saves nothing when the value parses to what is stored, and normalises the text", () => {
    render(island(9_500));

    typeAndBlur("95");

    expect(field()).toHaveValue("$95");
    expect(setProviderCap).not.toHaveBeenCalled();
  });

  it("goes back and says why when the save did not take", async () => {
    setProviderCap.mockResolvedValue({ ok: false, reason: "The vault is away." });
    render(island(9_500));

    typeAndBlur("120");

    expect(await screen.findByRole("alert")).toHaveTextContent("The vault is away.");
    await waitFor(() => expect(meterReads()).toBe("$76.00 of $95 cap · 4 seats"));
    expect(field()).toHaveValue("$95");
    // The figure shown is the stored one again, so it is not marked invalid — only a value
    // that is not a cap is.
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(field()).toHaveAccessibleDescription(/The vault is away/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("puts the stored value back on Escape", () => {
    render(island(9_500));

    fireEvent.change(field(), { target: { value: "7" } });
    fireEvent.keyDown(field(), { key: "Escape" });

    expect(field()).toHaveValue("$95");
    expect(setProviderCap).not.toHaveBeenCalled();
  });

  it("ignores a second commit while the first is in flight", async () => {
    setProviderCap.mockReturnValue(new Promise(() => {}));
    render(island(9_500));

    typeAndBlur("120");
    expect(field()).toHaveAttribute("aria-busy", "true");
    typeAndBlur("130");

    await waitFor(() => expect(setProviderCap).toHaveBeenCalledOnce());
  });
});

describe("a member's field", () => {
  it("is read-only, with the reason as its tooltip and description, and the figure or the em-dash", () => {
    const capped = render(island(9_500, false));
    expect(field()).toHaveValue("$95");
    expect(field()).toHaveAttribute("readonly");
    expect(field()).toHaveAttribute("title", CAP_READ_ONLY);
    expect(field()).toHaveAccessibleDescription(CAP_READ_ONLY);
    capped.unmount();

    render(island(null, false));
    expect(field()).toHaveValue(NO_CAP);
    expect(field()).toHaveAttribute("readonly");
  });

  it("still sees P7's tooltip on the meter — the warning is about the cap, not the reader", () => {
    render(island(9_500, false));

    expect(document.querySelector(".providers-card__meter-warning")).toHaveAttribute(
      "title",
      CAP_WARNING_ONLY,
    );
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, island(9_500));

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(field()).toHaveValue("$95");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(island(9_500));

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});

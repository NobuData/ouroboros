import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WHY_GOVERNANCE, WHY_KEYS, WHY_SWAP, WHY_TITLE } from "@/app/registry/chain";
import { WhyCard } from "@/app/registry/why-card";

import { renderInBothPalettes } from "../helpers/palettes";

/**
 * Mockup 21's **WHY ALIASES — THE BYOK POINT** card as it is drawn (#595).
 *
 * The copy's fidelity to the mockup is `chain.test.ts`'s; here it is that the card renders those
 * constants as a titled region of three claims, that the governance row goes when its gate is
 * held, and that the two palettes produce identical markup.
 */

describe("the why-aliases card", () => {
  it("is a region titled as the mockup titles it", () => {
    render(<WhyCard />);

    expect(screen.getByRole("region", { name: WHY_TITLE })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: WHY_TITLE })).toBeInTheDocument();
  });

  it("renders the three rows, verbatim and in order", () => {
    render(<WhyCard />);

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");

    expect(rows.map((row) => row.textContent)).toEqual(
      [WHY_SWAP, WHY_KEYS, WHY_GOVERNANCE].map(({ title, body }) => `✓${title}${body}`),
    );
  });

  it("draws the ✓ as decoration, so a screen reader reads the claims rather than the ticks", () => {
    const { container } = render(<WhyCard />);

    const ticks = container.querySelectorAll(".registry-why__tick");

    expect(ticks).toHaveLength(3);
    for (const tick of ticks) expect(tick).toHaveAttribute("aria-hidden", "true");
  });

  it("does not show the governance row while publish-time rejection is not live", () => {
    render(<WhyCard enforced={false} />);

    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(WHY_GOVERNANCE.body)).not.toBeInTheDocument();
    expect(screen.getByText(WHY_SWAP.body)).toBeInTheDocument();
  });

  it("renders identical markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<WhyCard />);

    expect(light).toBe(dark);
  });
});

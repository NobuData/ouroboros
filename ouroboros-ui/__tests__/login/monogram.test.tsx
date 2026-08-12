import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Monogram, initials } from "@/app/login/monogram";

/**
 * The derived initials beside every row.
 *
 * The rule matters more than it looks: the mockup's letters are a person's ("KS" for
 * `kensuenobu`) and nothing in the contract carries those, so these are derived — and a
 * derivation that returned an empty string would render as a broken tile on the product's
 * first screen.
 */

describe("initials", () => {
  it("takes the first letter of each part of a hyphenated name", () => {
    expect(initials("acme-robotics")).toBe("AR");
    expect(initials("acme_labs")).toBe("AL");
  });

  it("takes the first two letters when there is only one part", () => {
    expect(initials("nobudata")).toBe("NO");
  });

  it("uses only the first two parts of a longer name", () => {
    expect(initials("acme-robotics-emea")).toBe("AR");
  });

  it("upper-cases, because a monogram is set in display type", () => {
    expect(initials("acme")).toBe("AC");
  });

  it("ignores separators wherever they fall, including at the edges", () => {
    expect(initials("-acme-")).toBe("AC");
    expect(initials("acme  robotics")).toBe("AR");
  });

  it("handles a one-character name without inventing a second letter", () => {
    expect(initials("a")).toBe("A");
  });

  it("falls back to an em dash rather than to an empty tile", () => {
    expect(initials("")).toBe("—");
    expect(initials("---")).toBe("—");
  });

  it("counts letters beyond ASCII, because a display name is a display name", () => {
    expect(initials("Ünstable Systems")).toBe("ÜS");
  });
});

describe("<Monogram>", () => {
  it("renders the derived letters", () => {
    render(<Monogram name="acme-robotics" />);

    expect(screen.getByText("AR")).toBeInTheDocument();
  });

  it("is hidden from assistive technology, because the row names the thing in words", () => {
    const { container } = render(<Monogram name="acme-robotics" />);

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

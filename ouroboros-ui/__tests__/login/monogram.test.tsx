import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Monogram, initials } from "@/app/login/monogram";

/**
 * The tile beside every row, and the one derivation left on this side of the wire.
 *
 * **A workspace's letters are the service's** since
 * [#719](https://github.com/NobuData/ouroboros/issues/719) — `OrgRow.monogram`, derived where
 * the name is, so that a browser cannot become a second place the rule lives. What
 * {@link initials} is still for is the surface the contract says nothing about: the
 * signed-in person on step 1, whose letters are theirs ("KS" for `kensuenobu`).
 *
 * The rule matters more than it looks: a derivation that returned an empty string would
 * render as a broken tile on the product's first screen.
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
  it("renders the letters it is given", () => {
    render(<Monogram letters="AR" />);

    expect(screen.getByText("AR")).toBeInTheDocument();
  });

  it("renders the derived ones for the surface with no service monogram", () => {
    render(<Monogram letters={initials("Ken Suenobu")} />);

    expect(screen.getByText("KS")).toBeInTheDocument();
  });

  it("draws an empty tile for a name the service found no letters in", () => {
    // The contract asks for exactly this: "empty for a name with no letters or digits in it
    // at all, which a client renders as an empty circle rather than as a failure". Only the
    // *derived* path falls back to a dash, because only it has a name to have failed on.
    const { container } = render(<Monogram letters="" />);

    expect(container.firstElementChild).toBeEmptyDOMElement();
  });

  it("is hidden from assistive technology, because the row names the thing in words", () => {
    const { container } = render(<Monogram letters="AR" />);

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

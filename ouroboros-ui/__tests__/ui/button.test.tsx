import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The button primitive (#46).
 *
 * Two properties carry most of this suite. **What element it renders** is decided by what
 * the control does rather than by how it looks — the login screen's sign-in control goes to
 * an operation that answers `302`, and a button could not follow it. And **an inert control
 * is a control with a reason**: there is no boolean here that switches a button off without
 * saying what is missing, which is the design system's § 3.5 rule expressed as an API.
 */

describe("which element it renders", () => {
  it("is a button by default, and a button that does not submit", () => {
    // A bare `<button>` inside a form is a submit button. A primitive that inherited that
    // would make every button in a form a submit button by accident.
    render(<Button>Do the thing</Button>);

    expect(screen.getByRole("button", { name: "Do the thing" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("submits when the caller says so, which is how this product writes", () => {
    render(<Button type="submit">Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "submit");
  });

  it("is a link when it navigates", () => {
    render(<Button href="/dashboard">Enter</Button>);

    const link = screen.getByRole("link", { name: "Enter" });

    expect(link).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("a control that cannot act", () => {
  const REASON = "Issue intake is not built yet.";

  it("stays in the tab order and says why", () => {
    // `aria-disabled` rather than `disabled`: a disabled button leaves the tab order and
    // takes its explanation with it, so the keyboard reader who most needs the tooltip is
    // the one who could never reach it.
    render(<Button reason={REASON}>Pull next issue</Button>);

    const button = screen.getByRole("button", { name: "Pull next issue" });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("title", REASON);
  });

  it("cannot act, whatever handler it was given", () => {
    // The safeguard behind the label: an inert button that still fired its handler would be
    // the most confusing possible state — marked unavailable and working.
    const onClick = vi.fn();
    render(
      <Button reason={REASON} onClick={onClick}>
        Pull next issue
      </Button>,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("never submits the form around it, whatever the caller asked for", () => {
    // `aria-disabled` does not stop a browser submitting: without this, an inert control
    // inside a form would still post it on Enter.
    render(
      <Button reason={REASON} type="submit">
        Save
      </Button>,
    );

    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("acts normally when there is no reason to stop it", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Pull next issue</Button>);

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps a more specific tooltip when the caller wrote one", () => {
    render(
      <Button reason={REASON} title="Coming with mockup 03">
        Pull next issue
      </Button>,
    );

    expect(screen.getByRole("button")).toHaveAttribute("title", "Coming with mockup 03");
  });
});

describe("the treatments", () => {
  it("wears the class for the tone and size it was given", () => {
    const { container } = render(
      <Button tone="danger" size="sm" block>
        Delete
      </Button>,
    );

    expect(container.firstElementChild).toHaveClass(
      "ou-btn",
      "ou-btn--danger",
      "ou-btn--sm",
      "ou-btn--block",
    );
  });

  it("adds no modifier for the defaults, so the base class carries them", () => {
    const { container } = render(<Button>Plain</Button>);

    expect(container.firstElementChild?.className).toBe("ou-btn");
  });

  it("keeps a page's own class, which is how a page places one", () => {
    const { container } = render(<Button className="dash__action">Plain</Button>);

    expect(container.firstElementChild).toHaveClass("ou-btn", "dash__action");
  });

  it("passes the rest of a button's attributes through untouched", () => {
    render(<Button aria-describedby="why">Continue</Button>);

    expect(screen.getByRole("button")).toHaveAttribute("aria-describedby", "why");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <Button tone="primary" size="lg" block>
        Continue with GitHub
      </Button>,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toHaveClass(
      "ou-btn--primary",
    );
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <Button tone="primary" reason="Not yet">
        Pull next issue
      </Button>,
    );

    expect(light).toBe(dark);
  });
});

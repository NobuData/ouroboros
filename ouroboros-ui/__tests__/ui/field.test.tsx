import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SelectField, TextField, Toggle } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The form primitives (#46): a text field, a select, and a switch.
 *
 * Three properties are worth holding, and each is one somebody would otherwise have to
 * remember at every call site: a field is **labelled by a real `<label>`**, its hint is
 * **wired into the control's description** rather than merely printed near it, and a switch
 * **announces as a switch** — `role="switch"` plus `aria-checked`, with its accessible name
 * saying what pressing it would do.
 */

describe("the text field", () => {
  it("is labelled by a label element, which is what makes it findable at all", () => {
    render(<TextField id="domain" label="Company domain" name="domain" />);

    expect(screen.getByLabelText("Company domain")).toHaveAttribute("name", "domain");
  });

  it("wires its hint into the control's description", () => {
    // A hint merely printed under a field is a hint a screen reader reaches by accident.
    render(<TextField id="domain" label="Company domain" hint="Your identity provider." />);

    expect(screen.getByLabelText("Company domain")).toHaveAccessibleDescription(
      "Your identity provider.",
    );
  });

  it("keeps a description the caller already pointed at, and adds its own", () => {
    render(
      <>
        <p id="why">Enterprise SSO is not configured yet.</p>
        <TextField
          id="domain"
          label="Company domain"
          hint="Your identity provider."
          aria-describedby="why"
        />
      </>,
    );

    const field = screen.getByLabelText("Company domain");

    expect(field).toHaveAccessibleDescription(/Your identity provider/);
    expect(field).toHaveAccessibleDescription(/not configured yet/);
  });

  it("describes nothing when there is nothing to describe it", () => {
    render(<TextField id="domain" label="Company domain" />);

    expect(screen.getByLabelText("Company domain")).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("really disables a field that cannot be used", () => {
    // Unlike a button: a text box that accepts typing and then discards it is worse than
    // one that does not, and a field keeps its explanation in its hint rather than in a
    // tooltip only a focused control could show.
    render(<TextField id="domain" label="Company domain" disabled />);

    expect(screen.getByLabelText("Company domain")).toBeDisabled();
  });

  it("takes the monospaced treatment for a value read character by character", () => {
    render(<TextField id="domain" label="Company domain" mono />);

    expect(screen.getByLabelText("Company domain")).toHaveClass("ou-input--mono");
  });

  it("passes the rest of an input's attributes through untouched", () => {
    render(
      <TextField
        id="domain"
        label="Company domain"
        placeholder="acme.ouroboros.dev"
        inputMode="url"
      />,
    );

    expect(screen.getByLabelText("Company domain")).toHaveAttribute(
      "placeholder",
      "acme.ouroboros.dev",
    );
  });
});

describe("the select", () => {
  it("is the platform's control, labelled, with the caller's options in it", () => {
    render(
      <SelectField id="role" label="Role" defaultValue="admin">
        <option value="admin">admin</option>
        <option value="viewer">viewer</option>
      </SelectField>,
    );

    const select = screen.getByLabelText("Role");

    expect(select.tagName).toBe("SELECT");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(select).toHaveValue("admin");
  });

  it("wires its hint the same way the text field does", () => {
    render(
      <SelectField id="role" label="Role" hint="Owners and admins may change this.">
        <option value="admin">admin</option>
      </SelectField>,
    );

    expect(screen.getByLabelText("Role")).toHaveAccessibleDescription(
      "Owners and admins may change this.",
    );
  });
});

describe("the switch", () => {
  it("announces as a switch, in the state it is in, saying what a press would do", () => {
    render(<Toggle checked label="Enable acme-robotics" />);

    const toggle = screen.getByRole("switch", { name: "Enable acme-robotics" });

    expect(toggle).toBeChecked();
  });

  it("reports off as off rather than as absent", () => {
    render(<Toggle checked={false} label="Enable acme-robotics" />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("submits the form around it when the caller asks, which is how this product writes", () => {
    render(<Toggle checked={false} label="Enable acme-robotics" type="submit" />);

    expect(screen.getByRole("switch")).toHaveAttribute("type", "submit");
  });

  it("renders a switch nobody may press in its real state, marked and explained", () => {
    // Hiding the switches on a list somebody may only read would leave a list that looks
    // like it has no settings (design system § 3.3).
    render(
      <Toggle
        checked
        label="Enable acme-robotics"
        reason="Only an owner or admin can change this."
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Enable acme-robotics" });

    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveAttribute("title", "Only an owner or admin can change this.");
  });

  it("never submits when it may not be pressed, whatever the caller asked for", () => {
    // The form behind a read-only switch would otherwise still accept the press.
    const onClick = vi.fn();
    render(
      <Toggle
        checked
        label="Enable acme-robotics"
        type="submit"
        reason="Only an owner or admin can change this."
        onClick={onClick}
      />,
    );

    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByRole("switch")).toHaveAttribute("type", "button");
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <>
        <TextField id="domain" label="Company domain" hint="Okta, Entra ID." mono />
        <SelectField id="role" label="Role">
          <option value="admin">admin</option>
        </SelectField>
        <Toggle checked label="Enable acme-robotics" />
      </>,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByLabelText("Company domain")).toHaveClass("ou-input");
    expect(screen.getByLabelText("Role")).toHaveClass("ou-input");
    expect(screen.getByRole("switch")).toHaveClass("ou-switch");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <>
        <TextField id="domain" label="Company domain" hint="Okta, Entra ID." />
        <Toggle checked={false} label="Enable acme-robotics" reason="Read-only." />
      </>,
    );

    expect(light).toBe(dark);
  });
});

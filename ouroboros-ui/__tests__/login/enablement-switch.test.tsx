import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EnablementSwitch } from "@/app/login/enablement-switch";

/**
 * The switch, in its two shapes.
 *
 * Three properties are worth holding: it announces as a switch with a state, it submits the
 * state to move *to* rather than the one it is in, and a role that may not press it still
 * gets a control that explains itself rather than a missing one.
 */

/** A no-op stand-in for the Server Action; what it does is `actions.test.ts`'s subject. */
const action = vi.fn<(formData: FormData) => Promise<void>>();

describe("<EnablementSwitch>, pressable", () => {
  it("announces as a switch, on", () => {
    render(
      <EnablementSwitch
        action={action}
        fields={{ login: "acme-robotics" }}
        enabled
        label="Disable the acme-robotics organisation"
      />,
    );

    const control = screen.getByRole("switch", {
      name: "Disable the acme-robotics organisation",
    });

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control).not.toHaveAttribute("aria-disabled");
  });

  it("announces as a switch, off", () => {
    render(
      <EnablementSwitch
        action={action}
        fields={{ login: "acme-labs" }}
        enabled={false}
        label="Enable the acme-labs organisation"
      />,
    );

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("submits, so it works before hydration and without JavaScript", () => {
    const { container } = render(
      <EnablementSwitch
        action={action}
        fields={{ login: "acme-robotics" }}
        enabled
        label="Disable it"
      />,
    );

    expect(container.querySelector("form")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("type", "submit");
  });

  it("carries the state to move to, not the state it is in", () => {
    // A stale render — a second tab, a back button — then asks for something specific
    // instead of inverting whatever the flag has become since.
    const { container } = render(
      <EnablementSwitch action={action} fields={{ login: "x" }} enabled label="Disable it" />,
    );

    expect(container.querySelector('input[name="enabled"]')).toHaveAttribute("value", "false");
  });

  it("carries the reference the action needs, and nothing more", () => {
    const { container } = render(
      <EnablementSwitch
        action={action}
        fields={{ login: "acme-robotics", repo: "helios-firmware" }}
        enabled={false}
        label="Enable it"
      />,
    );

    const fields = [...container.querySelectorAll("input")].map((input) => [
      input.name,
      input.value,
    ]);

    // No tenant id: the action derives the workspace from the cookie and the session, so a
    // hand-made POST cannot name somebody else's.
    expect(fields).toEqual([
      ["login", "acme-robotics"],
      ["repo", "helios-firmware"],
      ["enabled", "true"],
    ]);
  });

  it("hides its label from the eye and keeps it for the ear", () => {
    render(
      <EnablementSwitch action={action} fields={{ login: "x" }} enabled label="Disable it" />,
    );

    expect(screen.getByText("Disable it")).toHaveClass("sr-only");
  });
});

describe("<EnablementSwitch>, read-only", () => {
  const reason = "Only an owner or admin can change what Ouroboros may work in.";

  it("renders in the same place, in the same state, marked unavailable", () => {
    render(
      <EnablementSwitch
        action={action}
        fields={{ login: "acme-robotics" }}
        enabled
        label="Disable the acme-robotics organisation"
        reason={reason}
      />,
    );

    const control = screen.getByRole("switch");

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("title", reason);
  });

  it("stays in the tab order, so the explanation is reachable", () => {
    // `aria-disabled` rather than `disabled`: the second would drop the control and its
    // reason out of the keyboard path together.
    render(
      <EnablementSwitch
        action={action}
        fields={{ login: "x" }}
        enabled
        label="Disable it"
        reason={reason}
      />,
    );

    expect(screen.getByRole("switch")).not.toBeDisabled();
  });

  it("has nothing to submit to", () => {
    const { container } = render(
      <EnablementSwitch
        action={action}
        fields={{ login: "x" }}
        enabled
        label="Disable it"
        reason={reason}
      />,
    );

    expect(container.querySelector("form")).not.toBeInTheDocument();
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(screen.getByRole("switch")).toHaveAttribute("type", "button");
  });

  it("points at the card's own explanation when it is given one", () => {
    render(
      <>
        <p id="why">{reason}</p>
        <EnablementSwitch
          action={action}
          fields={{ login: "x" }}
          enabled
          label="Disable it"
          reason={reason}
          describedBy="why"
        />
      </>,
    );

    expect(screen.getByRole("switch")).toHaveAccessibleDescription(reason);
  });
});

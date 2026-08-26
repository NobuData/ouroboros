import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ParamFields, UNSET_OPTION } from "@/app/registry/param-fields";
import { PROVIDER_DEFAULT, paramDefaults } from "@/app/registry/params";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { budgetField, paramField } from "../helpers/registry";

/**
 * The registry's parameter form as it is drawn (#594, over CH.2's schema, #585).
 *
 * The claim this suite exists to hold is the endpoint's own: **a model nobody wrote UI for
 * gets a working form**. So the cases feed it a parameter no adapter in this build has, and
 * assert that a control comes out — a form that contained a list of parameters would pass every
 * other test here and fail that one.
 *
 * `params.test.ts` proves the judgements; this proves what reaches the DOM: which control each
 * widget becomes, that the bounds are on the input as well as in the hint, that the default is
 * drawn beside the box rather than typed into it, that a refusal lands on the control it was
 * about, and — since CI.3 ([#593](https://github.com/NobuData/ouroboros/issues/593)) — that a
 * reader who may not write sees every one of them readable and inert.
 */

/** The Anthropic adapter's two parameters — a select and an integer. */
const FIELDS = [paramField(), budgetField()];

/** …and the registry's own boolean, which is the switch widget. */
const SWITCH = paramField({
  name: "batch_ok",
  label: "Batch ok",
  widget: "switch",
  choices: null,
  help: null,
});

/** Why a member may not move any of them — the inspector's role gate (#593). */
const READ_ONLY = "Editing an alias is for workspace owners and admins.";

describe("the five widgets", () => {
  it("draws a select over the schema's own choices, with a way to choose nothing", () => {
    // Every parameter is optional by construction — the schema has no `required` — so the blank
    // option is what *send nothing for this key* looks like, and it is never conditional.
    render(
      <ParamFields
        fields={[paramField()]}
        idPrefix="p"
        onChange={vi.fn()}
        values={paramDefaults([paramField()])}
      />,
    );

    const select = screen.getByLabelText("Thinking", { exact: false });

    expect(select.tagName).toBe("SELECT");
    expect([...(select as HTMLSelectElement).options].map((option) => option.value)).toEqual([
      "",
      "off",
      "std",
      "max",
    ]);
    expect((select as HTMLSelectElement).options[0]?.textContent).toBe(UNSET_OPTION);
  });

  it("draws a number box for an integer, stepped so a fraction is refused before the service is", () => {
    // The contract splits `integer` from `number` because `4096.5` is a token budget no
    // provider accepts.
    render(
      <ParamFields fields={[budgetField()]} idPrefix="p" onChange={vi.fn()} values={{ token_budget: "" }} />,
    );

    const input = screen.getByLabelText("Token budget", { exact: false });

    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("step", "1");
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "400000");
  });

  it("lets a number take a fraction, which is what a temperature is", () => {
    const temperature = paramField({ name: "temperature", label: "Temperature", widget: "number", choices: null });

    render(
      <ParamFields fields={[temperature]} idPrefix="p" onChange={vi.fn()} values={{ temperature: "" }} />,
    );

    expect(screen.getByLabelText("Temperature", { exact: false })).toHaveAttribute("step", "any");
  });

  it("draws a text box for free text, and reads it character by character", () => {
    const free = paramField({ name: "system_suffix", label: "System suffix", widget: "text", choices: null });

    render(
      <ParamFields fields={[free]} idPrefix="p" onChange={vi.fn()} values={{ system_suffix: "" }} />,
    );

    const input = screen.getByLabelText("System suffix", { exact: false });

    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveClass("ou-input--mono");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("draws the #46 switch for a boolean, named once rather than twice", () => {
    // The switch carries its own accessible name as visually hidden text, so the visible copy
    // beside it is aria-hidden — a reader who heard it twice would be hearing one control
    // announced as two.
    const flag = paramField({ name: "batch_ok", label: "Batch ok", widget: "switch", choices: null });

    render(<ParamFields fields={[flag]} idPrefix="p" onChange={vi.fn()} values={{ batch_ok: false }} />);

    const control = screen.getByRole("switch", { name: "Batch ok" });

    expect(control).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Batch ok", { selector: ".registry-params__switch-label" })).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});

describe("a parameter no adapter in this build has", () => {
  /** A tunable invented for this suite — nothing in the product knows it exists. */
  const INVENTED = paramField({
    name: "quantum_flux",
    label: "Quantum flux",
    widget: "integer",
    help: "How much flux to allow.",
    choices: null,
    minimum: 0,
    maximum: 11,
    sources: ["discovery"],
  });

  it("gets a working control anyway, which is the whole claim of the endpoint", () => {
    // A form that contained a list of parameters would pass every other case here and fail
    // this one.
    const onChange = vi.fn();

    render(<ParamFields fields={[INVENTED]} idPrefix="p" onChange={onChange} values={{ quantum_flux: "" }} />);

    const input = screen.getByLabelText("Quantum flux", { exact: false });

    fireEvent.change(input, { target: { value: "7" } });

    expect(onChange).toHaveBeenCalledExactlyOnceWith("quantum_flux", "7");
  });

  it("carries its bounds onto the input as well as into the hint", () => {
    render(<ParamFields fields={[INVENTED]} idPrefix="p" onChange={vi.fn()} values={{ quantum_flux: "" }} />);

    expect(screen.getByLabelText("Quantum flux", { exact: false })).toHaveAttribute("max", "11");
    expect(screen.getByText(/0–11/)).toBeInTheDocument();
  });
});

describe("the default", () => {
  it("is drawn beside the box and never typed into it", () => {
    // `defaultValue` is documented as *not a value this product sends*: an alias whose params
    // omits a key takes the provider's own default.
    const suggested = paramField({ defaultValue: "std" });

    render(<ParamFields fields={[suggested]} idPrefix="p" onChange={vi.fn()} values={{ thinking: "" }} />);

    expect(screen.getByLabelText("Thinking", { exact: false })).toHaveValue("");
    expect(screen.getByText(new RegExp(`${PROVIDER_DEFAULT} std`))).toBeInTheDocument();
  });
});

describe("a refusal", () => {
  it("lands on the control it was about, and marks it invalid", () => {
    render(
      <ParamFields
        errors={{ thinking: ["thinking must be one of off, std, max"] }}
        fields={FIELDS}
        idPrefix="p"
        onChange={vi.fn()}
        values={paramDefaults(FIELDS)}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("thinking must be one of off, std, max");
    expect(screen.getByLabelText("Thinking", { exact: false })).toHaveAttribute("aria-invalid", "true");
  });

  it("leaves a control nobody complained about alone", () => {
    // Which is what keeps `aria-invalid` off a field that is fine.
    render(
      <ParamFields
        errors={{ thinking: ["no"] }}
        fields={FIELDS}
        idPrefix="p"
        onChange={vi.fn()}
        values={paramDefaults(FIELDS)}
      />,
    );

    expect(screen.getByLabelText("Token budget", { exact: false })).not.toHaveAttribute("aria-invalid");
  });

  it("lands on a switch too, as an alert beside it", () => {
    const flag = paramField({ name: "batch_ok", label: "Batch ok", widget: "switch", choices: null });

    render(
      <ParamFields
        errors={{ batch_ok: ["not for this model"] }}
        fields={[flag]}
        idPrefix="p"
        onChange={vi.fn()}
        values={{ batch_ok: false }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("not for this model");
  });
});

describe("the form's frame", () => {
  it("draws nothing at all for a section with no fields", () => {
    // *Why* a section is empty is the response's `reason`, and the caller is what has it.
    const { container } = render(
      <ParamFields fields={[]} idPrefix="p" onChange={vi.fn()} values={{}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the service's order, which is the order the schema declared", () => {
    render(<ParamFields fields={FIELDS} idPrefix="p" onChange={vi.fn()} values={paramDefaults(FIELDS)} />);

    const labels = [...document.querySelectorAll(".ou-field__label")].map((node) => node.textContent);

    expect(labels).toEqual(["Thinking", "Token budget"]);
  });

  it("gives two forms on one page different ids, so neither label points at the other's box", () => {
    render(
      <>
        <ParamFields fields={[paramField()]} idPrefix="a" onChange={vi.fn()} values={{ thinking: "" }} />
        <ParamFields fields={[paramField()]} idPrefix="b" onChange={vi.fn()} values={{ thinking: "" }} />
      </>,
    );

    const [first, second] = screen.getAllByLabelText("Thinking", { exact: false });

    expect(first?.id).not.toBe(second?.id);
  });
});

describe("a reader who may not change them", () => {
  /** The Anthropic adapter's two parameters and a boolean, which is the third widget shape. */
  const ALL = [paramField(), budgetField(), SWITCH];

  it("disables every box and select outright, rather than accepting typing and discarding it", () => {
    // `app/ui/field.tsx`'s rule: a field that takes a keystroke and throws it away is worse
    // than one that will not take it, and the explanation belongs in the hint rather than in a
    // tooltip only a focused control could show.
    render(
      <ParamFields
        fields={ALL}
        idPrefix="p"
        onChange={vi.fn()}
        reason={READ_ONLY}
        values={paramDefaults(ALL)}
      />,
    );

    expect(screen.getByLabelText("Thinking", { exact: false })).toBeDisabled();
    expect(screen.getByLabelText("Token budget", { exact: false })).toBeDisabled();
  });

  it("makes the switch inert with the reason, because a switch keeps its own explanation", () => {
    render(
      <ParamFields
        fields={ALL}
        idPrefix="p"
        onChange={vi.fn()}
        reason={READ_ONLY}
        values={paramDefaults(ALL)}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Batch ok" });

    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAttribute("title", READ_ONLY);
  });

  it("changes nothing when a control is pressed anyway", () => {
    const onChange = vi.fn();

    render(
      <ParamFields
        fields={ALL}
        idPrefix="p"
        onChange={onChange}
        reason={READ_ONLY}
        values={paramDefaults(ALL)}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Batch ok" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves every control alone when there is no reason to", () => {
    render(
      <ParamFields fields={ALL} idPrefix="p" onChange={vi.fn()} values={paramDefaults(ALL)} />,
    );

    expect(screen.getByLabelText("Thinking", { exact: false })).not.toBeDisabled();
    expect(screen.getByRole("switch", { name: "Batch ok" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the form in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <ParamFields fields={FIELDS} idPrefix="p" onChange={vi.fn()} values={paramDefaults(FIELDS)} />,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByLabelText("Thinking", { exact: false })).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <ParamFields fields={FIELDS} idPrefix="p" onChange={vi.fn()} values={paramDefaults(FIELDS)} />,
    );

    expect(light).toBe(dark);
  });
});

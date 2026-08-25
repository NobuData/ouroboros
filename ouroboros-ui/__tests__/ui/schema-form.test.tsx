import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SchemaField, SchemaFields, type SchemaFieldSpec } from "@/app/ui";

import { renderInBothPalettes } from "../helpers/palettes";

/**
 * The schema-driven form (#231, shared with #150): a column of fields drawn from a list it
 * did not write.
 *
 * The property this suite holds is the one the add-provider flow's honesty rests on: the
 * renderer has **no list of fields of its own**. Every widget the dialect derives maps onto a
 * field primitive with the attributes that make the browser do the checking, an error keyed
 * by name lands on the field it names, and nothing here knows what any field is *for*.
 */

/** Every optional keyword unset, so a case says only what it is about. */
function spec(over: Partial<SchemaFieldSpec> & Pick<SchemaFieldSpec, "name" | "label" | "widget">): SchemaFieldSpec {
  return {
    required: false,
    help: null,
    placeholder: null,
    defaultValue: null,
    choices: null,
    minLength: null,
    maxLength: null,
    pattern: null,
    ...over,
  };
}

describe("the four widgets", () => {
  it("draws text as a text input, in the UI face, with spelling checked", () => {
    render(<SchemaFields fields={[spec({ name: "note", label: "Note", widget: "text" })]} idPrefix="f" />);

    const note = screen.getByLabelText("Note");

    expect(note).toHaveAttribute("type", "text");
    expect(note).toHaveAttribute("name", "note");
    expect(note).not.toHaveClass("ou-input--mono");
    expect(note).toHaveAttribute("spellcheck", "true");
  });

  it("draws a url as a url input, read character by character", () => {
    render(<SchemaFields fields={[spec({ name: "baseUrl", label: "Base URL", widget: "url" })]} idPrefix="f" />);

    const url = screen.getByLabelText("Base URL");

    expect(url).toHaveAttribute("type", "url");
    expect(url).toHaveClass("ou-input--mono");
    expect(url).toHaveAttribute("spellcheck", "false");
  });

  it("draws a secret masked, and offers it to no password manager", () => {
    render(<SchemaFields fields={[spec({ name: "apiKey", label: "API key", widget: "secret" })]} idPrefix="f" />);

    const key = screen.getByLabelText("API key");

    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveAttribute("autocomplete", "off");
    expect(key).toHaveClass("ou-input--mono");
  });

  it("draws a select over its choices, starting on the default", () => {
    render(
      <SchemaFields
        fields={[
          spec({
            name: "region",
            label: "Region",
            widget: "select",
            required: true,
            choices: ["us-east-1", "eu-west-1"],
            defaultValue: "eu-west-1",
          }),
        ]}
        idPrefix="f"
      />,
    );

    const region = screen.getByLabelText("Region");

    expect(region.tagName).toBe("SELECT");
    expect([...region.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "us-east-1",
      "eu-west-1",
    ]);
    expect(region).toHaveValue("eu-west-1");
  });

  it("gives an optional select a way to choose nothing, and a required one none", () => {
    render(
      <SchemaFields
        fields={[
          spec({ name: "a", label: "Optional", widget: "select", choices: ["x"] }),
          spec({ name: "b", label: "Required", widget: "select", choices: ["x"], required: true }),
        ]}
        idPrefix="f"
      />,
    );

    expect(screen.getByLabelText("Optional").querySelectorAll("option")).toHaveLength(2);
    expect(screen.getByLabelText("Optional")).toHaveValue("");
    expect(screen.getByLabelText("Required").querySelectorAll("option")).toHaveLength(1);
    expect(screen.getByLabelText("Required")).toBeRequired();
  });
});

describe("what the field says about itself", () => {
  it("hands the browser the constraints, so a blank required key is refused before any request", () => {
    render(
      <SchemaFields
        fields={[
          spec({
            name: "apiKey",
            label: "API key",
            widget: "secret",
            required: true,
            minLength: 1,
            maxLength: 2048,
            pattern: "^sk-",
            placeholder: "sk-ant-api03-…",
            defaultValue: null,
          }),
        ]}
        idPrefix="f"
      />,
    );

    const key = screen.getByLabelText("API key");

    expect(key).toBeRequired();
    expect(key).toHaveAttribute("minlength", "1");
    expect(key).toHaveAttribute("maxlength", "2048");
    expect(key).toHaveAttribute("pattern", "^sk-");
    expect(key).toHaveAttribute("placeholder", "sk-ant-api03-…");
  });

  it("wires the help line into the control's description", () => {
    render(
      <SchemaFields
        fields={[spec({ name: "host", label: "Host", widget: "url", help: "Where the daemon is listening." })]}
        idPrefix="f"
      />,
    );

    expect(screen.getByLabelText("Host")).toHaveAccessibleDescription("Where the daemon is listening.");
  });

  it("starts a text control at its default", () => {
    render(
      <SchemaFields
        fields={[spec({ name: "region", label: "Region", widget: "text", defaultValue: "us-east-1" })]}
        idPrefix="f"
      />,
    );

    expect(screen.getByLabelText("Region")).toHaveValue("us-east-1");
  });

  it("builds every id from the prefix, so two forms on one page never share one", () => {
    render(
      <>
        <SchemaFields fields={[spec({ name: "apiKey", label: "First", widget: "secret" })]} idPrefix="one" />
        <SchemaFields fields={[spec({ name: "apiKey", label: "Second", widget: "secret" })]} idPrefix="two" />
      </>,
    );

    expect(screen.getByLabelText("First")).toHaveAttribute("id", "one-apiKey");
    expect(screen.getByLabelText("Second")).toHaveAttribute("id", "two-apiKey");
  });
});

describe("errors", () => {
  it("land on the field they name, as an alert the control is described by", () => {
    render(
      <SchemaFields
        errors={{ baseUrl: ["must match format \"uri\""] }}
        fields={[
          spec({ name: "baseUrl", label: "Base URL", widget: "url", help: "The root." }),
          spec({ name: "apiKey", label: "API key", widget: "secret" }),
        ]}
        idPrefix="f"
      />,
    );

    const url = screen.getByLabelText("Base URL");

    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(url).toHaveAccessibleDescription(/The root\./);
    expect(url).toHaveAccessibleDescription(/must match format "uri"/);
    expect(screen.getByRole("alert")).toHaveTextContent("must match format \"uri\"");

    expect(screen.getByLabelText("API key")).not.toHaveAttribute("aria-invalid");
  });

  it("join several sentences into one line, and draw nothing for an empty list", () => {
    render(
      <SchemaFields
        errors={{ a: ["Too short.", "Not a key."], b: [] }}
        fields={[
          spec({ name: "a", label: "A", widget: "text" }),
          spec({ name: "b", label: "B", widget: "text" }),
        ]}
        idPrefix="f"
      />,
    );

    expect(screen.getByLabelText("A")).toHaveAccessibleDescription("Too short. Not a key.");
    expect(screen.getByLabelText("B")).not.toHaveAttribute("aria-invalid");
  });

  it("reach a select the same way", () => {
    render(
      <SchemaField
        error={["Choose a region."]}
        id="f-region"
        spec={spec({ name: "region", label: "Region", widget: "select", choices: ["x"] })}
      />,
    );

    expect(screen.getByLabelText("Region")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Region")).toHaveAccessibleDescription("Choose a region.");
  });
});

describe("the renderer knows nothing about providers", () => {
  it("draws a list it has never seen exactly as one it has", () => {
    // The whole point: there is no branch on a name here. A field called anything, of any
    // widget, comes out as its widget says.
    render(
      <SchemaFields
        fields={[
          spec({ name: "speculative_decoding", label: "Speculative decoding", widget: "text" }),
          spec({ name: "signing_region", label: "Signing region", widget: "select", choices: ["a", "b"] }),
        ]}
        idPrefix="f"
      />,
    );

    expect(screen.getByLabelText("Speculative decoding")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Signing region").tagName).toBe("SELECT");
  });

  it("draws nothing for no fields, rather than a heading over an empty column", () => {
    const { container } = render(<SchemaFields fields={[]} idPrefix="f" />);

    expect(container.querySelector(".ou-schema-form")?.childElementCount).toBe(0);
  });
});

describe("both palettes", () => {
  it("renders identically under each", () => {
    const [light, dark] = renderInBothPalettes(
      <SchemaFields
        fields={[
          spec({ name: "baseUrl", label: "Base URL", widget: "url" }),
          spec({ name: "apiKey", label: "API key", widget: "secret" }),
          spec({ name: "region", label: "Region", widget: "select", choices: ["x"] }),
        ]}
        idPrefix="f"
      />,
    );

    expect(light).toBe(dark);
  });
});

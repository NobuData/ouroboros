import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { aliasPath } from "@/app/paths";
import type {
  CreateOutcome,
  ModelsReading,
  ParamSchemaReading,
} from "@/app/registry/create-actions";
import {
  CREATE_CANCEL,
  CREATE_READ_ONLY,
  CREATE_SUBMIT,
  CREATE_TITLE,
  MODELS_UNREADABLE,
  MODEL_ID_LABEL,
  MODEL_LABEL,
  MODEL_NOT_DISCOVERED,
  MODE_LATER_LABEL,
  MODE_NOW_LABEL,
  NAME_LABEL,
  NAME_SHAPE,
  NAME_TAKEN,
  NEEDS_MODEL,
  NEEDS_NAME,
  NEEDS_PROVIDER,
  NO_PROVIDERS_YET,
  PARAMS_UNREADABLE,
  PROVIDER_LABEL,
  UNBOUND_LINK,
  UNBOUND_NOTICE,
} from "@/app/registry/create";
import { MEMBER_REASON, NEW_ALIAS_LABEL, importSources } from "@/app/registry/view";

import { seededCards } from "../helpers/providers";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { modelOptionList, paramSchemaResponse, seededRegistry } from "../helpers/registry";
import { settle } from "../helpers/settle";

/**
 * The **+ New alias** dialog as it is drawn (#594).
 *
 * The acceptance criteria this suite exists for, in the ticket's words: **bind-now create works
 * end to end with a live model list and schema-driven param fields, and the new row appears
 * selected**; **bind-later create produces exactly the mockup's orphan-row state**; **a name
 * collision is caught**; and **members see the entry point inactive, with the reason**.
 *
 * The Server Actions are mocked, not the API: what is under test is the dialog, and
 * `create-actions.test.ts` is that module's own suite. `create.test.ts` proves the judgements;
 * this proves what reaches the DOM and what leaves it in a request.
 */

/** What the actions answer, per case. */
const createAlias = vi.fn<(body: unknown) => Promise<CreateOutcome>>();
const readModelOptions = vi.fn<(id: string) => Promise<ModelsReading>>();
const readParamSchema = vi.fn<(model: string, connection: string | null) => Promise<ParamSchemaReading>>();

/** What lands the page on the row that was just made. */
const replace = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/registry/create-actions", () => ({
  createAlias: (body: unknown) => createAlias(body),
  readModelOptions: (id: string) => readModelOptions(id),
  readParamSchema: (model: string, connection: string | null) => readParamSchema(model, connection),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

const { NewAlias } = await import("@/app/registry/new-alias");

/** The workspace's five connections, as the page hands them over. */
const SOURCES = importSources(seededCards());

/** Every alias name the seeded workspace has. */
const TAKEN = seededRegistry().map((alias) => alias.alias);

/** The seeded Anthropic connection's id — what the provider select's first real option carries. */
const ANTHROPIC = SOURCES[0]!.id;

beforeEach(() => {
  createAlias.mockReset().mockResolvedValue({ ok: true, alias: "opus-5" });
  readModelOptions.mockReset().mockResolvedValue({ ok: true, models: modelOptionList().models });
  readParamSchema.mockReset().mockResolvedValue({ ok: true, schema: paramSchemaResponse() });
  replace.mockReset();
  refresh.mockReset();
});

/**
 * Render the action and open its dialog.
 *
 * @param over What this case is about.
 * @returns Nothing; the dialog is on the screen.
 */
function open(over: { mayAdminister?: boolean; sources?: typeof SOURCES } = {}): void {
  render(
    <NewAlias
      aliasNames={TAKEN}
      mayAdminister={over.mayAdminister ?? true}
      sources={over.sources ?? SOURCES}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: NEW_ALIAS_LABEL }));
}

/**
 * Type a name into the dialog.
 *
 * @param value What to type.
 */
function typeName(value: string): void {
  fireEvent.change(screen.getByLabelText(NAME_LABEL), { target: { value } });
}

/** The dialog's primary control. */
function submit(): HTMLElement {
  return screen.getByRole("button", { name: CREATE_SUBMIT });
}

describe("the head's primary action", () => {
  it("opens the dialog when an admin presses it", () => {
    open();

    expect(screen.getByRole("dialog")).toHaveAccessibleName(CREATE_TITLE);
  });

  it("is inert for a member, with the reason that is true of them", () => {
    // The ticket's own criterion, and the gate that enforces is the service's.
    render(<NewAlias aliasNames={TAKEN} mayAdminister={false} sources={SOURCES} />);

    const button = screen.getByRole("button", { name: NEW_ALIAS_LABEL });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", MEMBER_REASON);

    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays reachable by keyboard for a member, so its explanation is reachable too", () => {
    render(<NewAlias aliasNames={TAKEN} mayAdminister={false} sources={SOURCES} />);

    expect((screen.getByRole("button", { name: NEW_ALIAS_LABEL }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("opens on an empty form every time, so a dialog dismissed halfway starts clean", () => {
    open();
    typeName("half-typed");
    fireEvent.click(screen.getByRole("button", { name: CREATE_CANCEL }));
    fireEvent.click(screen.getByRole("button", { name: NEW_ALIAS_LABEL }));

    expect(screen.getByLabelText(NAME_LABEL)).toHaveValue("");
  });
});

describe("the name, checked as it is typed", () => {
  it("says nothing at all until something has been typed", () => {
    // A dialog that opened already telling the reader off for not having typed anything would
    // be shouting first and asking second.
    open();

    expect(screen.queryByText(NAME_SHAPE)).toBeNull();
    expect(screen.queryByText(NAME_TAKEN)).toBeNull();
  });

  it("catches a name the workspace already has, with no round trip", () => {
    // The ordinary collision, caught against the table the reader is looking at.
    open();
    typeName("coder-max");

    expect(screen.getByText(NAME_TAKEN)).toBeInTheDocument();
    expect(submit()).toHaveAttribute("title", NEEDS_NAME);
  });

  it("catches a name that is not lower-case kebab", () => {
    open();
    typeName("Coder Max");

    expect(screen.getByText(NAME_SHAPE)).toBeInTheDocument();
  });

  it("clears the line again when the name becomes free", () => {
    open();
    typeName("coder-max");
    typeName("opus-5");

    expect(screen.queryByText(NAME_TAKEN)).toBeNull();
  });
});

describe("bind now", () => {
  it("opens on the bound mode, which is what most aliases are", () => {
    open();

    expect(screen.getByRole("radio", { name: MODE_NOW_LABEL })).toBeChecked();
  });

  it("asks for a provider before it asks for anything else", () => {
    open();
    typeName("opus-5");

    expect(submit()).toHaveAttribute("title", NEEDS_PROVIDER);
  });

  it("lists the workspace's connections, in the order the page gave them", () => {
    open();

    const options = [...(screen.getByLabelText(PROVIDER_LABEL) as HTMLSelectElement).options];

    expect(options.slice(1).map((option) => option.textContent)).toEqual(
      SOURCES.map((source) => source.name),
    );
  });

  it("lists the chosen connection's models live, and asks about that connection alone", async () => {
    open();
    fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), {
      target: { value: ANTHROPIC },
    });

    expect(readModelOptions).toHaveBeenCalledExactlyOnceWith(ANTHROPIC);

    const select = await screen.findByLabelText(MODEL_LABEL);

    expect([...(select as HTMLSelectElement).options].slice(1).map((option) => option.value)).toEqual([
      "claude-fable-5",
      "claude-haiku-4-5",
      "claude-opus-5",
    ]);
  });

  it("draws a box instead of a select when discovery has reported nothing", async () => {
    // An empty list is an honest answer, not a failure: the alias may still be created by
    // typing the model, and the create answers with a warning rather than a refusal.
    readModelOptions.mockResolvedValue({ ok: true, models: [] });
    open();
    fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), {
      target: { value: ANTHROPIC },
    });

    const input = await screen.findByLabelText(MODEL_LABEL);

    expect(input.tagName).toBe("INPUT");
    expect(screen.getByText(MODEL_NOT_DISCOVERED)).toBeInTheDocument();
  });

  it("reads a typed model's parameters when the box is left, not on every keystroke", async () => {
    // A read per keystroke would ask about `c`, `cl`, `cla`… and answer about none of them.
    readModelOptions.mockResolvedValue({ ok: true, models: [] });
    open();
    fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), { target: { value: ANTHROPIC } });

    const box = await screen.findByLabelText(MODEL_LABEL);

    for (const typed of ["c", "cl", "cla", "claude-opus-5"]) {
      fireEvent.change(box, { target: { value: typed } });
    }
    await settle();

    expect(readParamSchema).not.toHaveBeenCalled();

    fireEvent.blur(box, { target: { value: "claude-opus-5" } });
    await settle();

    expect(readParamSchema).toHaveBeenCalledExactlyOnceWith("claude-opus-5", ANTHROPIC);
  });

  it("says why the box is a box when the listing itself was refused", async () => {
    readModelOptions.mockResolvedValue({ ok: false, reason: MODELS_UNREADABLE });
    open();
    fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), {
      target: { value: ANTHROPIC },
    });

    expect(await screen.findByText(MODELS_UNREADABLE)).toBeInTheDocument();
  });

  it("draws the model's own parameter fields once a model is chosen", async () => {
    // The schema-driven half of the ticket's first criterion, and there is no list of
    // parameters anywhere in this dialog.
    open();
    await chooseAnthropicOpus();

    expect(await screen.findByLabelText("Thinking", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText("Token budget", { exact: false })).toBeInTheDocument();
    expect(readParamSchema).toHaveBeenCalledExactlyOnceWith("claude-opus-5", ANTHROPIC);
  });

  it("draws the schema's own sentence when a model has nothing to tune", async () => {
    readParamSchema.mockResolvedValue({
      ok: true,
      schema: {
        ...paramSchemaResponse(),
        reason: "provider_has_no_parameters",
        params: {
          schema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            title: "Copilot",
            description: "This provider publishes no per-call parameters.",
            properties: {},
            additionalProperties: false,
          },
          fields: [],
        },
      },
    });
    open();
    await chooseAnthropicOpus();

    expect(
      await screen.findByText("This provider publishes no per-call parameters."),
    ).toBeInTheDocument();
  });

  it("keeps the create possible when the parameter schema could not be read", async () => {
    // A form that cannot be drawn is not a create that failed.
    readParamSchema.mockResolvedValue({ ok: false, reason: PARAMS_UNREADABLE });
    open();
    typeName("opus-5");
    await chooseAnthropicOpus();

    expect(await screen.findByText(PARAMS_UNREADABLE)).toBeInTheDocument();
    expect(submit()).not.toHaveAttribute("aria-disabled");
  });

  it("clears the model and its parameters when the provider changes", async () => {
    // A model belongs to its binding; carrying one across would send a model the new
    // connection has never reported.
    open();
    await chooseAnthropicOpus();
    await screen.findByLabelText("Thinking", { exact: false });

    fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), {
      target: { value: SOURCES[1]!.id },
    });
    await settle();

    expect(screen.queryByLabelText("Thinking", { exact: false })).toBeNull();
    expect(await screen.findByLabelText(MODEL_LABEL)).toHaveValue("");
  });

  it("sends the connection, the model and the parameters that were filled in", async () => {
    open();
    typeName("opus-5");
    await chooseAnthropicOpus();
    fireEvent.change(await screen.findByLabelText("Thinking", { exact: false }), {
      target: { value: "max" },
    });
    fireEvent.click(submit());

    await waitFor(() => {
      expect(createAlias).toHaveBeenCalledExactlyOnceWith({
        alias: "opus-5",
        modelId: "claude-opus-5",
        connectionId: ANTHROPIC,
        params: { thinking: "max" },
      });
    });
  });

  it("sends no parameters at all for a form nobody filled in", async () => {
    // The provider's own defaults, which is what an alias whose `params` omits a key gets.
    open();
    typeName("opus-5");
    await chooseAnthropicOpus();
    await screen.findByLabelText("Thinking", { exact: false });
    fireEvent.click(submit());

    await waitFor(() => {
      expect(createAlias).toHaveBeenCalledExactlyOnceWith({
        alias: "opus-5",
        modelId: "claude-opus-5",
        connectionId: ANTHROPIC,
      });
    });
  });
});

describe("bind later", () => {
  it("asks for a model id and no provider, which is the point of the mode", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: MODE_LATER_LABEL }));

    expect(screen.getByLabelText(MODEL_ID_LABEL)).toBeInTheDocument();
    expect(screen.queryByLabelText(PROVIDER_LABEL)).toBeNull();
  });

  it("says what the row will look like, before it is made", () => {
    // Mockup 21's orphan row — dimmed, switch off, `✗ no key — connect a provider` — described
    // in advance, which is what makes it read as a state somebody chose.
    open();
    fireEvent.click(screen.getByRole("radio", { name: MODE_LATER_LABEL }));

    expect(screen.getByText(UNBOUND_NOTICE, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: UNBOUND_LINK })).toHaveAttribute(
      "href",
      "/models/providers",
    );
  });

  it("sends a body with no connection in it", async () => {
    open();
    typeName("gpt5-preview");
    fireEvent.click(screen.getByRole("radio", { name: MODE_LATER_LABEL }));
    fireEvent.change(screen.getByLabelText(MODEL_ID_LABEL), {
      target: { value: "gpt-5.2-preview" },
    });
    fireEvent.click(submit());

    await waitFor(() => {
      expect(createAlias).toHaveBeenCalledExactlyOnceWith({
        alias: "gpt5-preview",
        modelId: "gpt-5.2-preview",
      });
    });
  });

  it("reads no parameter schema, because an unbound alias accepts none", async () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: MODE_LATER_LABEL }));
    fireEvent.change(screen.getByLabelText(MODEL_ID_LABEL), {
      target: { value: "gpt-5.2-preview" },
    });
    await settle();

    expect(readParamSchema).not.toHaveBeenCalled();
  });

  it("still asks for a model", () => {
    open();
    typeName("gpt5-preview");
    fireEvent.click(screen.getByRole("radio", { name: MODE_LATER_LABEL }));

    expect(submit()).toHaveAttribute("title", NEEDS_MODEL);
  });

  it("works for a workspace that has connected nothing, which is the state it is for", () => {
    // *Bind now* has nothing to offer and says so; *bind later* is unaffected.
    render(<NewAlias aliasNames={[]} mayAdminister sources={[]} />);
    fireEvent.click(screen.getByRole("button", { name: NEW_ALIAS_LABEL }));

    expect(screen.getByText(NO_PROVIDERS_YET)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: MODE_LATER_LABEL }));

    expect(screen.getByLabelText(MODEL_ID_LABEL)).toBeInTheDocument();
  });
});

describe("what a create does to the page", () => {
  it("closes, and lands the page on the row it just made", async () => {
    // The ticket's criterion: the row appears in the table and is selected, so the inspector's
    // seat is already open on it.
    open();
    typeName("opus-5");
    fireEvent.click(screen.getByRole("radio", { name: MODE_LATER_LABEL }));
    fireEvent.change(screen.getByLabelText(MODEL_ID_LABEL), {
      target: { value: "claude-opus-5" },
    });
    fireEvent.click(submit());

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(aliasPath("opus-5"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the name the service stored, not the one that was typed", async () => {
    createAlias.mockResolvedValue({ ok: true, alias: "opus-5-2" });
    open();
    typeName("opus-5");
    fireEvent.click(screen.getByRole("radio", { name: MODE_LATER_LABEL }));
    fireEvent.change(screen.getByLabelText(MODEL_ID_LABEL), {
      target: { value: "claude-opus-5" },
    });
    fireEvent.click(submit());

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(aliasPath("opus-5-2"));
    });
  });

  it("navigates nothing when the dialog is cancelled", () => {
    open();
    typeName("opus-5");
    fireEvent.click(screen.getByRole("button", { name: CREATE_CANCEL }));

    expect(createAlias).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("a refusal", () => {
  /**
   * Fill in and submit a bind-later draft.
   *
   * @param name The alias to ask for.
   */
  function submitUnbound(name: string): void {
    typeName(name);
    fireEvent.click(screen.getByRole("radio", { name: MODE_LATER_LABEL }));
    fireEvent.change(screen.getByLabelText(MODEL_ID_LABEL), {
      target: { value: "claude-opus-5" },
    });
    fireEvent.click(submit());
  }

  it("keeps the dialog open with every value where the reader left it", async () => {
    createAlias.mockResolvedValue({
      ok: false,
      refusal: { code: "model_alias_name_taken", message: "taken", details: {} },
    });
    open();
    submitUnbound("opus-5");

    // The whole-form sentence, not the name field's — both are alerts, and it is the one that
    // says nothing was created.
    await screen.findByText(NAME_TAKEN, { exact: false, selector: ".registry-create__failure" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(NAME_LABEL)).toHaveValue("opus-5");
    expect(screen.getByLabelText(MODEL_ID_LABEL)).toHaveValue("claude-opus-5");
  });

  it("puts a taken name under the name box, wherever it was caught", async () => {
    createAlias.mockResolvedValue({
      ok: false,
      refusal: { code: "model_alias_name_taken", message: "taken", details: {} },
    });
    open();
    submitUnbound("opus-5");

    await waitFor(() => {
      expect(screen.getByLabelText(NAME_LABEL)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    expect(screen.getAllByText(NAME_TAKEN, { exact: false }).length).toBeGreaterThan(0);
  });

  it("puts a parameter refusal on the control it named", async () => {
    createAlias.mockResolvedValue({
      ok: false,
      refusal: {
        code: "model_alias_params_invalid",
        message: "no",
        details: { "params.thinking": ["thinking must be one of off, std, max"] },
      },
    });
    open();
    typeName("opus-5");
    await chooseAnthropicOpus();
    await screen.findByLabelText("Thinking", { exact: false });
    fireEvent.click(submit());

    expect(await screen.findByText("thinking must be one of off, std, max")).toBeInTheDocument();
  });

  it("says a member's refusal in words, and creates nothing", async () => {
    // A check made in the browser is a check anybody can skip, so the service's answer is what
    // the dialog draws when somebody goes around the presentation.
    createAlias.mockResolvedValue({
      ok: false,
      refusal: { code: "forbidden", message: "no", details: {} },
    });
    open();
    submitUnbound("opus-5");

    expect(await screen.findByText(CREATE_READ_ONLY)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the action in the %s palette", (palette) => {
    renderInPalette(palette, <NewAlias aliasNames={TAKEN} mayAdminister sources={SOURCES} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("button", { name: NEW_ALIAS_LABEL })).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <NewAlias aliasNames={TAKEN} mayAdminister sources={SOURCES} />,
    );

    expect(light).toBe(dark);
  });
});

/**
 * Choose the seeded Anthropic connection and its `claude-opus-5`.
 *
 * @returns Nothing; the dialog's model select has been set.
 */
async function chooseAnthropicOpus(): Promise<void> {
  fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), {
    target: { value: ANTHROPIC },
  });

  const select = await screen.findByLabelText(MODEL_LABEL);

  fireEvent.change(select, { target: { value: "claude-opus-5" } });
  await settle();
}

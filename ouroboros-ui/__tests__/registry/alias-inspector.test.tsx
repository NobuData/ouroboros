import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { REGISTRY_PATH, aliasPath } from "@/app/paths";
import type { ModelsReading, ParamSchemaReading } from "@/app/registry/create-actions";
import {
  MODEL_ID_LABEL,
  MODEL_LABEL,
  MODEL_NOT_DISCOVERED,
  NAME_HINT,
  NAME_LABEL,
  PARAMS_TITLE,
  PROVIDER_LABEL,
} from "@/app/registry/create";
import type {
  DuplicateOutcome,
  RemoveOutcome,
  SaveOutcome,
} from "@/app/registry/inspector-actions";
import {
  DUPLICATE_LABEL,
  INSPECTOR_READ_ONLY,
  NAME_TAKEN,
  NOTHING_TO_SAVE,
  REMOVE_CONFIRM,
  REMOVE_LABEL,
  RENAME_BLOCKED,
  RESTRICTIONS_TITLE,
  SAVE_LABEL,
  UNBOUND_BANNER,
  USED_BY_LABEL,
  providerOption,
  removeWhy,
  renameGuardNote,
} from "@/app/registry/inspector";
import { type TableRow, FIX_IN_PROVIDERS, tableRows } from "@/app/registry/table";
import { importSources } from "@/app/registry/view";

import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { seededCards } from "../helpers/providers";
import {
  budgetField,
  modelOptionList,
  paramField,
  paramSchemaResponse,
  paramSection,
  seededRegistry,
} from "../helpers/registry";
import { settle } from "../helpers/settle";

/**
 * Mockup 21's **EDIT — CODER-MAX** card as it is drawn (CI.3, #593).
 *
 * The ticket's acceptance criteria are the shape of this file: the seeded `coder-max`
 * reproduces the drawing (fields, hints, four Used-by chips, the blocked foot) in both themes;
 * a rebind is one select and one press and sends one field; a model with no thinking select
 * loses the thinking controls and gets them back; a rename of a referenced alias is refused
 * *inline, before Save*; Remove completes on the orphan and is blocked with the mono why-line
 * on `coder-max`; Duplicate lands on `coder-max-copy`; and every server refusal reaches the
 * field it is about.
 *
 * The Server Actions are mocked and the API is not: what is under test is the card.
 * `inspector.ts`'s judgements are `inspector.test.ts`'s and the hops are
 * `inspector-actions.test.ts`'s; this proves what reaches the DOM and what leaves it in a
 * request.
 */

/** What the actions answer, per case. */
const saveAlias = vi.fn<(id: string, change: unknown) => Promise<SaveOutcome>>();
const duplicateAlias = vi.fn<(id: string) => Promise<DuplicateOutcome>>();
const removeAlias = vi.fn<(id: string) => Promise<RemoveOutcome>>();
const readModelOptions = vi.fn<(id: string) => Promise<ModelsReading>>();
const readParamSchema =
  vi.fn<(model: string, connection: string | null) => Promise<ParamSchemaReading>>();

/** Where a save, a duplicate or a remove lands the page. */
const replace = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/registry/inspector-actions", () => ({
  saveAlias: (id: string, change: unknown) => saveAlias(id, change),
  duplicateAlias: (id: string) => duplicateAlias(id),
  removeAlias: (id: string) => removeAlias(id),
}));
vi.mock("@/app/registry/create-actions", () => ({
  createAlias: vi.fn(),
  readModelOptions: (id: string) => readModelOptions(id),
  readParamSchema: (model: string, connection: string | null) => readParamSchema(model, connection),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

const { AliasInspector } = await import("@/app/registry/alias-inspector");

/** The seeded table's rows, decided. */
const ROWS: readonly TableRow[] = tableRows(seededRegistry());

/** The workspace's five connections, as the page hands them over. */
const SOURCES = importSources(seededCards());

/** Every alias name the seeded workspace has. */
const NAMES = seededRegistry().map((alias) => alias.alias);

/**
 * One row, by its alias.
 *
 * @param alias Which alias.
 * @returns The row.
 */
function row(alias: string): TableRow {
  const found = ROWS.find((candidate) => candidate.alias === alias);

  if (found === undefined) throw new Error(`no seeded row for ${alias}`);
  return found;
}

/** The Anthropic connection the mockup's inspector is bound to. */
const ANTHROPIC = row("coder-max").provider?.id ?? "";

/** …and a second one to rebind to. */
const CURSOR = SOURCES[1]?.id ?? "";

beforeEach(() => {
  saveAlias.mockReset().mockResolvedValue({ ok: true, alias: "coder-max" });
  duplicateAlias.mockReset().mockResolvedValue({ ok: true, alias: "coder-max-copy" });
  removeAlias.mockReset().mockResolvedValue({ ok: true });
  readModelOptions.mockReset().mockResolvedValue({ ok: true, models: modelOptionList().models });
  readParamSchema.mockReset().mockResolvedValue({ ok: true, schema: paramSchemaResponse() });
  replace.mockReset();
  refresh.mockReset();
});

/**
 * Render the card and let its two reads land.
 *
 * @param over What this case is about.
 * @returns The render result.
 */
async function card(
  over: { alias?: string; mayAdminister?: boolean; sources?: typeof SOURCES } = {},
) {
  const view = render(
    <AliasInspector
      aliasNames={NAMES}
      mayAdminister={over.mayAdminister ?? true}
      row={row(over.alias ?? "coder-max")}
      sources={over.sources ?? SOURCES}
    />,
  );

  await settle();

  return view;
}

/** The name box. */
function name(): HTMLInputElement {
  return screen.getByLabelText(NAME_LABEL) as HTMLInputElement;
}

/** One of the foot's three controls. */
function control(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

describe("the seeded coder-max, as the mockup draws it", () => {
  it("prefills every field from the row's own state", async () => {
    await card();

    expect(name()).toHaveValue("coder-max");
    expect(screen.getByLabelText(PROVIDER_LABEL)).toHaveValue(ANTHROPIC);
    expect(screen.getByLabelText(MODEL_LABEL)).toHaveValue("claude-fable-5");
  });

  it("carries the mockup's own hint under the name, verbatim", async () => {
    await card();

    expect(screen.getByText(NAME_HINT)).toBeInTheDocument();
  });

  it("names the connection and its masked key in the provider select, as the mockup's option does", async () => {
    await card();

    const option = within(screen.getByLabelText(PROVIDER_LABEL)).getByRole("option", {
      name: providerOption(SOURCES[0]!),
    });

    expect(option).toHaveValue(ANTHROPIC);
  });

  it("links the provider hint to Providers & keys, as the mockup does", async () => {
    await card();

    expect(screen.getByRole("link", { name: "Providers & keys" })).toHaveAttribute(
      "href",
      "/models/providers",
    );
  });

  it("lists the connection's models live, and says so", async () => {
    await card();

    expect(readModelOptions).toHaveBeenCalledWith(ANTHROPIC);
    expect(screen.getByText("listed live from the provider")).toBeInTheDocument();
    for (const option of modelOptionList().models) {
      expect(
        within(screen.getByLabelText(MODEL_LABEL)).getByRole("option", { name: option.display }),
      ).toBeInTheDocument();
    }
  });

  it("draws the model's own parameters, prefilled from what is stored", async () => {
    await card();

    expect(screen.getByRole("heading", { name: PARAMS_TITLE })).toBeInTheDocument();
    expect(screen.getByLabelText("Thinking")).toHaveValue("max");
    expect(screen.getByLabelText("Token budget")).toHaveValue(400_000);
  });

  it("draws the registry's restrictions beside them, whatever the model supports", async () => {
    await card();

    expect(screen.getByRole("heading", { name: RESTRICTIONS_TITLE })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Batch ok" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("draws the mockup's four Used-by chips, each pointing at the surface that holds it", async () => {
    await card();

    const chips = within(screen.getByRole("list", { name: /reference this alias/i })).getAllByRole(
      "listitem",
    );

    expect(chips.map((chip) => chip.textContent)).toEqual([
      "implement-primary",
      "plan-primary",
      "review-primary",
      "escalation:effort≥L",
    ]);
    expect(within(chips[0]!).getByRole("link")).toHaveAttribute("href", "/models#models-matrix-title");
    expect(within(chips[3]!).getByRole("link")).toHaveAttribute("href", "/models#models-rules-title");
    expect(screen.getByRole("heading", { name: USED_BY_LABEL })).toBeInTheDocument();
  });

  it("draws the foot's three controls, with Remove blocked and the mono why-line beside it", async () => {
    await card();

    const remove = control(REMOVE_LABEL);
    const why = removeWhy(4);

    expect(control(SAVE_LABEL)).toHaveAttribute("aria-disabled", "true");
    expect(control(DUPLICATE_LABEL)).not.toHaveAttribute("aria-disabled");
    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(remove).toHaveAttribute("title", why);
    expect(screen.getByText(why!)).toHaveClass("registry-inspector__why");
    // The line is *described* by the button rather than merely near it, so a reader who cannot
    // see the button dim is told why it will not act.
    expect(remove.getAttribute("aria-describedby")).toBe(screen.getByText(why!).id);
  });

  it("keeps Save inert until something is changed", async () => {
    await card();

    expect(control(SAVE_LABEL)).toHaveAttribute("title", NOTHING_TO_SAVE);
  });
});

describe("rebinding — the BYOK claim, in one select and one press", () => {
  it("sends the binding and what it governs, and lands the page on the row", async () => {
    await card();

    fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), { target: { value: CURSOR } });
    await settle();
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => { expect(saveAlias).toHaveBeenCalled(); });

    const [, body] = saveAlias.mock.calls[0]!;

    expect(body).toMatchObject({ connectionId: CURSOR });
    expect(body).not.toHaveProperty("alias");
    await waitFor(() => { expect(refresh).toHaveBeenCalled(); });
    expect(replace).toHaveBeenCalledWith(aliasPath("coder-max"));
  });

  it("keeps the model, and re-lists the new connection's models", async () => {
    // `claude-fable-5` on one Anthropic connection is `claude-fable-5` on the next; a rebind
    // that emptied the box would make the product's simplest story two decisions.
    await card();

    fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), { target: { value: CURSOR } });
    await settle();

    expect(readModelOptions).toHaveBeenCalledWith(CURSOR);
    expect(screen.getByLabelText(MODEL_LABEL)).toHaveValue("claude-fable-5");
  });

  it("offers a model the new connection has not reported, rather than dropping it", async () => {
    await card();

    readModelOptions.mockResolvedValue({ ok: true, models: [modelOptionList().models[2]!] });
    fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), { target: { value: CURSOR } });
    await settle();

    expect(screen.getByLabelText(MODEL_LABEL)).toHaveValue("claude-fable-5");
    expect(screen.getByText(/is not in this connection's discovered list/)).toBeInTheDocument();
  });
});

describe("the field set is the model's", () => {
  /** A schema for a model with nothing to tune but the workspace's own restrictions. */
  const PLAIN: ParamSchemaReading = {
    ok: true,
    schema: paramSchemaResponse({
      modelId: "claude-haiku-4-5",
      params: paramSection([], "Anthropic model parameters", "This model takes no parameters."),
    }),
  };

  it("loses the thinking and budget controls for a model that has neither, and gets them back", async () => {
    await card();

    expect(screen.getByLabelText("Thinking")).toBeInTheDocument();

    readParamSchema.mockResolvedValue(PLAIN);
    fireEvent.change(screen.getByLabelText(MODEL_LABEL), { target: { value: "claude-haiku-4-5" } });
    await settle();

    expect(screen.queryByLabelText("Thinking")).toBeNull();
    expect(screen.queryByLabelText("Token budget")).toBeNull();
    expect(screen.getByText("This model takes no parameters.")).toBeInTheDocument();

    readParamSchema.mockResolvedValue({ ok: true, schema: paramSchemaResponse() });
    fireEvent.change(screen.getByLabelText(MODEL_LABEL), { target: { value: "claude-fable-5" } });
    await settle();

    expect(screen.getByLabelText("Thinking")).toBeInTheDocument();
  });

  it("sends the reduced parameters with the model, so nothing stale is re-validated", async () => {
    await card();

    readParamSchema.mockResolvedValue(PLAIN);
    fireEvent.change(screen.getByLabelText(MODEL_LABEL), { target: { value: "claude-haiku-4-5" } });
    await settle();
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => { expect(saveAlias).toHaveBeenCalled(); });

    expect(saveAlias.mock.calls[0]![1]).toMatchObject({
      modelId: "claude-haiku-4-5",
      params: {},
    });
  });

  it("draws a parameter no adapter in this build has, because it holds no list of them", async () => {
    readParamSchema.mockResolvedValue({
      ok: true,
      schema: paramSchemaResponse({
        params: paramSection([
          paramField({
            name: "nucleus_sampling",
            label: "Nucleus sampling",
            widget: "number",
            choices: null,
            minimum: 0,
            maximum: 1,
          }),
        ]),
      }),
    });

    await card();

    expect(screen.getByLabelText("Nucleus sampling")).toBeInTheDocument();
  });

  it("sends a changed parameter on its own, with no binding attached", async () => {
    await card();

    fireEvent.change(screen.getByLabelText("Thinking"), { target: { value: "std" } });
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => { expect(saveAlias).toHaveBeenCalled(); });

    expect(saveAlias.mock.calls[0]![1]).toEqual({
      params: { thinking: "std", token_budget: 400_000 },
    });
  });

  it("sends a restriction toggled on, because policy is the registry's whatever the model is", async () => {
    await card();

    fireEvent.click(screen.getByRole("switch", { name: "Batch ok" }));
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => { expect(saveAlias).toHaveBeenCalled(); });

    expect(saveAlias.mock.calls[0]![1]).toEqual({ restrictions: { batch_ok: true } });
  });
});

describe("the rename guard, said before Save is pressed", () => {
  it("stands under the name field for a referenced alias, before anything is typed", async () => {
    await card();

    expect(screen.getByText(renameGuardNote(4)!)).toBeInTheDocument();
  });

  it("refuses the rename the moment the box holds a different name, with no round trip", async () => {
    await card();

    fireEvent.change(name(), { target: { value: "coder-dev" } });

    expect(control(SAVE_LABEL)).toHaveAttribute("title", RENAME_BLOCKED);
    expect(saveAlias).not.toHaveBeenCalled();

    fireEvent.click(control(SAVE_LABEL));
    await settle();

    expect(saveAlias).not.toHaveBeenCalled();
  });

  it("says nothing about renaming an alias nothing references, and lets it through", async () => {
    await card({ alias: "gpt5-experiments" });

    expect(screen.queryByText(/rename is blocked/)).toBeNull();

    fireEvent.change(name(), { target: { value: "gpt5-lab" } });
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => { expect(saveAlias).toHaveBeenCalled(); });

    expect(saveAlias.mock.calls[0]![1]).toMatchObject({ alias: "gpt5-lab" });
  });

  it("catches a name another alias already has, in the box, as it is typed", async () => {
    await card({ alias: "gpt5-experiments" });

    fireEvent.change(name(), { target: { value: "sizer" } });

    expect(screen.getByText(NAME_TAKEN)).toBeInTheDocument();
  });

  it("does not accuse the alias of taking its own name", async () => {
    await card();

    expect(screen.queryByText(NAME_TAKEN)).toBeNull();
  });
});

describe("Duplicate", () => {
  it("copies the alias and selects the copy the service named", async () => {
    await card();

    fireEvent.click(control(DUPLICATE_LABEL));

    await waitFor(() => { expect(duplicateAlias).toHaveBeenCalledWith(row("coder-max").id); });
    await waitFor(() => { expect(replace).toHaveBeenCalledWith(aliasPath("coder-max-copy")); });
    expect(refresh).toHaveBeenCalled();
  });

  it("draws a refused copy in the foot rather than replacing the page", async () => {
    duplicateAlias.mockResolvedValue({
      ok: false,
      refusal: { code: "model_alias_copy_name_too_long", message: "no", details: {} },
    });

    await card();
    fireEvent.click(control(DUPLICATE_LABEL));

    expect(await screen.findByRole("alert")).toHaveTextContent(/64 characters/);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("Remove", () => {
  it("asks first, then removes an alias nothing references, and leaves nothing selected", async () => {
    await card({ alias: "gpt5-experiments" });

    expect(control(REMOVE_LABEL)).not.toHaveAttribute("aria-disabled");
    fireEvent.click(control(REMOVE_LABEL));

    expect(screen.getByRole("dialog", { name: "Remove gpt5-experiments?" })).toBeInTheDocument();
    fireEvent.click(control(REMOVE_CONFIRM));

    await waitFor(() => { expect(removeAlias).toHaveBeenCalledWith(row("gpt5-experiments").id); });
    await waitFor(() => { expect(replace).toHaveBeenCalledWith(REGISTRY_PATH); });
  });

  it("writes nothing when the confirmation is dismissed", async () => {
    await card({ alias: "gpt5-experiments" });

    fireEvent.click(control(REMOVE_LABEL));
    fireEvent.click(control("Cancel"));
    await settle();

    expect(removeAlias).not.toHaveBeenCalled();
  });

  it("cannot be pressed at all on a referenced alias", async () => {
    await card();

    fireEvent.click(control(REMOVE_LABEL));
    await settle();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(removeAlias).not.toHaveBeenCalled();
  });

  it("names the service's own referrers when the guard changed underneath the card", async () => {
    removeAlias.mockResolvedValue({
      ok: false,
      refusal: {
        code: "model_alias_referenced",
        message: "no",
        details: { references: row("coder-max").references },
      },
    });

    await card({ alias: "gpt5-experiments" });
    fireEvent.click(control(REMOVE_LABEL));
    fireEvent.click(control(REMOVE_CONFIRM));

    expect(await screen.findByRole("alert")).toHaveTextContent("3 routes and 1 escalation rule");
  });
});

describe("a refusal from the service", () => {
  it("puts a taken name under the name box and a sentence under the form", async () => {
    saveAlias.mockResolvedValue({
      ok: false,
      refusal: { code: "model_alias_name_taken", message: "no", details: {} },
    });

    await card({ alias: "gpt5-experiments" });
    fireEvent.change(name(), { target: { value: "gpt5-lab" } });
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => { expect(screen.getAllByText(NAME_TAKEN).length).toBeGreaterThan(0); });
    expect(name()).toHaveAttribute("aria-invalid", "true");
  });

  it("puts a bad parameter under the control that produced it", async () => {
    saveAlias.mockResolvedValue({
      ok: false,
      refusal: {
        code: "model_alias_params_invalid",
        message: "no",
        details: { "params.thinking": ["This model has no extended thinking."] },
      },
    });

    await card();
    fireEvent.change(screen.getByLabelText("Thinking"), { target: { value: "off" } });
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => {
      expect(screen.getByText("This model has no extended thinking.")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Thinking")).toHaveAttribute("aria-invalid", "true");
  });

  it("never reaches the service with a value the schema's own bounds refuse", async () => {
    // CH.2 puts the bounds on the control as well as in the hint, so the browser refuses an
    // out-of-range budget before a round trip is spent on it — and the service refuses it
    // again, which is the half that decides.
    await card();

    const budget = screen.getByLabelText("Token budget");

    expect(budget).toHaveAttribute("max", "400000");

    fireEvent.change(budget, { target: { value: "900000" } });
    fireEvent.click(control(SAVE_LABEL));
    await settle();

    expect(saveAlias).not.toHaveBeenCalled();
    expect(budget).toBeInvalid();
  });

  it("puts a bad restriction under its own switch rather than under a parameter", async () => {
    saveAlias.mockResolvedValue({
      ok: false,
      refusal: {
        code: "model_alias_params_invalid",
        message: "no",
        details: { "restrictions.batch_ok": ["This provider cannot batch."] },
      },
    });

    await card();
    fireEvent.click(screen.getByRole("switch", { name: "Batch ok" }));
    fireEvent.click(control(SAVE_LABEL));

    expect(await screen.findByText("This provider cannot batch.")).toHaveClass(
      "registry-params__switch-error",
    );
  });

  it("puts a malformed model under the model field", async () => {
    saveAlias.mockResolvedValue({
      ok: false,
      refusal: {
        code: "validation_failed",
        message: "no",
        details: { modelId: ["Must not be empty."] },
      },
    });

    await card();
    fireEvent.change(screen.getByLabelText(MODEL_LABEL), { target: { value: "claude-opus-5" } });
    await settle();
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => {
      expect(screen.getByText("Must not be empty.")).toBeInTheDocument();
    });
  });
});

describe("an unbound alias", () => {
  it("says what state it is in and where the fix is, at the top of the card", async () => {
    await card({ alias: "gpt5-experiments" });

    expect(screen.getByText(UNBOUND_BANNER, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: FIX_IN_PROVIDERS })).toHaveAttribute(
      "href",
      "/models/providers",
    );
  });

  it("takes the model as text, since there is no connection to list from", async () => {
    await card({ alias: "gpt5-experiments" });

    expect(screen.getByLabelText(MODEL_ID_LABEL)).toHaveValue("gpt-5.2-preview");
    expect(screen.queryByLabelText(MODEL_LABEL)).toBeNull();
    expect(readModelOptions).not.toHaveBeenCalled();
  });

  it("still offers the workspace's restrictions, because policy does not need a provider", async () => {
    readParamSchema.mockResolvedValue({
      ok: true,
      schema: paramSchemaResponse({
        connectionId: null,
        params: paramSection([], "Model parameters", "No provider is bound yet."),
        reason: "alias_unbound",
      }),
    });

    await card({ alias: "gpt5-experiments" });

    expect(readParamSchema).toHaveBeenCalledWith("gpt-5.2-preview", null);
    expect(screen.getByRole("switch", { name: "Batch ok" })).toBeInTheDocument();
    expect(screen.getByText("No provider is bound yet.")).toBeInTheDocument();
  });

  it("can be bound from the card, which is the whole point of the state", async () => {
    await card({ alias: "gpt5-experiments" });

    fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), { target: { value: ANTHROPIC } });
    await settle();
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => { expect(saveAlias).toHaveBeenCalled(); });

    expect(saveAlias.mock.calls[0]![1]).toMatchObject({ connectionId: ANTHROPIC });
  });

  it("reads the schema only once the reader leaves the typed box, not per keystroke", async () => {
    await card({ alias: "gpt5-experiments" });

    const asked = readParamSchema.mock.calls.length;
    const box = screen.getByLabelText(MODEL_ID_LABEL);

    fireEvent.change(box, { target: { value: "gpt-5.3" } });
    fireEvent.change(box, { target: { value: "gpt-5.3-p" } });
    await settle();

    expect(readParamSchema).toHaveBeenCalledTimes(asked);

    fireEvent.blur(box, { target: { value: "gpt-5.3-preview" } });
    await settle();

    expect(readParamSchema).toHaveBeenCalledWith("gpt-5.3-preview", null);
  });
});

describe("a connection discovery has not run on", () => {
  it("takes the model as text and says why, rather than refusing to go on", async () => {
    readModelOptions.mockResolvedValue({ ok: true, models: [] });

    await card();

    expect(screen.getByLabelText(MODEL_LABEL)).toHaveValue("claude-fable-5");
    expect(screen.getByText(MODEL_NOT_DISCOVERED)).toBeInTheDocument();
  });

  it("says the service's own sentence when the listing was refused", async () => {
    readModelOptions.mockResolvedValue({ ok: false, reason: "Models could not be listed." });

    await card();

    expect(screen.getByText("Models could not be listed.")).toBeInTheDocument();
  });

  it("says so when the schema could not be read, and still lets the alias be saved", async () => {
    readParamSchema.mockResolvedValue({ ok: false, reason: "Parameters could not be read." });

    await card();

    expect(screen.getAllByText("Parameters could not be read.").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(PROVIDER_LABEL), { target: { value: CURSOR } });
    await settle();
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => { expect(saveAlias).toHaveBeenCalled(); });
  });
});

describe("a reader who may not administer", () => {
  it("reads the whole card with every control inert and its reason attached", async () => {
    await card({ mayAdminister: false });

    expect(name()).toHaveValue("coder-max");
    expect(name()).toBeDisabled();
    expect(screen.getByLabelText(PROVIDER_LABEL)).toBeDisabled();
    expect(screen.getByLabelText(MODEL_LABEL)).toBeDisabled();
    expect(screen.getByLabelText("Thinking")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Batch ok" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    for (const label of [SAVE_LABEL, DUPLICATE_LABEL, REMOVE_LABEL]) {
      expect(control(label), label).toHaveAttribute("title", INSPECTOR_READ_ONLY);
    }
  });

  it("still shows what the alias is used by, because reading is what the role is for", async () => {
    await card({ mayAdminister: false });

    expect(
      within(screen.getByRole("list", { name: /reference this alias/i })).getAllByRole("listitem"),
    ).toHaveLength(4);
  });
});

describe("an unsaved edit and the selection", () => {
  it("is still there after the selection moves away and back", async () => {
    // The drafts are held by alias id, so nothing is discarded silently and nothing has to be
    // confirmed on the way out.
    const view = await card();

    fireEvent.change(name(), { target: { value: "coder-max-2" } });

    view.rerender(
      <AliasInspector
        aliasNames={NAMES}
        mayAdminister
        row={row("sizer")}
        sources={SOURCES}
      />,
    );
    await settle();

    expect(name()).toHaveValue("sizer");

    view.rerender(
      <AliasInspector
        aliasNames={NAMES}
        mayAdminister
        row={row("coder-max")}
        sources={SOURCES}
      />,
    );
    await settle();

    expect(name()).toHaveValue("coder-max-2");
  });

  it("is forgotten once it has been saved, because the row is then the truth", async () => {
    await card({ alias: "gpt5-experiments" });

    fireEvent.change(name(), { target: { value: "gpt5-lab" } });
    fireEvent.click(control(SAVE_LABEL));

    await waitFor(() => { expect(refresh).toHaveBeenCalled(); });

    expect(name()).toHaveValue("gpt5-experiments");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the card in the %s palette", async (palette) => {
    renderInPalette(
      palette,
      <AliasInspector aliasNames={NAMES} mayAdminister row={row("coder-max")} sources={SOURCES} />,
    );
    await settle();

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByText(removeWhy(4)!)).toBeInTheDocument();
  });

  it("draws the same markup in both, fields, chips and the blocked foot included", async () => {
    const [light, dark] = renderInBothPalettes(
      <AliasInspector aliasNames={NAMES} mayAdminister row={row("coder-max")} sources={SOURCES} />,
    );
    await settle();

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});

describe("the card's own reads", () => {
  it("asks about a connection once, however often the selection returns to it", async () => {
    const view = await card();

    expect(readModelOptions).toHaveBeenCalledTimes(1);

    view.rerender(
      <AliasInspector aliasNames={NAMES} mayAdminister row={row("coder-std")} sources={SOURCES} />,
    );
    await settle();
    view.rerender(
      <AliasInspector aliasNames={NAMES} mayAdminister row={row("coder-max")} sources={SOURCES} />,
    );
    await settle();

    // Both rows resolve through the same Anthropic connection, so there is one question here
    // and it has already been answered.
    expect(readModelOptions).toHaveBeenCalledTimes(1);
  });

  it("asks about each model once", async () => {
    await card();

    expect(readParamSchema).toHaveBeenCalledExactlyOnceWith("claude-fable-5", ANTHROPIC);

    fireEvent.change(screen.getByLabelText(MODEL_LABEL), { target: { value: "claude-opus-5" } });
    await settle();
    fireEvent.change(screen.getByLabelText(MODEL_LABEL), { target: { value: "claude-fable-5" } });
    await settle();

    expect(readParamSchema).toHaveBeenCalledTimes(2);
  });
});

describe("a connection the page could not read", () => {
  it("still names the alias's own binding, rather than reporting the page's failure as the alias's", async () => {
    await card({ sources: [] });

    const select = screen.getByLabelText(PROVIDER_LABEL);

    expect(select).toHaveValue(ANTHROPIC);
    expect(
      within(select).getByRole("option", { name: /Anthropic Claude — key/ }),
    ).toBeInTheDocument();
  });
});

/** Kept honest: the fixtures this suite leans on are the contract's own published examples. */
describe("the fixtures", () => {
  it("uses the published parameter fields rather than invented ones", () => {
    expect(paramField().name).toBe("thinking");
    expect(budgetField().name).toBe("token_budget");
  });
});

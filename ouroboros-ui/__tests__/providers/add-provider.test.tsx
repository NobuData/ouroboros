import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AddOutcome, CatalogReading } from "@/app/providers/add-actions";
import {
  ADDED_TITLE,
  ADD_DIALOG_TITLE,
  ADD_PROVIDER_READ_ONLY,
  BACK_TO_CATALOG,
  BROWSE_CATALOG_LABEL,
  CATALOG_EMPTY,
  CATALOG_LIST_LABEL,
  CATALOG_LOADING,
  CATALOG_UNAVAILABLE,
  COMING_SOON,
  CONNECT,
  CONNECTING,
  CONNECT_ANYWAY,
  DONE,
  type ExistingConnection,
  NAME_LABEL,
  NOTHING_STORED,
  addedNote,
  providerRefused,
} from "@/app/providers/catalog";
import { ADD_PROVIDER_LABEL } from "@/app/providers/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import {
  FAKE_REGIONS,
  FAKE_TITLE,
  SEEDED_VLLM_URL,
  anthropicEntry,
  fakeEntry,
  seededCatalog,
  seededConnections,
} from "../helpers/providers";

/**
 * The add-provider flow as it is drawn (#231): two openers, the catalog, the form, the done
 * step — and what each does with what the service answers.
 *
 * The acceptance criteria this suite exists for, in the ticket's words: **the fake adapter
 * appears unbidden, with a working form**; **the form renders every declared field type
 * without per-kind UI code, including one no MVP adapter uses**; **a bad key never creates a
 * card** — the form stays open with the adapter's error; **`coming soon` tiles are visibly
 * non-interactive and name their source**; **a duplicate kind + endpoint warns before
 * creating**; **a member session cannot reach the flow**; and both palettes.
 *
 * The Server Actions are mocked, not the API: what is under test is the dialog, and
 * `add-actions.test.ts` is that module's own suite. `catalog.test.ts` proves the judgements;
 * this proves what reaches the DOM.
 */

/** What the actions answer, per case. */
const readCatalog = vi.fn<() => Promise<CatalogReading>>();
const addProvider = vi.fn<(body: unknown) => Promise<AddOutcome>>();

/** What tells the server's own render that a provider was added. */
const refresh = vi.fn();

vi.mock("@/app/providers/add-actions", () => ({
  readCatalog: () => readCatalog(),
  addProvider: (body: unknown) => addProvider(body),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { AddProviderButton, AddProviderFlow, BrowseCatalogButton } = await import(
  "@/app/providers/add-provider"
);

/**
 * The catalog, as the action answers it: the five live kinds, over a workspace that has
 * connected nothing unless a case says otherwise — the duplicate suite is the one that does.
 *
 * @param entries The live kinds.
 * @param existing What the workspace already has.
 * @returns The reading.
 */
function seeded(
  entries = seededCatalog(),
  existing: readonly ExistingConnection[] = [],
): CatalogReading {
  return { ok: true, entries, existing };
}

/** The page's shape: the flow around both openers. */
function Flow({ mayAdminister = true }: Readonly<{ mayAdminister?: boolean }>) {
  return (
    <AddProviderFlow mayAdminister={mayAdminister}>
      <AddProviderButton />
      <BrowseCatalogButton />
    </AddProviderFlow>
  );
}

/**
 * Open the dialog from the head's action and wait for the catalog to arrive.
 *
 * @param opener Which opener to press. Defaults to the head's.
 * @returns The dialog.
 */
async function openCatalog(opener: string = ADD_PROVIDER_LABEL): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: opener }));

  const dialog = await screen.findByRole("dialog", { name: ADD_DIALOG_TITLE });

  await waitFor(() => {
    expect(within(dialog).queryByText(CATALOG_LOADING)).not.toBeInTheDocument();
  });

  return dialog;
}

/**
 * Open the dialog and step into one kind's form.
 *
 * @param label The tile's label.
 * @returns The dialog, on its form step.
 */
async function openForm(label: string): Promise<HTMLElement> {
  const dialog = await openCatalog();

  fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${label}`) }));
  await within(dialog).findByLabelText(NAME_LABEL);

  return dialog;
}

/**
 * Type into one of the form's fields.
 *
 * @param dialog The dialog.
 * @param label The field's label.
 * @param value What to type.
 */
function type(dialog: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
}

/**
 * Press the submit control and wait for the provider to have answered.
 *
 * @param dialog The dialog.
 * @param label The control's label. Defaults to **Connect**.
 */
async function connect(dialog: HTMLElement, label: string = CONNECT): Promise<void> {
  fireEvent.click(within(dialog).getByRole("button", { name: label }));

  await waitFor(() => {
    expect(within(dialog).queryByText(CONNECTING)).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  readCatalog.mockReset().mockResolvedValue(seeded());
  addProvider.mockReset().mockResolvedValue({
    ok: true,
    connection: { id: "5eed000c-0000-4000-8000-000000000009", displayName: "Anthropic" },
  });
  refresh.mockReset();
});

describe("the two openers", () => {
  it("open nothing until pressed, and read nothing", () => {
    render(<Flow />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(readCatalog).not.toHaveBeenCalled();
  });

  it("open the same dialog from the head's action and from the dashed card", async () => {
    render(<Flow />);

    await openCatalog(ADD_PROVIDER_LABEL);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const dialog = await openCatalog(BROWSE_CATALOG_LABEL);

    expect(dialog).toHaveAccessibleName(ADD_DIALOG_TITLE);
    expect(readCatalog).toHaveBeenCalledTimes(2);
  });

  it("read the catalog in the press that opens the dialog, and say so until it arrives", async () => {
    render(<Flow />);

    fireEvent.click(screen.getByRole("button", { name: ADD_PROVIDER_LABEL }));

    const dialog = screen.getByRole("dialog", { name: ADD_DIALOG_TITLE });

    expect(readCatalog).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole("status")).toHaveTextContent(CATALOG_LOADING);

    await within(dialog).findByRole("list", { name: CATALOG_LIST_LABEL });
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
  });

  it("give focus back to whichever opener was pressed", async () => {
    render(<Flow />);

    const browse = screen.getByRole("button", { name: BROWSE_CATALOG_LABEL });
    browse.focus();

    await openCatalog(BROWSE_CATALOG_LABEL);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(browse).toHaveFocus();
  });
});

describe("a member session", () => {
  it("cannot reach the flow: both openers are inert, with the reason, and the dialog never opens", () => {
    // `aria-disabled` rather than `disabled`, deliberately: the control stays in the tab
    // order with its explanation. The gate that enforces is the service's.
    render(<Flow mayAdminister={false} />);

    for (const name of [ADD_PROVIDER_LABEL, BROWSE_CATALOG_LABEL]) {
      const opener = screen.getByRole("button", { name });

      expect(opener).toHaveAttribute("aria-disabled", "true");
      expect(opener).toHaveAttribute("title", ADD_PROVIDER_READ_ONLY);

      fireEvent.click(opener);
    }

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(readCatalog).not.toHaveBeenCalled();
  });
});

describe("the catalog", () => {
  it("draws a tile per live kind, in the service's order, and says what each will ask for", async () => {
    render(<Flow />);

    const dialog = await openCatalog();
    const tiles = within(dialog).getAllByRole("button", { name: /API key|Base URL|Host|token/ });

    expect(tiles.map((tile) => tile.textContent)).toEqual([
      "ANAnthropicAPI key",
      "OPOpenAI-compatibleBase URL · API key (optional)",
      "OLOllamaHost",
      "GIGitHub CopilotGitHub token",
      "CUCursorAPI key",
    ]);
  });

  it("draws the fake adapter unbidden, with a working form behind it", async () => {
    // The ticket's proof: a kind no file in this module names, arriving in the payload, gets
    // a tile and — pressed — the form its schema declares, select included.
    readCatalog.mockResolvedValue(seeded([...seededCatalog(), fakeEntry()]));
    render(<Flow />);

    const dialog = await openCatalog();
    const tile = within(dialog).getByRole("button", { name: /^custom/ });

    expect(tile).toHaveTextContent("Base URL · Region · API key (optional)");

    fireEvent.click(tile);

    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(FAKE_TITLE);
    expect(within(dialog).getByLabelText("Base URL")).toHaveAttribute("type", "url");
    expect(within(dialog).getByLabelText("Region").tagName).toBe("SELECT");
    expect(within(dialog).getByLabelText("API key")).toHaveAttribute("type", "password");
  });

  it("draws the coming soon tiles as plain items naming their source, never as controls", async () => {
    render(<Flow />);

    const dialog = await openCatalog();
    const list = within(dialog).getByRole("list", { name: CATALOG_LIST_LABEL });

    for (const announcement of COMING_SOON) {
      const item = within(list).getByText(announcement.label).closest("li") as HTMLElement;

      expect(item).toHaveClass("providers-catalog__tile--soon");
      expect(item).toHaveTextContent("coming soon");
      expect(item).toHaveTextContent(`Arrives with ${announcement.source}`);
      expect(within(item).queryByRole("button")).toBeNull();
      expect(item.querySelector("[tabindex]")).toBeNull();
    }

    expect(within(list).getAllByRole("listitem")).toHaveLength(
      seededCatalog().length + COMING_SOON.length,
    );
  });

  it("lights a promised tile the day its kind is in the catalog, with no change here", async () => {
    const openai = { ...anthropicEntry(), kind: "openai" as never, title: "Connect OpenAI" };
    readCatalog.mockResolvedValue(seeded([...seededCatalog(), openai]));
    render(<Flow />);

    const dialog = await openCatalog();

    expect(within(dialog).getByRole("button", { name: /^openai/ })).toBeInTheDocument();
    expect(within(dialog).queryByText("OpenAI", { exact: true })).toBeNull();
    expect(within(dialog).getByText("Google Gemini")).toBeInTheDocument();
  });

  it("says when the catalog could not be read, and when there is nothing in it", async () => {
    readCatalog.mockResolvedValue({ ok: false, reason: CATALOG_UNAVAILABLE });
    const { unmount } = render(<Flow />);

    let dialog = await openCatalog();
    expect(within(dialog).getByRole("status")).toHaveTextContent(CATALOG_UNAVAILABLE);
    unmount();

    readCatalog.mockResolvedValue({ ok: true, entries: [], existing: [] });
    render(<Flow />);

    dialog = await openCatalog();
    expect(within(dialog).getByRole("status")).toHaveTextContent(CATALOG_EMPTY);
  });
});

describe("the form", () => {
  it("is the adapter's own: the entry's title, a name, and its fields in order", async () => {
    render(<Flow />);

    const dialog = await openForm("OpenAI-compatible");

    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Connect an OpenAI-compatible endpoint",
    );
    expect(within(dialog).getByLabelText(NAME_LABEL)).toHaveValue("OpenAI-compatible");

    const controls = [...dialog.querySelectorAll("input, select")].map((control) =>
      control.getAttribute("name"),
    );
    expect(controls).toEqual(["displayName", "baseUrl", "apiKey"]);

    expect(within(dialog).getByLabelText("Base URL")).toBeRequired();
    expect(within(dialog).getByLabelText("Base URL")).toHaveAccessibleDescription(
      /The OpenAI-compatible root/,
    );
    expect(within(dialog).getByLabelText("API key")).not.toBeRequired();
    expect(within(dialog).getByLabelText("API key")).toHaveAttribute(
      "placeholder",
      "API key — optional, no auth configured",
    );
  });

  it("masks the key row, and offers it to no password manager", async () => {
    render(<Flow />);

    const dialog = await openForm("Anthropic");
    const key = within(dialog).getByLabelText("API key");

    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveAttribute("autocomplete", "off");
    expect(key).toHaveClass("ou-input--mono");
  });

  it("renders a select for the one widget no MVP adapter declares, with its choices", async () => {
    readCatalog.mockResolvedValue(seeded([fakeEntry()]));
    render(<Flow />);

    const dialog = await openForm("custom");
    const region = within(dialog).getByLabelText("Region");

    expect([...region.querySelectorAll("option")].map((option) => option.value)).toEqual([
      ...FAKE_REGIONS,
    ]);
    expect(region).toHaveValue(FAKE_REGIONS[0]);
  });

  it("sends the kind, the name, and the settings keyed by field — an untouched optional left out", async () => {
    render(<Flow />);

    const dialog = await openForm("OpenAI-compatible");
    type(dialog, NAME_LABEL, "vLLM · lab cluster ");
    type(dialog, "Base URL", " http://10.0.4.21:8000/v1 ");

    await connect(dialog);

    expect(addProvider).toHaveBeenCalledOnce();
    expect(addProvider.mock.calls[0][0]).toEqual({
      kind: "openai_compatible",
      displayName: "vLLM · lab cluster",
      config: { baseUrl: "http://10.0.4.21:8000/v1" },
    });
  });

  it("sends the credential in the settings for the service to route to the vault", async () => {
    render(<Flow />);

    const dialog = await openForm("Anthropic");
    type(dialog, "API key", "sk-ant-api03-not-a-real-key-Xq4A");

    await connect(dialog);

    expect(addProvider.mock.calls[0][0]).toEqual({
      kind: "anthropic",
      displayName: "Anthropic",
      config: { apiKey: "sk-ant-api03-not-a-real-key-Xq4A" },
    });
  });

  it("says it is asking the provider, and makes the control inert until it has answered", async () => {
    let answer: (outcome: AddOutcome) => void = () => {};
    addProvider.mockReturnValue(
      new Promise<AddOutcome>((resolve) => {
        answer = resolve;
      }),
    );
    render(<Flow />);

    const dialog = await openForm("Anthropic");
    type(dialog, "API key", "sk-ant-api03-Xq4A");
    fireEvent.click(within(dialog).getByRole("button", { name: CONNECT }));

    expect(await within(dialog).findByRole("status")).toHaveTextContent(CONNECTING);
    expect(within(dialog).getByRole("button", { name: CONNECT })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    answer({ ok: true, connection: { id: "x", displayName: "Anthropic" } });
    await within(dialog).findByRole("heading", { name: ADDED_TITLE });
  });

  it("steps back to the catalog without sending anything", async () => {
    render(<Flow />);

    const dialog = await openForm("Cursor");
    fireEvent.click(within(dialog).getByRole("button", { name: BACK_TO_CATALOG }));

    expect(within(dialog).getByRole("list", { name: CATALOG_LIST_LABEL })).toBeInTheDocument();
    expect(addProvider).not.toHaveBeenCalled();
  });
});

describe("a bad key never creates a card", () => {
  it("keeps the form open with the adapter's designed error under the key, and refreshes nothing", async () => {
    addProvider.mockResolvedValue({
      ok: false,
      refusal: {
        code: "provider_validation_failed",
        message: "The provider refused the configuration or credential.",
        details: { errorClass: "auth", detail: "key rejected (401)" },
      },
    });
    render(<Flow />);

    const dialog = await openForm("Anthropic");
    type(dialog, "API key", "sk-ant-api03-wrong");

    await connect(dialog);

    // Still the form — not the done step, not closed.
    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Connect Anthropic",
    );
    expect(within(dialog).getByLabelText("API key")).toHaveValue("sk-ant-api03-wrong");

    // The adapter's own phrase, inline where the key was typed, and the fact that matters.
    const key = within(dialog).getByLabelText("API key");
    expect(key).toHaveAttribute("aria-invalid", "true");
    expect(key).toHaveAccessibleDescription(/key rejected \(401\)/);
    expect(within(dialog).getByText(providerRefused("key rejected (401)"))).toBeInTheDocument();
    expect(dialog.textContent).toContain(NOTHING_STORED);

    expect(refresh).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole("heading", { name: ADDED_TITLE })).toBeNull();
  });

  it("draws a schema violation under the field it names", async () => {
    addProvider.mockResolvedValue({
      ok: false,
      refusal: {
        code: "provider_config_invalid",
        message: "",
        details: { fields: { baseUrl: ["must match format \"uri\""] } },
      },
    });
    render(<Flow />);

    const dialog = await openForm("Ollama");
    type(dialog, "Host", "http://ken-station.local:11434");

    await connect(dialog);

    expect(within(dialog).getByLabelText("Host")).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByLabelText("Host")).toHaveAccessibleDescription(
      /must match format "uri"/,
    );
    expect(within(dialog).getByLabelText(NAME_LABEL)).not.toHaveAttribute("aria-invalid");
  });

  it("draws a refused name under the name", async () => {
    addProvider.mockResolvedValue({
      ok: false,
      refusal: {
        code: "validation_failed",
        message: "",
        details: { displayName: ["displayName must be trimmed"] },
      },
    });
    render(<Flow />);

    const dialog = await openForm("Cursor");
    type(dialog, "API key", "key_x");

    await connect(dialog);

    expect(within(dialog).getByLabelText(NAME_LABEL)).toHaveAccessibleDescription(
      /must be trimmed/,
    );
  });

  it("tells a member who reached the action anyway who may connect a provider", async () => {
    addProvider.mockResolvedValue({
      ok: false,
      refusal: { code: "forbidden", message: "Your role does not permit this.", details: {} },
    });
    render(<Flow />);

    const dialog = await openForm("Cursor");
    type(dialog, "API key", "key_x");

    await connect(dialog);

    expect(within(dialog).getByText(ADD_PROVIDER_READ_ONLY)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears the last refusal when the form is sent again", async () => {
    addProvider.mockResolvedValueOnce({
      ok: false,
      refusal: {
        code: "provider_validation_failed",
        message: "",
        details: { errorClass: "auth", detail: "key rejected (401)" },
      },
    });
    render(<Flow />);

    const dialog = await openForm("Anthropic");
    type(dialog, "API key", "sk-wrong");
    await connect(dialog);
    expect(within(dialog).getByLabelText("API key")).toHaveAttribute("aria-invalid", "true");

    type(dialog, "API key", "sk-right");
    await connect(dialog);

    await within(dialog).findByRole("heading", { name: ADDED_TITLE });
    expect(within(dialog).queryByText(/key rejected/)).toBeNull();
  });
});

describe("a duplicate kind and endpoint", () => {
  beforeEach(() => {
    // The seeded workspace: Anthropic at its fixed endpoint, Ollama and vLLM at addresses.
    readCatalog.mockResolvedValue(seeded(seededCatalog(), seededConnections()));
  });

  it("warns before creating, relabels the control, and proceeds on the second press", async () => {
    render(<Flow />);

    const dialog = await openForm("OpenAI-compatible");
    type(dialog, "Base URL", `${SEEDED_VLLM_URL}/`);
    fireEvent.click(within(dialog).getByRole("button", { name: CONNECT }));

    expect(addProvider).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /"vLLM · lab cluster" is already connected at http:\/\/10\.0\.4\.20:8000\/v1\./,
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/allowed/);

    await connect(dialog, CONNECT_ANYWAY);

    expect(addProvider).toHaveBeenCalledOnce();
  });

  it("warns for a second connection of a kind with a fixed endpoint", async () => {
    render(<Flow />);

    const dialog = await openForm("Anthropic");
    type(dialog, "API key", "sk-ant-api03-Xq4A");
    fireEvent.click(within(dialog).getByRole("button", { name: CONNECT }));

    expect(addProvider).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /"Anthropic Claude" is already connected as Anthropic\./,
    );
  });

  it("judges a changed address afresh rather than waving it through", async () => {
    render(<Flow />);

    const dialog = await openForm("Ollama");
    type(dialog, "Host", "http://ken-station.local:11434");
    fireEvent.click(within(dialog).getByRole("button", { name: CONNECT }));
    expect(within(dialog).getByRole("button", { name: CONNECT_ANYWAY })).toBeInTheDocument();

    // A different host is not the duplicate that was warned about — and it is not a duplicate
    // at all, so the ordinary control comes back and the press proceeds.
    type(dialog, "Host", "http://other-station.local:11434");
    await connect(dialog, CONNECT_ANYWAY);

    expect(addProvider).toHaveBeenCalledOnce();
    expect(addProvider.mock.calls[0][0]).toMatchObject({
      config: { baseUrl: "http://other-station.local:11434" },
    });
  });

  it("does not warn for a new endpoint", async () => {
    render(<Flow />);

    const dialog = await openForm("Ollama");
    type(dialog, "Host", "http://other-station.local:11434");

    await connect(dialog);

    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(addProvider).toHaveBeenCalledOnce();
  });
});

describe("success", () => {
  it("shows the done step naming the connection, and refreshes the route on Done", async () => {
    addProvider.mockResolvedValue({
      ok: true,
      connection: { id: "x", displayName: "Ollama · other station" },
    });
    render(<Flow />);

    const dialog = await openForm("Ollama");
    type(dialog, "Host", "http://other-station.local:11434");
    await connect(dialog);

    expect(within(dialog).getByRole("heading", { name: ADDED_TITLE })).toBeInTheDocument();
    expect(within(dialog).getByText(addedNote("Ollama · other station"))).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: DONE }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refreshes the route however the done step is closed", async () => {
    render(<Flow />);

    const dialog = await openForm("Cursor");
    type(dialog, "API key", "key_x");
    await connect(dialog);
    await within(dialog).findByRole("heading", { name: ADDED_TITLE });

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("starts from the catalog again on the next open", async () => {
    render(<Flow />);

    const dialog = await openForm("Cursor");
    type(dialog, "API key", "key_x");
    await connect(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: DONE }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const reopened = await openCatalog();

    expect(within(reopened).getByRole("list", { name: CATALOG_LIST_LABEL })).toBeInTheDocument();
    expect(readCatalog).toHaveBeenCalledTimes(2);
  });
});

describe("both palettes", () => {
  it("render the openers identically under each", () => {
    const [light, dark] = renderInBothPalettes(<Flow />);

    expect(light).toBe(dark);
  });

  it.each(PALETTES)("render the catalog and the form in the %s palette", async (palette) => {
    const { unmount } = renderInPalette(palette, <Flow />);

    const dialog = await openForm("OpenAI-compatible");

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(within(dialog).getByLabelText("Base URL")).toBeInTheDocument();
    unmount();
  });

  it("render the catalog identically under each", async () => {
    const markup: string[] = [];

    for (const palette of PALETTES) {
      const { unmount } = renderInPalette(palette, <Flow />);
      const dialog = await openCatalog();

      markup.push(dialog.outerHTML);
      unmount();
    }

    expect(markup[0]).toBe(markup[1]);
  });
});

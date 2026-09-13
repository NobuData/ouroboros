import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COMING_SOON_LABEL } from "@/app/catalog-tiles";
import type { AddOutcome, CatalogReading } from "@/app/sources/actions";
import {
  ADD,
  ADDED_TITLE,
  ADDING,
  ADD_DIALOG_TITLE,
  ADD_READ_ONLY,
  BACK_TO_CATALOG,
  CATALOG_EMPTY,
  CATALOG_LIST_LABEL,
  CATALOG_LOADING,
  CATALOG_UNAVAILABLE,
  CONFIG_INVALID,
  DONE,
  NAME_LABEL,
  NAME_TAKEN,
  NOTHING_STORED,
  V2_LABEL,
  addedNote,
  arrivesNote,
} from "@/app/sources/catalog";
import { ADD_SOURCE_LABEL } from "@/app/sources/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { FAKE_TITLE, fakeEntry, githubEntry, seededCatalog } from "../helpers/sources";

/**
 * The add-source flow as it is drawn ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * The acceptance criteria this suite holds, in the ticket's words: **the provider form
 * renders from the provider-declared config schema — verified by pointing the same form
 * component at the in-memory fake provider's schema**; **"coming soon" tiles are visibly
 * non-functional and labelled as v2**; **a member sees the surface read-only**; a refusal
 * keeps the form open with nothing stored; and both palettes.
 */

const readSourceCatalog = vi.fn<() => Promise<CatalogReading>>();
const addSource = vi.fn<(body: unknown) => Promise<AddOutcome>>();
const refresh = vi.fn();

vi.mock("@/app/sources/actions", () => ({
  readSourceCatalog: () => readSourceCatalog(),
  addSource: (body: unknown) => addSource(body),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { AddSourceButton, AddSourceFlow } = await import("@/app/sources/add-source");

function Flow({ mayAdminister = true }: Readonly<{ mayAdminister?: boolean }>) {
  return (
    <AddSourceFlow mayAdminister={mayAdminister}>
      <AddSourceButton />
    </AddSourceFlow>
  );
}

async function openCatalog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: ADD_SOURCE_LABEL }));

  const dialog = await screen.findByRole("dialog", { name: ADD_DIALOG_TITLE });

  await waitFor(() => {
    expect(within(dialog).queryByText(CATALOG_LOADING)).not.toBeInTheDocument();
  });

  return dialog;
}

async function openForm(label: string): Promise<HTMLElement> {
  const dialog = await openCatalog();

  fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${label}`) }));
  await within(dialog).findByLabelText(NAME_LABEL);

  return dialog;
}

function type(dialog: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
}

/**
 * Fill the GitHub form's three required fields.
 *
 * jsdom implements constraint validation on a submit press, so a form with an empty
 * required field never submits — which is the browser's own rule and the reason a case
 * about the *service's* refusal has to get past the browser's first.
 *
 * @param dialog The dialog, on its form step.
 */
function fillGithub(dialog: HTMLElement): void {
  type(dialog, "GitHub account", "acme-robotics");
  type(dialog, "Repositories", "helios-firmware");
  type(dialog, "Personal access token", "ghp_secret");
}

beforeEach(() => {
  readSourceCatalog.mockReset().mockResolvedValue({ ok: true, entries: seededCatalog() });
  addSource.mockReset().mockResolvedValue({
    ok: true,
    source: { id: "5eed001a-0000-4000-8000-000000000001", displayName: "GitHub · acme-robotics" },
  });
  refresh.mockReset();
});

describe("the opener", () => {
  it("opens the dialog on the catalog, reading it in the press", async () => {
    render(<Flow />);

    const dialog = await openCatalog();

    expect(readSourceCatalog).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole("list", { name: CATALOG_LIST_LABEL })).toBeInTheDocument();
  });

  it("is inert for a member, with the reason, and the flow never opens", () => {
    render(<Flow mayAdminister={false} />);

    const opener = screen.getByRole("button", { name: ADD_SOURCE_LABEL });

    expect(opener).toHaveAttribute("aria-disabled", "true");
    expect(opener).toHaveAttribute("title", ADD_READ_ONLY);

    fireEvent.click(opener);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(readSourceCatalog).not.toHaveBeenCalled();
  });
});

describe("the catalog", () => {
  it("draws GitHub as a live tile and the three promised trackers as coming-soon, v2, non-interactive items", async () => {
    render(<Flow />);

    const dialog = await openCatalog();
    const tiles = within(dialog).getByRole("list", { name: CATALOG_LIST_LABEL });

    expect(within(tiles).getByRole("button", { name: /^GitHub/ })).toBeInTheDocument();
    expect(within(tiles).getAllByRole("button")).toHaveLength(1);

    for (const [label, source] of [
      ["Jira", "T.2 (#156)"],
      ["Linear", "T.3 (#157)"],
      ["GitLab", "T.4 (#158)"],
    ] as const) {
      const item = within(tiles)
        .getByText(label, { selector: ".sources-catalog__label" })
        .closest("li") as HTMLElement;

      expect(item).toHaveClass("sources-catalog__tile--soon");
      expect(item).toHaveTextContent(COMING_SOON_LABEL);
      expect(item).toHaveTextContent(V2_LABEL);
      expect(item).toHaveTextContent(arrivesNote(source));
      expect(within(item).queryByRole("button")).toBeNull();
    }
  });

  it("says what the GitHub form will ask for, so a reader has it ready", async () => {
    render(<Flow />);

    const dialog = await openCatalog();

    expect(within(dialog).getByRole("button", { name: /^GitHub/ })).toHaveTextContent(
      "GitHub account · Repositories · Personal access token",
    );
  });

  it("says so when the catalog could not be read, and when it is empty", async () => {
    readSourceCatalog.mockResolvedValue({ ok: false, reason: CATALOG_UNAVAILABLE });
    const { unmount } = render(<Flow />);

    expect(await openCatalog()).toHaveTextContent(CATALOG_UNAVAILABLE);
    unmount();

    readSourceCatalog.mockResolvedValue({ ok: true, entries: [] });
    render(<Flow />);

    // With no live entry and the three announcements standing, the list is the announcements.
    const dialog = await openCatalog();

    expect(within(dialog).queryByText(CATALOG_EMPTY)).toBeNull();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("the form", () => {
  it("renders every widget of the fake provider's schema with no per-kind code", async () => {
    // The acceptance criterion, as a test: a kind no UI file names, with a form that includes
    // the list, the select, the url, the text and the secret.
    readSourceCatalog.mockResolvedValue({ ok: true, entries: [fakeEntry()] });
    render(<Flow />);

    const dialog = await openForm("Custom");

    expect(within(dialog).getByRole("heading", { name: FAKE_TITLE })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Site")).toHaveAttribute("type", "url");
    expect(within(dialog).getByLabelText("Project key")).toHaveAttribute("type", "text");
    expect(within(dialog).getByLabelText("Region").tagName).toBe("SELECT");
    expect(within(dialog).getByLabelText("Boards").tagName).toBe("TEXTAREA");
    expect(within(dialog).getByLabelText("API token")).toHaveAttribute("type", "password");
  });

  it("starts the name at the kind's label and sends what was typed, the list split per line", async () => {
    render(<Flow />);

    const dialog = await openForm("GitHub");

    expect(within(dialog).getByLabelText(NAME_LABEL)).toHaveValue("GitHub");

    type(dialog, NAME_LABEL, "GitHub · acme-robotics");
    type(dialog, "GitHub account", "acme-robotics");
    type(dialog, "Repositories", "helios-firmware\nhelios-console");
    type(dialog, "Personal access token", "ghp_secret");
    fireEvent.click(within(dialog).getByRole("button", { name: ADD }));

    await waitFor(() => {
      expect(addSource).toHaveBeenCalledWith({
        kind: "github",
        displayName: "GitHub · acme-robotics",
        config: {
          login: "acme-robotics",
          repos: ["helios-firmware", "helios-console"],
          token: "ghp_secret",
        },
      });
    });
  });

  it("keeps the form open on a refusal, with the sentence under the field and nothing stored", async () => {
    addSource.mockResolvedValue({
      ok: false,
      refusal: {
        code: "ticket_source_config_invalid",
        message: "refused",
        details: { fields: { repos: ["Repositories needs at least 1 entry"] } },
      },
    });
    render(<Flow />);

    const dialog = await openForm("GitHub");

    fillGithub(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: ADD }));

    // Two alerts: the field's own line, and the sentence under the form.
    const alerts = await within(dialog).findAllByRole("alert");

    expect(alerts.map((alert) => alert.textContent)).toContain(CONFIG_INVALID);
    expect(within(dialog).getByLabelText("Repositories")).toHaveAccessibleDescription(
      /needs at least 1 entry/,
    );
    expect(within(dialog).getByLabelText("GitHub account")).toHaveValue("acme-robotics");
    expect(screen.getByText(CONFIG_INVALID)).toHaveTextContent(NOTHING_STORED);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("puts a taken name under the name", async () => {
    addSource.mockResolvedValue({
      ok: false,
      refusal: { code: "ticket_source_name_taken", message: "taken", details: {} },
    });
    render(<Flow />);

    const dialog = await openForm("GitHub");

    fillGithub(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: ADD }));

    await within(dialog).findAllByRole("alert");
    expect(within(dialog).getByLabelText(NAME_LABEL)).toHaveAccessibleDescription(
      new RegExp(NAME_TAKEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("says it is storing while the submission is in flight", async () => {
    let done: (outcome: AddOutcome) => void = () => {};
    addSource.mockReturnValue(
      new Promise<AddOutcome>((resolve) => {
        done = resolve;
      }),
    );
    render(<Flow />);

    const dialog = await openForm("GitHub");

    fillGithub(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: ADD }));

    expect(await within(dialog).findByText(ADDING)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: ADD })).toHaveAttribute("aria-disabled", "true");

    done({ ok: true, source: { id: "x", displayName: "GitHub" } });
    await within(dialog).findByText(ADDED_TITLE);
  });

  it("goes back to the catalog, and closes without writing", async () => {
    render(<Flow />);

    const dialog = await openForm("GitHub");

    fireEvent.click(within(dialog).getByRole("button", { name: BACK_TO_CATALOG }));
    expect(within(dialog).getByRole("list", { name: CATALOG_LIST_LABEL })).toBeInTheDocument();
    expect(addSource).not.toHaveBeenCalled();
  });
});

describe("the done step", () => {
  it("names the source, says what to do next, and refreshes the route on Done", async () => {
    render(<Flow />);

    const dialog = await openForm("GitHub");

    fillGithub(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: ADD }));

    expect(await within(dialog).findByText(ADDED_TITLE)).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent(addedNote("GitHub · acme-robotics"));

    fireEvent.click(within(dialog).getByRole("button", { name: DONE }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("both palettes", () => {
  it("draws the catalog the same in both", async () => {
    // The dialog is a portal, so it is the dialog itself that is compared — and the previous
    // palette's tree is cleaned up between the two rather than merely unmounted, or the
    // second body carries the first's empty container.
    const markup: string[] = [];

    for (const palette of PALETTES) {
      renderInPalette(palette, <Flow />);

      const dialog = await openCatalog();

      markup.push(dialog.outerHTML.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:/g, "id"));
      cleanup();
    }

    expect(markup[0]).toBe(markup[1]);
  });

  it("draws the opener the same in both", () => {
    const [light, dark] = renderInBothPalettes(<Flow />);

    expect(light).toBe(dark);
  });
});

/** So the fixture's entry stays the service's own shape. */
it("keeps the GitHub fixture's fields in the order the service derives them", () => {
  expect(githubEntry().fields.map((field) => field.widget)).toEqual(["text", "list", "secret"]);
});

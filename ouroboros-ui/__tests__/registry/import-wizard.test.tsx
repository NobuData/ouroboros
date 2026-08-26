import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CandidatesReading, ImportOutcome } from "@/app/registry/import-actions";
import type { ImportSource } from "@/app/registry/view";
import {
  CANDIDATES_LOADING,
  EMPTY_LINK,
  EMPTY_TITLE,
  FIX_ROWS,
  IMPORTED_TITLE,
  IMPORT_CANCEL,
  IMPORT_DONE,
  IMPORT_INVALID,
  IMPORT_READ_ONLY,
  IMPORT_STEPS,
  IMPORT_SUBMIT,
  NOTHING_CHOSEN,
  PREVIEW_LABEL,
  REVIEW_BACK,
  REVIEW_NEXT,
  SELECT_ALL_LABEL,
  SKIPPED_LABEL,
  STEPS_LABEL,
  aliasedMark,
  importSummary,
  rowError,
  rowNameLabel,
  rowSelectLabel,
  wizardTitle,
} from "@/app/registry/wizard";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { candidateList, importCandidate, importResult, seededRegistry } from "../helpers/registry";
import { settle } from "../helpers/settle";

/**
 * The import wizard as it is drawn (#594), over CH.4's annotated candidates (#587).
 *
 * The acceptance criteria this suite exists for, in the ticket's words: **importing two models
 * from the seeded Anthropic connection creates both with their suggested (or edited) names**;
 * **a name collision shows an inline error on that row and creates nothing**; **already-aliased
 * models are marked and pre-deselected, and `select all` skips them**; **a connection with no
 * discovered models shows the honest empty state**; and **the candidate table scrolls in its own
 * wrapper**.
 *
 * The Server Actions are mocked, not the API: what is under test is the wizard, and
 * `import-actions.test.ts` is that module's own suite. `wizard.test.ts` proves the judgements;
 * this proves what reaches the DOM and what leaves it in a request.
 */

/** What the actions answer, per case. */
const readCandidates = vi.fn<(id: string) => Promise<CandidatesReading>>();
const importAliases = vi.fn<(body: unknown) => Promise<ImportOutcome>>();

/** What re-reads the table behind the wizard. */
const refresh = vi.fn();

vi.mock("@/app/registry/import-actions", () => ({
  readCandidates: (id: string) => readCandidates(id),
  importAliases: (body: unknown) => importAliases(body),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { ImportWizard } = await import("@/app/registry/import-wizard");

/** The seeded Anthropic connection, as the menu row hands it over. */
const ANTHROPIC: ImportSource = {
  id: "5eed000c-0000-4000-8000-000000000001",
  name: "Anthropic Claude",
  mask: "••••Xq4A",
};

/** Every alias name the seeded workspace has. */
const TAKEN = seededRegistry().map((alias) => alias.alias);

beforeEach(() => {
  readCandidates.mockReset().mockResolvedValue({
    ok: true,
    candidates: candidateList().candidates,
    empty: null,
  });
  importAliases.mockReset().mockResolvedValue({ ok: true, result: importResult() });
  refresh.mockReset();
});

/**
 * Open the wizard and wait for its candidates.
 *
 * @returns Nothing; the candidate table is on the screen.
 */
async function open(): Promise<void> {
  render(<ImportWizard aliasNames={TAKEN} onClose={vi.fn()} source={ANTHROPIC} />);
  await settle();
}

/**
 * One row's name box.
 *
 * @param modelId Which row.
 * @returns The input.
 */
function nameBox(modelId: string): HTMLElement {
  return screen.getByLabelText(rowNameLabel(modelId));
}

/**
 * One row's tick.
 *
 * @param modelId Which row.
 * @returns The checkbox.
 */
function tick(modelId: string): HTMLElement {
  return screen.getByLabelText(rowSelectLabel(modelId));
}

describe("opening the wizard", () => {
  it("is scoped to the connection the menu row named, in the heading", () => {
    // The connection was chosen in the menu, and it is the one thing about the wizard that
    // cannot be changed from inside it — so it is named rather than re-asked.
    render(<ImportWizard aliasNames={TAKEN} onClose={vi.fn()} source={ANTHROPIC} />);

    expect(screen.getByRole("dialog")).toHaveAccessibleName(wizardTitle("Anthropic Claude"));
  });

  it("reads that connection's candidates, and says so while it waits", () => {
    render(<ImportWizard aliasNames={TAKEN} onClose={vi.fn()} source={ANTHROPIC} />);

    expect(readCandidates).toHaveBeenCalledExactlyOnceWith(ANTHROPIC.id);
    expect(screen.getByRole("status")).toHaveTextContent(CANDIDATES_LOADING);
  });

  it("walks three steps, with the connection already behind the reader", async () => {
    await open();

    const steps = within(screen.getByRole("list", { name: STEPS_LABEL })).getAllByRole("listitem");

    expect(steps.map((step) => step.textContent)).toEqual([...IMPORT_STEPS]);
    expect(steps[0]).toHaveClass("registry-wizard__step--done");
    expect(steps[1]).toHaveAttribute("aria-current", "step");
  });

  it("scrolls its table inside the primitive's own wrapper, never the pane", async () => {
    // The pane refuses horizontal scroll (design system § 1.3); a table that took it anyway
    // would take the whole page with it.
    await open();

    expect(document.querySelector(".ou-table-scroll")).toBeInTheDocument();
  });
});

describe("the candidate rows", () => {
  it("draws the service's cells — the model, the name, the price and the capabilities", async () => {
    await open();

    expect(nameBox("claude-opus-5")).toHaveValue("opus-5");
    expect(screen.getByText("$10 · $50")).toBeInTheDocument();
    expect(screen.getAllByText("thinking · 1.0M ctx · 64.0k out")).toHaveLength(2);
  });

  it("marks a model something already names, and cannot be ticked", async () => {
    // The one thing an operator did not ask for when they opened a wizard is to re-create what
    // is already named; the service would skip it anyway, reported rather than silently.
    await open();

    expect(screen.getByText(aliasedMark("coder-max"))).toBeInTheDocument();
    expect(tick("claude-fable-5")).not.toBeChecked();
    expect(tick("claude-fable-5")).toBeDisabled();
    expect(tick("claude-opus-5")).toBeChecked();
  });

  it("select-all skips the already-named row", async () => {
    // The ticket's criterion, verbatim.
    await open();

    fireEvent.click(screen.getByLabelText(SELECT_ALL_LABEL));
    fireEvent.click(screen.getByLabelText(SELECT_ALL_LABEL));

    expect(tick("claude-fable-5")).not.toBeChecked();
    expect(tick("claude-opus-5")).toBeChecked();
  });

  it("select-none clears the rows it can clear", async () => {
    await open();

    fireEvent.click(screen.getByLabelText(SELECT_ALL_LABEL));

    expect(tick("claude-opus-5")).not.toBeChecked();
    expect(screen.getByRole("button", { name: REVIEW_NEXT })).toHaveAttribute("title", NOTHING_CHOSEN);
  });

  it("lets the name be edited before it is created", async () => {
    await open();

    fireEvent.change(nameBox("claude-opus-5"), { target: { value: "opus" } });

    expect(nameBox("claude-opus-5")).toHaveValue("opus");
  });
});

describe("a name collision, before a round trip", () => {
  it("marks the row and holds the wizard on it", async () => {
    // *Nothing is created until they are all resolved* is the promise, and the control says so
    // rather than letting the reader walk into a certain refusal.
    await open();

    fireEvent.change(nameBox("claude-opus-5"), { target: { value: "coder-max" } });

    expect(screen.getByRole("alert")).toHaveTextContent(rowError("taken"));
    expect(screen.getByRole("button", { name: REVIEW_NEXT })).toHaveAttribute("title", FIX_ROWS);
  });

  it("asks a ticked row with an empty box for a name", async () => {
    await open();

    fireEvent.change(nameBox("claude-opus-5"), { target: { value: "" } });

    expect(screen.getByRole("alert")).toHaveTextContent(rowError("unnamed"));
  });

  it("clears the mark again when the name becomes free", async () => {
    await open();

    fireEvent.change(nameBox("claude-opus-5"), { target: { value: "coder-max" } });
    fireEvent.change(nameBox("claude-opus-5"), { target: { value: "opus-5" } });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the review, and the import", () => {
  it("names exactly what will be created", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: REVIEW_NEXT }));

    const preview = within(screen.getByRole("list", { name: PREVIEW_LABEL })).getAllByRole("listitem");

    expect(preview).toHaveLength(1);
    expect(preview[0]).toHaveTextContent("opus-5");
  });

  it("goes back to the rows with the ticks and the names still on them", async () => {
    await open();
    fireEvent.change(nameBox("claude-opus-5"), { target: { value: "opus" } });
    fireEvent.click(screen.getByRole("button", { name: REVIEW_NEXT }));
    fireEvent.click(screen.getByRole("button", { name: REVIEW_BACK }));

    expect(nameBox("claude-opus-5")).toHaveValue("opus");
  });

  it("sends one connection and the ticked rows, with the names in their boxes", async () => {
    // The ticket's criterion: importing from the seeded Anthropic connection lands the models
    // under their suggested — or edited — names.
    readCandidates.mockResolvedValue({
      ok: true,
      candidates: [
        importCandidate({ modelId: "claude-opus-5", suggestedName: "opus-5" }),
        importCandidate({ modelId: "claude-haiku-4-5", suggestedName: "haiku-4-5" }),
      ],
      empty: null,
    });
    await open();

    fireEvent.change(nameBox("claude-haiku-4-5"), { target: { value: "tiny" } });
    fireEvent.click(screen.getByRole("button", { name: REVIEW_NEXT }));
    fireEvent.click(screen.getByRole("button", { name: IMPORT_SUBMIT }));

    await waitFor(() => {
      expect(importAliases).toHaveBeenCalledExactlyOnceWith({
        connectionId: ANTHROPIC.id,
        items: [
          { modelId: "claude-opus-5", alias: "opus-5" },
          { modelId: "claude-haiku-4-5", alias: "tiny" },
        ],
      });
    });
  });

  it("reports what was created, and re-reads the table behind on Done", async () => {
    const onClose = vi.fn();

    render(<ImportWizard aliasNames={TAKEN} onClose={onClose} source={ANTHROPIC} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: REVIEW_NEXT }));
    fireEvent.click(screen.getByRole("button", { name: IMPORT_SUBMIT }));

    expect(await screen.findByText(IMPORTED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(importSummary(importResult()))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: IMPORT_DONE }));

    expect(refresh).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports a re-run that created nothing as a success, naming what it passed over", async () => {
    // The idempotency, reported rather than silent — and a wizard that said only *done* would
    // leave an operator wondering whether it had worked.
    const skipped = importResult([], [{ modelId: "claude-fable-5", alias: "coder-max" }]);

    importAliases.mockResolvedValue({ ok: true, result: skipped });
    await open();
    fireEvent.click(screen.getByRole("button", { name: REVIEW_NEXT }));
    fireEvent.click(screen.getByRole("button", { name: IMPORT_SUBMIT }));

    expect(await screen.findByText(importSummary(skipped))).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: SKIPPED_LABEL })).getByText(/coder-max/),
    ).toBeInTheDocument();
  });

  it("does not re-read the table when nothing was created", async () => {
    // Nothing changed behind the dialog, so nothing behind it needs refetching.
    importAliases.mockResolvedValue({
      ok: true,
      result: importResult([], [{ modelId: "claude-fable-5", alias: "coder-max" }]),
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: REVIEW_NEXT }));
    fireEvent.click(screen.getByRole("button", { name: IMPORT_SUBMIT }));
    fireEvent.click(await screen.findByRole("button", { name: IMPORT_DONE }));

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("an itemised refusal", () => {
  it("puts each message on its own row, and says nothing was created", async () => {
    // The ticket's criterion: a name collision in the wizard shows an inline error on that row
    // and creates nothing.
    importAliases.mockResolvedValue({
      ok: false,
      refusal: {
        code: "model_import_invalid",
        message: "no",
        details: { items: { "0": { alias: ["That name was taken a moment ago."] } } },
      },
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: REVIEW_NEXT }));
    fireEvent.click(screen.getByRole("button", { name: IMPORT_SUBMIT }));

    expect(await screen.findByText("That name was taken a moment ago.")).toBeInTheDocument();
    expect(screen.getByText(IMPORT_INVALID)).toBeInTheDocument();
    expect(nameBox("claude-opus-5")).toHaveAttribute("aria-invalid", "true");
  });

  it("comes back to the rows with the ticks and names it was sent with", async () => {
    importAliases.mockResolvedValue({
      ok: false,
      refusal: { code: "model_import_invalid", message: "no", details: { items: {} } },
    });
    await open();
    fireEvent.change(nameBox("claude-opus-5"), { target: { value: "opus" } });
    fireEvent.click(screen.getByRole("button", { name: REVIEW_NEXT }));
    fireEvent.click(screen.getByRole("button", { name: IMPORT_SUBMIT }));

    expect(await screen.findByText(IMPORT_INVALID)).toBeInTheDocument();
    expect(nameBox("claude-opus-5")).toHaveValue("opus");
  });

  it("says a member's refusal in words, and creates nothing", async () => {
    // The menu is drawn inert for a member, but a check made in the browser is a check anybody
    // can skip.
    importAliases.mockResolvedValue({
      ok: false,
      refusal: { code: "forbidden", message: "no", details: {} },
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: REVIEW_NEXT }));
    fireEvent.click(screen.getByRole("button", { name: IMPORT_SUBMIT }));

    expect(await screen.findByText(IMPORT_READ_ONLY)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("a connection with nothing to import", () => {
  it("says so, names the connection, and points at where to test it", async () => {
    // A wizard that opened onto nothing and explained nothing would be indistinguishable from
    // one that failed to load.
    readCandidates.mockResolvedValue({
      ok: true,
      candidates: [],
      empty: {
        code: "no_models_discovered",
        message: "Anthropic Claude has reported no models.",
        fix: "/models/providers",
      },
    });
    await open();

    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText("Anthropic Claude has reported no models.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: EMPTY_LINK })).toHaveAttribute(
      "href",
      "/models/providers",
    );
  });

  it("offers no table and no way to create anything", async () => {
    readCandidates.mockResolvedValue({
      ok: true,
      candidates: [],
      empty: { code: "no_models_discovered", message: "nothing", fix: "/models/providers" },
    });
    await open();

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: REVIEW_NEXT })).toBeNull();
    expect(screen.getByRole("button", { name: IMPORT_CANCEL })).toBeInTheDocument();
  });
});

describe("a read that was refused", () => {
  it("draws the service's own sentence rather than an empty table", async () => {
    readCandidates.mockResolvedValue({ ok: false, reason: "Could not be read. Importing is owner or admin." });
    await open();

    expect(screen.getByRole("alert")).toHaveTextContent("Importing is owner or admin.");
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the wizard in the %s palette", (palette) => {
    renderInPalette(palette, <ImportWizard aliasNames={TAKEN} onClose={vi.fn()} source={ANTHROPIC} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <ImportWizard aliasNames={TAKEN} onClose={vi.fn()} source={ANTHROPIC} />,
    );

    expect(light).toBe(dark);
  });
});

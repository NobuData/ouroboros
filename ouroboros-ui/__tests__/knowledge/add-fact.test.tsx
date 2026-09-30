import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADD_ANCHOR,
  ADD_FACT_LABEL,
  ADD_FACT_NOTE,
  ADD_FACT_SUBMIT,
  ADD_FACT_TITLE,
  ANCHOR_DUPLICATE,
  ANCHOR_KIND_LABEL,
  ANCHOR_VALUE_LABEL,
  ANCHOR_VALUE_REQUIRED,
  FACT_PROVENANCE_LABEL,
  FACT_REPO_LABEL,
  FACT_TEXT_LABEL,
  FACT_TEXT_REQUIRED,
  VIEWER_REASON,
  proposedToast,
} from "@/app/knowledge/facts";

import { SEEDED_REPO, fact, seededRepos } from "../helpers/knowledge";

/**
 * The facts card's **+ Add fact** dialog (#419): manual authoring with the anchor editor — all
 * three kinds — refused before a round trip when the form is not ready, landing `proposed` with a
 * toast that says so, and landing the service's anchor refusal under the anchor it named.
 */

const proposeFact = vi.fn();

vi.mock("@/app/knowledge/facts-actions", () => ({
  decideFact: vi.fn(),
  proposeFact: (body: unknown) => proposeFact(body),
}));

const { AddFact } = await import("@/app/knowledge/add-fact");

/**
 * Draw the action and open its dialog.
 *
 * @param mayDecide Whether the reader may propose.
 * @returns The `onProposed` spy.
 */
function open(mayDecide = true) {
  const onProposed = vi.fn();
  render(<AddFact mayDecide={mayDecide} onProposed={onProposed} repos={{ ok: true, value: seededRepos() }} />);
  fireEvent.click(screen.getByRole("button", { name: ADD_FACT_LABEL }));

  return onProposed;
}

/**
 * Add an anchor and fill it.
 *
 * @param index Which anchor it becomes.
 * @param kind Its kind.
 * @param value Its value.
 */
function anchor(index: number, kind: string, value: string): void {
  fireEvent.click(screen.getByRole("button", { name: ADD_ANCHOR }));
  fireEvent.change(screen.getAllByLabelText(ANCHOR_KIND_LABEL)[index]!, { target: { value: kind } });
  fireEvent.change(screen.getAllByLabelText(ANCHOR_VALUE_LABEL)[index]!, { target: { value } });
}

beforeEach(() => {
  proposeFact.mockReset().mockResolvedValue({ ok: true, value: fact({ text: "Use `k_msgq`" }) });
});

describe("the dialog", () => {
  it("opens on the button, says the fact lands awaiting review, and refuses an empty sentence", () => {
    open();

    expect(screen.getByRole("dialog", { name: ADD_FACT_TITLE })).toBeInTheDocument();
    expect(screen.getByText(ADD_FACT_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADD_FACT_SUBMIT })).toHaveAttribute("title", FACT_TEXT_REQUIRED);
  });

  it("proposes with the text alone, and lands the toast", async () => {
    const onProposed = open();

    fireEvent.change(screen.getByLabelText(FACT_TEXT_LABEL), { target: { value: "Use `k_msgq`" } });
    fireEvent.click(screen.getByRole("button", { name: ADD_FACT_SUBMIT }));

    expect(proposeFact).toHaveBeenCalledExactlyOnceWith({ text: "Use `k_msgq`" });
    await waitFor(() => {
      expect(onProposed).toHaveBeenCalledExactlyOnceWith(fact({ text: "Use `k_msgq`" }), proposedToast(fact({ text: "Use `k_msgq`" })));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends the repository, the provenance line and all three anchor kinds", () => {
    open();

    fireEvent.change(screen.getByLabelText(FACT_TEXT_LABEL), { target: { value: "Tests need the rig" } });
    fireEvent.change(screen.getByLabelText(FACT_REPO_LABEL), { target: { value: SEEDED_REPO } });
    fireEvent.change(screen.getByLabelText(FACT_PROVENANCE_LABEL), { target: { value: "from the bench" } });
    anchor(0, "path_glob", "tests/hil/**");
    anchor(1, "dependency", "west");
    anchor(2, "platform_version", "zephyr-4.0");
    fireEvent.click(screen.getByRole("button", { name: ADD_FACT_SUBMIT }));

    expect(proposeFact).toHaveBeenCalledExactlyOnceWith({
      text: "Tests need the rig",
      repoRef: SEEDED_REPO,
      provenanceLine: "from the bench",
      anchors: [
        { kind: "path_glob", value: "tests/hil/**" },
        { kind: "dependency", value: "west" },
        { kind: "platform_version", value: "zephyr-4.0" },
      ],
    });
  });

  it("refuses an empty anchor and a duplicate before a round trip, and lets one be removed", () => {
    open();

    fireEvent.change(screen.getByLabelText(FACT_TEXT_LABEL), { target: { value: "A fact" } });
    fireEvent.click(screen.getByRole("button", { name: ADD_ANCHOR }));

    expect(screen.getByRole("button", { name: ADD_FACT_SUBMIT })).toHaveAttribute("title", ANCHOR_VALUE_REQUIRED);
    expect(screen.getByRole("alert")).toHaveTextContent(ANCHOR_VALUE_REQUIRED);

    fireEvent.change(screen.getAllByLabelText(ANCHOR_VALUE_LABEL)[0]!, { target: { value: "west" } });
    fireEvent.change(screen.getAllByLabelText(ANCHOR_KIND_LABEL)[0]!, { target: { value: "dependency" } });
    anchor(1, "dependency", "west");

    expect(screen.getByRole("alert")).toHaveTextContent(ANCHOR_DUPLICATE);

    fireEvent.click(screen.getByRole("button", { name: /Remove anchor 2/ }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: ADD_FACT_SUBMIT })).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByRole("button", { name: ADD_FACT_SUBMIT }));
    expect(proposeFact).toHaveBeenCalledExactlyOnceWith({ text: "A fact", anchors: [{ kind: "dependency", value: "west" }] });
  });

  it("lands the service's anchor refusal under the anchor it named, and stays open", async () => {
    proposeFact.mockResolvedValue({
      ok: false,
      refusal: { code: "fact_anchor_invalid", message: "Not a glob.", details: { kind: "path_glob", value: "[" } },
    });
    open();

    fireEvent.change(screen.getByLabelText(FACT_TEXT_LABEL), { target: { value: "A fact" } });
    anchor(0, "dependency", "west");
    anchor(1, "path_glob", "[");
    fireEvent.click(screen.getByRole("button", { name: ADD_FACT_SUBMIT }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("Not a glob.");
    expect(screen.getAllByLabelText(ANCHOR_VALUE_LABEL)[1]).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByLabelText(ANCHOR_VALUE_LABEL)[0]).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows a refusal about the whole proposal above the actions", async () => {
    proposeFact.mockResolvedValue({
      ok: false,
      refusal: { code: "fact_provenance_unresolved", message: "No such run.", details: {} },
    });
    open();

    fireEvent.change(screen.getByLabelText(FACT_TEXT_LABEL), { target: { value: "A fact" } });
    fireEvent.click(screen.getByRole("button", { name: ADD_FACT_SUBMIT }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("No such run.");
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: ADD_FACT_SUBMIT })).not.toHaveAttribute("aria-disabled");
  });

  it("is inert for a viewer, with the reason", () => {
    render(<AddFact mayDecide={false} onProposed={vi.fn()} repos={{ ok: true, value: seededRepos() }} />);

    const button = screen.getByRole("button", { name: ADD_FACT_LABEL });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", VIEWER_REASON);
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

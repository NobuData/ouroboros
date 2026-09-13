import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workflowPath } from "@/app/paths";
import {
  CREATE_CANCEL,
  CREATE_READ_ONLY,
  CREATE_SUBMIT,
  CREATE_TITLE,
  NAME_LABEL,
  NEEDS_NAME,
  NEEDS_SLUG,
  SLUG_LABEL,
  SLUG_SHAPE,
  SLUG_TAKEN,
} from "@/app/workflows/create";
import type { CreateOutcome } from "@/app/workflows/create-actions";
import { NEW_WORKFLOW_LABEL, NEW_WORKFLOW_MEMBER_REASON } from "@/app/workflows/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { seededRail } from "../helpers/workflows";

/**
 * The **+ New workflow** tile and its dialog as they are drawn (#147).
 *
 * The acceptance criteria this suite exists for: **the dashed tile opens a create dialog
 * taking a slug and a name**, **a member sees the tile inert with the reason**, and — the
 * dialog's own promise — a slug collision is caught before a round trip, and the workflow that
 * was made is the one the page lands on.
 *
 * The Server Action is mocked, not the API: what is under test is the dialog, and
 * `create-actions.test.ts` is that module's own suite. `create.test.ts` proves the judgements;
 * this proves what reaches the DOM and what leaves it in a request.
 */

/** What the action answers, per case. */
const createWorkflow = vi.fn<(body: unknown) => Promise<CreateOutcome>>();

/** What lands the page on the workflow that was just made. */
const push = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/workflows/create-actions", () => ({
  createWorkflow: (body: unknown) => createWorkflow(body),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const { NewWorkflow } = await import("@/app/workflows/new-workflow");

/** Every slug the seeded workspace has. */
const TAKEN = seededRail().map((entry) => entry.slug);

beforeEach(() => {
  createWorkflow.mockReset().mockResolvedValue({ ok: true, slug: "hotfix-p1" });
  push.mockReset();
  refresh.mockReset();
});

/**
 * Render the tile and open its dialog.
 *
 * @param mayAdminister Whether the reader may create. Defaults to yes.
 */
function open(mayAdminister = true): void {
  render(<NewWorkflow mayAdminister={mayAdminister} slugs={TAKEN} />);

  fireEvent.click(screen.getByRole("button", { name: NEW_WORKFLOW_LABEL }));
}

/**
 * Type a name into the dialog.
 *
 * @param value What to type.
 */
function typeName(value: string): void {
  fireEvent.change(screen.getByLabelText(NAME_LABEL), { target: { value } });
}

/**
 * Type a slug into the dialog.
 *
 * @param value What to type.
 */
function typeSlug(value: string): void {
  fireEvent.change(screen.getByLabelText(SLUG_LABEL), { target: { value } });
}

/** The dialog's primary control. */
function submit(): HTMLElement {
  return screen.getByRole("button", { name: CREATE_SUBMIT });
}

describe("the tile", () => {
  it("opens the dialog when an admin presses it", () => {
    open();

    expect(screen.getByRole("dialog")).toHaveAccessibleName(CREATE_TITLE);
  });

  it("is inert for a member, with the reason that is true of them", () => {
    // The ticket's criterion, and the gate that enforces is the service's.
    render(<NewWorkflow mayAdminister={false} slugs={TAKEN} />);

    const tile = screen.getByRole("button", { name: NEW_WORKFLOW_LABEL });

    expect(tile).toHaveAttribute("aria-disabled", "true");
    expect(tile).toHaveAttribute("title", NEW_WORKFLOW_MEMBER_REASON);

    fireEvent.click(tile);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays reachable by keyboard for a member, so its explanation is reachable too", () => {
    render(<NewWorkflow mayAdminister={false} slugs={TAKEN} />);

    expect(
      (screen.getByRole("button", { name: NEW_WORKFLOW_LABEL }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("opens on an empty form every time, so a dialog dismissed halfway starts clean", () => {
    open();
    typeName("Half typed");
    fireEvent.click(screen.getByRole("button", { name: CREATE_CANCEL }));
    fireEvent.click(screen.getByRole("button", { name: NEW_WORKFLOW_LABEL }));

    expect(screen.getByLabelText(NAME_LABEL)).toHaveValue("");
    expect(screen.getByLabelText(SLUG_LABEL)).toHaveValue("");
  });
});

describe("the slug, which follows the name", () => {
  it("shows what the service would derive from the name, as it is typed", () => {
    open();
    typeName("Hotfix P1");

    expect(screen.getByLabelText(SLUG_LABEL)).toHaveValue("hotfix-p1");
  });

  it("stops following once the reader edits it", () => {
    // The slug is the one thing that cannot be changed later, so once it is chosen it is the
    // reader's.
    open();
    typeName("Hotfix P1");
    typeSlug("p1-hotfix");
    typeName("Hotfix P2");

    expect(screen.getByLabelText(SLUG_LABEL)).toHaveValue("p1-hotfix");
  });

  it("follows the name again once the reader empties it", () => {
    open();
    typeName("Hotfix P1");
    typeSlug("p1-hotfix");
    typeSlug("");

    expect(screen.getByLabelText(SLUG_LABEL)).toHaveValue("hotfix-p1");

    typeName("Hotfix P2");

    expect(screen.getByLabelText(SLUG_LABEL)).toHaveValue("hotfix-p2");
  });

  it("says nothing at all until something has been typed", () => {
    open();

    expect(screen.queryByText(SLUG_SHAPE)).toBeNull();
    expect(screen.queryByText(SLUG_TAKEN)).toBeNull();
  });

  it("catches a slug the rail already holds, with no round trip", () => {
    open();
    typeName("standard fix");

    expect(screen.getByText(SLUG_TAKEN)).toBeInTheDocument();
    expect(submit()).toHaveAttribute("title", NEEDS_SLUG);
  });

  it("catches a slug that is not lower-case kebab", () => {
    open();
    typeName("Hotfix P1");
    typeSlug("Hotfix P1");

    expect(screen.getByText(SLUG_SHAPE)).toBeInTheDocument();
  });

  it("clears the line again when the slug becomes free", () => {
    open();
    typeName("standard fix");
    typeName("hotfix p1");

    expect(screen.queryByText(SLUG_TAKEN)).toBeNull();
  });
});

describe("the submit", () => {
  it("asks for a name before anything else", () => {
    open();

    expect(submit()).toHaveAttribute("title", NEEDS_NAME);
  });

  it("sends the name and the slug the dialog showed", async () => {
    open();
    typeName("Hotfix P1");
    fireEvent.click(submit());

    await waitFor(() => {
      expect(createWorkflow).toHaveBeenCalledExactlyOnceWith({
        name: "Hotfix P1",
        slug: "hotfix-p1",
      });
    });
  });

  it("sends the slug the reader chose over the derived one", async () => {
    open();
    typeName("Hotfix P1");
    typeSlug("p1-hotfix");
    fireEvent.click(submit());

    await waitFor(() => {
      expect(createWorkflow).toHaveBeenCalledExactlyOnceWith({
        name: "Hotfix P1",
        slug: "p1-hotfix",
      });
    });
  });
});

describe("what a create does to the page", () => {
  it("closes, and lands the page on the workflow it just made", async () => {
    // The rail re-reads on the navigation, the new entry is on it, and the head is open on it.
    open();
    typeName("Hotfix P1");
    fireEvent.click(submit());

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(workflowPath("hotfix-p1"));
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the slug the service stored, not the one that was typed", async () => {
    createWorkflow.mockResolvedValue({ ok: true, slug: "hotfix-p1-2" });
    open();
    typeName("Hotfix P1");
    fireEvent.click(submit());

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(workflowPath("hotfix-p1-2"));
    });
  });

  it("navigates nothing when the dialog is cancelled", () => {
    open();
    typeName("Hotfix P1");
    fireEvent.click(screen.getByRole("button", { name: CREATE_CANCEL }));

    expect(createWorkflow).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("a refusal", () => {
  it("keeps the dialog open with every value where the reader left it", async () => {
    createWorkflow.mockResolvedValue({
      ok: false,
      refusal: { code: "workflow_slug_taken", message: "taken", details: {} },
    });
    open();
    typeName("Hotfix P1");
    fireEvent.click(submit());

    // The whole-form sentence, not the slug field's — both are alerts, and it is the one that
    // says nothing was created.
    await screen.findByText(SLUG_TAKEN, { exact: false, selector: ".studio-create__failure" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(NAME_LABEL)).toHaveValue("Hotfix P1");
    expect(screen.getByLabelText(SLUG_LABEL)).toHaveValue("hotfix-p1");
    expect(push).not.toHaveBeenCalled();
  });

  it("puts a taken slug under the slug box, wherever it was caught", async () => {
    createWorkflow.mockResolvedValue({
      ok: false,
      refusal: { code: "workflow_slug_taken", message: "taken", details: {} },
    });
    open();
    typeName("Hotfix P1");
    fireEvent.click(submit());

    await waitFor(() => {
      expect(screen.getByLabelText(SLUG_LABEL)).toHaveAttribute("aria-invalid", "true");
    });
    expect(screen.getByLabelText(NAME_LABEL)).not.toHaveAttribute("aria-invalid");
  });

  it("puts a shape refusal on the field it named", async () => {
    createWorkflow.mockResolvedValue({
      ok: false,
      refusal: {
        code: "validation_failed",
        message: "invalid",
        details: { name: ["name must be at most 120 characters"] },
      },
    });
    open();
    typeName("Hotfix P1");
    fireEvent.click(submit());

    expect(await screen.findByText("name must be at most 120 characters")).toBeInTheDocument();
    expect(screen.getByLabelText(NAME_LABEL)).toHaveAttribute("aria-invalid", "true");
  });

  it("says a member's refusal in words, and creates nothing", async () => {
    // A check made in the browser is a check anybody can skip, so the service's answer is what
    // the dialog draws when somebody goes around the presentation.
    createWorkflow.mockResolvedValue({
      ok: false,
      refusal: { code: "forbidden", message: "no", details: {} },
    });
    open();
    typeName("Hotfix P1");
    fireEvent.click(submit());

    expect(await screen.findByText(CREATE_READ_ONLY)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the tile in the %s palette", (palette) => {
    renderInPalette(palette, <NewWorkflow mayAdminister slugs={TAKEN} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("button", { name: NEW_WORKFLOW_LABEL })).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(<NewWorkflow mayAdminister slugs={TAKEN} />);

    expect(light).toBe(dark);
  });
});

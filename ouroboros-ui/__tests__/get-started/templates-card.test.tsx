import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnboardingTemplateTiles } from "@/app/api/onboarding";
import type { TemplatesPollOptions } from "@/app/get-started/templates-poll";
import {
  ADMIN_REASON,
  INVALID_NOTHING_CREATED,
  NO_TEMPLATES,
  SELECTING,
} from "@/app/get-started/templates-view";
import type { PollAnswer } from "@/app/poll";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";
import { REPO, instantiated, seededTiles, templateSelection, tile } from "../helpers/onboarding";

/**
 * The *"Choose a starting workflow"* card (BC.3, #392, mockup 13): the seeded grid with its
 * selected and locked treatments, the computed unlock line that opens by itself, a selection that
 * shows progress then links the created workflow, the designed error for a refused definition,
 * the re-selection confirmation, the caption gate, and full keyboard reach.
 */

const selectTemplate = vi.fn();

vi.mock("@/app/get-started/actions", () => ({
  selectTemplate: (repo: string, slug: string) => selectTemplate(repo, slug),
}));

const { TemplatesCard } = await import("@/app/get-started/templates-card");

/** What the poll answers next; null never answers. */
let answer: PollAnswer<OnboardingTemplateTiles> | null = null;

const POLL: TemplatesPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
};

const OWNER = { contribute: true, administer: true };
const MEMBER = { contribute: true, administer: false };

/**
 * The card over a first read.
 *
 * @param initial The first paint's tiles.
 * @param abilities What the person may do.
 * @param onChanged What a selection calls.
 * @returns The render.
 */
function card(
  initial: OnboardingTemplateTiles = seededTiles(),
  abilities = OWNER,
  onChanged?: () => void,
) {
  return render(
    <TemplatesCard
      abilities={abilities}
      initial={{ ok: true, value: initial }}
      onChanged={onChanged}
      poll={POLL}
      repo={REPO}
      stepStatus="active"
    />,
  );
}

/** The card's region. */
const region = () => screen.getByRole("region", { name: "Choose a starting workflow" });

/** The grid. */
const grid = () => within(region()).getByRole("list", { name: "Starting workflows" });

/** One tile's button, by the template's name. */
const tileButton = (name: string) =>
  within(grid())
    .getAllByRole("button")
    .find((button) => button.querySelector(".tile__name")?.textContent === name)!;

/** A fresh poll answer. */
function fresh(payload: OnboardingTemplateTiles): PollAnswer<OnboardingTemplateTiles> {
  return { state: "fresh", payload, etag: null, pollAfterSeconds: null };
}

/** Let the poll read its next answer now. */
async function pollNow(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
  });
}

/** The seeded grid with Quick fixes already created. */
function createdGrid(): OnboardingTemplateTiles {
  return seededTiles({
    tiles: seededTiles().tiles.map((one) =>
      one.slug === "quick-fixes" ? { ...one, workflow: instantiated() } : one,
    ),
  });
}

beforeEach(() => {
  answer = null;
  selectTemplate.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the seeded grid", () => {
  it("matches the mockup: four tiles in order, Quick fixes selected, Deep refactor locked", () => {
    card();

    expect(within(region()).getByText("step 3 · you are here")).toBeInTheDocument();
    expect(within(region()).getByRole("link", { name: "Open Workflow Studio →" })).toHaveAttribute(
      "href",
      "/workflows",
    );

    const buttons = within(grid()).getAllByRole("button");
    expect(buttons.map((button) => button.querySelector(".tile__name")!.textContent)).toEqual([
      "Quick fixes",
      "Feature builder",
      "Docs & chores",
      "Deep refactor",
    ]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);

    const quick = tileButton("Quick fixes");
    expect(quick.closest(".tile")).toHaveClass("tile--selected");
    expect(within(quick).getByText("✓ selected")).toBeInTheDocument();
    expect(quick).toHaveTextContent("Small bugs and cleanups, fully hands-off.");
    expect(quick).toHaveTextContent("Stages: analyze, plan, code, build, test, PR.");
    expect(
      within(quick)
        .getAllByText(/^(XS|S|M)$/)
        .map((chip) => chip.textContent),
    ).toEqual(["XS", "S", "M"]);
    expect(within(quick).getByText("recommended first workflow")).toBeInTheDocument();

    expect(tileButton("Deep refactor").closest(".tile")).toHaveClass("tile--locked");
    expect(
      within(tileButton("Deep refactor"))
        .getAllByText(/^(L|XL)$/)
        .map((chip) => chip.textContent),
    ).toEqual(["L", "XL"]);
  });

  it("renders the locked tile's computed progress, and exposes its state and reason", () => {
    card();

    const deep = tileButton("Deep refactor");
    // The visible tag is the computed progress, not the static rule — which only the spoken reason carries.
    expect(deep.querySelector(".tile__unlock")).toHaveTextContent("3 of 10 merged loops");
    expect(deep.querySelector(".tile__unlock")).not.toHaveTextContent("unlock after");
    expect(deep.querySelector(".sr-only:last-child")).toHaveTextContent(
      "unlock after 10 merged loops",
    );
    expect(deep).toHaveAttribute("aria-disabled", "true");
    expect(deep).toHaveAccessibleDescription(
      "Locked — 3 of 10 merged loops; unlock after 10 merged loops.",
    );

    fireEvent.click(deep);
    expect(selectTemplate).not.toHaveBeenCalled();
  });

  it("opens the locked tile by itself once the poll reads the threshold crossed", async () => {
    card();

    const unlocked = seededTiles({
      mergedLoops: 10,
      tiles: seededTiles().tiles.map((one) =>
        one.slug === "deep-refactor"
          ? {
              ...one,
              unlock: {
                ...one.unlock!,
                locked: false,
                mergedLoops: 10,
                progress: "10 of 10 merged loops",
              },
            }
          : one,
      ),
    });
    answer = fresh(unlocked);
    await pollNow();

    await waitFor(() => expect(tileButton("Deep refactor")).not.toHaveAttribute("aria-disabled"));
    expect(tileButton("Deep refactor").closest(".tile")).not.toHaveClass("tile--locked");
    expect(within(tileButton("Deep refactor")).queryByText(/merged loops/)).toBeNull();
  });

  it("prints no caption with a percentage or a count — the caption gate (O8)", () => {
    card(
      seededTiles({
        tiles: seededTiles().tiles.map((one) =>
          one.slug === "quick-fixes"
            ? { ...one, caption: "recommended first workflow — 92% of teams start here" }
            : one,
        ),
      }),
    );

    expect(grid()).not.toHaveTextContent("%");
    expect(grid()).not.toHaveTextContent("92");
    expect(within(tileButton("Quick fixes")).queryByText(/recommended/)).toBeNull();
    expect(
      within(tileButton("Feature builder")).getByText(
        "best for new capabilities that touch several files",
      ),
    ).toBeInTheDocument();
  });

  it("links the Studio from the footer and from a tile whose workflow exists", () => {
    card(createdGrid());

    expect(within(region()).getByRole("link", { name: "Workflow Studio" })).toHaveAttribute(
      "href",
      "/workflows",
    );
    expect(region()).toHaveTextContent(
      "All templates are editable later in the Workflow Studio — visually or as code.",
    );
    // The name's inline parts are joined without the space between them.
    expect(
      within(region()).getByRole("link", { name: /^Open in the Studio →\s*\(Quick fixes\)$/ }),
    ).toHaveAttribute("href", "/workflows/quick-fixes");
  });

  it("is reachable by keyboard: every tile is a focusable button, the locked one included", () => {
    card();

    for (const button of within(grid()).getAllByRole("button")) {
      button.focus();
      expect(button).toHaveFocus();
      expect(button).not.toHaveAttribute("tabindex", "-1");
    }
  });
});

describe("selecting", () => {
  it("shows progress, then the success state linking the created workflow — and tells the rail", async () => {
    let finish!: (value: unknown) => void;
    selectTemplate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onChanged = vi.fn();
    card(seededTiles(), OWNER, onChanged);

    fireEvent.click(tileButton("Feature builder"));

    await waitFor(() => expect(selectTemplate).toHaveBeenCalledWith(REPO, "feature-builder"));
    expect(within(region()).getByRole("status")).toHaveTextContent(SELECTING);
    expect(within(tileButton("Feature builder")).getByText(SELECTING)).toBeInTheDocument();
    expect(tileButton("Quick fixes")).toHaveAttribute("aria-disabled", "true");
    expect(tileButton("Quick fixes")).toHaveAccessibleDescription(SELECTING);

    await act(async () => {
      finish({
        ok: true,
        value: templateSelection({
          workflow: instantiated({
            id: "wf-fb",
            slug: "feature-builder",
            name: "Feature builder",
            templateSlug: "feature-builder",
            studioPath: "/workflows/feature-builder",
          }),
        }),
      });
      await settle();
    });

    const status = within(region()).getByRole("status");
    expect(status).toHaveTextContent("Created Feature builder.");
    expect(
      within(status).getByRole("link", { name: "Open it in the Workflow Studio →" }),
    ).toHaveAttribute("href", "/workflows/feature-builder");
    // The grid shows the selection at once, before the poll's next read.
    expect(tileButton("Feature builder")).toHaveAttribute("aria-pressed", "true");
    expect(tileButton("Quick fixes")).toHaveAttribute("aria-pressed", "false");
    expect(
      within(region()).getByRole("link", { name: /^Open in the Studio →\s*\(Feature builder\)$/ }),
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("says plainly when the existing workflow is reused", async () => {
    selectTemplate.mockResolvedValue({ ok: true, value: templateSelection({ created: false }) });
    card(createdGrid());

    fireEvent.click(tileButton("Quick fixes"));

    await waitFor(() =>
      expect(within(region()).getByRole("status")).toHaveTextContent(
        "Using Quick fixes, the workflow already made from this template.",
      ),
    );
    expect(selectTemplate).toHaveBeenCalledWith(REPO, "quick-fixes");
  });

  it("presses once however often a tile is clicked while asking", () => {
    selectTemplate.mockReturnValue(new Promise(() => {}));
    card();

    fireEvent.click(tileButton("Feature builder"));
    fireEvent.click(tileButton("Feature builder"));
    fireEvent.click(tileButton("Docs & chores"));

    expect(selectTemplate).toHaveBeenCalledTimes(1);
  });

  it("renders a validation failure as a designed error naming each finding, and claims no workflow", async () => {
    selectTemplate.mockResolvedValue({
      ok: false,
      reason: "The feature-builder template could not be turned into a workflow.",
      findings: [
        {
          source: "dsl",
          code: "unreachable_node",
          message: "Stage review is unreachable.",
          path: "/nodes/3",
        },
        {
          source: "registry",
          code: "alias_unknown",
          message: "No model alias named fast-coder.",
          path: null,
        },
      ],
    });
    card();

    fireEvent.click(tileButton("Feature builder"));

    const alert = await within(region()).findByRole("alert");
    expect(alert).toHaveTextContent(
      "The Feature builder template could not be turned into a workflow: its definition did not pass validation.",
    );
    expect(
      within(alert)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "dsl · unreachable_node — Stage review is unreachable. (at /nodes/3)",
      "registry · alias_unknown — No model alias named fast-coder.",
    ]);
    expect(alert).toHaveTextContent(INVALID_NOTHING_CREATED);
    expect(tileButton("Feature builder")).toHaveAttribute("aria-pressed", "false");
    expect(tileButton("Quick fixes")).toHaveAttribute("aria-pressed", "true");
    expect(within(region()).queryByRole("status")).toBeNull();
  });

  it("shows the service's other refusals in its words", async () => {
    selectTemplate.mockResolvedValue({
      ok: false,
      reason: "The deep-refactor template is locked: unlock after 10 merged loops.",
      findings: [],
    });
    card();

    fireEvent.click(tileButton("Docs & chores"));

    expect(await within(region()).findByRole("alert")).toHaveTextContent(
      "The deep-refactor template is locked",
    );
    expect(within(region()).queryByRole("list", { name: "Validation findings" })).toBeNull();
  });

  it("is an owner's or admin's — a member sees the tiles and why they cannot select", () => {
    card(seededTiles(), MEMBER);

    expect(within(region()).getByText(ADMIN_REASON)).toBeInTheDocument();
    const feature = tileButton("Feature builder");
    expect(feature).toHaveAttribute("aria-disabled", "true");
    expect(feature).toHaveAccessibleDescription(ADMIN_REASON);

    fireEvent.click(feature);
    expect(selectTemplate).not.toHaveBeenCalled();
  });
});

describe("re-selection", () => {
  it("asks first when a created workflow would be left behind, states it stays, and links it", async () => {
    selectTemplate.mockResolvedValue({
      ok: true,
      value: templateSelection({
        workflow: instantiated({
          slug: "feature-builder",
          name: "Feature builder",
          templateSlug: "feature-builder",
          studioPath: "/workflows/feature-builder",
        }),
      }),
    });
    card(createdGrid());

    fireEvent.click(tileButton("Feature builder"));

    const dialog = screen.getByRole("dialog", { name: "Switch to Feature builder?" });
    expect(dialog).toHaveAccessibleDescription(/Quick fixes stays\./);
    expect(
      within(dialog).getByRole("link", { name: "Open Quick fixes in the Workflow Studio →" }),
    ).toHaveAttribute("href", "/workflows/quick-fixes");
    expect(selectTemplate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Switch to Feature builder" }));

    await waitFor(() => expect(selectTemplate).toHaveBeenCalledWith(REPO, "feature-builder"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(within(region()).getByRole("status")).toHaveTextContent("Created Feature builder."),
    );
  });

  it("keeps the current choice on cancel or Escape", () => {
    card(createdGrid());

    fireEvent.click(tileButton("Feature builder"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Keep the current choice" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(tileButton("Docs & chores"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(selectTemplate).not.toHaveBeenCalled();
  });

  it("does not ask when nothing was created yet — a recorded choice has nothing to keep", async () => {
    selectTemplate.mockResolvedValue({ ok: true, value: templateSelection() });
    card();

    fireEvent.click(tileButton("Feature builder"));

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(selectTemplate).toHaveBeenCalledWith(REPO, "feature-builder"));
  });
});

describe("the card's states", () => {
  it("says so when the workspace is offered no template", () => {
    card(seededTiles({ tiles: [], selectedTemplate: null }));

    expect(within(region()).getByText(NO_TEMPLATES)).toBeInTheDocument();
    expect(within(region()).queryByRole("list")).toBeNull();
  });

  it("says why the tiles could not be read", () => {
    render(
      <TemplatesCard
        abilities={OWNER}
        initial={{ ok: false, reason: "Templates are busy." }}
        poll={POLL}
        repo={REPO}
        stepStatus="active"
      />,
    );

    expect(within(region()).getByRole("alert")).toHaveTextContent("Templates are busy.");
  });

  it("wears the done tag once step 3 is done, and no pill before step 3", () => {
    render(
      <TemplatesCard
        abilities={OWNER}
        initial={{ ok: true, value: createdGrid() }}
        poll={POLL}
        repo={REPO}
        stepStatus="done"
      />,
    );
    expect(within(region()).getByText("✓ step 3 done")).toBeInTheDocument();
    cleanup();

    render(
      <TemplatesCard
        abilities={OWNER}
        initial={{ ok: true, value: seededTiles() }}
        poll={POLL}
        repo={REPO}
        stepStatus="todo"
      />,
    );
    expect(within(region()).queryByText(/step 3/)).toBeNull();
  });

  it("skips an effort size the chip set lacks rather than crashing", () => {
    card(
      seededTiles({
        tiles: [tile({ slug: "odd", name: "Odd", effortRange: ["xs", "xxl" as "xs"] })],
      }),
    );

    expect(
      within(tileButton("Odd"))
        .getAllByText(/^(XS|XXL)$/)
        .map((chip) => chip.textContent),
    ).toEqual(["XS"]);
  });
});

describe("both palettes", () => {
  it("draws the same grid in light and dark — the hues are the tokens'", () => {
    const [light, dark] = renderInBothPalettes(
      <TemplatesCard
        abilities={OWNER}
        initial={{ ok: true, value: seededTiles() }}
        poll={POLL}
        repo={REPO}
        stepStatus="active"
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("tile--selected");
    expect(light).toContain("tile--locked");
  });
});

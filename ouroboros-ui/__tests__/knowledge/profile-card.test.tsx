import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnabledRepo } from "@/app/api/enablement";
import type { Reading } from "@/app/api/reading";
import { KNOWLEDGE_PATH } from "@/app/paths";
import {
  DETECTION_EDIT_REASON,
  ENV_ADD,
  ENV_ADMIN_REASON,
  ENV_CONSUMERS_NOTE,
  ENV_EDIT,
  ENV_TEXT_LABEL,
  NOT_SCANNED_TITLE,
  NO_RECIPE_TITLE,
  NO_REPOS_TITLE,
  PLATFORM_ABSENT,
  PROFILE_UNREAD_TITLE,
  PROTECTED_EDIT_REASON,
  RECIPE_EMPTY,
  REPO_SELECT_LABEL,
  SNAPSHOT_HONEST,
  savedToast,
} from "@/app/knowledge/profile";
import type { ProfileReadings } from "@/app/knowledge/view";

import {
  READ_AT,
  SEEDED_REPO,
  enabledRepo,
  seededDetection,
  seededProfile,
  seededRecipe,
  seededRepos,
  unscannedDetection,
} from "../helpers/knowledge";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * Mockup 14's Repo Profile card as it is drawn (#420): the `detected` pill and the rows composed
 * from detection in both palettes, the protected paths with inert edit affordances naming their
 * owners, the Environment block in order with its version line and in-place edit that saves the
 * next version, the honest snapshot row with no boot time, a member's read-only variant, and the
 * no-repository, not-scanned, unread and no-recipe states.
 */

const saveEnvRecipe = vi.fn();
const refresh = vi.fn();
const replace = vi.fn();

vi.mock("@/app/knowledge/profile-actions", () => ({ saveEnvRecipe: (body: unknown) => saveEnvRecipe(body) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace }),
}));

const { ProfileCard } = await import("@/app/knowledge/profile-card");

/**
 * Draw the card.
 *
 * @param over Props to replace.
 * @returns The render result, and the toast spy.
 */
function draw(
  over: Partial<{ profile: ProfileReadings; repos: Reading<readonly EnabledRepo[]>; mayAdminister: boolean }> = {},
) {
  const onToast = vi.fn();
  const result = render(
    <ProfileCard
      mayAdminister
      onToast={onToast}
      profile={seededProfile()}
      readAt={READ_AT}
      repos={{ ok: true, value: [enabledRepo()] }}
      {...over}
    />,
  );

  return { ...result, onToast };
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: /Repo profile/ });
}

/**
 * A profile row's value, by its label.
 *
 * @param label The row's label.
 * @returns The `<dd>`.
 */
function valueOf(label: string): HTMLElement {
  const term = within(card()).getByText(label, { selector: "dt" });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value for ${label}`);

  return value;
}

beforeEach(() => {
  saveEnvRecipe.mockReset().mockResolvedValue({ ok: true, value: seededRecipe({ version: 4 }) });
  refresh.mockReset();
  replace.mockReset();
});

describe("the seeded card", () => {
  it("is titled for the repository and wears the detected pill", () => {
    draw();

    expect(card()).toHaveAccessibleName("Repo profile — helios-firmware");
    expect(within(card()).getByText("detected", { selector: ".ou-chip" })).toHaveClass("ou-chip--ok");
  });

  it("renders the same markup in both palettes — the sheet is what differs", () => {
    const [light, dark] = renderInBothPalettes(
      <ProfileCard mayAdminister onToast={vi.fn()} profile={seededProfile()} readAt={READ_AT} repos={{ ok: true, value: [enabledRepo()] }} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("west update --narrow -o=--depth=1");
  });

  it("composes the profile rows from detection, the Platform honest about its missing pack", () => {
    draw();

    expect(valueOf("Language")).toHaveTextContent("C 92% · CMake");
    expect(valueOf("Platform")).toHaveTextContent(PLATFORM_ABSENT);
    expect(valueOf("Build")).toHaveTextContent("west + twister (found west.yml)");
    expect(valueOf("Devcontainer")).toHaveTextContent("✓ .devcontainer.json");
  });

  it("draws the protected paths as tags saying where each came from", () => {
    draw();

    const paths = valueOf("Protected paths");
    expect(within(paths).getByText("boot/**")).toHaveAttribute("title", "suggested by a scan");
    expect(within(paths).getByText("keys/**")).toHaveAttribute("title", "edited by a person");
  });

  it("makes every edit affordance inert, naming the surface that owns the data", () => {
    draw();

    const detection = within(card()).getByRole("button", { name: "edit: Language" });
    expect(detection).toHaveAttribute("aria-disabled", "true");
    expect(detection).toHaveAttribute("title", DETECTION_EDIT_REASON);
    expect(detection).toHaveAccessibleDescription(DETECTION_EDIT_REASON);

    const paths = within(card()).getByRole("button", { name: "edit: Protected paths" });
    expect(paths).toHaveAttribute("aria-disabled", "true");
    expect(paths).toHaveAccessibleDescription(PROTECTED_EDIT_REASON);

    expect(within(card()).queryByRole("textbox")).toBeNull();
  });

  it("prints the Environment block in order, with comments, its version line and who consumes it", () => {
    draw();

    const block = within(card()).getByRole("region", { name: "Environment" });
    const lines = [...block.querySelectorAll("pre > span")].map((line) => line.textContent?.trim());

    expect(lines).toEqual([
      "west init -m git@github.com:acme-robotics/helios-firmware # manifest repo",
      "west update --narrow -o=--depth=1 # shallow module fetch",
      "zephyr-sdk-install 0.17.2 --toolchains arm-zephyr-eabi # SDK + ARM toolchain",
      "ccache --set-config=max_size=8G # shared build cache",
    ]);
    expect(block).toHaveTextContent("v3 · edited by Ken, 1w ago");
    expect(block).toHaveTextContent(ENV_CONSUMERS_NOTE);
    expect(within(block).getByRole("button", { name: ENV_EDIT })).not.toHaveAttribute("aria-disabled");
  });

  it("draws the honest snapshot row and no boot time anywhere — decision K7", () => {
    draw();

    expect(card()).toHaveTextContent(`Warm snapshot — ${SNAPSHOT_HONEST}`);
    expect(card().textContent).not.toMatch(/38s|vs 6m cold|boots in/);
    expect(within(card()).queryByRole("switch")).toBeNull();
    expect(within(card()).queryByRole("button", { name: /Rebuild snapshot/ })).toBeNull();
  });

  it("offers no repository select with one repository, and moves the address with more", () => {
    draw();
    expect(screen.queryByLabelText(REPO_SELECT_LABEL)).toBeNull();

    const { unmount } = draw({ repos: { ok: true, value: seededRepos() } });
    void unmount;
    const select = screen.getByLabelText(REPO_SELECT_LABEL);
    expect(select).toHaveValue(SEEDED_REPO);

    fireEvent.change(select, { target: { value: "acme-robotics/helios-tools" } });

    expect(replace).toHaveBeenCalledExactlyOnceWith(`${KNOWLEDGE_PATH}?repo=${encodeURIComponent("acme-robotics/helios-tools")}`);
  });
});

describe("the states", () => {
  it("says no repository is enabled", () => {
    draw({ profile: { repo: null, detection: { ok: false, reason: NO_REPOS_TITLE }, recipe: { ok: false, reason: NO_REPOS_TITLE } } });

    expect(card()).toHaveTextContent(NO_REPOS_TITLE);
    expect(screen.queryByText("detected")).toBeNull();
    expect(within(card()).queryByText("Environment")).toBeNull();
  });

  it("says a repository was never scanned, and still draws the recipe and the snapshot row", () => {
    draw({ profile: seededProfile({ detection: { ok: true, value: unscannedDetection() } }) });

    expect(within(card()).getByText("not scanned")).toHaveClass("ou-chip--warn");
    expect(card()).toHaveTextContent(NOT_SCANNED_TITLE);
    expect(valueOf("Protected paths")).toHaveTextContent("none");
    expect(card()).toHaveTextContent("west update --narrow");
    expect(card()).toHaveTextContent(SNAPSHOT_HONEST);
  });

  it("says detection could not be read, with the reason", () => {
    draw({ profile: seededProfile({ detection: { ok: false, reason: "The service failed." } }) });

    expect(within(card()).getByText("not read")).toHaveClass("ou-chip--err");
    expect(card()).toHaveTextContent(PROFILE_UNREAD_TITLE);
    expect(card()).toHaveTextContent("The service failed.");
  });

  it("draws the no-recipe state with the add action", () => {
    draw({ profile: seededProfile({ recipe: { ok: true, value: null } }) });

    expect(card()).toHaveTextContent(NO_RECIPE_TITLE);
    expect(within(card()).getByRole("button", { name: ENV_ADD })).not.toHaveAttribute("aria-disabled");
    expect(within(card()).queryByText(/^v\d/)).toBeNull();
  });

  it("draws a member's edit inert with the reason", () => {
    draw({ mayAdminister: false });

    const edit = within(card()).getByRole("button", { name: ENV_EDIT });
    expect(edit).toHaveAttribute("aria-disabled", "true");
    expect(edit).toHaveAttribute("title", ENV_ADMIN_REASON);

    fireEvent.click(edit);
    expect(within(card()).queryByRole("textbox")).toBeNull();
  });
});

describe("editing the Environment block", () => {
  it("opens the block as text, saves it as the next version, and the block takes what the service answered", async () => {
    const saved = seededRecipe({
      version: 4,
      commands: [...seededRecipe().commands.slice(0, 2), { command: "zephyr-sdk-install 0.17.3 --toolchains arm-zephyr-eabi", comment: "SDK + ARM toolchain" }],
    });
    saveEnvRecipe.mockResolvedValue({ ok: true, value: saved });
    const { onToast } = draw();

    fireEvent.click(within(card()).getByRole("button", { name: ENV_EDIT }));

    const editor = within(card()).getByLabelText(ENV_TEXT_LABEL);
    expect(editor).toHaveValue(
      [
        "west init -m git@github.com:acme-robotics/helios-firmware # manifest repo",
        "west update --narrow -o=--depth=1 # shallow module fetch",
        "zephyr-sdk-install 0.17.2 --toolchains arm-zephyr-eabi # SDK + ARM toolchain",
        "ccache --set-config=max_size=8G # shared build cache",
      ].join("\n"),
    );

    fireEvent.change(editor, {
      target: {
        value: [
          "west init -m git@github.com:acme-robotics/helios-firmware # manifest repo",
          "west update --narrow -o=--depth=1 # shallow module fetch",
          "",
          "zephyr-sdk-install 0.17.3 --toolchains arm-zephyr-eabi # SDK + ARM toolchain",
        ].join("\n"),
      },
    });
    fireEvent.click(within(card()).getByRole("button", { name: "Save as v4" }));

    await waitFor(() => {
      expect(saveEnvRecipe).toHaveBeenCalledExactlyOnceWith({
        repo: SEEDED_REPO,
        commands: [
          { command: "west init -m git@github.com:acme-robotics/helios-firmware", comment: "manifest repo" },
          { command: "west update --narrow -o=--depth=1", comment: "shallow module fetch" },
          { command: "zephyr-sdk-install 0.17.3 --toolchains arm-zephyr-eabi", comment: "SDK + ARM toolchain" },
        ],
      });
    });
    await waitFor(() => {
      expect(card()).toHaveTextContent("v4 · edited by Ken");
    });

    expect(within(card()).queryByLabelText(ENV_TEXT_LABEL)).toBeNull();
    expect(card()).toHaveTextContent("zephyr-sdk-install 0.17.3");
    expect(card()).not.toHaveTextContent("ccache");
    expect(card().querySelector('[aria-live="polite"]')).toHaveTextContent("Saved as v4.");
    expect(onToast).toHaveBeenCalledExactlyOnceWith(savedToast(saved));
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses an empty block before a round trip", () => {
    draw();

    fireEvent.click(within(card()).getByRole("button", { name: ENV_EDIT }));
    fireEvent.change(within(card()).getByLabelText(ENV_TEXT_LABEL), { target: { value: "\n\n" } });
    fireEvent.click(within(card()).getByRole("button", { name: "Save as v4" }));

    expect(within(card()).getByRole("alert")).toHaveTextContent(RECIPE_EMPTY);
    expect(saveEnvRecipe).not.toHaveBeenCalled();
  });

  it("says when someone else saved first, and re-reads", async () => {
    saveEnvRecipe.mockResolvedValue({ ok: false, refusal: { code: "env_recipe_version_conflict", message: "Taken.", details: { version: 4 } } });
    draw();

    fireEvent.click(within(card()).getByRole("button", { name: ENV_EDIT }));
    fireEvent.click(within(card()).getByRole("button", { name: "Save as v4" }));

    await waitFor(() => {
      expect(within(card()).getByRole("alert")).toHaveTextContent("Not saved: someone else saved the next version first");
    });
    expect(refresh).toHaveBeenCalled();
    expect(within(card()).getByLabelText(ENV_TEXT_LABEL)).toBeInTheDocument();
  });

  it("writes the first version for a repository with none", async () => {
    saveEnvRecipe.mockResolvedValue({ ok: true, value: seededRecipe({ version: 1, commands: [{ command: "make setup", comment: null }] }) });
    draw({ profile: seededProfile({ recipe: { ok: true, value: null } }) });

    fireEvent.click(within(card()).getByRole("button", { name: ENV_ADD }));
    expect(within(card()).getByLabelText(ENV_TEXT_LABEL)).toHaveValue("");
    fireEvent.change(within(card()).getByLabelText(ENV_TEXT_LABEL), { target: { value: "make setup" } });
    fireEvent.click(within(card()).getByRole("button", { name: "Save as v1" }));

    await waitFor(() => {
      expect(saveEnvRecipe).toHaveBeenCalledExactlyOnceWith({ repo: SEEDED_REPO, commands: [{ command: "make setup" }] });
    });
    await waitFor(() => {
      expect(card()).toHaveTextContent("v1 · edited by Ken");
    });
    expect(card()).toHaveTextContent("make setup");
  });
});

describe("what it never invents", () => {
  it("draws no measured figure whatever detection says", () => {
    draw({ profile: seededProfile({ detection: { ok: true, value: seededDetection() } }) });

    expect(card().textContent).not.toMatch(/boots in/);
  });
});

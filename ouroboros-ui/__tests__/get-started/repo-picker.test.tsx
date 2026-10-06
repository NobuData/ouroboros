import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { REPO, mirrored } from "../helpers/onboarding";
import { jiraSource, source } from "../helpers/sources";

/**
 * Step 2's embedded flow (BC.6, #395): the login screen's enablement switch, one per repository
 * the connected GitHub sources name, over the tenancy API's upsert — the wizard grows no
 * enablement machinery of its own.
 */

const setRepositoryEnabled = vi.fn();

vi.mock("@/app/get-started/actions", () => ({
  setRepositoryEnabled: (formData: FormData) => setRepositoryEnabled(formData),
}));

const { RepoPicker } = await import("@/app/get-started/repo-picker");

const OWNER = { contribute: true, administer: true };
const VIEWER = { contribute: false, administer: false };

/** The card. */
const card = () => screen.getByRole("region", { name: "Pick a repo" });

/** The rows, by repository. */
const rows = () => within(card()).getAllByRole("listitem");

afterEach(() => {
  cleanup();
});

describe("the rows", () => {
  it("lists every repository the GitHub sources name — this wizard's first — with what the mirror says of each", () => {
    render(
      <RepoPicker
        abilities={OWNER}
        enablement={{ ok: true, value: mirrored() }}
        repo={REPO}
        sources={{ ok: true, value: [jiraSource(), source()] }}
        stepDone={false}
      />,
    );

    expect(within(card()).getByText("step 2 · you are here")).toBeInTheDocument();
    expect(rows().map((row) => row.getAttribute("data-repo"))).toEqual([
      "acme-robotics/helios-firmware",
      "acme-robotics/atlas-scheduler",
      "acme-robotics/helios-console",
      "acme-robotics/helios-telemetry",
    ]);
    expect(rows()[0]).toHaveTextContent("this wizard");
    expect(rows()[0]).toHaveTextContent("enabled");
    expect(rows()[2]).toHaveTextContent("off");
    expect(rows()[1]).toHaveTextContent("not recorded yet — switching on records it");
  });

  it("is the login screen's switch: a role=switch submit in a one-field form carrying the state to move to", () => {
    render(
      <RepoPicker abilities={OWNER} enablement={{ ok: true, value: mirrored() }} repo={REPO} sources={{ ok: true, value: [source()] }} stepDone />,
    );

    const on = within(rows()[0]!).getByRole("switch", { name: "Disable Ouroboros in acme-robotics/helios-firmware" });
    const off = within(rows()[1]!).getByRole("switch", { name: "Enable Ouroboros in acme-robotics/atlas-scheduler" });

    expect(on).toHaveAttribute("aria-checked", "true");
    expect(off).toHaveAttribute("aria-checked", "false");
    expect(on).toHaveAttribute("type", "submit");

    const form = on.closest("form")!;
    expect(form.querySelector<HTMLInputElement>('input[name="repo"]')!.value).toBe("acme-robotics/helios-firmware");
    expect(form.querySelector<HTMLInputElement>('input[name="enabled"]')!.value).toBe("false");
    expect(off.closest("form")!.querySelector<HTMLInputElement>('input[name="enabled"]')!.value).toBe("true");
    expect(within(card()).getByText("✓ step 2 done")).toBeInTheDocument();
  });

  it("tells a viewer why no switch will move, once, and makes every switch read-only with that reason", () => {
    render(
      <RepoPicker abilities={VIEWER} enablement={{ ok: true, value: mirrored() }} repo={REPO} sources={{ ok: true, value: [source()] }} stepDone />,
    );

    expect(within(card()).getByRole("note")).toHaveTextContent("Only an owner or admin can enable a repository.");
    for (const toggle of within(card()).getAllByRole("switch")) {
      expect(toggle).toHaveAttribute("aria-disabled", "true");
      expect(toggle).toHaveAccessibleDescription("Only an owner or admin can enable a repository.");
      expect(toggle.closest("form")).toBeNull();
    }
  });
});

describe("states", () => {
  it("says it is reading while either read is on its way", () => {
    const { unmount } = render(<RepoPicker abilities={OWNER} enablement={null} repo={REPO} sources={{ ok: true, value: [source()] }} stepDone={false} />);
    expect(within(card()).getByRole("status")).toHaveTextContent("Reading the repositories…");
    unmount();

    render(<RepoPicker abilities={OWNER} enablement={{ ok: true, value: mirrored() }} repo={REPO} sources={null} stepDone={false} />);
    expect(within(card()).getByRole("status")).toHaveTextContent("Reading the repositories…");
  });

  it("points at step 1 when no GitHub source is connected", () => {
    render(<RepoPicker abilities={OWNER} enablement={{ ok: true, value: mirrored() }} repo={null} sources={{ ok: true, value: [jiraSource()] }} stepDone={false} />);

    expect(card()).toHaveTextContent("Connect GitHub first");
    expect(within(card()).queryByRole("switch")).toBeNull();
  });

  it("says when the source names no repository", () => {
    render(
      <RepoPicker
        abilities={OWNER}
        enablement={{ ok: true, value: mirrored() }}
        repo={null}
        sources={{ ok: true, value: [source({ config: { login: "acme-robotics", repos: [] } })] }}
        stepDone={false}
      />,
    );

    expect(card()).toHaveTextContent("names no repository yet");
  });

  it("states a failed sources read as an alert, and a failed mirror read beside rows that read unrecorded", () => {
    const { unmount } = render(
      <RepoPicker abilities={OWNER} enablement={{ ok: true, value: mirrored() }} repo={REPO} sources={{ ok: false, reason: "The sources are busy." }} stepDone={false} />,
    );
    expect(within(card()).getByRole("alert")).toHaveTextContent("The sources are busy.");
    unmount();

    render(
      <RepoPicker abilities={OWNER} enablement={{ ok: false, reason: "The mirror is busy." }} repo={REPO} sources={{ ok: true, value: [source()] }} stepDone={false} />,
    );
    expect(within(card()).getByRole("alert")).toHaveTextContent("The mirror is busy.");
    for (const row of rows()) expect(row).toHaveTextContent("not recorded yet");
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <RepoPicker abilities={OWNER} enablement={{ ok: true, value: mirrored() }} repo={REPO} sources={{ ok: true, value: [source()] }} stepDone />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("wizard-picker__row--current");
  });
});

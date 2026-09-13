import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigureOutcome } from "@/app/sources/actions";
import {
  CONFIGURE_DIALOG_TITLE,
  CONFIGURE_NO_CATALOG,
  CREDENTIALS_UNSUPPORTED,
  CONFIG_INVALID,
  SAVE,
  SAVED,
  STORE_CREDENTIAL,
  credentialNote,
  credentialStored,
} from "@/app/sources/catalog";
import { CONFIGURE_LABEL, CONFIGURE_READ_ONLY } from "@/app/sources/view";

import { SEEDED_GITHUB_ID, fakeEntry, githubEntry, source } from "../helpers/sources";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateSourceConfig: vi.fn<(id: string, config: unknown) => Promise<ConfigureOutcome>>(),
  setSourceCredentials: vi.fn<(id: string, secret: string) => Promise<ConfigureOutcome>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/app/sources/actions", () => ({
  updateSourceConfig: (id: string, config: unknown) => state.updateSourceConfig(id, config),
  setSourceCredentials: (id: string, secret: string) => state.setSourceCredentials(id, secret),
}));

const { ConfigureSource } = await import("@/app/sources/configure-source");

/**
 * The configure dialog ([#141](https://github.com/NobuData/ouroboros/issues/141)): the
 * settings form is the provider's fields minus the secret, starting at what the row holds;
 * the credential form is write-only and shows a mask and never a value.
 */

function open(over: Partial<Parameters<typeof ConfigureSource>[0]> = {}): HTMLElement {
  render(<ConfigureSource entry={githubEntry()} mayAdminister source={source()} {...over} />);
  fireEvent.click(screen.getByRole("button", { name: CONFIGURE_LABEL }));

  return screen.getByRole("dialog", { name: CONFIGURE_DIALOG_TITLE });
}

beforeEach(() => {
  for (const fn of Object.values(state)) fn.mockReset();
  state.updateSourceConfig.mockResolvedValue({ ok: true, source: source() });
  state.setSourceCredentials.mockResolvedValue({ ok: true, source: source({ credentialMask: "••••3210" }) });
});

describe("the control", () => {
  it("is inert for a member, with the reason", () => {
    render(<ConfigureSource entry={githubEntry()} mayAdminister={false} source={source()} />);

    const control = screen.getByRole("button", { name: CONFIGURE_LABEL });

    expect(control).toHaveAttribute("title", CONFIGURE_READ_ONLY);
    fireEvent.click(control);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is inert when the catalog could not be read, because there is no form to draw", () => {
    render(<ConfigureSource entry={null} mayAdminister source={source()} />);

    expect(screen.getByRole("button", { name: CONFIGURE_LABEL })).toHaveAttribute("title", CONFIGURE_NO_CATALOG);
  });
});

describe("the settings form", () => {
  it("draws the provider's fields minus the secret, each starting at what the row holds", () => {
    const dialog = open();

    expect(within(dialog).getByLabelText("GitHub account")).toHaveValue("acme-robotics");
    expect(within(dialog).getByLabelText("Repositories")).toHaveValue(
      "helios-firmware\nhelios-console\nhelios-telemetry\natlas-scheduler",
    );
    expect(within(dialog).queryByLabelText("Personal access token", { selector: "input:not([name=secret])" })).toBeNull();
  });

  it("saves the settings whole, split per line, and says so", async () => {
    const dialog = open();

    fireEvent.change(within(dialog).getByLabelText("Repositories"), {
      target: { value: "helios-firmware\natlas-scheduler" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: SAVE }));

    await waitFor(() => {
      expect(state.updateSourceConfig).toHaveBeenCalledWith(SEEDED_GITHUB_ID, {
        login: "acme-robotics",
        repos: ["helios-firmware", "atlas-scheduler"],
      });
    });
    expect(await within(dialog).findByText(SAVED)).toBeInTheDocument();
  });

  it("keeps the form open on a refusal, with the sentence under the field", async () => {
    state.updateSourceConfig.mockResolvedValue({
      ok: false,
      refusal: {
        code: "ticket_source_config_invalid",
        message: "no",
        details: { fields: { login: ["GitHub account is not in the expected format"] } },
      },
    });
    const dialog = open();

    fireEvent.click(within(dialog).getByRole("button", { name: SAVE }));

    const alerts = await within(dialog).findAllByRole("alert");

    expect(alerts.map((alert) => alert.textContent)).toContain(CONFIG_INVALID);
    expect(within(dialog).getByLabelText("GitHub account")).toHaveAccessibleDescription(
      /not in the expected format/,
    );
  });
});

describe("the credential form", () => {
  it("shows the mask and never a value, over one masked input named for the provider's field", () => {
    const dialog = open();

    expect(within(dialog).getByText(credentialNote("••••"))).toBeInTheDocument();

    const input = within(dialog).getByLabelText("Personal access token");

    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveValue("");
    expect(dialog.innerHTML).not.toContain("ghp_");
  });

  it("stores the credential, echoes the mask, and clears the input", async () => {
    const dialog = open();
    const input = within(dialog).getByLabelText("Personal access token");

    fireEvent.change(input, { target: { value: "ghp_new3210" } });
    fireEvent.click(within(dialog).getByRole("button", { name: STORE_CREDENTIAL }));

    await waitFor(() => {
      expect(state.setSourceCredentials).toHaveBeenCalledWith(SEEDED_GITHUB_ID, "ghp_new3210");
    });
    expect(await within(dialog).findByText(credentialStored("••••3210"))).toBeInTheDocument();
    expect(within(dialog).getByText(credentialNote("••••3210"))).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("puts the secret field's own refusal under the input", async () => {
    state.setSourceCredentials.mockResolvedValue({
      ok: false,
      refusal: {
        code: "ticket_source_config_invalid",
        message: "no",
        details: { fields: { token: ["Personal access token must be at least 1 characters"] } },
      },
    });
    const dialog = open();

    fireEvent.change(within(dialog).getByLabelText("Personal access token"), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: STORE_CREDENTIAL }));

    await within(dialog).findAllByRole("alert");
    expect(within(dialog).getByLabelText("Personal access token")).toHaveAccessibleDescription(
      /at least 1 characters/,
    );
  });

  it("says so for a provider that takes no credential", () => {
    const noSecret = { ...fakeEntry(), fields: fakeEntry().fields.filter((f) => f.widget !== "secret") };
    const dialog = open({ entry: noSecret, source: source({ kind: "custom", config: {} }) });

    expect(within(dialog).getByText(CREDENTIALS_UNSUPPORTED)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: STORE_CREDENTIAL })).toBeNull();
  });
});

describe("closing", () => {
  it("refreshes the route only after something changed", async () => {
    const dialog = open();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(state.refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: CONFIGURE_LABEL }));

    const reopened = screen.getByRole("dialog", { name: CONFIGURE_DIALOG_TITLE });

    fireEvent.click(within(reopened).getByRole("button", { name: SAVE }));
    await within(reopened).findByText(SAVED);
    fireEvent.click(within(reopened).getByRole("button", { name: "Close" }));

    expect(state.refresh).toHaveBeenCalledOnce();
  });
});

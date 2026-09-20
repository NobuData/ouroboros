import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMMAND_LABEL,
  COMMAND_WITHHELD,
  COPIED_TOAST,
  COPYING_COMMAND,
  COPY_BLOCKED_LIVE,
  COPY_BLOCKED_REVOKED,
  COPY_COMMAND,
  DISMISS_TOAST,
  ENROLL_TITLE,
  MANAGE_TOKENS,
  MEMBER_NOTE,
  MINT_POOL_GONE,
  MTLS_NOTE,
  type MintOutcome,
  NO_POOLS_REASON,
  POOLS_UNREAD_REASON,
  POOL_LABEL,
  RESTING_TOKEN,
  type RevokeOutcome,
  TOKENS_LOADING,
  TOKENS_TITLE,
  type TokenListing,
  installsFrom,
  revokeLabel,
} from "@/app/farm/enroll";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmScreen } from "@/app/farm/farm-screen";

import {
  ADMIN_READER,
  FARM_AGENT_VERSION,
  FARM_ORIGIN,
  FARM_READ_AT,
  MEMBER_READER,
  TOKEN_SECRET,
  emptyFarm,
  enrollmentToken,
  failedFarmReadings,
  farmReadings,
  mintOutcome,
  tokenListing,
} from "../helpers/farm";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

const actions = vi.hoisted(() => ({
  mintEnrollCommand: vi.fn<(pool: string) => Promise<MintOutcome>>(),
  readEnrollmentTokens: vi.fn<() => Promise<TokenListing>>(),
  revokeEnrollmentToken: vi.fn<(id: string) => Promise<RevokeOutcome>>(),
}));

vi.mock("@/app/farm/enroll-actions", () => ({
  mintEnrollCommand: (pool: string) => actions.mintEnrollCommand(pool),
  readEnrollmentTokens: () => actions.readEnrollmentTokens(),
  revokeEnrollmentToken: (id: string) => actions.revokeEnrollmentToken(id),
}));

// The pools card (#259) writes through Server Actions too; this suite presses none of them.
vi.mock("@/app/farm/pool-actions", () => ({
  createPool: vi.fn(),
  deletePool: vi.fn(),
  updatePool: vi.fn(),
}));

/**
 * The enroll card on the farm screen (#258), end to end through the browser's half: what it shows
 * before anything is minted, that **Copy command** mints and the value reaches the clipboard and
 * *nothing else*, the toast, the token's line, a blocked copy revoking what it minted, the pool
 * selector, the sheet and its revoke, and the read-only card a member is given.
 */

/** A poll that never answers, so a case draws exactly what the server read. */
const QUIET: FarmPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** What the clipboard was handed. */
let clipboard: { writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>> };

/**
 * The card.
 *
 * @returns The enroll card's section.
 */
function card(): HTMLElement {
  return screen.getByRole("region", { name: ENROLL_TITLE });
}

/**
 * The command block's text.
 *
 * @returns What the block shows.
 */
function command(): string {
  return within(card()).getByRole("group", { name: COMMAND_LABEL }).textContent ?? "";
}

/** Press **Copy command** and let the mint and the clipboard write settle. */
async function copy(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(card()).getByRole("button", { name: COPY_COMMAND }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockReset();

  actions.mintEnrollCommand.mockImplementation((pool) => Promise.resolve(mintOutcome(pool)));
  actions.readEnrollmentTokens.mockResolvedValue(tokenListing());

  // jsdom has no clipboard and no `ClipboardItem`, so the write is `writeText`'s.
  clipboard = { writeText: vi.fn(() => Promise.resolve()) };
  vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { clipboard }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("at rest, for an administrator", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);
  });

  it("mints nothing to draw the card", () => {
    expect(actions.mintEnrollCommand).not.toHaveBeenCalled();
  });

  it("draws the mockup's card: the title, the explainer, the command's shape and the mTLS note verbatim", () => {
    expect(within(card()).getByRole("heading", { name: ENROLL_TITLE })).toBeInTheDocument();
    expect(card()).toHaveTextContent("Run this on any machine that can reach this deployment — no inbound ports needed.");
    expect(command()).toContain("--tenant acme-robotics");
    expect(command()).toContain("--pool pool-a");
    expect(command()).toContain(`--token ${RESTING_TOKEN}`);
    expect(within(card()).getByText(MTLS_NOTE)).toBeInTheDocument();
  });

  it("claims no host it has not been told, and never the mockup's get.ouroboros.dev", () => {
    expect(card()).not.toHaveTextContent("get.ouroboros.dev");
    expect(card()).not.toHaveTextContent(window.location.host);
    expect(card().querySelector(".farm-enroll__host")).toBeNull();
  });

  it("offers every pool of the workspace, and puts the chosen one in the command", () => {
    const select = within(card()).getByRole("combobox", { name: POOL_LABEL });

    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["pool-a", "pool-b"]);

    fireEvent.change(select, { target: { value: "pool-b" } });

    expect(command()).toContain("--pool pool-b");
  });

  it("sits beside the runners table in the mockup's four columns — a column it shares with the pools card (#259)", () => {
    const column = card().parentElement;

    expect(column).toHaveClass("farm-col--4", "farm__side");
    expect(column?.parentElement).toHaveClass("farm__grid");
  });
});

describe("copying the command", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);
  });

  it("mints a token for the chosen pool — once per press", async () => {
    fireEvent.change(within(card()).getByRole("combobox", { name: POOL_LABEL }), { target: { value: "pool-b" } });

    await copy();

    expect(actions.mintEnrollCommand).toHaveBeenCalledExactlyOnceWith("pool-b");
  });

  it("puts the whole command, live token included, on the clipboard", async () => {
    await copy();

    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(mintOutcome().command);
    expect(clipboard.writeText.mock.calls[0]?.[0]).toContain(TOKEN_SECRET);
  });

  it("never has the token's value anywhere in the document — before, during or after", async () => {
    let settle: (outcome: MintOutcome) => void = () => {};
    actions.mintEnrollCommand.mockReturnValue(new Promise((resolve) => (settle = resolve)));

    expect(document.documentElement.outerHTML).not.toContain(TOKEN_SECRET);

    fireEvent.click(within(card()).getByRole("button", { name: COPY_COMMAND }));

    expect(document.documentElement.outerHTML).not.toContain(TOKEN_SECRET);

    await act(async () => {
      settle(mintOutcome());
      await Promise.resolve();
    });

    expect(screen.getByText(COPIED_TOAST)).toBeInTheDocument();
    // Inspected, not assumed: markup, attributes and form values alike.
    expect(document.documentElement.outerHTML).not.toContain(TOKEN_SECRET);
    for (const field of document.querySelectorAll("input, textarea, select")) {
      expect((field as HTMLInputElement).value).not.toContain(TOKEN_SECRET);
    }
  });

  it("then shows that command masked: this deployment's origin, the pinned version and the mask", async () => {
    await copy();

    expect(command()).toContain(`${FARM_ORIGIN}/install.sh?version=${FARM_AGENT_VERSION}`);
    expect(command()).toContain("--token 'orb_enroll_••••a4b7'");
    expect(command()).not.toContain("get.ouroboros.dev");
    expect(card().querySelector(".farm-enroll__mask")).toHaveTextContent("orb_enroll_••••a4b7");
  });

  it("names the deployment's real host in the explainer, as an address", async () => {
    await copy();

    expect(card().querySelector(".farm-enroll__host")).toHaveTextContent("ouroboros.acme.dev:443");
  });

  it("says the value is a secret, in a status region, and stays until dismissed", async () => {
    await copy();

    const toast = screen.getByText(COPIED_TOAST);

    expect(toast.closest("[role='status']")).not.toBeNull();

    fireEvent.click(within(card()).getByRole("button", { name: DISMISS_TOAST }));

    expect(screen.queryByText(COPIED_TOAST)).toBeNull();
  });

  it("shows the token's TTL and remaining uses at mint time", async () => {
    // The fixture's token lives a day from the instant the page was read; hold the clock there.
    vi.spyOn(Date, "now").mockReturnValue(FARM_READ_AT);

    await copy();

    expect(card()).toHaveTextContent("Token orb_enroll_••••a4b7: expires in 24h · 1 of 1 use left");
  });

  it("says it is working while the mint is in flight, and ignores a second press", async () => {
    let settle: (outcome: MintOutcome) => void = () => {};
    actions.mintEnrollCommand.mockReturnValue(new Promise((resolve) => (settle = resolve)));

    fireEvent.click(within(card()).getByRole("button", { name: COPY_COMMAND }));

    const busy = await within(card()).findByRole("button", { name: COPYING_COMMAND });

    expect(busy).toHaveAttribute("aria-busy", "true");
    fireEvent.click(busy);
    expect(actions.mintEnrollCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle(mintOutcome());
      await Promise.resolve();
    });

    expect(within(card()).getByRole("button", { name: COPY_COMMAND })).toBeInTheDocument();
  });

  it("goes back to the shape when another pool is chosen — a minted command is about its pool", async () => {
    await copy();

    fireEvent.change(within(card()).getByRole("combobox", { name: POOL_LABEL }), { target: { value: "pool-b" } });

    expect(command()).toContain(`--token ${RESTING_TOKEN}`);
    expect(command()).toContain("--pool pool-b");
    expect(screen.queryByText(COPIED_TOAST)).toBeNull();
    // The host is the deployment's, not the pool's: once known, it stays named.
    expect(card().querySelector(".farm-enroll__host")).toHaveTextContent("ouroboros.acme.dev:443");
  });

  it("withholds a command the server could not mask, and still says where it installs from", async () => {
    actions.mintEnrollCommand.mockResolvedValue({ ...mintOutcome(), shown: null });

    await copy();

    expect(card()).toHaveTextContent(COMMAND_WITHHELD);
    expect(card()).toHaveTextContent(installsFrom(FARM_ORIGIN, FARM_AGENT_VERSION));
    expect(within(card()).queryByRole("group", { name: COMMAND_LABEL })).toBeNull();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });
});

describe("a mint that is refused", () => {
  it("says the service's sentence as an alert, copies nothing and shows no toast", async () => {
    actions.mintEnrollCommand.mockResolvedValue({ ok: false, reason: MINT_POOL_GONE });
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);

    await copy();

    expect(within(card()).getByRole("alert")).toHaveTextContent(MINT_POOL_GONE);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.queryByText(COPIED_TOAST)).toBeNull();
    expect(command()).toContain(`--token ${RESTING_TOKEN}`);
  });

  it("clears the refusal on the next press", async () => {
    actions.mintEnrollCommand.mockResolvedValueOnce({ ok: false, reason: MINT_POOL_GONE });
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);

    await copy();
    await copy();

    expect(within(card()).queryByRole("alert")).toBeNull();
    expect(screen.getByText(COPIED_TOAST)).toBeInTheDocument();
  });
});

describe("a copy the browser blocks", () => {
  beforeEach(() => {
    clipboard.writeText.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);
  });

  it("revokes the token it just minted, so nothing is left live, and says so", async () => {
    actions.revokeEnrollmentToken.mockResolvedValue({ ok: true, token: enrollmentToken({ revoked: true }) });

    await copy();

    expect(actions.revokeEnrollmentToken).toHaveBeenCalledExactlyOnceWith(enrollmentToken().id);
    expect(within(card()).getByRole("alert")).toHaveTextContent(COPY_BLOCKED_REVOKED);
    expect(screen.queryByText(COPIED_TOAST)).toBeNull();
    expect(command()).toContain(`--token ${RESTING_TOKEN}`);
  });

  it("points at Manage tokens when the revoke fails too", async () => {
    actions.revokeEnrollmentToken.mockResolvedValue({ ok: false, reason: "No." });

    await copy();

    expect(within(card()).getByRole("alert")).toHaveTextContent(COPY_BLOCKED_LIVE);
  });

  it("still has no token value in the document", async () => {
    actions.revokeEnrollmentToken.mockResolvedValue({ ok: true, token: enrollmentToken({ revoked: true }) });

    await copy();

    expect(document.documentElement.outerHTML).not.toContain(TOKEN_SECRET);
  });
});

describe("with no pool to enrol into", () => {
  it("draws the copy inert with the reason in a workspace with no pools, and no selector", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings(emptyFarm())} />);

    const control = within(card()).getByRole("button", { name: COPY_COMMAND });

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("title", NO_POOLS_REASON);
    expect(within(card()).queryByRole("combobox")).toBeNull();
    expect(command()).toContain("--pool <pool>");

    fireEvent.click(control);
    expect(actions.mintEnrollCommand).not.toHaveBeenCalled();
  });

  it("says the pools could not be read, rather than that there are none, over an unread page", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={failedFarmReadings()} />);

    expect(within(card()).getByRole("button", { name: COPY_COMMAND })).toHaveAttribute("title", POOLS_UNREAD_REASON);
  });
});

describe("a reader who may not mint", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);
  });

  it("sees the explainer, the command's shape and the mTLS note", () => {
    expect(card()).toHaveTextContent("Run this on any machine that can reach this deployment");
    expect(command()).toContain("--tenant acme-robotics");
    expect(command()).toContain(`--token ${RESTING_TOKEN}`);
    expect(within(card()).getByText(MTLS_NOTE)).toBeInTheDocument();
    expect(within(card()).getByRole("note")).toHaveTextContent(MEMBER_NOTE);
  });

  it("has no mint, no copy, no selector and no way into the token list", () => {
    expect(within(card()).queryAllByRole("button")).toHaveLength(0);
    expect(within(card()).queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(MANAGE_TOKENS)).toBeNull();
    expect(actions.mintEnrollCommand).not.toHaveBeenCalled();
    expect(actions.readEnrollmentTokens).not.toHaveBeenCalled();
  });
});

describe("the token management sheet", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);
  });

  it("reads nothing until it is opened, and starts its read in the press that opens it", async () => {
    expect(actions.readEnrollmentTokens).not.toHaveBeenCalled();
    actions.readEnrollmentTokens.mockReturnValue(new Promise(() => {}));

    fireEvent.click(within(card()).getByRole("button", { name: MANAGE_TOKENS }));

    const sheet = await screen.findByRole("dialog", { name: TOKENS_TITLE });

    expect(actions.readEnrollmentTokens).toHaveBeenCalledTimes(1);
    expect(sheet).toHaveTextContent(TOKENS_LOADING);
  });

  it("lists the tokens — masked, with pool, TTL, uses left and who minted them", async () => {
    fireEvent.click(within(card()).getByRole("button", { name: MANAGE_TOKENS }));

    const sheet = await screen.findByRole("dialog", { name: TOKENS_TITLE });
    const rows = await within(sheet).findAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("orb_enroll_••••a4b7");
    expect(rows[0]).toHaveTextContent("pool-a");
    expect(rows[0]).toHaveTextContent("expires in 24h");
    expect(rows[0]).toHaveTextContent("4 of 5 uses left");
    expect(rows[0]).toHaveTextContent("minted by Ken");
    expect(rows[1]).toHaveTextContent("expired");
  });

  it("shows a token the card just minted, and revokes it", async () => {
    const minted = enrollmentToken();
    actions.readEnrollmentTokens.mockResolvedValue(tokenListing([minted]));
    actions.revokeEnrollmentToken.mockResolvedValue({
      ok: true,
      token: { ...minted, revoked: true, revokedAt: "2026-09-19T14:05:00.000Z" },
    });

    await copy();
    fireEvent.click(within(card()).getByRole("button", { name: MANAGE_TOKENS }));

    const sheet = await screen.findByRole("dialog", { name: TOKENS_TITLE });

    await act(async () => {
      fireEvent.click(await within(sheet).findByRole("button", { name: revokeLabel(minted.masked) }));
      await Promise.resolve();
    });

    expect(actions.revokeEnrollmentToken).toHaveBeenCalledExactlyOnceWith(minted.id);
    expect(within(sheet).getByRole("listitem")).toHaveTextContent("revoked");
    expect(within(sheet).queryByRole("button", { name: revokeLabel(minted.masked) })).toBeNull();
  });

  it("reads again each time it is opened, so a token minted since is in it", async () => {
    fireEvent.click(within(card()).getByRole("button", { name: MANAGE_TOKENS }));
    fireEvent.keyDown(await screen.findByRole("dialog", { name: TOKENS_TITLE }), { key: "Escape" });
    fireEvent.click(within(card()).getByRole("button", { name: MANAGE_TOKENS }));

    await screen.findByRole("dialog", { name: TOKENS_TITLE });

    expect(actions.readEnrollmentTokens).toHaveBeenCalledTimes(2);
  });
});

describe("theming", () => {
  it("draws one markup under both palettes, for an administrator and for a member", () => {
    for (const reader of [ADMIN_READER, MEMBER_READER]) {
      const [light, dark] = renderInBothPalettes(
        <FarmScreen poll={QUIET} reader={reader} readings={farmReadings()} />,
      );

      expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
    }
  });
});

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NO_TOKENS_NOTE,
  NO_TOKENS_TITLE,
  REVOKE,
  REVOKE_FORBIDDEN,
  REVOKE_NOTE,
  REVOKING,
  type RevokeOutcome,
  TOKENS_CAPTION,
  TOKENS_FORBIDDEN,
  TOKENS_LOADING,
  TOKENS_UNREAD_TITLE,
  type TokenListing,
  revokeLabel,
  revokedNote,
} from "@/app/farm/enroll";
import { TokenList } from "@/app/farm/token-list";

import { enrollmentToken, tokenListing } from "../helpers/farm";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

const actions = vi.hoisted(() => ({
  revokeEnrollmentToken: vi.fn<(id: string) => Promise<RevokeOutcome>>(),
}));

vi.mock("@/app/farm/enroll-actions", () => ({
  revokeEnrollmentToken: (id: string) => actions.revokeEnrollmentToken(id),
}));

/**
 * The token list (#258) — the one list the sheet and the settings tab both mount: its states,
 * its rows, and the revoke landing in place with what it did said out loud.
 */

/** The live token's mask, and the expired one's. */
const LIVE = "orb_enroll_••••a4b7";
const EXPIRED = "orb_enroll_••••c0de";

/**
 * The list over a listing it may change, as both of its callers hold it.
 *
 * @param props.initial The listing to start from.
 * @returns The list.
 */
function Held({ initial }: Readonly<{ initial: TokenListing | null }>) {
  const [listing, setListing] = useState(initial);

  return <TokenList listing={listing} onListing={setListing} />;
}

/**
 * Press a token's revoke and let the answer land.
 *
 * @param masked The token's mask.
 */
async function revoke(masked: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: revokeLabel(masked) }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  actions.revokeEnrollmentToken.mockReset();
});

describe("what stands where the list would be", () => {
  it("says it is reading while the first read is in flight", () => {
    render(<Held initial={null} />);

    expect(screen.getByText(TOKENS_LOADING)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("says why a listing could not be read", () => {
    render(<Held initial={{ ok: false, reason: TOKENS_FORBIDDEN }} />);

    expect(screen.getByText(TOKENS_UNREAD_TITLE)).toBeInTheDocument();
    expect(screen.getByText(TOKENS_FORBIDDEN)).toBeInTheDocument();
  });

  it("says how a token comes to exist, over a workspace that has minted none", () => {
    render(<Held initial={tokenListing([])} />);

    expect(screen.getByText(NO_TOKENS_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_TOKENS_NOTE)).toBeInTheDocument();
  });
});

describe("the rows", () => {
  beforeEach(() => {
    render(<Held initial={tokenListing()} />);
  });

  it("are a named list, newest first as served", () => {
    const rows = within(screen.getByRole("list", { name: TOKENS_CAPTION })).getAllByRole("listitem");

    expect(rows.map((row) => row.querySelector(".farm-tokens__mask")?.textContent)).toEqual([LIVE, EXPIRED]);
  });

  it("offer a revoke on the live token and none on the expired one, which recedes", () => {
    const [live, expired] = screen.getAllByRole("listitem");

    expect(within(live!).getByRole("button", { name: revokeLabel(LIVE) })).toHaveTextContent(REVOKE);
    expect(live).not.toHaveClass("farm-tokens__row--dead");
    expect(within(expired!).queryByRole("button")).toBeNull();
    expect(expired).toHaveClass("farm-tokens__row--dead");
  });

  it("say once what a revoke does — and that certificates already issued survive it", () => {
    expect(screen.getByText(REVOKE_NOTE)).toBeInTheDocument();
    expect(REVOKE_NOTE).toMatch(/keep their certificates/);
  });
});

describe("revoking", () => {
  it("replaces the row in place and says what it did, with the uses the token had spent", async () => {
    const revoked = enrollmentToken({ maxUses: 5, uses: 1, revoked: true });
    actions.revokeEnrollmentToken.mockResolvedValue({ ok: true, token: revoked });
    render(<Held initial={tokenListing()} />);

    const before = screen.getAllByRole("listitem")[0];

    await revoke(LIVE);

    const [row] = screen.getAllByRole("listitem");

    expect(actions.revokeEnrollmentToken).toHaveBeenCalledExactlyOnceWith(revoked.id);
    expect(row).toBe(before);
    expect(row).toHaveTextContent("revoked");
    expect(row).toHaveClass("farm-tokens__row--dead");
    expect(within(row!).queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(revokedNote(revoked));
  });

  it("says a refusal as an alert and leaves the token as it was", async () => {
    actions.revokeEnrollmentToken.mockResolvedValue({ ok: false, reason: REVOKE_FORBIDDEN });
    render(<Held initial={tokenListing()} />);

    await revoke(LIVE);

    expect(screen.getByRole("alert")).toHaveTextContent(REVOKE_FORBIDDEN);
    expect(screen.getByRole("button", { name: revokeLabel(LIVE) })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("expires in 24h");
  });

  it("says it is working while in flight, and ignores a second press", async () => {
    let settle: (outcome: RevokeOutcome) => void = () => {};
    actions.revokeEnrollmentToken.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    render(<Held initial={tokenListing()} />);

    fireEvent.click(screen.getByRole("button", { name: revokeLabel(LIVE) }));

    const busy = await screen.findByText(REVOKING);

    expect(busy.closest("button")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(busy);
    expect(actions.revokeEnrollmentToken).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle({ ok: true, token: enrollmentToken({ revoked: true }) });
      await Promise.resolve();
    });

    expect(screen.queryByText(REVOKING)).toBeNull();
  });
});

describe("theming", () => {
  it("draws one markup under both palettes", () => {
    const [light, dark] = renderInBothPalettes(<Held initial={tokenListing()} />);

    expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
  });
});

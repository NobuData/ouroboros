import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";
import {
  OPEN_BUILD_FARM,
  type RevokeOutcome,
  TOKENS_CAPTION,
  TOKENS_FORBIDDEN,
  TOKENS_LOADING,
  TOKENS_SUBLINE,
  TOKENS_TITLE,
  revokeLabel,
  tokensReadOnlyHead,
} from "@/app/farm/enroll";
import { FarmTokensScreen } from "@/app/farm/farm-tokens-screen";
import { FarmTokensSkeleton, LOADING_LABEL } from "@/app/farm/farm-tokens-skeleton";
import { BUILD_FARM_PATH } from "@/app/paths";

import { enrollmentToken, tokenListing } from "../helpers/farm";
import { membership, sessionUser } from "../helpers/login";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

const state = vi.hoisted(() => ({
  requireWorkspace: vi.fn(),
  readTokenListing: vi.fn(),
  revokeEnrollmentToken: vi.fn<(id: string) => Promise<RevokeOutcome>>(),
}));

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => state.requireWorkspace() }));
vi.mock("@/app/farm/token-data", () => ({ readTokenListing: () => state.readTokenListing() }));
vi.mock("@/app/farm/enroll-actions", () => ({
  revokeEnrollmentToken: (id: string) => state.revokeEnrollmentToken(id),
}));

const Page = (await import("@/app/(app)/settings/farm-tokens/page")).default;

/**
 * The settings section's **Farm tokens** tab (#258, by its amendment — decision S2): the same
 * token list the enroll card's sheet draws, mounted in the settings frame; read only for a
 * reader who may have it; and told by role to one who may not.
 */

/**
 * What the gate hands back, for a reader holding these roles.
 *
 * @param roles The roles.
 * @returns The workspace.
 */
function access(roles: Role[]) {
  return {
    session: { user: sessionUser(), memberships: [membership({ roles })], tenantSuggestion: null },
    membership: membership({ roles }),
  };
}

beforeEach(() => {
  for (const mock of Object.values(state)) mock.mockReset();

  state.requireWorkspace.mockResolvedValue(access(["owner"]));
  state.readTokenListing.mockResolvedValue(tokenListing());
});

describe("the screen", () => {
  it("is the settings frame with the underline on Farm tokens", () => {
    render(<FarmTokensScreen listing={tokenListing()} mayAdminister workspaceName="Acme Robotics" />);

    expect(screen.getByRole("main")).toHaveClass("settings");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TOKENS_TITLE);
    expect(screen.getByText(TOKENS_SUBLINE)).toBeInTheDocument();
    expect(screen.getByText("Settings · Acme Robotics")).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Settings" })).getByRole("link", { name: "Farm tokens" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("mounts the sheet's own list, rows and revoke included", async () => {
    const revoked = enrollmentToken({ maxUses: 5, uses: 1, revoked: true });
    state.revokeEnrollmentToken.mockResolvedValue({ ok: true, token: revoked });
    render(<FarmTokensScreen listing={tokenListing()} mayAdminister workspaceName="Acme Robotics" />);

    expect(within(screen.getByRole("list", { name: TOKENS_CAPTION })).getAllByRole("listitem")).toHaveLength(2);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: revokeLabel(revoked.masked) }));
      await Promise.resolve();
    });

    expect(state.revokeEnrollmentToken).toHaveBeenCalledExactlyOnceWith(revoked.id);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("revoked");
  });

  it("leads back to where a token is minted", () => {
    render(<FarmTokensScreen listing={tokenListing()} mayAdminister workspaceName="Acme Robotics" />);

    expect(screen.getByRole("link", { name: OPEN_BUILD_FARM })).toHaveAttribute("href", BUILD_FARM_PATH);
  });

  it("tells a reader who may not administer so, once, by role — and draws no list", () => {
    render(<FarmTokensScreen listing={null} mayAdminister={false} role="member" workspaceName="Acme Robotics" />);

    const note = screen.getByRole("note");

    expect(note).toHaveTextContent(tokensReadOnlyHead("member"));
    expect(note).toHaveTextContent(TOKENS_FORBIDDEN);
    expect(screen.queryByRole("list", { name: TOKENS_CAPTION })).toBeNull();
    expect(screen.queryByText(TOKENS_LOADING)).toBeNull();
  });

  it("draws one markup under both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <FarmTokensScreen listing={tokenListing()} mayAdminister workspaceName="Acme Robotics" />,
    );

    expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
  });
});

describe("the route", () => {
  it.each<[Role]>([["owner"], ["admin"]])("reads the listing for an %s and draws it", async (role) => {
    state.requireWorkspace.mockResolvedValue(access([role]));

    render(await Page());

    expect(state.readTokenListing).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("list", { name: TOKENS_CAPTION })).toBeInTheDocument();
  });

  it.each<[Role]>([["member"], ["viewer"]])("reads nothing for a %s — the service would refuse it", async (role) => {
    state.requireWorkspace.mockResolvedValue(access([role]));

    render(await Page());

    expect(state.readTokenListing).not.toHaveBeenCalled();
    expect(screen.getByRole("note")).toHaveTextContent(tokensReadOnlyHead(role));
  });

  it("reads nothing when the gate refuses — its redirect is the answer", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    state.requireWorkspace.mockRejectedValue(redirect);

    await expect(Page()).rejects.toBe(redirect);
    expect(state.readTokenListing).not.toHaveBeenCalled();
  });

  it("names the workspace the gate returned in the eyebrow", async () => {
    render(await Page());

    expect(screen.getByText(`Settings · ${membership().name}`)).toBeInTheDocument();
  });
});

describe("the loading state", () => {
  it("is what the route's loading.tsx draws", async () => {
    const Loading = (await import("@/app/(app)/settings/farm-tokens/loading")).default;

    render(<Loading />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toBeInTheDocument();
  });


  it("is the real frame, busy and named, waiting in the list's own words", () => {
    render(<FarmTokensSkeleton />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TOKENS_TITLE);
    expect(screen.getByText(TOKENS_LOADING)).toBeInTheDocument();
  });
});

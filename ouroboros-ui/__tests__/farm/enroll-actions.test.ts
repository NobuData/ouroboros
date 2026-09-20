import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  MINT_FAILED,
  MINT_FORBIDDEN,
  MINT_POOL_GONE,
  MINT_UNAVAILABLE,
  REVOKE_FAILED,
  REVOKE_FORBIDDEN,
  REVOKE_GONE,
} from "@/app/farm/enroll";

import {
  FARM_AGENT_VERSION,
  FARM_ORIGIN,
  TOKEN_SECRET,
  enrollmentToken,
  mintedCommand,
  tokenListing,
} from "../helpers/farm";

const api = vi.hoisted(() => ({
  enrollCommand: vi.fn(),
  revokeToken: vi.fn(),
  readTokenListing: vi.fn(),
}));

vi.mock("@/app/api/farm", () => ({
  farm: {
    enrollCommand: (pool: string) => api.enrollCommand(pool),
    revokeToken: (id: string) => api.revokeToken(id),
  },
}));
vi.mock("@/app/farm/token-data", () => ({ readTokenListing: () => api.readTokenListing() }));

const actions = await import("@/app/farm/enroll-actions");

/**
 * The enroll flow's Server Actions (#258): the mint answers the command whole for the clipboard
 * and **masked for everything else**, every refusal is a value with its own sentence, and
 * anything that is not an `ApiError` — Next.js's redirect above all — travels.
 */

/**
 * A refusal, as the typed client throws one.
 *
 * @param status The HTTP status.
 * @param code The service's code.
 * @returns The error.
 */
function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, `${code} message`);
}

/** What the service answers a mint with. */
const MINTED = {
  command: mintedCommand(),
  origin: FARM_ORIGIN,
  version: FARM_AGENT_VERSION,
  tenant: "acme-robotics",
  pool: "pool-a",
  token: enrollmentToken(),
};

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});

describe("mintEnrollCommand", () => {
  it("mints for the pool asked for, and answers the command whole for the clipboard", async () => {
    api.enrollCommand.mockResolvedValue(MINTED);

    const outcome = await actions.mintEnrollCommand("pool-a");

    expect(api.enrollCommand).toHaveBeenCalledExactlyOnceWith("pool-a");
    expect(outcome).toMatchObject({ ok: true, command: MINTED.command });
  });

  it("answers the shown command already masked, so no component ever has to mask one", async () => {
    api.enrollCommand.mockResolvedValue(MINTED);

    const outcome = await actions.mintEnrollCommand("pool-a");

    expect(outcome.ok && outcome.shown).toBe(mintedCommand("pool-a", MINTED.token.masked));
    expect(outcome.ok && outcome.shown).not.toContain(TOKEN_SECRET);
  });

  it("carries the value in exactly one field", async () => {
    api.enrollCommand.mockResolvedValue(MINTED);

    const outcome = await actions.mintEnrollCommand("pool-a");
    const { command, ...rest } = outcome as Extract<typeof outcome, { ok: true }>;

    expect(command).toContain(TOKEN_SECRET);
    expect(JSON.stringify(rest)).not.toContain(TOKEN_SECRET);
  });

  it("hands back the origin, the pinned version and the masked token the card draws", async () => {
    api.enrollCommand.mockResolvedValue(MINTED);

    await expect(actions.mintEnrollCommand("pool-a")).resolves.toMatchObject({
      origin: FARM_ORIGIN,
      version: FARM_AGENT_VERSION,
      token: MINTED.token,
    });
  });

  it("withholds a command it cannot mask with certainty, rather than showing it", async () => {
    api.enrollCommand.mockResolvedValue({ ...MINTED, command: `install --secret '${TOKEN_SECRET}'` });

    await expect(actions.mintEnrollCommand("pool-a")).resolves.toMatchObject({ ok: true, shown: null });
  });

  it.each([
    [403, "forbidden", MINT_FORBIDDEN],
    [404, "farm_pool_not_found", MINT_POOL_GONE],
    [404, "farm_enroll_command_unavailable", MINT_UNAVAILABLE],
    [500, "internal_error", MINT_FAILED],
  ])("turns a %i %s into its sentence — a value, not a throw", async (status, code, reason) => {
    api.enrollCommand.mockRejectedValue(refusal(status, code));

    await expect(actions.mintEnrollCommand("pool-a")).resolves.toEqual({ ok: false, reason });
  });

  it("lets the redirect signal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    api.enrollCommand.mockRejectedValue(redirect);

    await expect(actions.mintEnrollCommand("pool-a")).rejects.toBe(redirect);
  });
});

describe("readEnrollmentTokens", () => {
  it("answers the one reader's listing — the settings route's, in the same shape", async () => {
    api.readTokenListing.mockResolvedValue(tokenListing());

    await expect(actions.readEnrollmentTokens()).resolves.toEqual(tokenListing());
  });
});

describe("revokeEnrollmentToken", () => {
  it("revokes by id and answers the token as it now stands", async () => {
    const revoked = enrollmentToken({ revoked: true });
    api.revokeToken.mockResolvedValue(revoked);

    await expect(actions.revokeEnrollmentToken(revoked.id)).resolves.toEqual({ ok: true, token: revoked });
    expect(api.revokeToken).toHaveBeenCalledExactlyOnceWith(revoked.id);
  });

  it.each([
    [403, "forbidden", REVOKE_FORBIDDEN],
    [404, "farm_enrollment_token_not_found", REVOKE_GONE],
    [500, "internal_error", REVOKE_FAILED],
  ])("turns a %i %s into its sentence", async (status, code, reason) => {
    api.revokeToken.mockRejectedValue(refusal(status, code));

    await expect(actions.revokeEnrollmentToken("id")).resolves.toEqual({ ok: false, reason });
  });

  it("lets the redirect signal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    api.revokeToken.mockRejectedValue(redirect);

    await expect(actions.revokeEnrollmentToken("id")).rejects.toBe(redirect);
  });
});

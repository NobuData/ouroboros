import { describe, expect, it } from "vitest";

import {
  COPIED_TOAST,
  CREATED_BY_DELETED,
  ENROLL_UNAVAILABLE_CODE,
  FORBIDDEN_CODE,
  MINT_FAILED,
  MINT_FORBIDDEN,
  MINT_POOL_GONE,
  MINT_UNAVAILABLE,
  MTLS_NOTE,
  NAME_UNREAD,
  POOL_DELETED,
  POOL_NOT_FOUND_CODE,
  RESTING_TOKEN,
  REVOKE_FAILED,
  REVOKE_FORBIDDEN,
  REVOKE_GONE,
  THIS_DEPLOYMENT,
  TOKEN_NOT_FOUND_CODE,
  commandParts,
  explainer,
  hostOf,
  installsFrom,
  maskedCommand,
  mintRefusal,
  poolNames,
  restingCommand,
  revokeLabel,
  revokeRefusal,
  revokedNote,
  tokenLine,
  tokenRows,
  tokenState,
  tokenWindow,
  tokensReadOnlyHead,
  usesLeft,
  withToken,
} from "@/app/farm/enroll";

import {
  FARM_AGENT_VERSION,
  FARM_ORIGIN,
  FARM_READ_AT,
  TOKEN_SECRET,
  enrollmentToken,
  mintedCommand,
  seededFarm,
  tokenListing,
} from "../helpers/farm";

/**
 * Every decision the enroll card and the token list make (#258), as values: what the command
 * looks like before and after a mint, **that the mask can never let a value through**, what a
 * token's window and uses read as, and what each refusal says.
 */

/** A second, in milliseconds. */
const SECOND = 1000;

/** An hour, in milliseconds. */
const HOUR = 3600 * SECOND;

describe("the words that are acceptance criteria", () => {
  it("keeps the mTLS note verbatim from the mockup", () => {
    expect(MTLS_NOTE).toBe("The agent connects outbound over mTLS and registers itself.");
  });

  it("says the copied value is a secret, and claims nothing about the clipboard", () => {
    expect(COPIED_TOAST).toMatch(/secret/i);
    // No lifetime, no clearing, no *only*: the UI can keep none of those promises.
    expect(COPIED_TOAST).not.toMatch(/clipboard|clear|expire|second|minute|forget|only/i);
  });
});

describe("the explainer", () => {
  it("names no host before a mint has answered with one", () => {
    const sentence = explainer(null);

    expect(sentence.host).toBe(THIS_DEPLOYMENT);
    expect(sentence.mono).toBe(false);
    expect(`${sentence.before}${sentence.host}${sentence.after}`).toBe(
      "Run this on any machine that can reach this deployment — no inbound ports needed.",
    );
  });

  it("names the deployment's real host once it is known, as an address", () => {
    const sentence = explainer(hostOf(FARM_ORIGIN));

    expect(sentence.host).toBe("ouroboros.acme.dev:443");
    expect(sentence.mono).toBe(true);
  });

  it("always says the port, because which port must be reachable is what the sentence is for", () => {
    expect(hostOf("https://ouroboros.acme.dev")).toBe("ouroboros.acme.dev:443");
    expect(hostOf("https://farm.lan:8443/")).toBe("farm.lan:8443");
  });

  it("keeps the placeholder for an origin that is not a URL, rather than printing it", () => {
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("the command at rest", () => {
  it("is the mockup's shape, claiming the workspace and the pool and no origin", () => {
    expect(restingCommand("acme-robotics", "pool-a")).toBe(
      [
        "curl -fsSL <this deployment>/install.sh | sh -s -- \\",
        "  --tenant acme-robotics \\",
        "  --pool pool-a \\",
        `  --token ${RESTING_TOKEN}`,
      ].join("\n"),
    );
  });

  it("never reads get.ouroboros.dev — the mockup's host is design shorthand", () => {
    expect(restingCommand("acme-robotics", "pool-a")).not.toContain("get.ouroboros.dev");
  });

  it("says <pool> where there is no pool to name", () => {
    expect(restingCommand("acme-robotics", null)).toContain("--pool <pool>");
  });
});

describe("masking the command as minted", () => {
  const masked = enrollmentToken().masked;

  it("replaces the token's value with its mask and keeps everything before it", () => {
    const shown = maskedCommand(mintedCommand(), masked);

    expect(shown).toBe(mintedCommand("pool-a", masked));
    expect(shown).toContain(`${FARM_ORIGIN}/install.sh?version=${FARM_AGENT_VERSION}`);
    expect(shown).toContain("--pool 'pool-a'");
  });

  it("never lets the value through", () => {
    expect(maskedCommand(mintedCommand(), masked)).not.toContain(TOKEN_SECRET);
  });

  it("drops anything that followed the flag, whatever it was", () => {
    const shown = maskedCommand(`${mintedCommand()} --label '${TOKEN_SECRET}'`, masked);

    expect(shown).not.toContain(TOKEN_SECRET);
    expect(shown?.endsWith(`--token '${masked}'`)).toBe(true);
  });

  it("fails closed on a command with no --token flag", () => {
    expect(maskedCommand(`curl https://x | sh -s -- --secret '${TOKEN_SECRET}'`, masked)).toBeNull();
  });

  it("fails closed when a token-shaped value sits before the flag", () => {
    expect(maskedCommand(`curl 'https://x/?t=${TOKEN_SECRET}' | sh -s -- --token 'abc'`, masked)).toBeNull();
  });

  it("does not mistake a longer flag for the token's", () => {
    // `--token-ttl 60` is not `--token `: the flag's trailing space is part of it.
    expect(maskedCommand("sh -s -- --token-ttl 60", masked)).toBeNull();
  });
});

describe("splitting a shown command around its mask", () => {
  it("hands back what is before the mask, the mask, and what is after", () => {
    expect(commandParts(`a --token '${RESTING_TOKEN}'`, RESTING_TOKEN)).toEqual({
      before: "a --token '",
      mask: RESTING_TOKEN,
      after: "'",
    });
  });

  it("is all *before* for a command that does not carry the mask", () => {
    expect(commandParts("curl", RESTING_TOKEN)).toEqual({ before: "curl", mask: "", after: "" });
  });
});

describe("a refused mint", () => {
  it.each([
    [FORBIDDEN_CODE, MINT_FORBIDDEN],
    [POOL_NOT_FOUND_CODE, MINT_POOL_GONE],
    [ENROLL_UNAVAILABLE_CODE, MINT_UNAVAILABLE],
    ["internal_error", MINT_FAILED],
  ])("says its own sentence for %s", (code, sentence) => {
    expect(mintRefusal(code)).toBe(sentence);
  });

  it("always answers whether anything was minted — the question a refusal here leaves open", () => {
    for (const sentence of [MINT_POOL_GONE, MINT_UNAVAILABLE, MINT_FAILED]) {
      expect(sentence).toMatch(/Nothing was (minted|created)/);
    }
  });
});

describe("a refused revoke", () => {
  it.each([
    [FORBIDDEN_CODE, REVOKE_FORBIDDEN],
    [TOKEN_NOT_FOUND_CODE, REVOKE_GONE],
    ["internal_error", REVOKE_FAILED],
  ])("says its own sentence for %s", (code, sentence) => {
    expect(revokeRefusal(code)).toBe(sentence);
  });
});

describe("where a token stands", () => {
  it("is live while it is inside its window with a use left", () => {
    expect(tokenState(enrollmentToken(), FARM_READ_AT)).toBe("live");
  });

  it("is expired at the instant its window closes, and after", () => {
    const token = enrollmentToken();

    expect(tokenState(token, Date.parse(token.expiresAt))).toBe("expired");
    expect(tokenState(token, Date.parse(token.expiresAt) + SECOND)).toBe("expired");
  });

  it("is spent once every use is taken", () => {
    expect(tokenState(enrollmentToken({ maxUses: 5, uses: 5 }), FARM_READ_AT)).toBe("spent");
  });

  it("is revoked before it is anything else — the one state a person chose", () => {
    const token = enrollmentToken({ revoked: true, uses: 1, expiresAt: "2020-01-01T00:00:00.000Z" });

    expect(tokenState(token, FARM_READ_AT)).toBe("revoked");
  });

  it("is expired before it is spent: past its window it admits nobody, whatever is left", () => {
    const token = enrollmentToken({ uses: 1, expiresAt: "2020-01-01T00:00:00.000Z" });

    expect(tokenState(token, FARM_READ_AT)).toBe("expired");
  });

  it("does not vouch for a window it cannot parse", () => {
    expect(tokenState(enrollmentToken({ expiresAt: "soon" }), FARM_READ_AT)).toBe("expired");
  });
});

describe("a token's window", () => {
  it("reads 24h at the moment a day-long token is minted — not 1d, and not 23h", () => {
    expect(tokenWindow(enrollmentToken(), FARM_READ_AT)).toBe("expires in 24h");
    // A few milliseconds in, it is still the day it was minted with.
    expect(tokenWindow(enrollmentToken(), FARM_READ_AT + 40)).toBe("expires in 24h");
  });

  it("counts down in whole units, rounded down", () => {
    expect(tokenWindow(enrollmentToken(), FARM_READ_AT + SECOND)).toBe("expires in 23h");
    expect(tokenWindow(enrollmentToken(), FARM_READ_AT + 23 * HOUR + 30 * 60 * SECOND)).toBe("expires in 30m");
    expect(tokenWindow(enrollmentToken(), FARM_READ_AT + 24 * HOUR - 40 * SECOND)).toBe("expires in 40s");
  });

  it("says days for a token with more than two of them left", () => {
    const month = enrollmentToken({ expiresAt: "2026-10-19T14:02:00.000Z" });

    expect(tokenWindow(month, FARM_READ_AT)).toBe("expires in 30d");
  });

  it("says expired and revoked in a word", () => {
    expect(tokenWindow(enrollmentToken({ expiresAt: "2026-09-18T14:02:00.000Z" }), FARM_READ_AT)).toBe("expired");
    expect(tokenWindow(enrollmentToken({ revoked: true }), FARM_READ_AT)).toBe("revoked");
  });
});

describe("the line under the card's actions", () => {
  it("shows the TTL and the remaining uses at mint time", () => {
    expect(tokenLine(enrollmentToken(), FARM_READ_AT)).toBe(
      "Token orb_enroll_••••a4b7: expires in 24h · 1 of 1 use left",
    );
  });

  it("reads the diagram's 4 of 5 for a rack's token", () => {
    expect(tokenLine(enrollmentToken({ maxUses: 5, uses: 1 }), FARM_READ_AT)).toContain("4 of 5 uses left");
  });

  it("never counts below zero, whatever the counters say", () => {
    expect(usesLeft(enrollmentToken({ maxUses: 1, uses: 3 }))).toBe(0);
  });
});

describe("the token list's rows", () => {
  it("draws the diagram's two rows: a live token with its minter, and an expired one", () => {
    const [live, expired] = tokenRows(tokenListing(), FARM_READ_AT);

    expect(live).toEqual({
      id: enrollmentToken().id,
      masked: "orb_enroll_••••a4b7",
      pool: "pool-a",
      window: "expires in 24h",
      uses: "4 of 5 uses left",
      createdBy: "minted by Ken",
      state: "live",
      revocable: true,
    });
    expect(expired).toMatchObject({ pool: "pool-b", window: "expired", uses: "1 of 1 use left", state: "expired" });
  });

  it("offers a revoke only where it changes something", () => {
    const rows = tokenRows(
      tokenListing([
        enrollmentToken(),
        enrollmentToken({ id: "spent", uses: 1 }),
        enrollmentToken({ id: "expired", expiresAt: "2026-09-18T14:02:00.000Z" }),
        enrollmentToken({ id: "revoked", revoked: true }),
      ]),
      FARM_READ_AT,
    );

    expect(rows.map((row) => [row.state, row.revocable])).toEqual([
      ["live", true],
      ["spent", false],
      ["expired", false],
      ["revoked", false],
    ]);
  });

  it("says a former member for somebody deleted, or no longer in the workspace", () => {
    const rows = tokenRows(
      tokenListing([enrollmentToken({ createdBy: null }), enrollmentToken({ id: "left", createdBy: "user-gone" })]),
      FARM_READ_AT,
    );

    expect(rows.map((row) => row.createdBy)).toEqual([
      `minted by ${CREATED_BY_DELETED}`,
      `minted by ${CREATED_BY_DELETED}`,
    ]);
  });

  it("says nothing about who when the members could not be read — unread is not gone", () => {
    const [row] = tokenRows({ ...tokenListing([enrollmentToken()]), people: null }, FARM_READ_AT);

    expect(row?.createdBy).toBeNull();
  });

  it("tells a deleted pool from pools that could not be read", () => {
    const token = enrollmentToken({ poolId: "5eed0400-0000-4000-8000-0000000000ff" });

    expect(tokenRows(tokenListing([token]), FARM_READ_AT)[0]?.pool).toBe(POOL_DELETED);
    expect(tokenRows({ ...tokenListing([token]), pools: null }, FARM_READ_AT)[0]?.pool).toBe(NAME_UNREAD);
  });

  it("looks pools up by id, from the pools a page holds", () => {
    expect(poolNames(seededFarm().pools)).toEqual({
      "5eed0400-0000-4000-8000-0000000000b1": "pool-a",
      "5eed0400-0000-4000-8000-0000000000b2": "pool-b",
    });
  });
});

describe("a revoke landing in the list", () => {
  it("replaces the row in place, so the list neither reorders nor re-reads", () => {
    const listing = tokenListing();
    const revoked = enrollmentToken({ maxUses: 5, uses: 1, revoked: true });

    const next = withToken(listing, revoked);

    expect(next.ok && next.tokens.map((token) => token.id)).toEqual(listing.tokens.map((token) => token.id));
    expect(next.ok && next.tokens[0]?.revoked).toBe(true);
    expect(next.ok && next.tokens[1]).toBe(listing.tokens[1]);
  });

  it("leaves a listing that could not be read as it is", () => {
    const failed = { ok: false, reason: "No." } as const;

    expect(withToken(failed, enrollmentToken())).toBe(failed);
  });

  it("says what it did, with the number an incident turns on", () => {
    expect(revokedNote(enrollmentToken({ uses: 0 }))).toBe("Revoked orb_enroll_••••a4b7. It had enrolled 0 machines.");
    expect(revokedNote(enrollmentToken({ uses: 1 }))).toContain("1 machine.");
  });

  it("names each revoke by its token, so two in one list are two names", () => {
    expect(revokeLabel("orb_enroll_••••a4b7")).toBe("Revoke orb_enroll_••••a4b7");
  });
});

describe("the smaller sentences", () => {
  it("still says the origin and the pinned version when the command is withheld", () => {
    expect(installsFrom(FARM_ORIGIN, FARM_AGENT_VERSION)).toBe(
      "It installs agent 0.9.0 from https://ouroboros.acme.dev.",
    );
  });

  it("names the reader's role in the settings page's read-only note", () => {
    expect(tokensReadOnlyHead("member")).toBe("Viewing farm tokens as a member.");
    expect(tokensReadOnlyHead("admin")).toBe("Viewing farm tokens as an admin.");
  });
});

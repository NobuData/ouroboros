import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  BACKLOG_TOKEN_FAILED,
  BACKLOG_TOKEN_FORBIDDEN,
  BACKLOG_TOKEN_SHAPE,
} from "@/app/sources/view";

import { NO_BACKLOG_TOKEN, backlogToken } from "../helpers/sources";

const set = vi.fn();
const clear = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/sources", () => ({ sources: {} }));
vi.mock("@/app/api/github-token", () => ({
  githubToken: { set: (token: string) => set(token), clear: () => clear() },
}));

const { clearBacklogToken, setBacklogToken } = await import("@/app/sources/actions");

/**
 * The two writes to the backlog token
 * ([#1250](https://github.com/NobuData/ouroboros/issues/1250)). A refusal is answered in this
 * application's words, so nothing the service says about a rejected secret reaches the page.
 */

/** What the service might say about a refused value — which must not be repeated. */
const SERVICE_WORDS = "token ghp_leaked is not a GitHub token";

beforeEach(() => {
  set.mockReset().mockResolvedValue(backlogToken());
  clear.mockReset().mockResolvedValue(NO_BACKLOG_TOKEN);
});

describe("setBacklogToken", () => {
  it("stores the token and answers its masked state", async () => {
    expect(await setBacklogToken("ghp_typed")).toEqual({ ok: true, token: backlogToken() });
    expect(set).toHaveBeenCalledExactlyOnceWith("ghp_typed");
  });

  it("drops the whitespace a copy left around it", async () => {
    await setBacklogToken("  ghp_typed\n");

    expect(set).toHaveBeenCalledExactlyOnceWith("ghp_typed");
  });

  it.each([
    [422, BACKLOG_TOKEN_SHAPE],
    [403, BACKLOG_TOKEN_FORBIDDEN],
    [503, BACKLOG_TOKEN_FAILED],
  ])("answers a %i in its own words, never the service's", async (status, sentence) => {
    set.mockRejectedValue(new ApiError(status, "refused", SERVICE_WORDS));

    expect(await setBacklogToken("ghp_typed")).toEqual({ ok: false, reason: sentence });
  });

  it("lets anything that is not the service's answer through", async () => {
    set.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(setBacklogToken("ghp_typed")).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("clearBacklogToken", () => {
  it("removes the token and answers the not-configured state", async () => {
    expect(await clearBacklogToken()).toEqual({ ok: true, token: NO_BACKLOG_TOKEN });
    expect(clear).toHaveBeenCalledOnce();
  });

  it("answers a refusal with a sentence", async () => {
    clear.mockRejectedValue(new ApiError(403, "forbidden", SERVICE_WORDS));

    expect(await clearBacklogToken()).toEqual({ ok: false, reason: BACKLOG_TOKEN_FORBIDDEN });
  });
});

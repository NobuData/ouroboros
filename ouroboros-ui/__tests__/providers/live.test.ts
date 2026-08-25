import { describe, expect, it } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { ProviderTest } from "@/app/api/providers";
import {
  CHIP_LEAVE_MS,
  DISCOVERY_FAILED_CODE,
  GLYPHS,
  PULL_FAILED,
  PULL_READ_ONLY,
  REFRESH_FAILED,
  REFRESH_READ_ONLY,
  RETRY_DELAY_MS,
  TEST_FAILED,
  TEST_GONE,
  TEST_READ_ONLY,
  aliasLinks,
  anyInFlight,
  chipDiff,
  discoverRefusal,
  newlyPulled,
  pullRefusal,
  pullRowState,
  pullValueText,
  retryDelayFor,
  sizeTag,
  testNote,
  testRefusal,
} from "@/app/providers/live";

import { pullRecord } from "../helpers/providers";

/**
 * The live surfaces' decisions ([#230](https://github.com/NobuData/ouroboros/issues/230)),
 * each a pure function: the note the foot prints, the one bounded retry, the size tag, a
 * row's state, and every refusal-to-sentence mapping the three islands rely on.
 */

/** A test that passed, as the service answers it — the Anthropic card's `✓ 200 · 38ms`. */
function passed(over: Partial<ProviderTest> = {}): ProviderTest {
  return {
    connectionId: "5eed000c-0000-4000-8000-000000000001",
    checkedAt: "2026-08-25T10:00:12.004Z",
    status: "active",
    pill: { tone: "ok", label: "connected" },
    note: "200",
    latencyMs: 38,
    errorClass: null,
    retryable: false,
    detail: "200",
    ...over,
  };
}

/** The Copilot card's `△ 503 upstream · retrying`. */
function degraded(): ProviderTest {
  return passed({
    status: "error",
    pill: { tone: "warn", label: "degraded upstream" },
    note: "503 upstream · retrying",
    latencyMs: null,
    errorClass: "upstream",
    retryable: true,
    detail: "503 upstream",
  });
}

describe("the test note", () => {
  it("draws a pass as the mockup's `✓ 200 · 38ms` — the service's sentence, the measured latency after it", () => {
    expect(testNote(passed())).toEqual({ tone: "ok", glyph: GLYPHS.ok, text: "200 · 38ms" });
  });

  it("draws a degraded upstream as `△ 503 upstream · retrying`, with nothing appended", () => {
    // A failure has no latency, by the service's design; the note must not invent one.
    expect(testNote(degraded())).toEqual({
      tone: "warn",
      glyph: GLYPHS.warn,
      text: "503 upstream · retrying",
    });
  });

  it("draws a refused key in the err tone with its glyph", () => {
    const note = testNote(
      passed({
        status: "error",
        pill: { tone: "err", label: "key rejected" },
        note: "key rejected (401)",
        latencyMs: null,
        errorClass: "auth",
        detail: "key rejected (401)",
      }),
    );

    expect(note).toEqual({ tone: "err", glyph: GLYPHS.err, text: "key rejected (401)" });
  });

  it("keeps a seat count the service put in the sentence", () => {
    expect(testNote(passed({ note: "200 · 4 seats", latencyMs: 12 })).text).toBe("200 · 4 seats · 12ms");
  });
});

describe("the one bounded retry", () => {
  it("is earned by an upstream failure, once, after the delay", () => {
    expect(retryDelayFor(degraded())).toBe(RETRY_DELAY_MS);
  });

  it("is not earned by a pass, a rate limit, a closed socket or a refused key", () => {
    expect(retryDelayFor(passed())).toBeNull();
    expect(retryDelayFor(passed({ errorClass: "rate_limit", retryable: true }))).toBeNull();
    expect(retryDelayFor(passed({ errorClass: "network", retryable: true }))).toBeNull();
    expect(retryDelayFor(passed({ errorClass: "auth", retryable: false }))).toBeNull();
  });
});

describe("why a test could not run", () => {
  it("names the role for a 403, the reload for a 404, and says nothing was recorded otherwise", () => {
    expect(testRefusal(new ApiError(403, "forbidden", "no"))).toBe(TEST_READ_ONLY);
    expect(testRefusal(new ApiError(404, "provider_connection_not_found", "no"))).toBe(TEST_GONE);
    expect(testRefusal(new ApiError(501, "provider_kind_unsupported", "no"))).toBe(TEST_FAILED);
    expect(testRefusal(new ApiError(500, "internal_error", "no"))).toBe(TEST_FAILED);
  });
});

describe("why a refresh did not happen", () => {
  it("says what the provider said when it did not answer its list, and that the list stands", () => {
    const sentence = discoverRefusal(
      new ApiError(502, DISCOVERY_FAILED_CODE, "no", {
        errorClass: "network",
        detail: "unreachable (ECONNREFUSED)",
      }),
    );

    expect(sentence).toContain("unreachable (ECONNREFUSED)");
    expect(sentence).toContain("unchanged");
  });

  it("falls back to the plain sentence when the refusal carries no phrase", () => {
    expect(discoverRefusal(new ApiError(502, DISCOVERY_FAILED_CODE, "no"))).toBe(REFRESH_FAILED);
    expect(discoverRefusal(new ApiError(500, "internal_error", "no"))).toBe(REFRESH_FAILED);
  });

  it("names the role and the reload as the test does", () => {
    expect(discoverRefusal(new ApiError(403, "forbidden", "no"))).toBe(REFRESH_READ_ONLY);
    expect(discoverRefusal(new ApiError(404, "provider_connection_not_found", "no"))).toBe(TEST_GONE);
  });
});

describe("the flag's links", () => {
  it("links each alias to the registry page, opened on that alias", () => {
    expect(
      aliasLinks({
        modelId: "deepseek-v3.2",
        aliases: [
          { id: "a", alias: "local-ds" },
          { id: "b", alias: "local/free" },
        ],
      }),
    ).toEqual([
      { name: "local-ds", href: "/models/registry?alias=local-ds" },
      { name: "local/free", href: "/models/registry?alias=local%2Ffree" },
    ]);
  });
});

describe("what changed between two chip lists", () => {
  it("names what entered and what left, in their own orders", () => {
    const diff = chipDiff(["a", "gone", "b"], ["b", "new", "a"]);

    expect([...diff.entering]).toEqual(["new"]);
    expect(diff.leaving).toEqual(["gone"]);
  });

  it("is empty for a re-render that changed nothing, so nothing animates", () => {
    const diff = chipDiff(["a", "b"], ["a", "b"]);

    expect(diff.entering.size).toBe(0);
    expect(diff.leaving).toEqual([]);
    expect(CHIP_LEAVE_MS).toBeGreaterThan(0);
  });
});

describe("the size tag", () => {
  it("prints the mockup's three tags from the daemon's own byte counts", () => {
    expect(sizeTag(18_997_469_184)).toBe("19 GB");
    expect(sizeTag(62_970_741_760)).toBe("63 GB");
    expect(sizeTag(9_053_116_800)).toBe("9.1 GB");
  });

  it("keeps one decimal under ten gigabytes and none above, and drops to megabytes below one", () => {
    expect(sizeTag(1_500_000_000)).toBe("1.5 GB");
    expect(sizeTag(10_000_000_000)).toBe("10 GB");
    expect(sizeTag(512_000_000)).toBe("512 MB");
    expect(sizeTag(4_096)).toBe("4 KB");
  });

  it("prints nothing for a model that has no size — a chip, not a row", () => {
    expect(sizeTag(null)).toBeNull();
    expect(sizeTag(0)).toBeNull();
    expect(sizeTag(Number.NaN)).toBeNull();
  });
});

describe("a pull-list row's state", () => {
  it("is idle for a model nothing has pulled", () => {
    expect(pullRowState(undefined)).toEqual({ kind: "idle" });
  });

  it("carries the percentage and the daemon's word while running", () => {
    expect(pullRowState(pullRecord())).toEqual({ kind: "running", percent: 61, status: "downloading" });
  });

  it("is running with no percentage while the daemon has not sized the transfer", () => {
    expect(pullRowState(pullRecord({ percent: null, status: "pulling manifest" }))).toEqual({
      kind: "running",
      percent: null,
      status: "pulling manifest",
    });
  });

  it("is queued, done, or failed with the service's sentence", () => {
    expect(pullRowState(pullRecord({ state: "queued", status: "queued" }))).toEqual({ kind: "queued" });
    // A finished pull is `succeeded`, whatever the last line's counts said.
    expect(pullRowState(pullRecord({ state: "succeeded", percent: null }))).toEqual({ kind: "done" });
    expect(pullRowState(pullRecord({ state: "failed", detail: "the host closed the stream" }))).toEqual({
      kind: "failed",
      detail: "the host closed the stream",
    });
    expect(pullRowState(pullRecord({ state: "failed", detail: null }))).toEqual({
      kind: "failed",
      detail: PULL_FAILED,
    });
  });

  it("announces the bar as the model and its percentage, or the daemon's word", () => {
    expect(pullValueText("llama4:scout", { kind: "running", percent: 61, status: "downloading" })).toBe(
      "llama4:scout · 61%",
    );
    expect(
      pullValueText("llama4:scout", { kind: "running", percent: null, status: "pulling manifest" }),
    ).toBe("llama4:scout · pulling manifest");
    expect(pullValueText("llama4:scout", { kind: "idle" })).toBe("llama4:scout");
  });
});

describe("what keeps the list polling, and what makes it re-read", () => {
  it("polls while anything is queued or running, and stops when nothing is", () => {
    expect(anyInFlight([pullRecord()])).toBe(true);
    expect(anyInFlight([pullRecord({ state: "queued" })])).toBe(true);
    expect(anyInFlight([pullRecord({ state: "succeeded" }), pullRecord({ state: "failed" })])).toBe(false);
    expect(anyInFlight([])).toBe(false);
  });

  it("names the models whose pulls landed since the last poll, once", () => {
    const before = [pullRecord(), pullRecord({ modelId: "phi4:14b", state: "succeeded" })];
    const after = [
      pullRecord({ state: "succeeded" }),
      pullRecord({ modelId: "phi4:14b", state: "succeeded" }),
    ];

    expect(newlyPulled(before, after)).toEqual(["llama4:scout"]);
    expect(newlyPulled(after, after)).toEqual([]);
  });
});

describe("why a pull did not start", () => {
  it("names the role, the reload, or says to try again", () => {
    expect(pullRefusal(new ApiError(403, "forbidden", "no"))).toBe(PULL_READ_ONLY);
    expect(pullRefusal(new ApiError(404, "provider_connection_not_found", "no"))).toBe(TEST_GONE);
    expect(pullRefusal(new ApiError(422, "provider_kind_cannot_pull", "no"))).toBe(PULL_FAILED);
  });
});

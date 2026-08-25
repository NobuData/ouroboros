import { PROVIDER_CONNECTION_KINDS } from "../db/schema";
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  PROVIDER_CHECKS,
  checkFor,
  checkKindFor,
  checkUrl,
  kindsOnCadence,
  reportsLatencyFor,
} from "./checks";

/**
 * The passive-first policy, asserted as a table rather than as behaviour.
 *
 * Everything this module is judged on is decided here — decision **M8**'s *no synthetic
 * completions*, its *`unknown` where nothing is cheap and truthful*, and the split between a
 * cadence that asks the operator's own machine and one that asks a vendor. A suite that
 * exercised the sweep would prove those for the paths it happened to walk; this one asserts
 * them over **every** kind, so a seventh provider added to V015's CHECK arrives with the
 * decision already demanded of it.
 */

describe("the per-kind check policy", () => {
  it("has an entry for every kind V015 admits, and no others", () => {
    // Totality is the point of the `Record`: a kind added to the union will not compile until
    // somebody has decided what this service may ask it, and that decision is exactly the one
    // that should never be made by default.
    expect(Object.keys(PROVIDER_CHECKS).sort()).toEqual([...PROVIDER_CONNECTION_KINDS].sort());
  });

  it.each(["copilot", "cursor", "custom"] as const)(
    "has nothing cheap and honest to ask %s, and says so with null",
    (kind) => {
      expect(checkFor(kind)).toBeNull();
    },
  );

  it.each(["ollama", "openai_compatible", "anthropic"] as const)(
    "asks %s exactly one question",
    (kind) => {
      expect(checkFor(kind)).not.toBeNull();
    },
  );

  describe("no synthetic completions, as a property of the table", () => {
    // The ticket's explicit, testable non-goal. Asserted against every entry rather than a
    // representative one, and against the *path* rather than against the client — a client
    // that only sends GETs is still one completion route away from billing a workspace to
    // decorate a status bar.
    const COMPLETION_ROUTES = [
      "/completion",
      "/completions",
      "/chat",
      "/messages",
      "/generate",
      "/api/chat",
      "/api/generate",
    ];

    it.each(Object.entries(PROVIDER_CHECKS))(
      "%s asks for a listing, not a generation",
      (_kind, check) => {
        if (check === null) {
          return;
        }

        for (const route of COMPLETION_ROUTES) {
          expect(check.path).not.toContain(route);
        }
      },
    );
  });

  describe("cadences", () => {
    it("puts the operator's own machines on the fast cadence", () => {
      expect(kindsOnCadence("local")).toEqual(["ollama", "openai_compatible"]);
    });

    it("puts a vendor's rate-limited endpoint on the slow one", () => {
      expect(kindsOnCadence("cloud")).toEqual(["anthropic"]);
    });

    it("leaves the kinds with no check out of both, so no sweep can reach them", () => {
      const swept = [...kindsOnCadence("local"), ...kindsOnCadence("cloud")];

      expect(swept).not.toContain("copilot");
      expect(swept).not.toContain("cursor");
      expect(swept).not.toContain("custom");
    });
  });

  describe("credentials", () => {
    it("gives the reachability checks no way to attach one", () => {
      // A local daemon needs none, and a check that *could* carry one is a check that could
      // send a workspace's Anthropic key to whatever address a row names.
      expect(checkFor("ollama")?.authorize).toBeNull();
      expect(checkFor("openai_compatible")?.authorize).toBeNull();
    });

    it("presents an Anthropic key the way Anthropic asks for it", () => {
      expect(checkFor("anthropic")?.authorize?.("sk-ant-test")).toEqual({
        "x-api-key": "sk-ant-test",
        "anthropic-version": "2023-06-01",
      });
    });
  });

  describe("model counts", () => {
    it("reads Ollama's own field", () => {
      expect(checkFor("ollama")?.inventory).toBe("models");
    });

    it("reads the OpenAI shape's", () => {
      expect(checkFor("openai_compatible")?.inventory).toBe("data");
    });

    it("counts nothing for a key validation, which is not asking about models", () => {
      expect(checkFor("anthropic")?.inventory).toBeNull();
    });
  });
});

describe("where a check is sent", () => {
  it("appends the path to the row's own address", () => {
    expect(checkUrl(checkFor("ollama")!, "http://workstation:11434")).toBe(
      "http://workstation:11434/api/tags",
    );
  });

  it("does not double the separator when the address ends in one", () => {
    expect(checkUrl(checkFor("ollama")!, "http://workstation:11434/")).toBe(
      "http://workstation:11434/api/tags",
    );
  });

  it("falls back to the vendor's endpoint for a kind that has one", () => {
    expect(checkUrl(checkFor("anthropic")!, null)).toBe(
      `${ANTHROPIC_DEFAULT_BASE_URL}/v1/models?limit=1`,
    );
  });

  it("prefers a row's address over the vendor's, for a proxy or a regional endpoint", () => {
    expect(checkUrl(checkFor("anthropic")!, "https://anthropic.proxy.internal")).toBe(
      "https://anthropic.proxy.internal/v1/models?limit=1",
    );
  });

  it("has nowhere to send a local kind with no address", () => {
    // V015 requires one for these two, so this is a row that cannot exist — and the answer is
    // still `undefined` rather than a guess, because the guess would be `localhost`.
    expect(checkUrl(checkFor("ollama")!, null)).toBeUndefined();
  });
});

describe("the two answers an on-demand test takes from the table (#230)", () => {
  it("names the sweep's own check for a kind the table covers, whatever the schema says", () => {
    expect(checkKindFor("ollama", true)).toBe("reachability");
    expect(checkKindFor("anthropic", false)).toBe("key_validation");
  });

  it("derives the check from the credential field for a kind the table does not cover", () => {
    expect(checkKindFor("copilot", true)).toBe("key_validation");
    expect(checkKindFor("custom", false)).toBe("reachability");
  });

  it("keeps the table's judgement about whose latency is worth storing", () => {
    expect(reportsLatencyFor("ollama")).toBe(false);
    expect(reportsLatencyFor("anthropic")).toBe(true);
  });

  it("stores a latency for a kind the table does not cover — a cloud round trip means something", () => {
    expect(reportsLatencyFor("copilot")).toBe(true);
  });
});

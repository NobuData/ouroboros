import { describe, expect, it } from "vitest";

import {
  ADD_CARD_NOTE,
  ADD_FAILURE,
  ADD_PROVIDER_READ_ONLY,
  COMING_SOON,
  CONFIG_INVALID,
  KIND_LABELS,
  KIND_UNSUPPORTED,
  NEEDS_NOTHING,
  NOTHING_STORED,
  NOT_STORABLE,
  REFUSED_WITHOUT_DETAIL,
  VALIDATION_FAILED,
  addFailure,
  addedNote,
  catalogTiles,
  configOf,
  duplicateKey,
  duplicateOf,
  duplicateWarning,
  endpointKey,
  labelOf,
  monogramOf,
  needsOf,
  providerRefused,
} from "@/app/providers/catalog";

import {
  SEEDED_OLLAMA_URL,
  SEEDED_VLLM_URL,
  anthropicEntry,
  fakeEntry,
  formField,
  openaiCompatibleEntry,
  seededCatalog,
  seededConnections,
} from "../helpers/providers";

/**
 * The add-provider flow's decisions (#231).
 *
 * `add-provider.test.tsx` proves what reaches the DOM; this proves the judgements behind it,
 * organised around the ticket's own criteria: the tiles derive from the registry and the fake
 * shows up unbidden; the `coming soon` tiles are honest and retire themselves; what is sent
 * is what was typed, with an empty optional left out; a duplicate is recognised across the
 * spellings of one endpoint; and every refusal the service can answer becomes a sentence and
 * the fields it is about.
 */

describe("the tiles derive from the registry", () => {
  it("draws one live tile per entry, in the service's order, with the entry behind it", () => {
    const tiles = catalogTiles(seededCatalog());
    const live = tiles.filter((tile) => tile.live);

    expect(live.map((tile) => tile.kind)).toEqual([
      "anthropic",
      "openai_compatible",
      "ollama",
      "copilot",
      "cursor",
    ]);
    expect(live.map((tile) => tile.label)).toEqual([
      "Anthropic",
      "OpenAI-compatible",
      "Ollama",
      "GitHub Copilot",
      "Cursor",
    ]);
    expect(live[1]).toMatchObject({ entry: openaiCompatibleEntry() });
  });

  it("draws the fake adapter unbidden — a kind no label names, with its form behind it", () => {
    // The ticket's proof, on this side of the wire: nothing here holds a list of kinds, so
    // an entry it has never seen is a tile like any other, labelled by its own kind.
    const tiles = catalogTiles([...seededCatalog(), fakeEntry()]);
    const fake = tiles.find((tile) => tile.kind === "custom");

    expect(KIND_LABELS).not.toHaveProperty("custom");
    expect(fake).toMatchObject({
      live: true,
      label: "custom",
      needs: "Base URL · Region · API key (optional)",
      entry: fakeEntry(),
    });
  });

  it("draws nothing for an empty catalog but the announcements", () => {
    const tiles = catalogTiles([]);

    expect(tiles.every((tile) => !tile.live)).toBe(true);
    expect(tiles).toHaveLength(COMING_SOON.length);
  });

  it("labels the kinds the mockup names as the mockup spells them, and any other by itself", () => {
    expect(labelOf("anthropic")).toBe("Anthropic");
    expect(labelOf("openai_compatible")).toBe("OpenAI-compatible");
    expect(labelOf("copilot")).toBe("GitHub Copilot");
    expect(labelOf("something_new")).toBe("something_new");
  });

  it("derives a monogram from the label rather than choosing one per provider", () => {
    expect(monogramOf("Anthropic")).toBe("AN");
    expect(monogramOf("OpenAI-compatible")).toBe("OP");
    expect(monogramOf("GitHub Copilot")).toBe("GI");
    expect(monogramOf("custom")).toBe("CU");
    expect(monogramOf("—")).toBe("?");
  });

  it("says what a form will ask for, marking what is optional", () => {
    expect(needsOf(anthropicEntry().fields)).toBe("API key");
    expect(needsOf(openaiCompatibleEntry().fields)).toBe("Base URL · API key (optional)");
    expect(needsOf([])).toBe(NEEDS_NOTHING);
  });
});

describe("the coming soon tiles", () => {
  it("are the three kinds the dashed card promises, each naming where it comes from", () => {
    expect(COMING_SOON.map((announcement) => announcement.kind)).toEqual([
      "openai",
      "google",
      "bedrock",
    ]);
    for (const announcement of COMING_SOON) {
      expect(announcement.source).toMatch(/#236/);
    }
  });

  it("follow the live tiles, and draw nothing interactive", () => {
    const tiles = catalogTiles(seededCatalog());
    const soon = tiles.filter((tile) => !tile.live);

    expect(tiles.slice(-soon.length)).toEqual(soon);
    expect(soon.map((tile) => tile.label)).toEqual(["OpenAI", "Google Gemini", "AWS Bedrock"]);
    for (const tile of soon) {
      expect(tile).not.toHaveProperty("entry");
    }
  });

  it("retire themselves the moment the registry answers their kind", () => {
    // AF.3's whole promise on this side: the tile flips from soon to live with no change
    // here. A live `openai` entry is the day that happens.
    const openai = { ...anthropicEntry(), kind: "openai" as never, title: "Connect OpenAI" };
    const tiles = catalogTiles([...seededCatalog(), openai]);

    expect(tiles.filter((tile) => tile.kind === "openai")).toEqual([
      expect.objectContaining({ live: true, label: "openai", entry: openai }),
    ]);
    expect(tiles.filter((tile) => !tile.live).map((tile) => tile.kind)).toEqual([
      "google",
      "bedrock",
    ]);
  });

  it("can be told a different list, so the rule is tested without editing the product's", () => {
    const tiles = catalogTiles(seededCatalog(), [
      { kind: "anthropic", label: "Anthropic", source: "already here" },
      { kind: "mistral", label: "Mistral", source: "nowhere yet" },
    ]);

    expect(tiles.filter((tile) => !tile.live).map((tile) => tile.kind)).toEqual(["mistral"]);
  });
});

describe("what the form sends", () => {
  const fields = openaiCompatibleEntry().fields;

  it("keys every value by the field's name, trimmed", () => {
    const values: Record<string, string> = {
      baseUrl: "  http://10.0.4.20:8000/v1  ",
      apiKey: "sk-vllm-Xq4A\n",
    };

    expect(configOf(fields, (name) => values[name] ?? "")).toEqual({
      baseUrl: "http://10.0.4.20:8000/v1",
      apiKey: "sk-vllm-Xq4A",
    });
  });

  it("leaves an empty optional field out rather than sending an empty string", () => {
    // An untouched optional key is not a credential, and the service's capability-note
    // column refuses `""` outright.
    const values: Record<string, string> = { baseUrl: "http://10.0.4.20:8000/v1", apiKey: "   " };

    expect(configOf(fields, (name) => values[name] ?? "")).toEqual({
      baseUrl: "http://10.0.4.20:8000/v1",
    });
  });

  it("keeps an empty required field, so the service's own field error is what answers", () => {
    expect(configOf(fields, () => "")).toEqual({ baseUrl: "" });
  });

  it("reads only the fields the entry declares", () => {
    // A value for a name the schema does not declare would be a `422` from the service, and
    // there is no way to type one into a form that did not draw it — but a caller could pass
    // one, and this is what stops it travelling.
    const values: Record<string, string> = { baseUrl: "http://x", extra: "y" };

    expect(configOf(fields, (name) => values[name] ?? "")).toEqual({ baseUrl: "http://x" });
  });
});

describe("the duplicate warning", () => {
  it("treats two spellings of one endpoint as one", () => {
    expect(endpointKey("http://Ken-Station.local:11434/")).toBe(endpointKey(SEEDED_OLLAMA_URL));
    expect(endpointKey(" http://10.0.4.20:8000/v1// ")).toBe(endpointKey(SEEDED_VLLM_URL));
  });

  it("treats two fixed endpoints of one kind as one, and different kinds as different", () => {
    expect(duplicateKey("anthropic", null)).toBe(duplicateKey("anthropic", null));
    expect(duplicateKey("anthropic", null)).not.toBe(duplicateKey("cursor", null));
  });

  it("keeps a path that differs as different — two routes on one host are two endpoints", () => {
    expect(endpointKey("http://10.0.4.20:8000/v1")).not.toBe(endpointKey("http://10.0.4.20:8000/v2"));
  });

  it("compares a value that is not a URL as typed", () => {
    expect(endpointKey("not a url/")).toBe("not a url");
    expect(endpointKey(null)).toBe("");
  });

  it("finds the connection a submission would duplicate", () => {
    const existing = seededConnections();

    expect(duplicateOf(existing, "openai_compatible", "http://10.0.4.20:8000/v1/")).toMatchObject({
      displayName: "vLLM · lab cluster",
    });
    expect(duplicateOf(existing, "anthropic", null)).toMatchObject({
      displayName: "Anthropic Claude",
    });
  });

  it("finds nothing for a new endpoint, a new kind, or an empty workspace", () => {
    const existing = seededConnections();

    expect(duplicateOf(existing, "openai_compatible", "http://10.0.4.21:8000/v1")).toBeNull();
    expect(duplicateOf(existing, "cursor", null)).toBeNull();
    expect(duplicateOf([], "anthropic", null)).toBeNull();
  });

  it("says which connection, where, and that it is allowed", () => {
    const [anthropic, ollama] = seededConnections();

    expect(duplicateWarning(ollama)).toBe(
      "\"Ollama · workstation\" is already connected at http://ken-station.local:11434. " +
        "Connecting it a second time is allowed, but it is usually a mistake.",
    );
    expect(duplicateWarning(anthropic)).toMatch(/is already connected as Anthropic\./);
  });
});

describe("what a refusal becomes", () => {
  const vllm = openaiCompatibleEntry().fields;

  it("draws the provider's own phrase under the key row for an auth refusal", () => {
    // The adapter's designed error — `key rejected (401)` — inline, where the key was typed.
    const failure = addFailure(
      {
        code: "provider_validation_failed",
        message: "The provider refused the configuration or credential.",
        details: { errorClass: "auth", detail: "key rejected (401)" },
      },
      vllm,
    );

    expect(failure.message).toBe(providerRefused("key rejected (401)"));
    expect(failure.message).toContain(NOTHING_STORED);
    expect(failure.fields).toEqual({ apiKey: ["key rejected (401)"] });
  });

  it("draws a network refusal under the address", () => {
    const failure = addFailure(
      {
        code: "provider_validation_failed",
        message: "",
        details: { errorClass: "network", detail: "unreachable (ECONNREFUSED)" },
      },
      vllm,
    );

    expect(failure.fields).toEqual({ baseUrl: ["unreachable (ECONNREFUSED)"] });
  });

  it("highlights no field for a class the form has no row for", () => {
    // Anthropic's form has no address; a network refusal there is the sentence alone.
    const failure = addFailure(
      {
        code: "provider_validation_failed",
        message: "",
        details: { errorClass: "network", detail: "unreachable" },
      },
      anthropicEntry().fields,
    );

    expect(failure.fields).toEqual({});
    expect(failure.message).toContain("unreachable");
  });

  it("says something when the adapter sent no phrase at all", () => {
    const failure = addFailure(
      { code: "provider_validation_failed", message: "", details: {} },
      vllm,
    );

    expect(failure.message).toBe(providerRefused(REFUSED_WITHOUT_DETAIL));
  });

  it("hands a schema violation through keyed by field", () => {
    const failure = addFailure(
      {
        code: "provider_config_invalid",
        message: "",
        details: { fields: { baseUrl: ["must match format \"uri\""], apiKey: [] } },
      },
      vllm,
    );

    expect(failure.message).toBe(CONFIG_INVALID);
    expect(failure.fields).toEqual({ baseUrl: ["must match format \"uri\""] });
  });

  it("hands a body violation through keyed by body field, the name's included", () => {
    const failure = addFailure(
      {
        code: "validation_failed",
        message: "",
        details: { displayName: ["displayName must be trimmed"], config: "at most 20 settings" },
      },
      vllm,
    );

    expect(failure.message).toBe(VALIDATION_FAILED);
    expect(failure.fields).toEqual({
      displayName: ["displayName must be trimmed"],
      config: ["at most 20 settings"],
    });
  });

  it("says who may connect a provider for the role gate's refusal", () => {
    expect(addFailure({ code: "forbidden", message: "x", details: {} }, vllm)).toEqual({
      message: ADD_PROVIDER_READ_ONLY,
      fields: {},
    });
  });

  it("says to reopen the catalog for a kind the build no longer has", () => {
    expect(
      addFailure({ code: "provider_kind_unsupported", message: "x", details: {} }, vllm),
    ).toEqual({ message: KIND_UNSUPPORTED, fields: {} });
  });

  it("marks the fields this build cannot store, with the service's sentence", () => {
    const failure = addFailure(
      {
        code: "provider_config_not_storable",
        message: "This build has no column for organization.",
        details: { kind: "copilot", fields: ["organization"] },
      },
      [...vllm, formField({ name: "organization", label: "Organization", widget: "text" })],
    );

    expect(failure.message).toBe(`This build has no column for organization. ${NOTHING_STORED}`);
    expect(failure.fields).toEqual({ organization: [NOT_STORABLE] });
  });

  it("answers an unknown code with the service's sentence, or a sentence of its own", () => {
    expect(addFailure({ code: "internal_error", message: "It broke.", details: {} }, vllm)).toEqual(
      { message: "It broke.", fields: {} },
    );
    expect(addFailure({ code: "internal_error", message: "", details: {} }, vllm)).toEqual({
      message: ADD_FAILURE,
      fields: {},
    });
  });

  it("reads details defensively, because it runs while explaining a failure", () => {
    expect(
      addFailure(
        { code: "provider_config_invalid", message: "", details: { fields: "not a map" } },
        vllm,
      ).fields,
    ).toEqual({});
    expect(
      addFailure(
        { code: "validation_failed", message: "", details: { displayName: [1, null, "ok"] } },
        vllm,
      ).fields,
    ).toEqual({ displayName: ["ok"] });
  });
});

describe("the copy", () => {
  it("names on the dashed card only what is live, and says the rest is coming", () => {
    // Mockup 07's line promises OpenAI, Google and Bedrock as though they could be connected;
    // this page's version names the five that can and says the three are on their way.
    expect(ADD_CARD_NOTE).toMatch(/Anthropic/);
    expect(ADD_CARD_NOTE).toMatch(/OpenAI-compatible/);
    expect(ADD_CARD_NOTE).toMatch(/OpenAI, Google and Bedrock are on their way/);
  });

  it("tells the done step's reader the card is in the grid, and that the trail has the add", () => {
    // The grid re-reads when the dialog closes (AE.2, #228), so the sentence names where the
    // card is rather than an issue number — and still names the trail, because somebody has
    // just handed over a key.
    expect(addedNote("vLLM · lab cluster")).toContain("\"vLLM · lab cluster\"");
    expect(addedNote("x")).toMatch(/in the grid/);
    expect(addedNote("x")).toMatch(/Audit log/);
    expect(addedNote("x")).not.toMatch(/#228/);
  });
});

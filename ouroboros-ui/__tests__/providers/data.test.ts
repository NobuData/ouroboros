import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { stripPayload } from "../helpers/models";
import {
  READ_AT,
  anthropicModels,
  catalogPayload,
  connectionPage,
  seededAliases,
  seededCards,
  seededSpend,
} from "../helpers/providers";

/**
 * The providers page's reader (#228): five reads composed into one object, each part either
 * read or explained.
 *
 * The property under test is the one every reader in this module keeps — **one failed read
 * is one degraded region** — and the shape this reader adds to it: the models are read per
 * connection, after the listing, all at once, and not at all when there is no listing to
 * read them for.
 */

const list = vi.fn();
const catalog = vi.fn();
const spend = vi.fn();
const models = vi.fn();
const health = vi.fn();
const aliases = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/providers", () => ({
  providers: {
    list: () => list(),
    catalog: () => catalog(),
    spend: () => spend(),
    models: (id: string) => models(id),
    aliases: () => aliases(),
  },
}));
vi.mock("@/app/api/routing", () => ({ routing: { providers: () => health() } }));

const { readProviders } = await import("@/app/providers/data");

/** What the gate hands the reader — held, not read. */
const ACCESS = {} as Parameters<typeof readProviders>[0];

/** A refusal, as the service's envelope says it. */
function refused(message: string): ApiError {
  return new ApiError(503, "unavailable", message);
}

beforeEach(() => {
  list.mockReset().mockResolvedValue(connectionPage(seededCards()));
  catalog.mockReset().mockResolvedValue(catalogPayload());
  spend.mockReset().mockResolvedValue(seededSpend());
  health.mockReset().mockResolvedValue(stripPayload());
  aliases.mockReset().mockResolvedValue(seededAliases());
  models.mockReset().mockResolvedValue(anthropicModels());
});

describe("a clean read", () => {
  it("composes the five readings, and the instant they were read at", async () => {
    const readings = await readProviders(ACCESS, new Date(READ_AT));

    expect(readings.connections).toEqual({ ok: true, value: seededCards() });
    expect(readings.catalog).toEqual({ ok: true, value: catalogPayload().kinds });
    expect(readings.health).toEqual({ ok: true, value: stripPayload().providers });
    expect(readings.spend).toEqual({ ok: true, value: seededSpend() });
    expect(readings.aliases).toEqual({ ok: true, value: seededAliases() });
    expect(readings.now).toBe(READ_AT);
  });

  it("reads every connection's models, once each, by id", async () => {
    const readings = await readProviders(ACCESS, new Date(READ_AT));

    expect(models).toHaveBeenCalledTimes(seededCards().length);
    for (const card of seededCards()) {
      expect(models).toHaveBeenCalledWith(card.id);
      expect(readings.models.get(card.id)).toEqual({ ok: true, value: anthropicModels() });
    }
  });

  it("reads the four page-level things at once, and the models only after the listing", async () => {
    // Order of *starting*: the listing, catalog, strip and month are independent and begin
    // together; a model read cannot begin until the listing has said which connections exist.
    const order: string[] = [];
    list.mockImplementation(async () => {
      order.push("list");
      return connectionPage(seededCards());
    });
    catalog.mockImplementation(async () => {
      order.push("catalog");
      return catalogPayload();
    });
    models.mockImplementation(async (id: string) => {
      order.push(`models:${id}`);
      return [];
    });

    await readProviders(ACCESS, new Date(READ_AT));

    expect(order.indexOf("catalog")).toBeLessThan(order.findIndex((step) => step.startsWith("models")));
  });
});

describe("one failed read is one degraded region", () => {
  it("keeps the grid when the catalog could not be read", async () => {
    catalog.mockRejectedValue(refused("registry away"));

    const readings = await readProviders(ACCESS, new Date(READ_AT));

    expect(readings.catalog).toEqual({ ok: false, reason: "registry away" });
    expect(readings.connections.ok).toBe(true);
    expect(readings.models.size).toBe(seededCards().length);
  });

  it("keeps the grid when the strip or the month could not be read", async () => {
    health.mockRejectedValue(refused("strip away"));
    spend.mockRejectedValue(refused("ledger away"));

    const readings = await readProviders(ACCESS, new Date(READ_AT));

    expect(readings.health).toEqual({ ok: false, reason: "strip away" });
    expect(readings.spend).toEqual({ ok: false, reason: "ledger away" });
    expect(readings.connections.ok).toBe(true);
  });

  it("keeps every other card's models when one card's could not be read", async () => {
    const [first, second] = seededCards();
    models.mockImplementation((id: string) =>
      id === second.id ? Promise.reject(refused("that one is away")) : Promise.resolve([]),
    );

    const readings = await readProviders(ACCESS, new Date(READ_AT));

    expect(readings.models.get(first.id)).toEqual({ ok: true, value: [] });
    expect(readings.models.get(second.id)).toEqual({ ok: false, reason: "that one is away" });
  });

  it("explains the grid and asks for no models when the listing could not be read", async () => {
    list.mockRejectedValue(refused("listing away"));

    const readings = await readProviders(ACCESS, new Date(READ_AT));

    expect(readings.connections).toEqual({ ok: false, reason: "listing away" });
    expect(models).not.toHaveBeenCalled();
    expect(readings.models.size).toBe(0);
  });

  it("lets anything that is not the service's refusal travel — the redirect above all", async () => {
    list.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readProviders(ACCESS, new Date(READ_AT))).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

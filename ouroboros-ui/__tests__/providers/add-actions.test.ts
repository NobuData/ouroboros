import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { CATALOG_UNAVAILABLE } from "@/app/providers/catalog";

import { catalogPayload, connection, connectionPage, seededCatalog } from "../helpers/providers";

/**
 * The add-provider dialog's two server hops (#231).
 *
 * A Server Action is a POST endpoint anybody can reach, so every action suite in this module
 * is written as the security case first. Here it is the shape of the calls: **neither takes
 * a workspace or a person**, so there is nothing to forge — a connection belongs to the
 * workspace the caller's own session is acting in, and the role gate is the service's.
 *
 * The rest is the posture: a refusal is a value the dialog can draw rather than a rejection
 * that would replace the page underneath it, the listing failing on its own does not keep the
 * dialog from opening, and the gate's redirect is the one throw that must travel.
 */

/** What the API answers, per case. */
const catalog = vi.fn();
const list = vi.fn();
const add = vi.fn();

vi.mock("@/app/api/providers", () => ({
  providers: {
    catalog: () => catalog(),
    list: () => list(),
    add: (body: unknown) => add(body),
  },
}));

const { addProvider, readCatalog } = await import("@/app/providers/add-actions");

beforeEach(() => {
  catalog.mockReset().mockResolvedValue(catalogPayload());
  list.mockReset().mockResolvedValue(connectionPage());
  add.mockReset().mockResolvedValue(connection());
});

describe("reading the catalog", () => {
  it("asks for the catalog and the session's own listing, and names nothing else", async () => {
    await readCatalog();

    expect(catalog).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("hands back the entries and the connections slimmed to what the warning compares", async () => {
    const reading = await readCatalog();

    expect(reading).toMatchObject({ ok: true, entries: seededCatalog() });
    expect(reading.ok && reading.existing).toEqual(
      connectionPage().items.map(({ id, kind, displayName, baseUrl }) => ({
        id,
        kind,
        displayName,
        baseUrl,
      })),
    );
  });

  it("carries no mask, no cap and no status across — the dialog has no use for them", async () => {
    const reading = await readCatalog();

    for (const existing of reading.ok ? reading.existing : []) {
      expect(existing).not.toHaveProperty("mask");
      expect(existing).not.toHaveProperty("monthlyCapCents");
    }
  });

  it("still opens when the listing could not be read — the warning simply has nothing to compare", async () => {
    // A warning is not a gate; a dialog that refused to open over one would be.
    list.mockRejectedValue(new ApiError(500, "internal_error", "Something failed.", {}));

    await expect(readCatalog()).resolves.toEqual({
      ok: true,
      entries: seededCatalog(),
      existing: [],
    });
  });

  it("answers a catalog that could not be read with the sentence that says nothing changed", async () => {
    catalog.mockRejectedValue(new ApiError(500, "internal_error", "Something failed.", {}));

    await expect(readCatalog()).resolves.toEqual({ ok: false, reason: CATALOG_UNAVAILABLE });
  });

  it("lets the gate's redirect travel, from either read", async () => {
    // A `401` reaches this layer as Next.js's redirect signal rather than as an `ApiError`,
    // and a `catch` wide enough to hold it would swallow the navigation to the login screen.
    const redirect = new Error("NEXT_REDIRECT");

    catalog.mockRejectedValue(redirect);
    await expect(readCatalog()).rejects.toBe(redirect);

    catalog.mockResolvedValue(catalogPayload());
    list.mockRejectedValue(redirect);
    await expect(readCatalog()).rejects.toBe(redirect);
  });
});

describe("adding a provider", () => {
  const body = {
    kind: "anthropic" as const,
    displayName: "Anthropic Claude",
    config: { apiKey: "sk-ant-api03-Xq4A" },
  };

  it("forwards the body exactly as the dialog composed it", async () => {
    await addProvider(body);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toEqual(body);
  });

  it("hands back what the done step needs, and no more", async () => {
    await expect(addProvider(body)).resolves.toEqual({
      ok: true,
      connection: { id: connection().id, displayName: connection().displayName },
    });
  });

  it("hands back the service's refusal as a value, envelope intact", async () => {
    // Code and details survive because `catalog.ts`'s `addFailure` reads both: the adapter's
    // designed error and the class that says which field it belongs under.
    add.mockRejectedValue(
      new ApiError(422, "provider_validation_failed", "The provider refused it.", {
        errorClass: "auth",
        detail: "key rejected (401)",
      }),
    );

    await expect(addProvider(body)).resolves.toEqual({
      ok: false,
      refusal: {
        code: "provider_validation_failed",
        message: "The provider refused it.",
        details: { errorClass: "auth", detail: "key rejected (401)" },
      },
    });
  });

  it("hands back the role gate's refusal the same way, so a member writes nothing and sees why", async () => {
    add.mockRejectedValue(new ApiError(403, "forbidden", "Your role does not permit this.", {}));

    await expect(addProvider(body)).resolves.toMatchObject({
      ok: false,
      refusal: { code: "forbidden" },
    });
  });

  it("lets the gate's redirect travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");

    add.mockRejectedValue(redirect);

    await expect(addProvider(body)).rejects.toBe(redirect);
  });
});

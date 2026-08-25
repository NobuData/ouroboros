import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  ADDRESS_FAILED,
  ADDRESS_INVALID,
  DELETE_FAILED,
  OLD_KEY_ACTIVE,
  ROTATE_CHANGED,
  STEP_UP_DEFAULT_WINDOW_SECONDS,
  addressUnreachable,
  providerRefused,
  revealRateLimited,
} from "@/app/providers/keys";

/**
 * The key-management server hops (#229): reveal, rotate, delete, the address save.
 *
 * Each is `card-actions.ts`'s posture applied to a security-critical flow: a refusal is a
 * *value* the dialog draws, never a rejection that replaces the page, and the one throw that
 * travels is Next.js's redirect signal for a session that expired. The refusal-to-sentence
 * mapping is `keys.ts`'s (its own suite); what is held here is that each action sends the
 * right request and returns the right shape, and that a `step_up_required` challenge comes
 * back as a challenge rather than a plain refusal.
 */

const reveal = vi.fn();
const rotate = vi.fn();
const remove = vi.fn();
const update = vi.fn();
const signOutSession = vi.fn();

vi.mock("@/app/api/providers", () => ({
  providers: {
    reveal: (id: string, body: unknown) => reveal(id, body),
    rotate: (id: string, secret: string) => rotate(id, secret),
    remove: (id: string) => remove(id),
    update: (id: string, patch: unknown) => update(id, patch),
  },
}));
vi.mock("@/app/api/auth-server", () => ({ signOutSession: (...args: unknown[]) => signOutSession(...args) }));

const { revealCredential, rotateCredential, removeProvider, saveProviderAddress, reauthenticate } =
  await import("@/app/providers/key-actions");

/** The seed's Anthropic card. */
const ID = "5eed000c-0000-4000-8000-000000000001";

beforeEach(() => {
  reveal.mockReset();
  rotate.mockReset();
  remove.mockReset();
  update.mockReset();
  signOutSession.mockReset().mockResolvedValue(undefined);
});

describe("revealCredential", () => {
  it("forwards a password when given one, and returns the value with its expiry", async () => {
    reveal.mockResolvedValue({ connectionId: ID, value: "sk-real", expiresAt: "2026-08-23T10:00:41.882Z" });

    const outcome = await revealCredential(ID, "hunter2");

    expect(reveal).toHaveBeenCalledWith(ID, { password: "hunter2" });
    expect(outcome).toEqual({
      ok: true,
      connectionId: ID,
      value: "sk-real",
      expiresAt: "2026-08-23T10:00:41.882Z",
    });
  });

  it("sends an empty body when there is no password, leaning on a recent session", async () => {
    reveal.mockResolvedValue({ connectionId: ID, value: "x", expiresAt: "2026-08-23T10:00:41.882Z" });

    await revealCredential(ID);

    expect(reveal).toHaveBeenCalledWith(ID, {});
  });

  it("turns the 401 challenge into a step-up outcome carrying the methods and window", async () => {
    reveal.mockRejectedValue(
      new ApiError(401, "step_up_required", "confirm", {
        methods: ["session", "password"],
        maxAgeSeconds: 300,
      }),
    );

    await expect(revealCredential(ID)).resolves.toEqual({
      ok: false,
      kind: "step-up",
      methods: ["session", "password"],
      maxAgeSeconds: 300,
    });
  });

  it("defaults the window when the challenge did not name one", async () => {
    reveal.mockRejectedValue(new ApiError(401, "step_up_required", "confirm", { methods: ["session"] }));

    const outcome = await revealCredential(ID);

    expect(outcome).toMatchObject({ kind: "step-up", maxAgeSeconds: STEP_UP_DEFAULT_WINDOW_SECONDS });
  });

  it("turns the rate limit into a refusal carrying the service's figure", async () => {
    reveal.mockRejectedValue(
      new ApiError(429, "provider_reveal_rate_limited", "slow", { scope: "connection", retryAfterSeconds: 240 }),
    );

    await expect(revealCredential(ID)).resolves.toEqual({
      ok: false,
      kind: "refused",
      reason: revealRateLimited(240),
    });
  });

  it("lets the redirect signal travel", async () => {
    reveal.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(revealCredential(ID)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("rotateCredential", () => {
  it("swaps and returns the new mask", async () => {
    rotate.mockResolvedValue({ mask: "••••7Kd2" });

    await expect(rotateCredential(ID, "sk-new")).resolves.toEqual({ ok: true, mask: "••••7Kd2" });
    expect(rotate).toHaveBeenCalledWith(ID, "sk-new");
  });

  it("explains a provider rejection — the old key still live is keys.ts's standing line", async () => {
    rotate.mockRejectedValue(
      new ApiError(422, "provider_validation_failed", "refused", { errorClass: "auth", detail: "key rejected (401)" }),
    );

    await expect(rotateCredential(ID, "bad")).resolves.toEqual({
      ok: false,
      reason: providerRefused("key rejected (401)"),
    });
    // The standing line the dialog draws beside that reason.
    expect(OLD_KEY_ACTIVE).toMatch(/still active/);
  });

  it("tells the reader to reload when the row changed mid-check", async () => {
    rotate.mockRejectedValue(new ApiError(409, "provider_connection_changed", "changed", { connectionId: ID }));

    await expect(rotateCredential(ID, "x")).resolves.toEqual({ ok: false, reason: ROTATE_CHANGED });
  });
});

describe("removeProvider", () => {
  it("resolves ok on a clean delete", async () => {
    remove.mockResolvedValue(undefined);

    await expect(removeProvider(ID)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith(ID);
  });

  it("returns the in-use state with the service's alias names", async () => {
    remove.mockRejectedValue(
      new ApiError(409, "provider_connection_in_use", "in use", {
        connectionId: ID,
        aliases: ["coder-max", "local-docs"],
      }),
    );

    await expect(removeProvider(ID)).resolves.toEqual({
      ok: false,
      kind: "in-use",
      aliases: ["coder-max", "local-docs"],
    });
  });

  it("returns a plain refusal for anything else", async () => {
    remove.mockRejectedValue(new ApiError(500, "internal_error", "boom"));

    await expect(removeProvider(ID)).resolves.toEqual({ ok: false, kind: "refused", reason: DELETE_FAILED });
  });
});

describe("saveProviderAddress", () => {
  it("PATCHes the address under the reserved config field and returns the stored value", async () => {
    update.mockResolvedValue({ baseUrl: "http://10.0.4.20:8000/v1" });

    const outcome = await saveProviderAddress(ID, "http://10.0.4.20:8000/v1");

    expect(update).toHaveBeenCalledWith(ID, { config: { baseUrl: "http://10.0.4.20:8000/v1" } });
    expect(outcome).toEqual({ ok: true, value: "http://10.0.4.20:8000/v1" });
  });

  it("explains an unreachable endpoint, leaving the working address (keys.ts's standing line)", async () => {
    update.mockRejectedValue(
      new ApiError(422, "provider_validation_failed", "unreachable", { errorClass: "network", detail: "ECONNREFUSED" }),
    );

    await expect(saveProviderAddress(ID, "http://nope")).resolves.toEqual({
      ok: false,
      reason: addressUnreachable("ECONNREFUSED"),
    });
  });

  it("keys a schema refusal's messages to the address field", async () => {
    update.mockRejectedValue(
      new ApiError(422, "provider_config_invalid", "bad", { fields: { baseUrl: ["Base URL is not usable: bad scheme"] } }),
    );

    await expect(saveProviderAddress(ID, "ftp://x")).resolves.toEqual({
      ok: false,
      reason: "Base URL is not usable: bad scheme",
    });
  });

  it("falls back to a generic reason when a config refusal named no field", async () => {
    update.mockRejectedValue(new ApiError(422, "provider_config_invalid", "bad", { fields: {} }));

    await expect(saveProviderAddress(ID, "x")).resolves.toEqual({ ok: false, reason: ADDRESS_INVALID });
  });

  it("says the address could not be saved for anything else", async () => {
    update.mockRejectedValue(new ApiError(500, "internal_error", "boom"));

    await expect(saveProviderAddress(ID, "x")).resolves.toEqual({ ok: false, reason: ADDRESS_FAILED });
  });
});

describe("reauthenticate", () => {
  it("signs out with the providers page as the return-to", async () => {
    await reauthenticate();

    expect(signOutSession).toHaveBeenCalledWith(expect.any(Function), "/models/providers");
  });
});

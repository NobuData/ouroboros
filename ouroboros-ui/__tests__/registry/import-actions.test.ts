import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { CANDIDATES_FAILED } from "@/app/registry/wizard";

import { candidateList, importResult } from "../helpers/registry";

/**
 * The import wizard's two server hops (#594).
 *
 * A Server Action is a POST endpoint anybody can reach, so the security case is first. Neither
 * call takes a workspace or a person, and **both** are the service's to gate at `owner` or
 * `admin` — the candidate list included, because it is the first half of a write: a form
 * pre-filled with the names that write would use.
 *
 * The rest is the posture the wizard depends on: a connection that reported nothing is a
 * **success** with an `empty` beside it rather than a failure; a refusal is a value the wizard
 * draws with each message on its own row; and the gate's redirect is the one throw that travels.
 */

/** What the API answers, per case. */
const candidates = vi.fn();
const importAliasesApi = vi.fn();

vi.mock("@/app/api/registry", () => ({
  registry: {
    candidates: (id: string) => candidates(id),
    importAliases: (body: unknown) => importAliasesApi(body),
  },
}));

const { importAliases, readCandidates } = await import("@/app/registry/import-actions");

/** The itemised refusal the whole all-or-nothing contract exists for. */
const ITEMISED = new ApiError(422, "model_import_invalid", "One or more items cannot be created.", {
  items: { "1": { alias: ["This workspace already has an alias by that name."] } },
});

beforeEach(() => {
  candidates.mockReset().mockResolvedValue(candidateList());
  importAliasesApi.mockReset().mockResolvedValue(importResult());
});

describe("reading a connection's candidates", () => {
  it("asks about the connection the menu row named, and nothing else", () => {
    void readCandidates("5eed000c-0000-4000-8000-000000000001");

    expect(candidates).toHaveBeenCalledExactlyOnceWith("5eed000c-0000-4000-8000-000000000001");
  });

  it("hands back the candidates and the empty state the service decided", async () => {
    await expect(readCandidates("c")).resolves.toEqual({
      ok: true,
      candidates: candidateList().candidates,
      empty: null,
    });
  });

  it("treats a connection that reported nothing as a success, with the reason beside it", async () => {
    // A wizard that called this a failure would say *could not be read* about a connection that
    // answered perfectly well.
    candidates.mockResolvedValue(candidateList([]));

    const reading = await readCandidates("c");

    expect(reading).toMatchObject({ ok: true, candidates: [] });
    expect(reading.ok && reading.empty).toMatchObject({ code: "no_models_discovered" });
  });

  it("turns a refusal into the product's sentence with the service's after it", async () => {
    // A `403` and a `502` are the same shape here, and a reader is owed both what happened and
    // what it means.
    candidates.mockRejectedValue(new ApiError(403, "forbidden", "Importing is owner or admin."));

    await expect(readCandidates("c")).resolves.toEqual({
      ok: false,
      reason: `${CANDIDATES_FAILED} Importing is owner or admin.`,
    });
  });

  it("lets the gate's redirect through, so an expired session still reaches login", async () => {
    candidates.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(readCandidates("c")).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("creating the batch", () => {
  it("forwards the body the wizard composed, unchanged", async () => {
    const body = { connectionId: "c", items: [{ modelId: "claude-opus-5", alias: "opus-5" }] };

    await importAliases(body);

    expect(importAliasesApi).toHaveBeenCalledExactlyOnceWith(body);
  });

  it("names no workspace and no person", async () => {
    await importAliases({ connectionId: "c", items: [{ modelId: "m", alias: "a" }] });

    const [sent] = importAliasesApi.mock.calls[0] as [Record<string, unknown>];

    expect(Object.keys(sent).sort()).toEqual(["connectionId", "items"]);
  });

  it("hands back what was created and what was skipped", async () => {
    await expect(
      importAliases({ connectionId: "c", items: [{ modelId: "claude-opus-5", alias: "opus-5" }] }),
    ).resolves.toEqual({ ok: true, result: importResult() });
  });

  it("reports a re-run that created nothing as a success, with what it passed over", async () => {
    // The idempotency, reported rather than silent: an operator who re-ran an import is owed
    // the list of what that meant.
    importAliasesApi.mockResolvedValue(
      importResult([], [{ modelId: "claude-fable-5", alias: "coder-max" }]),
    );

    const outcome = await importAliases({ connectionId: "c", items: [{ modelId: "m", alias: "a" }] });

    expect(outcome).toMatchObject({ ok: true });
    expect(outcome.ok && outcome.result.created).toEqual([]);
    expect(outcome.ok && outcome.result.skipped).toHaveLength(1);
  });

  it("hands an itemised refusal back with its details intact, so each row can be told", async () => {
    // The positions are the only thing that maps a message back to a row, so they must survive
    // this hop exactly as the service sent them.
    importAliasesApi.mockRejectedValue(ITEMISED);

    await expect(
      importAliases({ connectionId: "c", items: [{ modelId: "m", alias: "a" }] }),
    ).resolves.toEqual({
      ok: false,
      refusal: {
        code: "model_import_invalid",
        message: ITEMISED.message,
        details: ITEMISED.details,
      },
    });
  });

  it("hands a member's 403 back the same way, because the gate is the service's", async () => {
    importAliasesApi.mockRejectedValue(new ApiError(403, "forbidden", "no"));

    await expect(
      importAliases({ connectionId: "c", items: [{ modelId: "m", alias: "a" }] }),
    ).resolves.toMatchObject({ ok: false, refusal: { code: "forbidden" } });
  });

  it("lets the gate's redirect through", async () => {
    importAliasesApi.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(
      importAliases({ connectionId: "c", items: [{ modelId: "m", alias: "a" }] }),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});

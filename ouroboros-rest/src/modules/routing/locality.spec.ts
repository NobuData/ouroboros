import { PROVIDER_CONNECTION_KINDS } from "../db/schema";
import { CLOUD_PROVIDER_KINDS, LOCAL_PROVIDER_KINDS } from "../internal/providers";
import { isLocalProvider } from "./locality";

/**
 * One question, one answer, and the assertion that keeps it that way.
 *
 * The lease policy (`internal/providers.ts`) and this module both ask *is this provider
 * local*, and they must not be able to disagree — which is why this file borrows the list
 * rather than restating it, and why the first test reads the borrowed constant instead of
 * naming `ollama` and `openai_compatible` again.
 *
 * The second is the one this module has to answer alone: V015's column admits a sixth kind the
 * lease policy never had to classify.
 */

describe("classifying a provider kind", () => {
  it.each([...LOCAL_PROVIDER_KINDS])("calls %s local, as the lease policy does", (kind) => {
    expect(isLocalProvider(kind)).toBe(true);
  });

  it.each([...CLOUD_PROVIDER_KINDS])("does not call %s local", (kind) => {
    expect(isLocalProvider(kind)).toBe(false);
  });

  it("does not assume custom is local", () => {
    // The sixth kind, which the lease policy never had to classify. A connection whose adapter
    // is unspecified cannot be assumed reachable offline, and the honest default for *we do
    // not know what this is* is the one that does not promise the network is unnecessary.
    expect(isLocalProvider("custom")).toBe(false);
  });

  it("answers for every kind V015 accepts", () => {
    // A seventh kind added to the column should fail here rather than quietly defaulting to
    // cloud in a policy an operator relies on.
    const classified = [...LOCAL_PROVIDER_KINDS, ...CLOUD_PROVIDER_KINDS, "custom"];

    expect([...PROVIDER_CONNECTION_KINDS].toSorted()).toEqual(classified.toSorted());
  });
});

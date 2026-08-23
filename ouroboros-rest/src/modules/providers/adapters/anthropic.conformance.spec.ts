import {
  conformanceContext,
  describeAdapterConformance,
  type AdapterConformance,
} from "../conformance.fixture";
import { AnthropicAdapter } from "./anthropic.adapter";
import {
  ANTHROPIC_EXPECTED_MODELS,
  ANTHROPIC_MODEL_ENTRIES,
  ANTHROPIC_SECRET,
  recordedListing,
  recordedRefusal,
} from "./anthropic.recordings.fixture";
import { recordFailure, recordResponses } from "./http.recordings.fixture";

/**
 * AC.2's first acceptance criterion: **the conformance kit is green** for the Anthropic
 * adapter.
 *
 * This is the first *real* adapter to run the kit — the fake proved the rules were passable,
 * and what this proves is that they are passable by something that talks HTTP. Every case
 * below is arranged from a recorded response in `anthropic.recordings.fixture.ts`: a stand-in
 * `fetch` serves the capture, the adapter is called for real, and the kit checks the contract
 * on the way back out. No socket is opened, so this runs in `yarn test`.
 *
 * The five error classes are the interesting half, because the kit has no *"this cannot happen
 * for my provider"* escape hatch and every one of them is a real Anthropic answer:
 *
 * ```
 * auth        401 authentication_error   →  key rejected (401)
 * rate_limit  429 rate_limit_error       →  rate limited (429)
 * upstream    529 overloaded_error       →  529 upstream
 * network     socket refused             →  unreachable (ECONNREFUSED)
 * config      no credential at all       →  API key required        (no request is made)
 * ```
 *
 * `config` is derived rather than recorded, which is the habit `docs/MODEL_PROVIDERS.md` asks
 * an author to copy: a connection with no key is not a provider being down, and the adapter
 * knows it before it opens anything.
 */

/**
 * A harness over a freshly built adapter and a freshly arranged recording.
 *
 * A function, called once per `it`, so no case can be affected by a previous one's arranged
 * response — and each thunk arranges its own, because `jest.restoreMocks` puts the real
 * `fetch` back between cases.
 *
 * @returns The harness.
 */
function anthropicHarness(): AdapterConformance {
  const adapter = new AnthropicAdapter();

  const harness: AdapterConformance = {
    adapter,
    secret: ANTHROPIC_SECRET,
    // Empty, and legitimately so: this card's only field is the key row, and a credential is
    // never stored as configuration. It is the shape `storedConfigSchema` exists for.
    sampleConfig: {},
    validateSuccess: () => {
      // `validate` asks for one row — the smallest question that still needs the credential to
      // be honoured — so the recorded success is a one-entry listing.
      recordResponses(recordedListing({ entries: ANTHROPIC_MODEL_ENTRIES.slice(0, 1) }));

      return adapter.validate({}, ANTHROPIC_SECRET);
    },
    validateFailures: {
      auth: () => {
        recordResponses(recordedRefusal(401));

        return adapter.validate({}, ANTHROPIC_SECRET);
      },
      rate_limit: () => {
        recordResponses(recordedRefusal(429));

        return adapter.validate({}, ANTHROPIC_SECRET);
      },
      upstream: () => {
        // 529 rather than 503: `overloaded_error` is the one Anthropic actually answers when
        // it is over capacity, and a fixture recording the status a vendor really sends is
        // worth more than one recording the status a table happens to list.
        recordResponses(recordedRefusal(529));

        return adapter.validate({}, ANTHROPIC_SECRET);
      },
      network: () => {
        recordFailure();

        return adapter.validate({}, ANTHROPIC_SECRET);
      },
      // Derived from the schema, before any socket is opened. No recording, because there is
      // nothing to record: no request is made.
      config: () => adapter.validate({}, null),
    },
    discover: () => {
      recordResponses(recordedListing());

      return adapter.discoverModels(conformanceContext(harness));
    },
    expectedModels: ANTHROPIC_EXPECTED_MODELS,
    // Nothing pulls a hosted model onto a machine. The kit's complementary leg asserts the
    // member is unreachable rather than that the case does not apply.
    pull: null,
  };

  return harness;
}

describeAdapterConformance("AnthropicAdapter", anthropicHarness);

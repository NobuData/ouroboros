import {
  conformanceContext,
  describeAdapterConformance,
  type AdapterConformance,
} from "../conformance.fixture";
import { BASE_URL_FIELD, CAPABILITY_NOTE_FIELD } from "../provider.config";
import { recordFailure, recordResponses } from "./http.recordings.fixture";
import { OpenAiCompatibleAdapter } from "./openai-compatible.adapter";
import {
  OPENAI_COMPATIBLE_CAPABILITY_NOTE,
  OPENAI_COMPATIBLE_FLAVOURS,
  OPENAI_COMPATIBLE_SECRET,
  recordedListing,
  recordedRefusal,
  type OpenAiCompatibleFlavour,
} from "./openai-compatible.recordings.fixture";

/**
 * AC.3's first acceptance criterion: **the conformance kit is green against both a vLLM fixture
 * and a generic OpenAI-compatible fixture.**
 *
 * Two runs of the whole kit rather than one, because the claim this adapter makes is *"any
 * OpenAI-compatible endpoint"* and a kit green against one vendor's capture proves it about one
 * vendor. The two captures differ in the two ways that matter — a rich response against a bare
 * one, and an OpenAI-style `…/v1` base URL against a plain host — so the pair also covers both
 * spellings of the address field and both answers to *did the server say how much context it
 * has*. See `openai-compatible.recordings.fixture.ts`.
 *
 * Every case is arranged from a recorded response: a stand-in `fetch` serves the capture, the
 * adapter is called for real, and the kit checks the contract on the way back out. No socket is
 * opened, so this runs in `yarn test`.
 *
 * The five error classes are the interesting half, because the kit has no *"this cannot happen
 * for my provider"* escape hatch and every one of them is a real answer from a server speaking
 * this format:
 *
 * ```
 * auth        401 invalid_api_key        →  key rejected (401)
 * rate_limit  429 rate_limit_exceeded    →  rate limited (429)
 * upstream    503 model still loading    →  503 upstream
 * network     socket refused             →  10.0.4.20:8000 unreachable (ECONNREFUSED)
 * config      no address at all          →  Base URL required        (no request is made)
 * ```
 *
 * `config` is derived rather than recorded, which is the habit `docs/MODEL_PROVIDERS.md` asks an
 * author to copy: a connection with no address is not a provider being down, and the adapter
 * knows it before it opens anything. The SSRF policy's own cases — a `file:` URL, an unfollowed
 * redirect, a private range accepted — are `openai-compatible.adapter.spec.ts`'s, because they
 * are claims about *this* adapter rather than about the shared contract.
 */

/**
 * A harness over a freshly built adapter and a freshly arranged recording.
 *
 * A function, called once per `it`, so no case can be affected by a previous one's arranged
 * response — and each thunk arranges its own, because `jest.restoreMocks` puts the real `fetch`
 * back between cases.
 *
 * @param flavour - Which recorded endpoint to run the kit against.
 * @returns The harness.
 */
function harnessFor(flavour: OpenAiCompatibleFlavour): AdapterConformance {
  const adapter = new OpenAiCompatibleAdapter();
  // The stored configuration, which is the submission minus the credential — the address and
  // the card's second line. `capabilityNote` is here rather than omitted because the acceptance
  // criterion is that it *round-trips*: the kit validates this against `storedConfigSchema()`,
  // and `conformanceContext` hands the same object back to `discoverModels`.
  const config = {
    [BASE_URL_FIELD]: flavour.baseUrl,
    [CAPABILITY_NOTE_FIELD]: OPENAI_COMPATIBLE_CAPABILITY_NOTE,
  };

  const harness: AdapterConformance = {
    adapter,
    secret: OPENAI_COMPATIBLE_SECRET,
    sampleConfig: config,
    validateSuccess: () => {
      recordResponses(recordedListing(flavour.entries));

      return adapter.validate(config, OPENAI_COMPATIBLE_SECRET);
    },
    validateFailures: {
      auth: () => {
        // The recorded body quotes the credential back, which is what these servers really do.
        // The kit searches every rendered detail for it.
        recordResponses(recordedRefusal(401));

        return adapter.validate(config, OPENAI_COMPATIBLE_SECRET);
      },
      rate_limit: () => {
        recordResponses(recordedRefusal(429));

        return adapter.validate(config, OPENAI_COMPATIBLE_SECRET);
      },
      upstream: () => {
        // 503 rather than 500: a server that is still loading a model onto the device is the
        // way this kind is actually unavailable, and it is a state that clears itself.
        recordResponses(recordedRefusal(503));

        return adapter.validate(config, OPENAI_COMPATIBLE_SECRET);
      },
      network: () => {
        recordFailure();

        return adapter.validate(config, OPENAI_COMPATIBLE_SECRET);
      },
      // Derived from the schema, before any socket is opened. No recording, because there is
      // nothing to record: no request is made.
      config: () => adapter.validate({}, OPENAI_COMPATIBLE_SECRET),
    },
    discover: () => {
      recordResponses(recordedListing(flavour.entries));

      return adapter.discoverModels(conformanceContext(harness));
    },
    expectedModels: flavour.expected,
    // A served model is already loaded, and this wire format has no route to ask for another.
    // The kit's complementary leg asserts the member is unreachable rather than inapplicable.
    pull: null,
  };

  return harness;
}

for (const flavour of OPENAI_COMPATIBLE_FLAVOURS) {
  describeAdapterConformance(`OpenAiCompatibleAdapter · ${flavour.name}`, () =>
    harnessFor(flavour),
  );
}

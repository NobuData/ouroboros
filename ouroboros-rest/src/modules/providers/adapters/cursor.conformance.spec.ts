import {
  conformanceContext,
  describeAdapterConformance,
  type AdapterConformance,
} from "../conformance.fixture";
import { CAPABILITY_NOTE_FIELD } from "../provider.config";
import { CursorAdapter } from "./cursor.adapter";
import {
  CURSOR_CAPABILITY_NOTE,
  CURSOR_EXPECTED_MODELS,
  CURSOR_SECRET,
  recordedMe,
  recordedRefusal,
} from "./cursor.recordings.fixture";
import { recordFailure, recordResponses } from "./http.recordings.fixture";

/**
 * AC.5's first acceptance criterion for the Cursor adapter: **the conformance kit is green**.
 *
 * Every case below is arranged from a recorded response in `cursor.recordings.fixture.ts`: a
 * stand-in `fetch` serves the capture, the adapter is called for real, and the kit checks the
 * contract on the way back out. No socket is opened, so this runs in `yarn test`.
 *
 * ```
 * auth        401  the key quoted back in the body   →  key rejected (401)
 * rate_limit  429  too many requests                 →  rate limited (429)
 * upstream    503  temporarily unavailable           →  503 upstream
 * network     —    socket refused                    →  unreachable (ECONNREFUSED)
 * config      —    no key at all                     →  API key required        (no request)
 * ```
 *
 * One run rather than the Copilot suite's three: there is one thing this adapter can be asked
 * and one answer it can give, which is the whole reason it is in the same ticket as the
 * complicated one. The `401` body really contains the credential — see the recordings fixture
 * — so the kit's search for it in every rendered `detail` is asserted against a body that would
 * genuinely leak.
 */

/**
 * A harness over a freshly built adapter and a freshly arranged recording.
 *
 * A function, called once per `it`, so no case can be affected by a previous one's arranged
 * response — and each thunk arranges its own, because `jest.restoreMocks` puts the real `fetch`
 * back between cases.
 *
 * @returns The harness.
 */
function cursorHarness(): AdapterConformance {
  const adapter = new CursorAdapter();
  // The stored configuration. `capabilityNote` is here rather than omitted because the kit
  // validates it against `storedConfigSchema()` and `conformanceContext` hands the same object
  // back to `discoverModels` — so the card's second line is proved to round-trip.
  const config = { [CAPABILITY_NOTE_FIELD]: CURSOR_CAPABILITY_NOTE };

  const harness: AdapterConformance = {
    adapter,
    secret: CURSOR_SECRET,
    sampleConfig: config,
    validateSuccess: () => {
      recordResponses(recordedMe());

      return adapter.validate(config, CURSOR_SECRET);
    },
    validateFailures: {
      auth: () => {
        recordResponses(recordedRefusal(401));

        return adapter.validate(config, CURSOR_SECRET);
      },
      rate_limit: () => {
        recordResponses(recordedRefusal(429));

        return adapter.validate(config, CURSOR_SECRET);
      },
      upstream: () => {
        recordResponses(recordedRefusal(503));

        return adapter.validate(config, CURSOR_SECRET);
      },
      network: () => {
        recordFailure();

        return adapter.validate(config, CURSOR_SECRET);
      },
      // Derived from the schema, before any socket is opened. No recording, because there is
      // nothing to record: no request is made.
      config: () => adapter.validate(config, null),
    },
    // No recording at all: the catalog is declared, so discovery opens nothing. The kit's
    // normalized model checks apply to a fixed catalog exactly as they do to a listing.
    discover: () => adapter.discoverModels(conformanceContext(harness)),
    expectedModels: CURSOR_EXPECTED_MODELS,
    // Nothing pulls a hosted model onto a machine. The kit's complementary leg asserts the
    // member is unreachable rather than that the case does not apply.
    pull: null,
  };

  return harness;
}

describeAdapterConformance("CursorAdapter", cursorHarness);

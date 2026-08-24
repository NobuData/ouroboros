import {
  conformanceContext,
  describeAdapterConformance,
  type AdapterConformance,
} from "../conformance.fixture";
import { BASE_URL_FIELD, CAPABILITY_NOTE_FIELD } from "../provider.config";
import { OllamaAdapter } from "./ollama.adapter";
import {
  OLLAMA_CAPABILITY_NOTE,
  OLLAMA_EXPECTED_MODELS,
  OLLAMA_HOST,
  OLLAMA_PULLED_MODEL,
  OLLAMA_PULL_LINES,
  OLLAMA_RESUMED_PULL_LINES,
  recordedPull,
  recordedRefusal,
  recordedTags,
  recordedVersion,
} from "./ollama.recordings.fixture";
import { recordFailure, recordResponses } from "./http.recordings.fixture";

/**
 * AC.4's first acceptance criterion: **the conformance kit is green, including the streamed-pull
 * fixtures.**
 *
 * Two runs of the whole kit rather than one, and the difference between them is the pull. The
 * first is a **cold** pull — a manifest fetched before any size is known, then a layer moving,
 * then `success`. The second is the **partial-then-resumed** sequence the ticket asks for by
 * name: the same model pulled again after an interruption, so the daemon's very first byte count
 * is already at 61%. Both go through `pullStreamViolations`, which is the kit's assertion that a
 * stream ends with exactly one terminal event and that no progress reading is nonsense on the
 * way there.
 *
 * The other legs are the same contract every adapter shares. What is worth reading here is what
 * is *absent*: `secret` is `null`, because this adapter declares no credential field at all, and
 * the kit checks that in both directions — a harness with a credential and a schema with no
 * secret row fails, and so does the reverse.
 *
 * Every case is arranged from a recorded response: a stand-in `fetch` serves the capture, the
 * adapter is called for real, and the kit checks the contract on the way back out. No socket is
 * opened, so this runs in `yarn test`.
 *
 * The five error classes are the interesting half, because the kit has no *"this cannot happen
 * for my provider"* escape hatch:
 *
 * ```
 * auth        401 from a reverse proxy    →  key rejected (401)
 * rate_limit  429 from the same proxy     →  rate limited (429)
 * upstream    500 the runner was killed   →  500 upstream
 * network     socket refused              →  ken-station.local:11434 unreachable (ECONNREFUSED)
 * config      no host at all              →  Host required            (no request is made)
 * ```
 *
 * A daemon authenticates nobody, so `auth` and `rate_limit` are a proxy's answers — see
 * `ollama.recordings.fixture.ts` on why that is the rule earning its keep rather than a
 * contrivance. `network` is not a contrivance at all: it is AC.4's own acceptance criterion that
 * a **stopped Ollama** produces the designed network state rather than a hung request.
 */

/** One recorded pull, named for the `describe` block it runs the kit under. */
interface PullFlavour {
  /** What to call it. */
  readonly name: string;
  /** The NDJSON lines the daemon sends. */
  readonly lines: readonly unknown[];
  /**
   * How many bytes each network chunk carries, or undefined for one chunk per body.
   *
   * The cold pull is served in small chunks on purpose: NDJSON is line-delimited and TCP is not,
   * so an adapter that assumed one read is one line would pass a whole-body fixture and fail
   * against a real daemon on its first slow layer.
   */
  readonly chunkBytes?: number;
}

/** The two shapes a pull has, both recorded. */
const PULL_FLAVOURS: readonly PullFlavour[] = [
  { name: "a cold pull", lines: OLLAMA_PULL_LINES, chunkBytes: 17 },
  { name: "a resumed pull", lines: OLLAMA_RESUMED_PULL_LINES },
];

/**
 * A harness over a freshly built adapter and a freshly arranged recording.
 *
 * A function, called once per `it`, so no case can be affected by a previous one's arranged
 * response — and each thunk arranges its own, because `jest.restoreMocks` puts the real `fetch`
 * back between cases.
 *
 * @param flavour - Which recorded pull to run the kit's pull leg against.
 * @returns The harness.
 */
function harnessFor(flavour: PullFlavour): AdapterConformance {
  const adapter = new OllamaAdapter();
  // The stored configuration. `capabilityNote` is here rather than omitted because the kit
  // validates it against `storedConfigSchema()` and `conformanceContext` hands the same object
  // back to `discoverModels` — so the card's second line is proved to round-trip.
  const config = {
    [BASE_URL_FIELD]: OLLAMA_HOST,
    [CAPABILITY_NOTE_FIELD]: OLLAMA_CAPABILITY_NOTE,
  };

  const harness: AdapterConformance = {
    adapter,
    // No credential anywhere, which is the point of this card. The kit asserts the schema agrees:
    // a `null` here against a schema that marked a secret field would fail.
    secret: null,
    sampleConfig: config,
    validateSuccess: () => {
      recordResponses(recordedVersion());

      return adapter.validate(config, null);
    },
    validateFailures: {
      auth: () => {
        // A reverse proxy's challenge, not the daemon's — see this file's header.
        recordResponses(recordedRefusal(401));

        return adapter.validate(config, null);
      },
      rate_limit: () => {
        recordResponses(recordedRefusal(429));

        return adapter.validate(config, null);
      },
      upstream: () => {
        recordResponses(recordedRefusal(500));

        return adapter.validate(config, null);
      },
      network: () => {
        // A stopped daemon. AC.4's eighth acceptance criterion, as a conformance case.
        recordFailure();

        return adapter.validate(config, null);
      },
      // Derived from the schema, before any socket is opened. No recording, because there is
      // nothing to record: no request is made.
      config: () => adapter.validate({}, null),
    },
    discover: () => {
      recordResponses(recordedTags());

      return adapter.discoverModels(conformanceContext(harness));
    },
    expectedModels: OLLAMA_EXPECTED_MODELS,
    // Nothing extra: the daemon's models differ in how they were loaded rather than in what
    // may be set on them, so there is one schema and the recording exercises it.
    paramModels: [],
    pull: () => {
      recordResponses(recordedPull(flavour.lines, { chunkBytes: flavour.chunkBytes }));

      return adapter.pullModel(conformanceContext(harness), OLLAMA_PULLED_MODEL);
    },
  };

  return harness;
}

for (const flavour of PULL_FLAVOURS) {
  describeAdapterConformance(`OllamaAdapter · ${flavour.name}`, () => harnessFor(flavour));
}

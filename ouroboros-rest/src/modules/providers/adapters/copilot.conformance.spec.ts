import {
  conformanceContext,
  describeAdapterConformance,
  type AdapterConformance,
} from "../conformance.fixture";
import { CAPABILITY_NOTE_FIELD, type ProviderConnectionConfig } from "../provider.config";
import { COPILOT_ORGANIZATION_FIELD, CopilotAdapter } from "./copilot.adapter";
import {
  COPILOT_BILLING_WITHOUT_SEATS,
  COPILOT_CAPABILITY_NOTE,
  COPILOT_EXPECTED_MODELS,
  COPILOT_ORGANIZATION,
  COPILOT_SECRET,
  recordedBilling,
  recordedProxyChallenge,
  recordedRefusal,
  recordedUser,
} from "./copilot.recordings.fixture";
import { recordFailure, recordRepeatedly, recordResponses } from "./http.recordings.fixture";

/**
 * AC.5's first acceptance criterion for the Copilot adapter: **the conformance kit is green**.
 *
 * Every case below is arranged from a recorded response in `copilot.recordings.fixture.ts`: a
 * stand-in `fetch` serves the capture, the adapter is called for real, and the kit checks the
 * contract on the way back out. No socket is opened, so this runs in `yarn test`.
 *
 * ```
 * auth        401  a proxy's page quoting the token   →  key rejected (401)
 * rate_limit  429  secondary rate limit               →  rate limited (429)
 * upstream    503  GitHub unavailable                 →  503 upstream        (retried once)
 * network     —    socket refused                     →  unreachable (ECONNREFUSED)
 * config      —    no token at all                    →  GitHub token required   (no request)
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The kit runs three times, and the third run is the acceptance criterion about seats.**
 *
 * A kit green against one entitlement answer proves the adapter handles one entitlement
 * answer, and decision **P8** is precisely about the difference between them. So
 * {@link ENTITLEMENT_FLAVOURS} is the three states a real connection is in — an organization
 * that reports its seats, one whose plan does not, and a connection with no organization
 * configured at all — and each one runs the whole suite. The middle and last must produce a
 * `detail` with **no** seat suffix, which the kit's *the detail never contains the credential
 * and always says something* checks do not care about but
 * `copilot.adapter.spec.ts` asserts exactly.
 *
 * The `config` case is derived rather than recorded, which is the habit
 * `docs/MODEL_PROVIDERS.md` asks an author to copy: a connection with no token is not a
 * provider being down, and the adapter knows it before it opens anything.
 */

/** One of the three entitlement states a real Copilot connection is in. */
interface EntitlementFlavour {
  /** What the run is called, in the `describe` block. */
  readonly name: string;
  /** The stored configuration for it. */
  readonly config: ProviderConnectionConfig;
  /**
   * The billing response the recording serves, or null when there is no organization and the
   * adapter therefore makes no second request at all.
   */
  readonly billing: (() => Response) | null;
}

const ENTITLEMENT_FLAVOURS: readonly EntitlementFlavour[] = [
  {
    name: "an org that reports its seats",
    config: {
      [COPILOT_ORGANIZATION_FIELD]: COPILOT_ORGANIZATION,
      [CAPABILITY_NOTE_FIELD]: COPILOT_CAPABILITY_NOTE,
    },
    billing: () => recordedBilling(),
  },
  {
    name: "an org whose plan reports none",
    config: {
      [COPILOT_ORGANIZATION_FIELD]: COPILOT_ORGANIZATION,
      [CAPABILITY_NOTE_FIELD]: COPILOT_CAPABILITY_NOTE,
    },
    billing: () => recordedBilling(COPILOT_BILLING_WITHOUT_SEATS),
  },
  {
    // The ordinary state of a connection whose owner is not an administrator of the
    // organization paying for it. No organization is a blank field rather than an error.
    name: "no organization configured",
    config: { [CAPABILITY_NOTE_FIELD]: COPILOT_CAPABILITY_NOTE },
    billing: null,
  },
];

/**
 * A harness over a freshly built adapter and a freshly arranged recording.
 *
 * A function, called once per `it`, so no case can be affected by a previous one's arranged
 * response — and each thunk arranges its own, because `jest.restoreMocks` puts the real `fetch`
 * back between cases.
 *
 * @param flavour - Which entitlement state to run the kit against.
 * @returns The harness.
 */
function harnessFor(flavour: EntitlementFlavour): AdapterConformance {
  const adapter = new CopilotAdapter();
  // The stored configuration. `capabilityNote` is here rather than omitted because the kit
  // validates it against `storedConfigSchema()` and `conformanceContext` hands the same object
  // back to `discoverModels` — so the card's second line is proved to round-trip.
  const config = flavour.config;

  const harness: AdapterConformance = {
    adapter,
    secret: COPILOT_SECRET,
    sampleConfig: config,
    validateSuccess: () => {
      const billing = flavour.billing;

      // Two responses where there is an organization to ask about, one where there is not —
      // and the second is a *different* object rather than the same one repeated, because a
      // body may be read once and the billing response is the one body this adapter reads.
      recordResponses(...(billing === null ? [recordedUser()] : [recordedUser(), billing()]));

      return adapter.validate(config, COPILOT_SECRET);
    },
    validateFailures: {
      auth: () => {
        // A TLS-inspecting proxy's page, which really quotes the token — see the recordings
        // fixture. The kit searches this call's rendered detail for the credential.
        recordResponses(recordedProxyChallenge());

        return adapter.validate(config, COPILOT_SECRET);
      },
      rate_limit: () => {
        recordResponses(recordedRefusal(429));

        return adapter.validate(config, COPILOT_SECRET);
      },
      upstream: () => {
        // `recordRepeatedly` rather than `recordResponses`, because this is the one class the
        // adapter retries: a second attempt asks for a second response, and handing back the
        // same object would be a *body already used* failure rather than the behaviour under
        // test. The bound itself is asserted in `copilot.adapter.spec.ts`.
        recordRepeatedly(() => recordedRefusal(503));

        return adapter.validate(config, COPILOT_SECRET);
      },
      network: () => {
        recordFailure();

        return adapter.validate(config, COPILOT_SECRET);
      },
      // Derived from the schema, before any socket is opened. No recording, because there is
      // nothing to record: no request is made.
      config: () => adapter.validate(config, null),
    },
    // No recording at all: the catalog is declared, so discovery opens nothing. That is the
    // whole difference between this adapter and the three before it, and the kit's normalized
    // model checks apply to a fixed catalog exactly as they do to a discovered listing.
    discover: () => adapter.discoverModels(conformanceContext(harness)),
    expectedModels: COPILOT_EXPECTED_MODELS,
    // Nothing pulls a hosted model onto a machine. The kit's complementary leg asserts the
    // member is unreachable rather than that the case does not apply.
    pull: null,
  };

  return harness;
}

for (const flavour of ENTITLEMENT_FLAVOURS) {
  describeAdapterConformance(`CopilotAdapter · ${flavour.name}`, () => harnessFor(flavour));
}

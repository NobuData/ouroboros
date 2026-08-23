import {
  conformanceContext,
  describeAdapterConformance,
  type AdapterConformance,
} from "../conformance.fixture";
import {
  FAKE_CONFIG,
  FAKE_MODELS,
  FAKE_SECRET,
  FakeModelProviderAdapter,
  FakePullingProviderAdapter,
  type FakeAdapterOptions,
} from "./fake.adapter.fixture";

/**
 * AC.1's first acceptance criterion: **the conformance kit is green for the fake adapter.**
 *
 * The criterion is really about the kit rather than about the fake. A set of rules no
 * implementation satisfies is a set of rules nobody can adopt, and the cheapest way to find out
 * that a kit demands something impossible is to have written one adapter that passes it. That
 * the kit also *refuses* a non-conforming adapter is `conformance.fixture.spec.ts`'s question;
 * the two together are what make it a gate rather than a decoration.
 *
 * Both fakes run, because the kit has a leg that only exists for a pulling adapter and a
 * complementary one that asserts the member is unreachable without the capability. Running only
 * the non-pulling fake would leave the first of those never executed.
 */

/**
 * A harness over a freshly built fake.
 *
 * A function, called once per `it`, so no case can be affected by a previous one's scripted
 * outcome. The scripting is what stands in for a recorded HTTP response here: the fake has no
 * wire to capture, so its fixture is the result the captured response would have produced.
 *
 * @param options - Passed to the fake's constructor.
 * @param pulling - Whether to build the pulling fake.
 * @returns The harness.
 */
function harnessFor(options: FakeAdapterOptions, pulling: boolean): AdapterConformance {
  const adapter = pulling
    ? new FakePullingProviderAdapter(options)
    : new FakeModelProviderAdapter(options);

  const harness: AdapterConformance = {
    adapter,
    secret: FAKE_SECRET,
    sampleConfig: FAKE_CONFIG,
    validateSuccess: () => adapter.validate(FAKE_CONFIG, FAKE_SECRET),
    validateFailures: {
      auth: () => adapter.willFail("auth").validate(FAKE_CONFIG, FAKE_SECRET),
      network: () => adapter.willFail("network").validate(FAKE_CONFIG, FAKE_SECRET),
      upstream: () => adapter.willFail("upstream").validate(FAKE_CONFIG, FAKE_SECRET),
      rate_limit: () => adapter.willFail("rate_limit").validate(FAKE_CONFIG, FAKE_SECRET),
      // Derived rather than scripted: the fake finds its own required field missing, which is
      // the habit `docs/MODEL_PROVIDERS.md` asks an adapter author to copy — check the
      // configuration before opening a socket.
      config: () => adapter.validate({}, FAKE_SECRET),
    },
    discover: () => adapter.discoverModels(conformanceContext(harness)),
    expectedModels: FAKE_MODELS,
    pull: pulling
      ? () =>
          (adapter as FakePullingProviderAdapter).pullModel(
            conformanceContext(harness),
            "qwen3-coder:32b",
          )
      : null,
  };

  return harness;
}

describeAdapterConformance("FakeModelProviderAdapter", () => harnessFor({}, false));

describeAdapterConformance("FakePullingProviderAdapter", () => harnessFor({}, true));

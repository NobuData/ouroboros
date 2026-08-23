import {
  FakeModelProviderAdapter,
  FakePullingProviderAdapter,
} from "./adapters/fake.adapter.fixture";
import { supportsPull, validationPill, type ModelProviderAdapter } from "./provider.adapter";
import { CONNECTED_PILL, PROVIDER_ERROR_PILLS } from "./provider.errors";

/**
 * The SPI's two run-time helpers, and AC.1's fifth acceptance criterion.
 *
 * *"`capabilities()` gates optional members: calling `pullModel` on an adapter that does not
 * declare `pull` is a **type error**, not a runtime one."*
 *
 * A type error cannot be caught with `expect`, so it is asserted with `@ts-expect-error`, which
 * inverts the usual direction: TypeScript reports *"Unused '@ts-expect-error' directive"* when
 * the line below it compiles. So the day somebody adds an optional `pullModel` to
 * {@link ModelProviderAdapter} — which is the shape this SPI exists to refuse — this suite stops
 * compiling and ts-jest fails it. It is the only kind of test that can hold that criterion.
 */

describe("the pull capability gate", () => {
  it("does not expose pullModel on the interface every caller holds", () => {
    const adapter: ModelProviderAdapter = new FakeModelProviderAdapter();

    // @ts-expect-error — Property 'pullModel' does not exist on type 'ModelProviderAdapter'.
    // This is AC.1's fifth acceptance criterion. If this line ever compiles, the criterion is
    // gone and the failure has moved from here to a person who clicked *Pull latest*.
    expect(adapter.pullModel).toBeUndefined();
  });

  it("exposes it once supportsPull has narrowed", () => {
    const adapter: ModelProviderAdapter = new FakePullingProviderAdapter();

    expect(supportsPull(adapter)).toBe(true);

    if (supportsPull(adapter)) {
      // No cast, no optional call, no `in` check: the guard is the whole of the access. That is
      // what makes the member unreachable without one.
      expect(typeof adapter.pullModel).toBe("function");
    }
  });

  it("narrows on the declared flag rather than on the member being there", () => {
    // An adapter is entitled to say what it can do. A half-finished or inherited `pullModel` on
    // something reporting `pull: false` must not become callable because it happens to exist —
    // the registry is what refuses to accept that disagreement at all.
    const liar = Object.assign(new FakeModelProviderAdapter(), {
      pullModel: () => {
        throw new Error("should be unreachable");
      },
    });

    expect(supportsPull(liar)).toBe(false);
  });

  it("says no for an adapter that does not pull", () => {
    expect(supportsPull(new FakeModelProviderAdapter())).toBe(false);
  });
});

describe("validationPill", () => {
  it("renders a success as connected", () => {
    expect(validationPill({ status: "ok", latencyMs: 38, detail: "200" })).toBe(CONNECTED_PILL);
  });

  it("renders a failure as its class's pill", () => {
    expect(
      validationPill({ status: "failed", errorClass: "upstream", detail: "503 upstream" }),
    ).toBe(PROVIDER_ERROR_PILLS.upstream);
  });
});

describe("the reserved invocation capability", () => {
  it("is declared and false on everything that ships today", () => {
    // AF.2 (#235) is what makes a `true` mean anything. The flag existing now is what lets that
    // ticket extend the interface instead of reshaping it — every adapter already answers the
    // question, so adding `InvocationCapableAdapter` beside `PullCapableAdapter` breaks nothing.
    expect(new FakeModelProviderAdapter().capabilities().invocation).toBe(false);
    expect(new FakePullingProviderAdapter().capabilities().invocation).toBe(false);
  });
});

import {
  FakeModelProviderAdapter,
  FakePullingProviderAdapter,
} from "./adapters/fake.adapter.fixture";
import {
  supportsPull,
  validationNote,
  validationPill,
  type ModelProviderAdapter,
} from "./provider.adapter";
import {
  CONNECTED_PILL,
  PROVIDER_ERROR_CLASSES,
  PROVIDER_ERROR_PILLS,
  PROVIDER_ERROR_RETRYABLE,
} from "./provider.errors";

/**
 * The SPI's three run-time helpers, and AC.1's fifth acceptance criterion.
 *
 * *"`capabilities()` gates optional members: calling `pullModel` on an adapter that does not
 * declare `pull` is a **type error**, not a runtime one."*
 *
 * A type error cannot be caught with `expect`, so it is asserted with `@ts-expect-error`, which
 * inverts the usual direction: TypeScript reports *"Unused '@ts-expect-error' directive"* when
 * the line below it compiles. So the day somebody adds an optional `pullModel` to
 * {@link ModelProviderAdapter} — which is the shape this SPI exists to refuse — this suite stops
 * compiling and ts-jest fails it. It is the only kind of test that can hold that criterion.
 *
 * {@link validationNote} is the third helper, added by AC.5
 * ([#220](https://github.com/NobuData/ouroboros/issues/220)) beside {@link validationPill} and
 * asserted the same way: both turn one validation result into one thing mockup 07 draws, and
 * neither knows which provider produced it.
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

describe("validationNote", () => {
  it("is the adapter's own detail for a success", () => {
    // The `· 38ms` is the card's — a failure has no latency at all, so appending one here would
    // be a rendering decision made where half the cases cannot supply it.
    expect(validationNote({ status: "ok", latencyMs: 38, detail: "200" })).toBe("200");
  });

  it("carries an entitlement through untouched", () => {
    // AC.5's Copilot card. The seat suffix is `provider.entitlements.ts`'s and this does not
    // second-guess it.
    expect(validationNote({ status: "ok", latencyMs: 51, detail: "200 · 4 seats" })).toBe(
      "200 · 4 seats",
    );
  });

  it("draws mockup 07's Copilot note from the taxonomy", () => {
    // AC.5's second acceptance criterion, at the layer that owns the sentence: the `503
    // upstream` is the adapter's detail, the `· retrying` is `PROVIDER_ERROR_RETRYABLE`, and
    // nothing in either half knows which provider it is describing.
    expect(
      validationNote({ status: "failed", errorClass: "upstream", detail: "503 upstream" }),
    ).toBe("503 upstream · retrying");
  });

  it("says nothing about retrying for a failure a retry cannot fix", () => {
    // A refused credential stays refused and a wrong address stays wrong. Promising a person
    // that something is being done about their typo is worse than saying nothing.
    expect(
      validationNote({ status: "failed", errorClass: "auth", detail: "key rejected (401)" }),
    ).toBe("key rejected (401)");
    expect(
      validationNote({ status: "failed", errorClass: "config", detail: "API key required" }),
    ).toBe("API key required");
  });

  it.each(PROVIDER_ERROR_CLASSES)(
    "appends retrying to a %s failure iff it is retryable",
    (errorClass) => {
      // Written over the whole taxonomy rather than over the two interesting classes, so a sixth
      // class added to `ProviderErrorClass` arrives here with a case already waiting for it.
      const note = validationNote({ status: "failed", errorClass, detail: "detail" });

      expect(note.endsWith(" · retrying")).toBe(PROVIDER_ERROR_RETRYABLE[errorClass]);
      expect(note.startsWith("detail")).toBe(true);
    },
  );
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

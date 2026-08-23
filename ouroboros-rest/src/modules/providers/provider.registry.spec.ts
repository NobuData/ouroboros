import { InvalidRequestError, NotImplementedError } from "../errors/error.envelope";
import {
  FakeModelProviderAdapter,
  FakePullingProviderAdapter,
} from "./adapters/fake.adapter.fixture";
import type { ModelProviderAdapter } from "./provider.adapter";
import {
  ModelProviderRegistry,
  PROVIDER_REGISTRY_ERRORS,
  providerKindCannotPull,
  providerKindUnsupported,
} from "./provider.registry";

/**
 * The lookup, and the two things it refuses.
 *
 * The registry is small on purpose — a map and two error paths — so most of what is worth
 * asserting is at its *edges*: what it does with a build that has no adapters (which is this
 * build), and the two misuses it stops at construction rather than at a call site.
 *
 * The boot-time checks are the interesting half. A duplicate kind and a lying capability flag
 * are both programming errors, and both are the kind that otherwise surface as *the wrong
 * adapter answered* or *undefined is not a function* somewhere unrelated.
 */

/**
 * A registry over the given adapters.
 *
 * Constructed directly rather than through the Nest injector: the injector's job is covered by
 * `providers.module.spec.ts`, and everything here is about the class.
 *
 * @param adapters - What to register.
 * @returns The registry.
 */
function registryOf(...adapters: ModelProviderAdapter[]): ModelProviderRegistry {
  return new ModelProviderRegistry(adapters);
}

describe("an empty registry — this build", () => {
  it("lists no kinds", () => {
    expect(registryOf().kinds()).toEqual([]);
  });

  it("answers 501 for a kind V015 accepts but nothing implements", () => {
    // The honest answer while AC.2–AC.5 are open: the row is valid and this build cannot reach
    // it. A 404 would be indistinguishable from a caller with the path wrong.
    const registry = registryOf();

    expect(() => registry.get("anthropic")).toThrow(NotImplementedError);
    expect(() => registry.get("anthropic")).toThrow(
      "This build has no adapter for that provider kind.",
    );
  });

  it("answers undefined from find, which is the honest shape for a lookup", () => {
    expect(registryOf().find("anthropic")).toBeUndefined();
  });
});

describe("a populated registry", () => {
  it("returns the adapter registered for a kind", () => {
    const anthropic = new FakeModelProviderAdapter({ kind: "anthropic" });
    const ollama = new FakePullingProviderAdapter();

    expect(registryOf(anthropic, ollama).get("anthropic")).toBe(anthropic);
    expect(registryOf(anthropic, ollama).get("ollama")).toBe(ollama);
  });

  it("lists kinds in V015's declaration order rather than the injector's", () => {
    // A catalog page's ordering must not depend on what order Nest happened to construct
    // providers in.
    const registry = registryOf(
      new FakeModelProviderAdapter({ kind: "cursor" }),
      new FakePullingProviderAdapter(),
      new FakeModelProviderAdapter({ kind: "anthropic" }),
    );

    expect(registry.kinds()).toEqual(["anthropic", "ollama", "cursor"]);
  });

  it("names what is available when it refuses a kind", () => {
    const registry = registryOf(new FakeModelProviderAdapter({ kind: "anthropic" }));

    try {
      registry.get("cursor");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(NotImplementedError);
      expect((error as NotImplementedError).details).toEqual({
        kind: "cursor",
        registered: ["anthropic"],
      });
    }
  });
});

describe("pullCapable", () => {
  it("narrows an adapter that declares the capability", () => {
    const registry = registryOf(new FakePullingProviderAdapter());

    expect(typeof registry.pullCapable("ollama").pullModel).toBe("function");
  });

  it("refuses one that does not, with a 422", () => {
    // The connection exists and the route exists; what is not acceptable is asking *this*
    // provider to do it. In practice: a card rendered from a stale capability set.
    const registry = registryOf(new FakeModelProviderAdapter({ kind: "cursor" }));

    expect(() => registry.pullCapable("cursor")).toThrow(InvalidRequestError);
    expect(() => registry.pullCapable("cursor")).toThrow(
      "This provider does not pull models onto a host.",
    );
  });

  it("still refuses an unregistered kind as unsupported", () => {
    // Order matters: *no adapter* and *an adapter that cannot pull* are different facts, and a
    // 422 for the first would send somebody looking at a provider's capabilities instead of at
    // the module list.
    expect(() => registryOf().pullCapable("ollama")).toThrow(NotImplementedError);
  });
});

describe("misuses refused at construction", () => {
  it("refuses two adapters claiming the same kind", () => {
    // Otherwise one of them silently shadows the other, on whichever order the injector
    // produced — a bug that reproduces on one machine and not another.
    expect(() =>
      registryOf(
        new FakeModelProviderAdapter({ kind: "anthropic" }),
        new FakeModelProviderAdapter({ kind: "anthropic" }),
      ),
    ).toThrow('Two adapters are registered for provider kind "anthropic"');
  });

  it("refuses an adapter whose pull flag disagrees with its member", () => {
    // `supportsPull` narrows on the flag, so a flag that lies is either an unreachable
    // `pullModel` or a `TypeError` at a call site the compiler was told is safe.
    const liar = Object.assign(new FakeModelProviderAdapter({ kind: "ollama" }), {
      pullModel: () => {
        throw new Error("should be unreachable");
      },
    });

    expect(() => registryOf(liar)).toThrow(/declares pull: false but its pullModel member/);
  });

  it("refuses one that claims pull with nothing behind it", () => {
    const empty = new FakeModelProviderAdapter({ kind: "ollama" });
    jest.spyOn(empty, "capabilities").mockReturnValue({
      discovery: true,
      pull: true,
      entitlements: false,
      invocation: false,
    });

    expect(() => registryOf(empty)).toThrow(/declares pull: true but its pullModel member/);
  });
});

describe("the published codes", () => {
  it("are what the two constructors carry", () => {
    expect(providerKindUnsupported("anthropic", []).code).toBe(
      PROVIDER_REGISTRY_ERRORS.kindUnsupported,
    );
    expect(providerKindCannotPull("cursor").code).toBe(PROVIDER_REGISTRY_ERRORS.kindCannotPull);
  });

  it("answer the statuses their names imply", () => {
    expect(providerKindUnsupported("anthropic", []).getStatus()).toBe(501);
    expect(providerKindCannotPull("cursor").getStatus()).toBe(422);
  });

  it("copies the registered list rather than aliasing the caller's", () => {
    const registered: string[] = [];
    const error = providerKindUnsupported("anthropic", registered as never);
    registered.push("mutated");

    expect(error.details).toEqual({ kind: "anthropic", registered: [] });
  });
});

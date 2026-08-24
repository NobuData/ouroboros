import { AuditContextMiddleware } from "./audit.middleware";
import { currentClientAddress } from "./audit.context";

/**
 * The one stage that can open the store, and the reason it is a middleware.
 *
 * `AsyncLocalStorage.run` exists for the duration of a callback, so something has to *wrap*
 * the rest of the request. An interceptor hands back an `Observable` that Nest subscribes to
 * after the interceptor's frame has returned, which would put the handler outside any scope
 * it opened — so this asserts the property that makes the choice correct: everything
 * downstream of `next()`, including what it schedules, reads the address.
 */

describe("the audit context middleware", () => {
  it("opens a store the rest of the request reads", () => {
    const middleware = new AuditContextMiddleware();
    let seen: string | undefined;

    middleware.use({ socket: { remoteAddress: "198.51.100.24" } }, undefined, () => {
      seen = currentClientAddress();
    });

    expect(seen).toBe("198.51.100.24");
  });

  it("normalises before it stores, so nothing downstream has to", () => {
    const middleware = new AuditContextMiddleware();
    let seen: string | undefined;

    middleware.use({ socket: { remoteAddress: "::ffff:10.0.4.20" } }, undefined, () => {
      seen = currentClientAddress();
    });

    expect(seen).toBe("10.0.4.20");
  });

  it("reaches everything the continuation schedules", async () => {
    // The property an interceptor could not give: a writer reads this after several awaits,
    // from a call stack that never saw the request.
    const middleware = new AuditContextMiddleware();
    let seen: string | undefined;

    await new Promise<void>((resolve) => {
      middleware.use({ socket: { remoteAddress: "203.0.113.7" } }, undefined, () => {
        void Promise.resolve()
          .then(() => Promise.resolve())
          .then(() => {
            seen = currentClientAddress();
            resolve();
          });
      });
    });

    expect(seen).toBe("203.0.113.7");
  });

  it("opens a store even when there is no address, so the question is always answerable", () => {
    // Applied to every route including the public ones. A store nothing reads costs one
    // object per request; a route with no store would make *this happened from nowhere*
    // indistinguishable from a missing registration.
    const middleware = new AuditContextMiddleware();
    let called = false;

    middleware.use({}, undefined, () => {
      called = true;
      expect(currentClientAddress()).toBeUndefined();
    });

    expect(called).toBe(true);
  });

  it("continues the request exactly once", () => {
    const middleware = new AuditContextMiddleware();
    const next = jest.fn();

    middleware.use({ socket: { remoteAddress: "198.51.100.24" } }, undefined, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

/**
 * The stand-in `fetch` every HTTP adapter's recorded fixtures are served through.
 *
 * AC.2 ([#217](https://github.com/NobuData/ouroboros/issues/217)) wrote these beside the
 * Anthropic recordings; AC.3 ([#218](https://github.com/NobuData/ouroboros/issues/218)) moved
 * them here rather than making a second copy, and AC.4
 * ([#219](https://github.com/NobuData/ouroboros/issues/219)) and AC.5
 * ([#220](https://github.com/NobuData/ouroboros/issues/220)) use the same ones. A test harness
 * in two copies is a test harness with two behaviours, and the one that matters here — *how
 * many times may the same `Response` be handed back* — is exactly the kind that drifts.
 *
 * Nothing in this file knows a provider. What each adapter keeps beside itself is its
 * **recordings**: the captured bodies, the vendor's own error envelope, and what the listing
 * must normalize to. This is only the machinery that serves them.
 *
 * **The global `fetch` is spied on rather than injected**, for `probe.client.spec.ts`'s reason:
 * injecting one would make every assertion *"the adapter called the function it was given"*,
 * which is equally true of an adapter that also calls the real one. No socket is opened by any
 * of this, which is what lets the conformance kits run in `yarn test`.
 *
 * It is a `.fixture.ts`: type-checked with the code it exercises, left out of the image by
 * `tsconfig.build.json`, and not counted as application code by `jest.config.mjs`.
 */

/**
 * Serve these responses to the next `fetch` calls, in order.
 *
 * @param responses - What to answer, oldest first. The last one is repeated if the adapter asks
 *   again, so a test that does not care how many calls happen does not have to count — but it
 *   is repeated as the *same object*, and a body may be read once. A test whose adapter really
 *   reads more bodies than there are responses here wants {@link recordRepeatedly}.
 * @returns The spy, for a test that wants to read the request the provider would have seen.
 */
export function recordResponses(
  ...responses: readonly Response[]
): jest.MockedFunction<typeof fetch> {
  const spy = jest.spyOn(globalThis, "fetch") as unknown as jest.MockedFunction<typeof fetch>;

  spy.mockReset();

  for (const response of responses.slice(0, -1)) {
    spy.mockResolvedValueOnce(response);
  }

  spy.mockResolvedValue(responses[responses.length - 1]);

  return spy;
}

/**
 * Answer every `fetch` with a freshly built response.
 *
 * The counterpart of {@link recordResponses} for a test that drives an adapter round a loop: a
 * `Response`'s body may be read once, so handing the same object back a second time is a *body
 * already used* failure rather than the behaviour under test.
 *
 * @param build - Builds one response. Called once per request.
 * @returns The spy.
 */
export function recordRepeatedly(build: () => Response): jest.MockedFunction<typeof fetch> {
  const spy = jest.spyOn(globalThis, "fetch") as unknown as jest.MockedFunction<typeof fetch>;

  spy.mockReset();
  // eslint-disable-next-line @typescript-eslint/require-await
  spy.mockImplementation(async () => build());

  return spy;
}

/**
 * Fail the next `fetch` the way the runtime fails.
 *
 * @param error - What to reject with. Defaults to a refused connection.
 * @returns The spy.
 */
export function recordFailure(
  error: unknown = recordedTransportFailure(),
): jest.MockedFunction<typeof fetch> {
  const spy = jest.spyOn(globalThis, "fetch") as unknown as jest.MockedFunction<typeof fetch>;

  spy.mockReset();
  spy.mockRejectedValue(error);

  return spy;
}

/**
 * The transport failure a refused socket really arrives as.
 *
 * `fetch` reports one as a `TypeError` reading *fetch failed* whose `cause` carries the code —
 * which is the shape `errors/failure.ts` exists to look through, and the reason a fixture that
 * threw a bare `Error` would prove nothing.
 *
 * @param code - The runtime's code. Defaults to a refused connection.
 * @returns The error to reject with.
 */
export function recordedTransportFailure(code = "ECONNREFUSED"): unknown {
  return new TypeError("fetch failed", { cause: { code } });
}

/**
 * A deadline, as `AbortSignal.timeout` reports one.
 *
 * A `DOMException`, which Node does **not** make an `instanceof Error` — the trap
 * `provider.errors.ts`'s `isTimeout` is written for. Constructed here so a test of the timeout
 * phrase exercises the real shape rather than an object with the right `name`.
 *
 * @returns The error to reject with.
 */
export function recordedTimeout(): unknown {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

/**
 * The request the provider would have received, from a spy.
 *
 * @param spy - The `fetch` spy.
 * @param index - Which call. Defaults to the first.
 * @returns Its URL and its init, so a test can assert the method, the headers and the deadline
 *   without repeating the tuple destructuring.
 */
export function recordedRequest(
  spy: jest.MockedFunction<typeof fetch>,
  index = 0,
): { url: string; init: RequestInit } {
  const [target, init] = spy.mock.calls[index];
  // `fetch` accepts three things and these adapters only ever pass the first, but the tuple's
  // type is all three — and `String(new Request(…))` is `[object Object]`, which would make a
  // URL assertion pass for the wrong reason.
  const url =
    typeof target === "string" ? target : target instanceof URL ? target.href : target.url;

  return { url, init: init ?? {} };
}

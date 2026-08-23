/**
 * The address policy — what an adapter that accepts an **operator-supplied URL** is allowed to
 * do with it, and the four rules that make that safe.
 *
 * AC.3 ([#218](https://github.com/NobuData/ouroboros/issues/218)), shared with AC.4
 * ([#219](https://github.com/NobuData/ouroboros/issues/219)). Written once, here, rather than
 * twice in two adapters, because a security policy that exists in two copies is a security
 * policy with two versions.
 *
 * ```
 * resolveProviderAddress("http://10.0.4.20:8000/v1")  → ok   ·  RFC-1918 is the use case
 * resolveProviderAddress("file:///etc/passwd")        → no   ·  scheme allow-list
 * resolveProviderAddress("http://k:s@host/v1")        → no   ·  userinfo is a credential
 * fetch(url, { redirect: PROVIDER_REDIRECT })         → 302 arrives as a refusal, unfollowed
 * readCappedBody(response, PROVIDER_MAX_RESPONSE_BYTES) → a stranger's endpoint cannot stream
 *                                                          this process out of memory
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Private ranges are deliberately allowed, and that is the whole design.**
 *
 * Two adapters take an address from a person: the OpenAI-compatible one takes a **Base URL**
 * and the Ollama one takes a **Host**. Both exist to reach a model server the customer runs
 * themselves — a vLLM on `10.0.4.20:8000`, an Ollama on `localhost:11434`. The reflexive rule
 * for a user-supplied URL is to reject RFC-1918 and loopback, and applying it here would
 * produce an adapter that cannot do the only job it has. *Self-hosted models* and *no private
 * addresses* cannot both be true, so the product states which one it picked instead of leaving
 * an operator to discover it as a surprising rejection at connect time.
 *
 * `docs/SECURITY_MODEL.md` §6.1 is the same decision written for a reader who is auditing
 * rather than editing, and it names what remains: **a workspace administrator can point their
 * own deployment at an internal address and learn whether something answers there.** That is a
 * capability an administrator of a self-hosted service already has by other means, and the
 * boundary this policy defends is *who may configure a connection*, not *which addresses
 * exist*. A deployment needing a harder boundary puts `ouroboros-rest` on a network segment
 * that cannot reach what it must not reach — which the network can enforce and an application
 * allow-list cannot.
 *
 * ---------------------------------------------------------------------------
 * **So the risk is closed off everywhere else instead, in four places.**
 *
 * 1. **A scheme allow-list.** {@link PROVIDER_URL_SCHEMES} — `http` and `https`, nothing else.
 *    `file:`, `gopher:`, `ftp:` and everything else a URL parser will happily accept are
 *    refused by {@link resolveProviderAddress} before a socket exists. An allow-list rather
 *    than a deny-list, because the set of schemes a runtime might learn tomorrow is not one
 *    this file can enumerate.
 * 2. **No redirect following.** {@link PROVIDER_REDIRECT} is `manual`. A redirect is the
 *    mechanism by which an allowed address becomes a disallowed one *after* the check has
 *    passed, so the check is not asked to be clever a second time — the redirect is simply not
 *    followed. `manual` rather than `error` because Node's `fetch` hands the `3xx` back intact,
 *    which makes it an ordinary refusal an adapter classifies with the shared taxonomy; with
 *    `error` it would arrive as a `TypeError` indistinguishable from a closed socket, and an
 *    address pointing one level above an API would be reported as *unreachable*.
 * 3. **A response size cap.** {@link readCappedBody}. The endpoint is a stranger's, and a
 *    `GET` of a model listing that answers with a hundred megabytes is a denial of service on
 *    the control plane rather than a provider being unhelpful.
 * 4. **No userinfo.** A `http://key:secret@host/v1` would put a credential into
 *    `provider_connections.config`, which is the one column in V015 designed to be readable —
 *    the sealed one is `credentials_encrypted`, and the schema's `x-ouroboros-secret` field is
 *    the supported way to supply a key. Refusing it here is what stops a person who pasted the
 *    URL their vendor printed from storing a key in the clear.
 *
 * Two more rules are the *adapter's*, not this file's, and are named here so the policy reads
 * as one list: **kind scoping** — only these two adapter kinds take an address at all, cloud
 * adapters have fixed hosts — and **response bodies are never echoed**: a test connection
 * reports a status and a latency, and a discovery parses a listing into a known shape. Neither
 * returns what the endpoint said, which is what keeps a reachability probe from being a
 * data-exfiltration primitive.
 */

/**
 * The schemes an operator-supplied address may use.
 *
 * `URL.protocol`'s own spelling, colon included, so a check is an equality rather than a
 * `slice` somebody has to read twice.
 */
export const PROVIDER_URL_SCHEMES = ["http:", "https:"] as const;

/**
 * What `fetch` does with a `3xx` — nothing.
 *
 * See this file's header, rule 2, for why `manual` and not `error`. The value is exported so an
 * adapter states the policy by naming it rather than by writing the string, and so
 * `provider.address.spec.ts` can assert the two adapters agree.
 */
// Typed through `RequestInit` rather than through undici's `RequestRedirect`, which is not a
// global here: the point is that this value is what a `fetch` init's `redirect` accepts, and
// saying so in the type is what makes a typo in it a compile error.
export const PROVIDER_REDIRECT: NonNullable<RequestInit["redirect"]> = "manual";

/**
 * The most of a response body that will be read, in bytes.
 *
 * One mebibyte. A model listing is a few kilobytes — vLLM serving a hundred models is under
 * fifty — so this is three orders of magnitude of headroom rather than a budget anybody has to
 * think about, and it is still small enough that a misdirected address answering with a video
 * costs one megabyte and a classified error instead of the process.
 */
export const PROVIDER_MAX_RESPONSE_BYTES = 1_048_576;

/**
 * An address that passed the policy, or the reason it did not.
 *
 * A discriminated union rather than this codebase's usual `…Violations(): string[]`, because a
 * caller needs the *parsed* `URL` on the way through and a list of sentences has nowhere to
 * carry one. There is at most one violation for the same reason: parsing stops at the first
 * thing wrong with an address, and reporting *scheme is not allowed* and *host is missing*
 * about `file:///etc/passwd` would be two sentences about one mistake.
 */
export type ProviderAddress =
  | {
      readonly ok: true;
      /**
       * The parsed address, exactly as it was written.
       *
       * What a caller reads off it is `host` — the `10.0.4.20:8000` an unreachable endpoint's
       * message names. For building a request, use {@link ProviderAddress.root}.
       */
      readonly url: URL;
      /**
       * The address a path is joined onto: scheme, host, port and path, with any trailing
       * slashes taken off and any query or fragment dropped.
       *
       * Derived once, here, so that every caller joins the same way. `http://host:8000/v1/`
       * concatenated with `/models` gives a double slash, which vLLM answers and a stricter
       * server does not — `provider-health/checks.ts` strips them for the same reason and says
       * so in the same words. A query string is dropped because a listing route takes none, and
       * carrying an operator's stray `?` through to a stranger's server is not this layer's
       * decision to make.
       */
      readonly root: string;
    }
  | {
      readonly ok: false;
      /**
       * Why it was refused, as a phrase fit for a card foot.
       *
       * Names the offending scheme where there is one, because *what* is wrong with an
       * address is the half an operator cannot see by looking at the field.
       */
      readonly violation: string;
    };

/**
 * Check an operator-supplied address against the policy.
 *
 * The one door. An adapter must not `fetch` a configured address it did not receive back from
 * here, which is what makes the scheme allow-list a property of the code rather than of
 * somebody's memory.
 *
 * **Private and loopback addresses pass on purpose.** There is no branch below that looks at
 * the host's address range, and its absence is the decision — see this file's header.
 *
 * @param raw - Whatever the **Base URL** or **Host** field holds. Surrounding whitespace is
 *   taken off, because a pasted URL frequently arrives with a trailing newline and that is not
 *   a configuration error worth showing somebody.
 * @returns The parsed address, or the reason it was refused. Never throws: an unparseable
 *   address is an ordinary answer here, and a `config` failure at the adapter.
 */
export function resolveProviderAddress(raw: string): ProviderAddress {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, violation: "no address configured" };
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    // `URL` refuses a relative address and anything whose scheme is not a scheme — which
    // includes the commonest mistake of all, a host typed with no `http://` in front of it:
    // `10.0.4.20:8000/v1` has a scheme starting with a digit, so it does not parse at all.
    return { ok: false, violation: "the address is not a URL" };
  }

  if (!(PROVIDER_URL_SCHEMES as readonly string[]).includes(url.protocol)) {
    // The scheme is named because it is the diagnosis: somebody who pasted `10.0.4.20:8000`
    // sees `10.0.4.20:` here and can tell at once that the `http://` is missing.
    return {
      ok: false,
      violation: `the address scheme "${url.protocol}" is not http or https`,
    };
  }

  // There is deliberately no *does it name a host* check here. `http` and `https` are the URL
  // standard's **special schemes**, and a special-scheme URL with no host does not parse —
  // `new URL("http://")` throws, and `http:///v1` is read as the host `v1`. A branch for it
  // would be one nothing could ever reach and no test could ever cover.
  if (url.username.length > 0 || url.password.length > 0) {
    // Rule 4. The message says where the key belongs rather than only that this is refused,
    // because the person reading it has a key in their hand and needs somewhere to put it.
    return {
      ok: false,
      violation: "the address must not carry a credential — use the API key field",
    };
  }

  // Built rather than assigned back onto the URL: setting `pathname` to the empty string is a
  // no-op — the parser puts the `/` back — so a bare host would keep a trailing slash and every
  // join would double it.
  return { ok: true, url, root: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}

/**
 * Whether a status is a redirect this policy declined to follow.
 *
 * A status rather than a `Response`, because that is what a caller classifying a refusal has in
 * hand — and because a predicate over a number can be exercised without constructing one.
 *
 * @param status - The status the endpoint answered with.
 * @returns `true` for `300`–`399`. Reachable at all only because {@link PROVIDER_REDIRECT} is
 *   `manual`: with the default `follow`, the runtime would have chased it and a caller would
 *   never see one.
 */
export function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * How a declined redirect reads on the card foot.
 *
 * The status alone — `describeHttpRefusal` would say `responded 302` — is a true sentence that
 * sends the reader to look for a server that answered oddly, when what actually happened is
 * that this service refused to go where it was pointed. The class is still `config`, which
 * `classifyHttpStatus` already decides for every `3xx` and which this does not second-guess:
 * an address that redirects is an address one level above the API, and that is a setting
 * somebody can correct.
 *
 * @param status - The redirect's status.
 * @returns The phrase. **Never the `Location` header** — echoing it would print wherever an
 *   endpoint tried to send this service onto a page, which is the exfiltration shape the
 *   no-redirect rule exists to close.
 */
export function describeRedirectRefused(status: number): string {
  return `redirect not followed (${status.toString()})`;
}

/**
 * Give a response's socket back without reading it.
 *
 * An unread body keeps its connection checked out of undici's pool until the collector gets to
 * it. Errors are swallowed because a body that cannot be cancelled has already ended — and a
 * `401` must not be reported as a `network` failure because tidying up after it threw.
 *
 * @param response - The response to discard.
 */
export async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The socket is already gone, which is the outcome this was asking for.
  }
}

/**
 * A body that was read, or the reason it was not.
 *
 * Same shape and same argument as {@link ProviderAddress}: the caller needs the text on the way
 * through, and a violation has to be a sentence somebody can act on.
 */
export type CappedBody =
  | { readonly read: true; readonly text: string }
  | { readonly read: false; readonly violation: string };

/**
 * Read a response body, refusing to read more than `capBytes` of it.
 *
 * Rule 3. `response.text()` would buffer whatever a stranger's endpoint chose to send, so this
 * reads the stream itself and stops — cancelling the rest, which closes the socket rather than
 * leaving it draining.
 *
 * The `content-length` header is checked first as a fast path and is **not** trusted as the
 * enforcement: a header can be absent, wrong, or a lie, and the byte count below is what
 * actually holds. A response with no body at all reads as the empty string, which is a `200`
 * with nothing in it — a caller's parse is what decides whether that is acceptable.
 *
 * @param response - The response. Its body is consumed or cancelled either way, so a caller
 *   must not also discard it.
 * @param capBytes - The most to read. {@link PROVIDER_MAX_RESPONSE_BYTES} unless a caller has
 *   a reason.
 * @returns The decoded body, or why there is none.
 */
export async function readCappedBody(response: Response, capBytes: number): Promise<CappedBody> {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);

  if (Number.isInteger(declared) && declared > capBytes) {
    await discardBody(response);

    return { read: false, violation: tooLarge(capBytes) };
  }

  const body = response.body;

  if (body === null) {
    return { read: true, text: "" };
  }

  // Typed explicitly: `Response.body` is a `ReadableStream<any>` in this runtime's types, and
  // an untyped chunk would make every `byteLength` below an unchecked member access.
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  let seen = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      seen += value.byteLength;

      if (seen > capBytes) {
        // Cancelled rather than read to the end and thrown away: the point of a cap is that
        // the bytes past it never arrive.
        await reader.cancel();

        return { read: false, violation: tooLarge(capBytes) };
      }

      // `stream: true` because a multi-byte character can straddle two chunks, and decoding
      // each chunk independently would replace it with U+FFFD in a model id.
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // The connection died part way through the body. Nothing about the runtime's own message
    // reaches a caller — it carries the host and sometimes the request headers.
    return { read: false, violation: "the response ended part way through" };
  }

  return { read: true, text: text + decoder.decode() };
}

/**
 * What an over-long response says.
 *
 * @param capBytes - The cap that was exceeded.
 * @returns The phrase. Names the cap, because an operator whose endpoint really does answer
 *   with more than this needs to know what the number is.
 */
function tooLarge(capBytes: number): string {
  return `the response exceeded ${capBytes.toString()} bytes`;
}

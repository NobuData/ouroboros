/**
 * The Copilot adapter's **recorded fixtures** — GitHub's two captured routes, the refusals they
 * answer with, and the one arranged body that is not GitHub's at all.
 *
 * AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)). The stand-in `fetch` is
 * `http.recordings.fixture.ts`, shared with every other HTTP adapter; what is here is the
 * captures. No socket is opened, so `copilot.conformance.spec.ts` and `copilot.adapter.spec.ts`
 * run in `yarn test` — the suite that will actually notice them.
 *
 * ```
 * user           200  ·  login · id · type            → the token is good  ·  ✓ 200 · 38ms
 * billing        200  ·  seat_breakdown.total: 4      → the meter's  · 4 seats
 * billing (bare) 200  ·  no seat_breakdown at all     → the meter, with no seat suffix (P8)
 * auth           401  ·  a proxy quoting the header   → key rejected (401)
 * rate_limit     429  ·  secondary rate limit         → rate limited (429)
 * upstream       503  ·  GitHub's own unavailable     → degraded upstream · △ 503 upstream · retrying
 * config         —    ·  no token at all              → needs configuration
 * network        —    ·  TypeError · ECONNREFUSED     → unreachable
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Two billing captures, because the acceptance criterion is about the second one.**
 *
 * *"Seat count renders **only** from real entitlement data; the fixture without it renders the
 * cap line without a seat suffix."* {@link COPILOT_BILLING_WITH_SEATS} is an organization whose
 * plan reports a `seat_breakdown`, and {@link COPILOT_BILLING_WITHOUT_SEATS} is one whose
 * response carries everything else and no breakdown at all. The pair is what makes decision
 * **P8** a test rather than a claim: the same adapter, the same code path, and a seat suffix in
 * exactly one of the two answers.
 *
 * ---------------------------------------------------------------------------
 * **The `401` body is a proxy's, and it is deliberately not GitHub's.**
 *
 * GitHub's own `401` is `{"message": "Bad credentials"}` — it quotes nothing, which would make
 * the conformance kit's *"no `detail` ever contains the credential"* assertion pass vacuously
 * for this adapter. What actually sits between a control plane and `api.github.com` in the
 * deployments this card is for is frequently a TLS-inspecting corporate proxy, and those
 * answer with a page that quotes the request headers back — one of which is the token.
 * {@link COPILOT_PROXY_CHALLENGE} is that page, it really contains {@link COPILOT_SECRET}, and
 * it is what makes *the adapter cancels every refusal unread* worth asserting. GitHub's own
 * wording is recorded too, in {@link GITHUB_REFUSALS}, because both are real.
 *
 * ---------------------------------------------------------------------------
 * **Why the responses are built by functions rather than held as constants.** A `Response` body
 * may be read once. The kit builds a fresh harness for every `it` precisely so no case can be
 * affected by a previous one, and a shared `Response` would undo that by being consumed by
 * whichever test ran first. The *bodies* are the constants — they are the recording — and each
 * builder wraps one in a new envelope.
 *
 * It is a `.fixture.ts`: type-checked with the code it exercises, left out of the image by
 * `tsconfig.build.json`, and not counted as application code by `jest.config.mjs`.
 */

import type { NormalizedModel } from "../provider.adapter";
import {
  COPILOT_MODEL_CONTEXT_TOKENS,
  COPILOT_MODEL_DISPLAY,
  COPILOT_MODEL_ID,
} from "./copilot.adapter";

/**
 * The credential every recorded call is made with.
 *
 * Shaped like the token mockup 07's row holds — `ghu_••••••••••••7Kd2`, a GitHub App
 * user-to-server token — and long enough to be findable: the conformance kit searches every
 * rendered `detail` for this exact string, and a secret of `"x"` would appear in a hundred
 * innocent sentences and prove nothing. It is not a token, has never been one, and reaches no
 * network.
 */
export const COPILOT_SECRET = "ghu_00000000000000000000000000000000220Kd2";

/** The organization mockup 07's capability line names, verbatim. */
export const COPILOT_ORGANIZATION = "acme-robotics";

/** Mockup 07's capability line under the Copilot card's name, verbatim. */
export const COPILOT_CAPABILITY_NOTE = "billed through GitHub org acme-robotics";

/** Where the recorded token check was made. */
export const COPILOT_USER_URL = "https://api.github.com/user";

/** Where the recorded entitlement lookup was made. */
export const COPILOT_BILLING_URL = "https://api.github.com/orgs/acme-robotics/copilot/billing";

/**
 * `GET /user`, as GitHub answers it for a good token.
 *
 * Trimmed to the fields a capture would plausibly be kept for — the real response carries
 * about forty, most of them URLs. Nothing in the adapter reads any of them: the question was
 * the status, and the body is cancelled unread. It is here so that a fixture of a `200` is a
 * `200` with a body, which is what a `Response` a real server sent looks like.
 */
export const COPILOT_USER_BODY: unknown = Object.freeze({
  login: "ken-suenobu",
  id: 2_200_000,
  node_id: "U_kgDOACGqQA",
  type: "User",
  site_admin: false,
  name: "Ken",
  company: "@acme-robotics",
});

/**
 * `GET /orgs/{org}/copilot/billing`, for an organization that reports its seats.
 *
 * `seat_breakdown.total` is the `· 4 seats` on mockup 07's meter, and it is the only field the
 * adapter reads. The rest is the real shape of the response, kept because a capture that
 * quietly tidied a response is not a capture.
 */
export const COPILOT_BILLING_WITH_SEATS: unknown = Object.freeze({
  seat_breakdown: Object.freeze({
    total: 4,
    added_this_cycle: 1,
    pending_cancellation: 0,
    pending_invitation: 0,
    active_this_cycle: 4,
    inactive_this_cycle: 0,
  }),
  seat_management_setting: "assign_selected",
  ide_chat: "enabled",
  platform_chat: "enabled",
  cli: "enabled",
  public_code_suggestions: "block",
});

/**
 * The same route, for an organization whose response carries no breakdown.
 *
 * The fixture AC.5's fourth acceptance criterion names. A `200` with the settings and no
 * `seat_breakdown` is what a plan that does not report seats answers with — and what the
 * adapter has to render as *no seat suffix* rather than as a zero.
 */
export const COPILOT_BILLING_WITHOUT_SEATS: unknown = Object.freeze({
  seat_management_setting: "assign_all",
  ide_chat: "enabled",
  platform_chat: "enabled",
  cli: "enabled",
  public_code_suggestions: "block",
});

/**
 * A TLS-inspecting proxy's `401`, quoting the header it rejected.
 *
 * Not GitHub's, and labelled as such — see this file's header. It exists so that *no `detail`
 * ever quotes a provider's body* is asserted against a body that really would leak the token.
 */
export const COPILOT_PROXY_CHALLENGE = `<html><head><title>401 Unauthorized</title></head>
<body><h1>Request blocked by the egress proxy</h1>
<p>Upstream rejected the credentials presented for api.github.com.</p>
<pre>authorization: Bearer ${COPILOT_SECRET}</pre>
</body></html>`;

/**
 * GitHub's own refusal bodies, by status.
 *
 * Real wording, including the `documentation_url` every one of them carries. Nothing in the
 * adapter reads them; they are here so a refusal fixture is a refusal with a body.
 */
export const GITHUB_REFUSALS: Readonly<Record<number, unknown>> = Object.freeze({
  401: {
    message: "Bad credentials",
    documentation_url: "https://docs.github.com/rest",
    status: "401",
  },
  403: {
    message: "You must be an administrator of this organization to view its Copilot billing.",
    documentation_url:
      "https://docs.github.com/rest/copilot/copilot-metrics#get-copilot-seat-information",
    status: "403",
  },
  404: {
    message: "Not Found",
    documentation_url: "https://docs.github.com/rest",
    status: "404",
  },
  429: {
    message:
      "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
    documentation_url:
      "https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api",
    status: "429",
  },
  503: {
    message: "Service unavailable",
    documentation_url: "https://www.githubstatus.com/",
    status: "503",
  },
  500: {
    message: "Server Error",
    documentation_url: "https://www.githubstatus.com/",
    status: "500",
  },
});

/**
 * What the fixed catalog must normalize to — the one chip mockup 07's `GH` card draws.
 *
 * Written out here rather than exported from the adapter, because the point of the kit's
 * discovery leg is to state the answer somewhere other than where it is produced. The context
 * length is Copilot's published window for the model; the tier is null, because Copilot
 * publishes no per-model entitlement signal and decision **P8** says report what was said or
 * say nothing.
 */
export const COPILOT_EXPECTED_MODELS: readonly NormalizedModel[] = Object.freeze([
  {
    id: COPILOT_MODEL_ID,
    display: COPILOT_MODEL_DISPLAY,
    contextLength: COPILOT_MODEL_CONTEXT_TOKENS,
    sizeBytes: null,
    tier: null,
  },
]);

/**
 * A recorded `GET /user`.
 *
 * @param body - What the route answered. Defaults to the capture.
 * @returns A fresh `Response`.
 */
export function recordedUser(body: unknown = COPILOT_USER_BODY): Response {
  return Response.json(body, { status: 200 });
}

/**
 * A recorded `GET /orgs/{org}/copilot/billing`.
 *
 * @param body - What the route answered. Defaults to the organization that reports its seats;
 *   {@link COPILOT_BILLING_WITHOUT_SEATS} is the other capture.
 * @returns A fresh `Response`.
 */
export function recordedBilling(body: unknown = COPILOT_BILLING_WITH_SEATS): Response {
  return Response.json(body, { status: 200 });
}

/**
 * A recorded refusal, in GitHub's own shape.
 *
 * @param status - The status. One of {@link GITHUB_REFUSALS}' keys, or any other — an
 *   unrecorded status gets a plausible envelope so a test about classification does not need a
 *   body written for it.
 * @returns A fresh `Response`.
 */
export function recordedRefusal(status: number): Response {
  return Response.json(
    GITHUB_REFUSALS[status] ?? {
      message: "Unexpected error",
      documentation_url: "https://docs.github.com/rest",
      status: status.toString(),
    },
    { status },
  );
}

/**
 * The proxy's `401`, as a response.
 *
 * @returns A fresh `Response` carrying {@link COPILOT_PROXY_CHALLENGE} — an HTML body, because
 *   that is what a proxy answers with and because a JSON-only adapter meeting one is exactly
 *   the case worth recording.
 */
export function recordedProxyChallenge(): Response {
  return new Response(COPILOT_PROXY_CHALLENGE, {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * A recorded `200` whose body is whatever is handed in.
 *
 * For the cases about a billing response that is not one — an array, a string, a `200` from
 * something that is not GitHub. Kept separate from {@link recordedBilling} so that function
 * stays *the recording* and this one is obviously an arrangement.
 *
 * @param body - What the server answered.
 * @param contentType - The header. Defaults to JSON.
 * @returns A fresh `Response`.
 */
export function recordedBody(body: string, contentType = "application/json"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

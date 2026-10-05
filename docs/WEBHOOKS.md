# Outbound webhooks — the receiver's contract

Ouroboros sends **signed, at-least-once** HTTP POSTs to endpoints a workspace's owners and admins
configure under **Settings → Integrations → Webhooks** (`/api/v1/settings/webhooks`, BR.3,
[#487](https://github.com/NobuData/ouroboros/issues/487)). *Stream to SIEM* is an endpoint
subscribed to `audit.*`. This page is what a receiver needs to know: what arrives, how to verify it,
and what the delivery guarantees are — and are not.

## What arrives

```http
POST /your/collector HTTP/1.1
Content-Type: application/json
User-Agent: Ouroboros-Webhooks/1
X-Ouro-Event: audit.provider.rotated
X-Ouro-Delivery: 5f0c2b9e-7d41-4c8a-9a13-6e2d1b0c4f77
X-Ouro-Timestamp: 1791115200
X-Ouro-Signature: v1=3b1f…e9 (64 lower-case hex characters)

{
  "id": "5f0c2b9e-7d41-4c8a-9a13-6e2d1b0c4f77",
  "type": "audit.provider.rotated",
  "eventId": "8a6e0d2c-…",
  "occurredAt": "2026-10-04T12:00:00.000Z",
  "workspaceId": "aBcD1234…",
  "registryVersion": 1,
  "data": { … }
}
```

| Field | Meaning |
|---|---|
| `id` | The **idempotency key** — the same value as `X-Ouro-Delivery`, and the same on every attempt at this event for this endpoint (retries and redeliveries included). |
| `type` | The event type — also `X-Ouro-Event`. |
| `eventId` | The event itself. Two endpoints receiving the same event see the same `eventId` and different `id`s. `null` for `ping`. |
| `occurredAt` | When the event happened (not when this attempt was made). |
| `workspaceId` | The workspace the event belongs to. |
| `registryVersion` | The event-registry version the endpoint subscribed under. |
| `data` | The event's facts. Never a credential. |

The body is **identical on every attempt** at one event; only `X-Ouro-Timestamp` and
`X-Ouro-Signature` change.

### Event families

An endpoint subscribes to family wildcards (`audit.*`, `decision.*`, `run.*`, `pr.*`) and/or exact
event types (`run.merged`). Matching is **exact**: `audit.*` receives audit events and nothing else.

| Family | Types (registry version 1) | `data` |
|---|---|---|
| `audit.*` | `audit.<action>` for every audit action — `audit.provider.rotated`, `audit.workspace.paused`, `audit.webhook.secret_rotated`, … | The audit row: `id`, `action`, `actorKind` (`human`/`bot`/`service`/`system` — `user` before #486), `actorId`, `actorService`, `subjectType`, `subjectId`, `ip`, `detail`, `occurredAt` |
| `decision.*` | `decision.filed`, `decision.refreshed`, `decision.source_resolved` | The same audit row |
| `pr.*` | `pr.criterion_verified`, `pr.criterion_unverified`, `pr.criterion_waived`, `pr.approval_requested`, `pr.approval_approved`, `pr.approval_declined`, `pr.thread_resolved`, `pr.merged` | The audit row; for `pr.merged`, the run's facts as below |
| `run.*` | `run.opened`, `run.merged`, `run.canceled` | `runId`, `loopSeq`, `repositoryId`, `issueNumber`, `status`, `prNumber`, `startedAt`, `finishedAt` |

**Registry version 2** (#462) adds a person's answer through the Needs-You inbox and a press its
plane refused: `audit.decision.answered`, `audit.decision.answer_failed`, `decision.answered` and
`decision.answer_failed`.
**Registry version 3** (#464) adds snoozing: `audit.decision.snoozed`, `audit.decision.snoozed_all`,
`audit.decision.unsnoozed` and their `decision.*` types.
**Registry version 4** (#482) adds a data-retention tier change: `audit.workspace.retention_changed`.
**Registry version 5** (#481) adds a published org policy: `audit.policy.published`.
**Registry version 6** (#486) adds the audit plane's own events: `audit.audit.exported` (a CSV
export of the log — its range, filters, row count and actor) and `audit.audit.purged` (the retention
purge's per-workspace record — cutoff, tier, `removed` and `held`).

The full list is `GET /api/v1/settings/webhooks` → `registry.eventTypes`.

**The registry is versioned.** A release that adds an event type adds it in a new registry
version; an endpoint keeps receiving exactly what it subscribed to until an administrator moves it
to the new version (`PATCH … {"registryVersion": n}`). A new audit action therefore never starts
arriving at your SIEM unannounced.

`ping` is the test event an administrator fires from the management sheet. It belongs to no family
and is sent only on request.

## Verifying a delivery

The signature is **HMAC-SHA256** with the endpoint's signing secret (`whsec_…`, shown once when the
endpoint is created or its secret rotated) over the timestamp, a full stop, and the **raw** request
body:

```
signed  = X-Ouro-Timestamp + "." + raw body bytes
expected = hex(HMAC-SHA256(secret, signed))
X-Ouro-Signature = "v1=" + expected
```

A receiver must:

1. **Read `X-Ouro-Timestamp`** and reject the request if it is not a whole number, or is more than
   **300 seconds** (five minutes) away from the receiver's own clock in either direction. This is
   the **replay window**: a captured request is worthless five minutes later, because changing the
   timestamp breaks the signature.
2. **Compute `expected`** over the body exactly as received — before any JSON parsing or
   re-serialisation.
3. **Compare** it with every `v1=` value in `X-Ouro-Signature` (comma-separated; a future scheme
   may be sent beside it) using a **constant-time** comparison. Reject if none matches.
4. Only then **parse** the body, and **drop it if `X-Ouro-Delivery` was already processed**.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, headers, rawBody, now = Date.now()) {
  const timestamp = headers["x-ouro-timestamp"];
  if (!/^\d+$/.test(timestamp ?? "")) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) return false; // replay

  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"),
  );
  return (headers["x-ouro-signature"] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .some((part) => {
      const given = Buffer.from(part.slice(3));
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}
```

`ouroboros-rest/src/modules/webhooks/webhook.receiver.fixture.ts` is this recipe as code, and the
test suite holds the sender to it: a tampered body, a replay outside the window, a refreshed
timestamp and a second delivery of one key are each refused.

## Delivery guarantees

**At least once.** Every event is written to an outbox in the same database transaction as the
change it records, so a crash cannot lose it. An attempt that is in flight when a server stops is
sent again after its two-minute lease lapses. **Duplicates are therefore possible**, and
`X-Ouro-Delivery` is how you drop them. Ordering between events is not guaranteed.

**Success is a 2xx** within ten seconds. Anything else — another status, a timeout, a refused
connection, a redirect (redirects are never followed) — is a failure.

**Retries back off exponentially**: 30 s, 1 m, 2 m, 4 m … capped at 1 h (±10% jitter), up to
`OURO_WEBHOOK_MAX_ATTEMPTS` attempts (5 by default). Then the event is **dead-lettered**: it stays
visible in the endpoint's delivery log, the endpoint's health — and, for the SIEM endpoint, the
Audit card's *Stream to SIEM* row — shows a **warning**, and an administrator can **redeliver** it
once the receiver is fixed. A redelivery keeps the original `X-Ouro-Delivery` and gets one try.

A disabled endpoint receives nothing; attempts already queued for it wait until it is enabled
again. An endpoint is never sent an event that happened before it was created.

**What the log keeps of your answer**: the status, the latency, and at most 1 024 characters of the
response body with anything credential-shaped (tokens, `Authorization` values, `password=…`, long
hex or base64 runs) replaced by `[redacted]`. Do not echo secrets back anyway.

## Where a webhook may point

- **https only**, and no user name or password in the URL.
- The host must resolve **only** to external addresses. Loopback, link-local (including the cloud
  metadata address `169.254.169.254`), RFC1918, carrier-grade NAT, unique-local IPv6 and the
  reserved ranges are refused — **at save and again at every delivery**, and the connection is
  made to the address that was checked, so a name that later resolves inward (DNS rebinding) is
  still refused.
- A self-hosted operator can allow genuine internal collectors with
  `OURO_WEBHOOK_INTERNAL_ALLOWLIST` (hostnames, addresses or CIDR blocks). It never relaxes https.

## Secrets

The signing secret is stored sealed under the workspace's data key and is returned **only** by the
create and rotate answers — never by a list, a read, an audit row or an error. Rotating it replaces
it at once; deliveries signed after the rotation use the new secret, so update the receiver before
(or immediately after) rotating.

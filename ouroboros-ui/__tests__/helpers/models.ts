import type { ProviderHealth, ProviderHealthStrip } from "@/app/api/routing";
import type { ModelsReadings } from "@/app/models/view";

/**
 * The routing page's fixtures — the seeded workspace's health strip, as
 * `GET /api/v1/routing/providers` actually serves it.
 *
 * **These are the dev seed's five connections read through the service's own composition
 * rules**, not five plausible-looking objects: `R__dev_seed_providers.sql` writes the rows,
 * `provider-health/resources.ts` composes `meta` from them, and mockup 06's strip is what
 * comes out. That is what makes "the seeded strip matches the mockup" a claim a test in this
 * module can make at all — a fixture invented here would prove that the page renders
 * *something*, which is not the acceptance criterion.
 *
 * The four facts each row carries and where they come from:
 *
 * | Chip | Seeded row | `meta` the service composes |
 * |---|---|---|
 * | Anthropic Claude | `active`, `{"latency_ms": 42}` | `42ms` |
 * | Cursor | `active`, `{}` — nothing was measured | `null` |
 * | GitHub Copilot | `error`, `{"detail": "elevated latency"}` | `elevated latency` |
 * | OpenAI-compatible · local vLLM | `active`, `{"detail": "vLLM local"}`, a host | `10.0.4.20 · vLLM local` |
 * | Ollama · workstation | `active`, `{"models": 3, "detail": "workstation"}`, a host | `ken-station.local · 3 models · workstation` |
 *
 * The two local rows carry **no latency**, deliberately and not by omission: Z.3's
 * `ProviderCheck.reportsLatency` discards a loopback measurement, because an unvarying `0ms`
 * printed beside Anthropic's real `42ms` teaches a reader to ignore both.
 *
 * **Two of these lines are not the mockup's, and the difference is upstream of this module.**
 * Mockup 06 draws `Ollama ● workstation · 3 models` and `OpenAI-compatible ● vLLM local`;
 * `chipMeta` (`provider-health/resources.ts`) prepends the connection's *host* — which the
 * seed sets to `ken-station.local` and `10.0.4.20` — so the served lines carry it. Z.3's own
 * unit specs use a row whose host happens to be `workstation` and therefore come out matching
 * the mockup; the dev seed's rows do not. The strip renders `meta` as served rather than
 * recomposing it, because the whole point of the contract serving a composed line is that the
 * strip and the route inspector cannot draw two different sentences from one row — so these
 * fixtures record what the product actually shows, and the divergence is written up in
 * `docs/ROADMAP_MOCKUP_06_MODEL_ROUTING.md` for Y.4 to settle.
 *
 * `checkedAt` is a fixed instant rather than a window off the clock: these fixtures back
 * assertions about a rendered timestamp, and a stamp that moved with the test run would make
 * those assertions unwritable.
 */

/** When every seeded check in these fixtures finished. Fixed, so a rendered stamp is too. */
export const CHECKED_AT = "2026-08-24T09:58:12.004Z";

/** {@link CHECKED_AT} as the strip's hover prints it. */
export const CHECKED_STAMP = "2026-08-24 09:58 UTC";

/**
 * One chip, defaulting to a healthy provider that nothing measured anything about.
 *
 * @param overrides What this case is about.
 * @returns The chip as the contract serves it.
 */
export function provider(overrides: Partial<ProviderHealth> = {}): ProviderHealth {
  return {
    id: "5eed000c-0000-4000-8000-000000000001",
    kind: "anthropic",
    displayName: "Anthropic Claude",
    status: "active",
    check: null,
    checkedAt: CHECKED_AT,
    host: null,
    latencyMs: null,
    models: null,
    detail: null,
    meta: null,
    ...overrides,
  };
}

/**
 * The seeded workspace's five chips, in the order the service sends them (by display name).
 *
 * @returns The strip mockup 06 draws.
 */
export function seededProviders(): ProviderHealth[] {
  return [
    provider({
      check: "key_validation",
      latencyMs: 42,
      meta: "42ms",
    }),
    provider({
      id: "5eed000c-0000-4000-8000-000000000002",
      kind: "cursor",
      displayName: "Cursor",
    }),
    provider({
      id: "5eed000c-0000-4000-8000-000000000003",
      kind: "copilot",
      displayName: "GitHub Copilot",
      status: "error",
      detail: "elevated latency",
      meta: "elevated latency",
    }),
    provider({
      id: "5eed000c-0000-4000-8000-000000000004",
      kind: "openai_compatible",
      displayName: "OpenAI-compatible · local vLLM",
      check: "reachability",
      host: "10.0.4.20",
      detail: "vLLM local",
      meta: "10.0.4.20 · vLLM local",
    }),
    provider({
      id: "5eed000c-0000-4000-8000-000000000005",
      kind: "ollama",
      displayName: "Ollama · workstation",
      check: "reachability",
      host: "ken-station.local",
      models: 3,
      detail: "workstation",
      meta: "ken-station.local · 3 models · workstation",
    }),
  ];
}

/**
 * A connection nothing has ever looked at — the state every row starts in (decision M8).
 *
 * @param overrides What this case is about.
 * @returns The chip, with no check, no timestamp and nothing measured.
 */
export function unknownProvider(overrides: Partial<ProviderHealth> = {}): ProviderHealth {
  return provider({
    id: "5eed000c-0000-4000-8000-0000000000ff",
    kind: "custom",
    displayName: "Fresh connection",
    status: "unknown",
    checkedAt: null,
    ...overrides,
  });
}

/** The strip payload, as the endpoint wraps it. */
export function stripPayload(
  providers: readonly ProviderHealth[] = seededProviders(),
): ProviderHealthStrip {
  return { providers: [...providers] };
}

/**
 * What the reader hands the screen, for a workspace whose strip read cleanly.
 *
 * @param overrides What this case is about.
 * @returns The readings.
 */
export function readings(overrides: Partial<ModelsReadings> = {}): ModelsReadings {
  return {
    providers: { ok: true, value: seededProviders() },
    pending: 0,
    ...overrides,
  };
}

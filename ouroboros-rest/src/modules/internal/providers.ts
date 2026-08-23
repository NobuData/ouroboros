/**
 * Which provider kinds a worker may be told how to reach, and which ones it may not.
 *
 * AD.3 ([#224](https://github.com/NobuData/ouroboros/issues/224)) and roadmap decision
 * **P3**. The whole of the lease policy is the two lists below, and it is a list rather than
 * a flag on a row for one reason: there are no rows yet. Y.1
 * ([#189](https://github.com/NobuData/ouroboros/issues/189)) is what brings
 * `provider_connections`, and until it does the only thing that can classify a provider is
 * its *kind*.
 *
 * ---------------------------------------------------------------------------
 * **The vocabulary is AC.1's, borrowed.** `anthropic`, `openai_compatible`, `ollama`,
 * `copilot` and `cursor` are the adapter registry's keys — the same spellings
 * `ouroboros-db`'s V012 writes into `model_prices.match_provider_kind`, snake_case per
 * decision **A4**. AC.1 ([#216](https://github.com/NobuData/ouroboros/issues/216)) owns that
 * registry and has not landed; this file enumerates the five MVP kinds because a policy that
 * refuses cloud providers has to be able to name one, and it hands the list back when the
 * registry exists. What it must not become is a second catalog: nothing here describes a
 * provider beyond *may a worker be given its address*.
 *
 * ---------------------------------------------------------------------------
 * **Why `openai_compatible` is in the leasable list, given V012 says local-ness is a
 * property of the connection.** That is exactly right and it is why the list alone does not
 * grant anything. The same adapter fronts a vLLM on somebody's own GPU *and*
 * `api.openai.com`, so no rule at the level of a kind can tell those apart — which is why a
 * lease for a leasable kind still fails unless the *deployment* has said where that
 * provider is, in `OURO_LOCAL_PROVIDER_URLS`. The operator's declaration is the
 * connection-level statement V012 asks for, made once at the deployment level instead of
 * once per row, and Y.1 replaces it with the row.
 *
 * ---------------------------------------------------------------------------
 * **Why the cloud list is closed and unconfigurable.** A lease naming one is a `403`
 * whatever the environment says, and `configuration.ts` refuses to start a process whose
 * `OURO_LOCAL_PROVIDER_URLS` names one. Both halves are needed: a policy that only lived in
 * the service could be walked around by configuration, and a check that only lived in
 * configuration would let a kind added to that variable later slip past. The criterion this
 * file exists for is *tested rather than documented*, and `lease.spec.ts` runs it once per
 * cloud kind rather than on a representative one.
 */

/**
 * Provider kinds a worker may be given the address of.
 *
 * Both are reachable **without a credential** — an Ollama daemon on the same box, an
 * OpenAI-compatible server an operator is running — which is the property that makes an
 * address worth handing over at all. Proxying a local call through the control plane would
 * cost a network hop and buy nothing, because there is no key on that path to protect.
 */
export const LOCAL_PROVIDER_KINDS = ["ollama", "openai_compatible"] as const;

/**
 * Provider kinds whose connection details are, in substance, a key.
 *
 * There is nothing useful to lease for any of them: the address is a public hostname
 * everybody already knows, and the part that matters is the credential — which is what
 * decision **P3** says never leaves the control plane. A worker that needs one of these
 * calls `POST /internal/llm/invoke` and gets an answer rather than a key.
 *
 * Copilot and Cursor are here for a second reason worth stating: their tokens are billed to
 * a GitHub organization or to a seat, so a leaked one spends somebody's money rather than
 * merely reading their data.
 */
export const CLOUD_PROVIDER_KINDS = ["anthropic", "copilot", "cursor"] as const;

/** A provider kind a worker may be given the address of. */
export type LocalProviderKind = (typeof LOCAL_PROVIDER_KINDS)[number];

/** A provider kind that is proxied and never leased. */
export type CloudProviderKind = (typeof CLOUD_PROVIDER_KINDS)[number];

/** Any of the five MVP provider kinds. */
export type ProviderKind = LocalProviderKind | CloudProviderKind;

/**
 * Every kind the lease API accepts as a *request*.
 *
 * Cloud kinds are in it deliberately. A lease naming one has to reach the policy and be
 * refused by it with `403 provider_not_leasable`; if the validator rejected them instead,
 * the answer would be a `422` that says *no such provider*, which is a different and untrue
 * statement — and the acceptance criterion asks specifically for the refusal to be the
 * policy's.
 */
export const PROVIDER_KINDS: readonly ProviderKind[] = [
  ...LOCAL_PROVIDER_KINDS,
  ...CLOUD_PROVIDER_KINDS,
];

/**
 * May a worker be told where this provider is?
 *
 * @param kind - A provider kind, already known to be one of {@link PROVIDER_KINDS}.
 * @returns `true` for a kind reachable without a credential. A `true` here is *permission
 *   to look*, not a grant: whether this deployment actually has that provider is
 *   `local.providers.ts`'s question, and the answer is frequently no.
 */
export function isLeasable(kind: ProviderKind): kind is LocalProviderKind {
  return (LOCAL_PROVIDER_KINDS as readonly string[]).includes(kind);
}

/**
 * Is this one of the kinds that is never leased?
 *
 * The complement of {@link isLeasable} over {@link PROVIDER_KINDS}, written as its own
 * function rather than as a negation because it has a caller of its own: `configuration.ts`
 * asks it of a *string from the environment*, which is not yet known to be a provider kind
 * at all.
 *
 * @param kind - Any string.
 * @returns `true` when it names a cloud provider kind.
 */
export function isCloudProvider(kind: string): kind is CloudProviderKind {
  return (CLOUD_PROVIDER_KINDS as readonly string[]).includes(kind);
}

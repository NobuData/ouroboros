/**
 * Learned facts — mockup 14's *Learned by the loop* card, through `ouroboros-rest`
 * (BF.2, [#411](https://github.com/NobuData/ouroboros/issues/411); drawn by BG.3,
 * [#419](https://github.com/NobuData/ouroboros/issues/419)).
 *
 * ### The lifecycle is the service's, and every transition is one call
 *
 * Decision **K3**: `proposed → confirmed | rejected`, `confirmed → stale` (the nightly sweep),
 * `stale → confirmed | expired`, and an `expired` fact may be **re-learned** into a new, linked
 * proposal. Only `confirmed` facts are injected. Each edge is its own endpoint, so the card's
 * Confirm, Reject, Re-confirm, Expire and Re-learn are five calls with no state to keep — the
 * service answers the fact as it now stands (or the new proposal, for a re-learn), and the row
 * takes that.
 *
 * A transition the fact's status does not allow is `409 fact_transition_refused`, and a fact that
 * moved under a concurrent writer is `409 fact_changed`: the row reloads rather than guessing.
 *
 * ### The workspace is the session's
 *
 * No workspace in these paths and no `X-Ouro-Tenant` sent (`app/api/server.ts` says why). Every
 * member reads, `viewer` included; proposing and deciding are `owner`, `admin` or `member`, and
 * the service records the session's person as the transition's actor — which is what the card's
 * *confirmed by Ken, 6w ago* is read back from.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One learned fact, as the card renders it. */
export type Fact = components["schemas"]["Fact"];

/** Every fact of the workspace and every status's count. */
export type FactList = components["schemas"]["FactList"];

/** Where a fact is in its lifecycle. */
export type FactStatus = components["schemas"]["FactStatus"];

/** A transition's actor, instant and note, read from the audit; `null` before the transition. */
export type FactStamp = components["schemas"]["FactStamp"];

/** The card's provenance line and the typed references it stands for. */
export type FactProvenance = components["schemas"]["FactProvenance"];

/** One typed reference of a fact's provenance. */
export type FactRef = FactProvenance["refs"][number];

/** Why a fact can expire — one anchor. */
export type FactAnchor = components["schemas"]["FactAnchor"];

/** The three kinds of anchor. */
export type FactAnchorKind = components["schemas"]["FactAnchorKind"];

/** What a manual proposal sends. */
export type ProposeFactBody = components["schemas"]["ProposeFactBody"];

/** One anchor, as a proposal sends it. */
export type FactAnchorBody = components["schemas"]["FactAnchorBody"];

/** The optional note beside a confirm, reject or re-confirm. */
export type FactTransitionBody = components["schemas"]["FactTransitionBody"];

/** What an expire sends: its reason, required. */
export type ExpireFactBody = components["schemas"]["ExpireFactBody"];

/** What a re-learn sends: optionally the new proposal's text. */
export type RelearnFactBody = components["schemas"]["RelearnFactBody"];

/** Facts, as `ouroboros-rest` serves them. */
export const facts = {
  /**
   * Every fact of the workspace, newest first, with every status's count.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The facts and the counts. A workspace with no facts answers an empty list.
   * @throws {ApiError} What the service answered.
   */
  async list(client: ApiClient = api()): Promise<FactList> {
    return unwrap(await client.GET("/api/v1/facts", {}));
  },

  /**
   * Propose a fact by hand. It is born `proposed`, like every fact.
   *
   * @param body The text, and optionally the repository, the provenance line and the anchors.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The new proposal.
   * @throws {ApiError} `403 forbidden` for a viewer, `409 fact_anchor_exists` for the same anchor
   *   twice, `422 fact_anchor_invalid` (`details.kind`, `details.value`) for an anchor the service
   *   refuses, `422 fact_provenance_unresolved` for a cited row not this workspace's.
   */
  async propose(body: ProposeFactBody, client: ApiClient = api()): Promise<Fact> {
    return unwrap(await client.POST("/api/v1/facts", { body }));
  },

  /**
   * `proposed → confirmed`: injected into every run's context from now on.
   *
   * @param factId The fact.
   * @param body An optional note.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The fact, with its confirmation stamp.
   * @throws {ApiError} `403 forbidden` for a viewer, `409 fact_transition_refused` off the edge,
   *   `409 fact_changed` under a concurrent writer.
   */
  async confirm(factId: string, body: FactTransitionBody = {}, client: ApiClient = api()): Promise<Fact> {
    return unwrap(await client.POST("/api/v1/facts/{factId}/confirm", { params: { path: { factId } }, body }));
  },

  /**
   * `proposed → rejected`. Terminal; the text never comes back as a new proposal.
   *
   * @param factId The fact.
   * @param body An optional note.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The fact.
   * @throws {ApiError} As {@link facts.confirm}.
   */
  async reject(factId: string, body: FactTransitionBody = {}, client: ApiClient = api()): Promise<Fact> {
    return unwrap(await client.POST("/api/v1/facts/{factId}/reject", { params: { path: { factId } }, body }));
  },

  /**
   * `stale → confirmed`: a person looked, and the fact still holds.
   *
   * @param factId The fact.
   * @param body An optional note.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The fact, confirmed again.
   * @throws {ApiError} As {@link facts.confirm}.
   */
  async reconfirm(factId: string, body: FactTransitionBody = {}, client: ApiClient = api()): Promise<Fact> {
    return unwrap(await client.POST("/api/v1/facts/{factId}/reconfirm", { params: { path: { factId } }, body }));
  },

  /**
   * `stale → expired`, with a reason — *Zephyr 4.1 migration* — and the use count snapshotted.
   *
   * @param factId The fact.
   * @param body The reason, required.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The fact, expired.
   * @throws {ApiError} As {@link facts.confirm}.
   */
  async expire(factId: string, body: ExpireFactBody, client: ApiClient = api()): Promise<Fact> {
    return unwrap(await client.POST("/api/v1/facts/{factId}/expire", { params: { path: { factId } }, body }));
  },

  /**
   * Re-learn an expired fact: a **new** proposal linked to it, awaiting review. The expired fact
   * stays expired.
   *
   * @param factId The expired fact.
   * @param body Optionally the new proposal's text; the expired fact's when absent.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The new proposal.
   * @throws {ApiError} As {@link facts.confirm}.
   */
  async relearn(factId: string, body: RelearnFactBody = {}, client: ApiClient = api()): Promise<Fact> {
    return unwrap(await client.POST("/api/v1/facts/{factId}/relearn", { params: { path: { factId } }, body }));
  },
};

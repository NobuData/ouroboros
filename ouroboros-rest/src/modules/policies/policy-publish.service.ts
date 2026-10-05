/**
 * `PolicyPublishService` — the settings card's edit becomes `policy vN+1` (BQ.2,
 * [#481](https://github.com/NobuData/ouroboros/issues/481)).
 *
 * ```
 * draft ─▶ schema validation ─▶ diff classified per rule ─▶ role check ─▶ publish vN+1 ─▶ audit ─▶ cache cleared
 *          (schemas/org-policy/v1.json)  (policy-publish.ts)   (loosening = owner)  (org_policy_publish)  (policy.published)
 * ```
 *
 * - **Validated against the committed grammar** (`org-policy.schema.ts`, held equal to
 *   `schemas/org-policy/v1.json`), so the card cannot publish what CI would refuse to have stored.
 * - **Decided under the workspace's lock, against the version in force.** The caller names the
 *   version it edited (`baseVersion`); a publish that landed since is a `409`, not a silent
 *   overwrite of somebody else's change. The diff and the role check use the version read under the
 *   lock, so the classification is of the change actually made.
 * - **Admin may publish a tightening or neutral change; a loosening needs the owner.** The route
 *   already holds the caller to owner/admin.
 * - **Audited** as `policy.published` (subject `org_policy`, the workspace id) with the version,
 *   the changed rule ids, the classification of each, and the audit card's line —
 *   *"enabled auto-merge (policy v8)"*. An unaudited publish is not answered as a success.
 * - **Every enforcement point sees it at once** on this process: the resolver's cache is cleared
 *   after the write commits (other replicas within `POLICY_CACHE_TTL_MS`).
 */

import { Inject, Injectable } from "@nestjs/common";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

import { POLICY_PUBLISHED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import type { OrganizationRole } from "../db/schema";
import { ConflictError, ForbiddenError, InvalidRequestError } from "../errors/error.envelope";
import { rulesOf } from "./org-policy.document";
import {
  OrgPolicyRepository,
  type PolicyPublishStore,
  type StoredPolicyVersion,
} from "./org-policy.repository";
import { ORG_POLICY_DSL_DEFINITIONS, ORG_POLICY_SCHEMA } from "./org-policy.schema";
import type { PolicyAudit } from "./org-policy.service";
import {
  type ChangeClass,
  type PolicyDiff,
  type RuleChange,
  diffPolicies,
  publishSummary,
  ruleChangesFact,
} from "./policy-publish";
import { PolicyResolutionService } from "./policy-resolution.service";

/** The `code` of each refusal. */
export const POLICY_PUBLISH_ERRORS = Object.freeze({
  /** The document is not one `schemas/org-policy/v1.json` accepts. `422`. */
  invalid: "policy_document_invalid",
  /** The document is the version in force — nothing would change. `422`. */
  unchanged: "policy_unchanged",
  /** Another publish landed since the version the caller edited. `409`. */
  conflict: "policy_version_conflict",
  /** The edit loosens autonomy, and only the owner may publish that. `403`. */
  ownerRequired: "policy_loosening_requires_owner",
});

/** The most validation problems a refusal lists. */
const MAX_REPORTED_ERRORS = 20;

/** A policy edit, as the card sends it. */
export interface PolicyDraft {
  /** The whole document — every rule, not a patch. */
  readonly document: unknown;
  /** The version the caller edited, or null for a workspace that has published nothing. */
  readonly baseVersion: number | null;
  /** Why — what the history popover shows. Null for none. */
  readonly changeNote?: string | null;
}

/** Who is publishing. */
export interface PolicyActor {
  /** `user.id`. */
  readonly id: string;
  /** Their roles in the workspace. */
  readonly roles: readonly OrganizationRole[];
}

/** The workspace's policy as the settings card reads it. */
export interface PolicyResource {
  /** The version in force — the card's `policy v7` — or null when nothing is published. */
  readonly version: number | null;
  /** The document verbatim, or null. */
  readonly document: Record<string, unknown> | null;
  readonly publishedAt: string | null;
  /** `user.id`, or null. */
  readonly publishedBy: string | null;
  readonly changeNote: string | null;
}

/** What publishing a draft would do — the confirm dialog's content. */
export interface PolicyPreviewResource {
  /** The version the draft is compared with — the one in force. */
  readonly baseVersion: number | null;
  /** The draft's class: loosening if any change loosens, else tightening if any tightens. */
  readonly classification: ChangeClass;
  /** Each changed rule, its class and its line. Empty for a draft that changes nothing. */
  readonly changes: readonly RuleChange[];
  /** Whether only the owner may publish it. */
  readonly requiresOwner: boolean;
  /** Whether the caller may publish it — false for an admin and a loosening. */
  readonly mayPublish: boolean;
}

/** A published version. */
export interface PublishedPolicyResource extends PolicyResource {
  readonly version: number;
  readonly document: Record<string, unknown>;
  readonly publishedAt: string;
  readonly publishedBy: string;
  /** What changed, per rule — the audit row's content. */
  readonly classification: ChangeClass;
  readonly changes: readonly RuleChange[];
  /** The audit card's line — `enabled auto-merge (policy v8)`. */
  readonly summary: string;
}

/** The compiled validator — compiled once, on first use. */
let validator: ValidateFunction | undefined;

/**
 * The validator for the committed grammar — the DSL definitions it references added first.
 *
 * @returns It.
 */
function validate(): ValidateFunction {
  if (validator === undefined) {
    const ajv = new Ajv2020({ strict: false, allErrors: true });

    ajv.addSchema(ORG_POLICY_DSL_DEFINITIONS);
    validator = ajv.compile(ORG_POLICY_SCHEMA as unknown as Record<string, unknown>);
  }

  return validator;
}

/**
 * The document, if the grammar accepts it.
 *
 * @param document - What the caller sent.
 * @returns It, typed.
 * @throws {InvalidRequestError} `policy_document_invalid`, listing where and why.
 */
export function validPolicyDocument(document: unknown): Record<string, unknown> {
  const check = validate();

  if (check(document)) {
    return document as Record<string, unknown>;
  }

  const errors = (check.errors ?? []).slice(0, MAX_REPORTED_ERRORS).map((error: ErrorObject) => ({
    path: error.instancePath === "" ? "/" : error.instancePath,
    message: error.message ?? "is not valid",
  }));

  throw new InvalidRequestError(
    POLICY_PUBLISH_ERRORS.invalid,
    "The policy document is not one schemas/org-policy/v1.json accepts.",
    { errors },
  );
}

/**
 * Whether a person is the workspace's owner.
 *
 * @param roles - Their roles.
 * @returns True for an owner.
 */
function isOwner(roles: readonly OrganizationRole[]): boolean {
  return roles.includes("owner");
}

/**
 * What a draft changes against the version in force.
 *
 * @param current - The version in force, or null.
 * @param document - The draft, validated.
 * @returns The diff.
 */
function diffAgainst(
  current: StoredPolicyVersion | null,
  document: Record<string, unknown>,
): PolicyDiff {
  return diffPolicies(current === null ? null : rulesOf(current.document), rulesOf(document));
}

/**
 * The card's read of a stored version.
 *
 * @param stored - The version, or null.
 * @returns The resource.
 */
export function policyResource(stored: StoredPolicyVersion | null): PolicyResource {
  return stored === null
    ? { version: null, document: null, publishedAt: null, publishedBy: null, changeNote: null }
    : {
        version: stored.version,
        document: stored.document,
        publishedAt: stored.publishedAt.toISOString(),
        publishedBy: stored.publishedBy,
        changeNote: stored.changeNote,
      };
}

@Injectable()
export class PolicyPublishService {
  /**
   * @param store - The published versions.
   * @param resolver - The resolver whose cache a publish clears.
   * @param audit - The audit trail (#225).
   */
  constructor(
    @Inject(OrgPolicyRepository) private readonly store: PolicyPublishStore,
    private readonly resolver: PolicyResolutionService,
    @Inject(AuditService) private readonly audit: PolicyAudit,
  ) {}

  /**
   * The version in force, verbatim.
   *
   * @param organizationId - The workspace.
   * @returns The card's read.
   */
  async read(organizationId: string): Promise<PolicyResource> {
    return policyResource(await this.store.version(organizationId));
  }

  /**
   * What publishing a draft would do, for the person asking — writes nothing.
   *
   * @param organizationId - The workspace.
   * @param actor - Who is asking.
   * @param document - The draft.
   * @returns Each change and its class, and whether this person may publish it.
   * @throws {InvalidRequestError} `policy_document_invalid`.
   */
  async preview(
    organizationId: string,
    actor: PolicyActor,
    document: unknown,
  ): Promise<PolicyPreviewResource> {
    const valid = validPolicyDocument(document);
    const current = await this.store.version(organizationId);
    const diff = diffAgainst(current, valid);
    const requiresOwner = diff.classification === "loosening";

    return {
      baseVersion: current?.version ?? null,
      classification: diff.classification,
      changes: diff.changes,
      requiresOwner,
      mayPublish: !requiresOwner || isOwner(actor.roles),
    };
  }

  /**
   * Publish a draft as the next version.
   *
   * @param organizationId - The workspace.
   * @param actor - Who — the route already held them to owner/admin.
   * @param draft - The document, the version it was edited from, and why.
   * @returns The version published and what it changed.
   * @throws {InvalidRequestError} `policy_document_invalid`, or `policy_unchanged`.
   * @throws {ConflictError} `policy_version_conflict` — another publish landed since `baseVersion`.
   * @throws {ForbiddenError} `policy_loosening_requires_owner`.
   */
  async publish(
    organizationId: string,
    actor: PolicyActor,
    draft: PolicyDraft,
  ): Promise<PublishedPolicyResource> {
    const document = validPolicyDocument(draft.document);
    const changeNote = draft.changeNote?.trim() || null;
    let diff: PolicyDiff = { changes: [], classification: "neutral" };

    const published = await this.store.publish(
      organizationId,
      document,
      actor.id,
      changeNote,
      (current) => {
        const inForce = current?.version ?? null;

        if (inForce !== draft.baseVersion) {
          throw new ConflictError(
            POLICY_PUBLISH_ERRORS.conflict,
            inForce === null
              ? "The policy this edit began from is not the one in force — reload it and edit again."
              : `Policy v${String(inForce)} is in force, not the version this edit began from — reload it and edit again.`,
            { baseVersion: draft.baseVersion, currentVersion: inForce },
          );
        }

        diff = diffAgainst(current, document);

        if (diff.changes.length === 0) {
          throw new InvalidRequestError(
            POLICY_PUBLISH_ERRORS.unchanged,
            "The document is the policy already in force — there is nothing to publish.",
            { currentVersion: inForce },
          );
        }

        if (diff.classification === "loosening" && !isOwner(actor.roles)) {
          throw new ForbiddenError(
            POLICY_PUBLISH_ERRORS.ownerRequired,
            "This edit loosens what runs without a person, and only the workspace owner may publish that.",
            {
              loosening: diff.changes
                .filter((change) => change.classification === "loosening")
                .map((change) => change.ruleId),
            },
          );
        }
      },
    );

    this.resolver.invalidate(organizationId);

    const summary = publishSummary(diff, published.version);

    await this.audit.record({
      organizationId,
      actorId: actor.id,
      action: POLICY_PUBLISHED_EVENT,
      subjectType: "org_policy",
      subjectId: organizationId,
      at: published.publishedAt,
      detail: {
        version: published.version,
        previous_version: draft.baseVersion,
        classification: diff.classification,
        changed_rules: diff.changes.map((change) => change.ruleId).join(","),
        loosening_rules: diff.changes
          .filter((change) => change.classification === "loosening")
          .map((change) => change.ruleId)
          .join(","),
        tightening_rules: diff.changes
          .filter((change) => change.classification === "tightening")
          .map((change) => change.ruleId)
          .join(","),
        // Typed facts, never the sentence: the audit plane composes the line (#486).
        changes: ruleChangesFact(diff),
        change_note: changeNote,
      },
    });

    return {
      version: published.version,
      document,
      publishedAt: published.publishedAt.toISOString(),
      publishedBy: actor.id,
      changeNote,
      classification: diff.classification,
      changes: diff.changes,
      summary,
    };
  }
}

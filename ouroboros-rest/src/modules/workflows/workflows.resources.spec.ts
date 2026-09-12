import type { Workflow, WorkflowVersion } from "../db/schema";
import { NO_DRAFT, draftEtag } from "./draft.etag";
import type { PublishedVersionRow } from "./workflows.repository";
import {
  workflowDetail,
  workflowDraft,
  workflowSummary,
  workflowVersion,
  workflowVersionSummary,
} from "./workflows.resources";

/**
 * The wire shapes: what a client is given, and what it is deliberately not.
 *
 * Two things are asserted here that no other layer can say. **A history row carries no
 * document** — a definition holds a prompt template per model stage, and a history that
 * inlined them would move megabytes to render a list of dates. And **`isCurrent` is measured
 * against the pointer rather than against the newest number**, because V029 is emphatic that
 * `current_version` is a pointer: a workflow can carry several published versions while an
 * older one runs.
 */

const CREATED = new Date("2026-08-01T09:00:00.000Z");
const EDITED = new Date("2026-09-12T08:30:00.000Z");
const PUBLISHED = new Date("2026-09-01T12:00:00.000Z");

/** A workflow row, with whatever a test changes. */
function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
    organization_id: "acme-robotics-id",
    slug: "standard-fix",
    name: "Standard Fix",
    status: "active",
    current_version: 14,
    created_at: CREATED,
    updated_at: EDITED,
    ...overrides,
  };
}

/** A version row, with whatever a test changes. */
function version(overrides: Partial<WorkflowVersion> = {}): WorkflowVersion {
  return {
    id: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
    workflow_id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
    version: 14,
    definition: { dsl_version: "1.0", nodes: [] },
    published_at: PUBLISHED,
    published_by: "user-1",
    change_note: "Added the review gate.",
    created_at: PUBLISHED,
    updated_at: PUBLISHED,
    ...overrides,
  };
}

/** A draft row — `version is null` *is* the draft (V029). */
function draft(overrides: Partial<WorkflowVersion> = {}): WorkflowVersion {
  return version({
    id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9",
    version: null,
    published_at: null,
    published_by: null,
    change_note: null,
    updated_at: EDITED,
    ...overrides,
  });
}

describe("the summary", () => {
  it("renders the page head's title, chip and stamps", () => {
    expect(workflowSummary(workflow())).toEqual({
      id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
      slug: "standard-fix",
      name: "Standard Fix",
      status: "active",
      currentVersion: 14,
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-09-12T08:30:00.000Z",
    });
  });

  it("carries a null chip for a workflow that has only ever had a draft", () => {
    // What **+ New workflow** leaves behind. Not `0`: nothing has been published.
    expect(workflowSummary(workflow({ current_version: null })).currentVersion).toBeNull();
  });

  it("publishes no organization id", () => {
    // The workspace is the session's, and echoing it would put a tenancy identifier into a
    // payload that never needs one.
    expect(workflowSummary(workflow())).not.toHaveProperty("organization_id");
  });
});

describe("the draft slot", () => {
  it("carries the document, the stamp and the etag of the next write", () => {
    const row = draft();

    expect(workflowDraft(row)).toEqual({
      etag: draftEtag(row),
      definition: { dsl_version: "1.0", nodes: [] },
      updatedAt: "2026-09-12T08:30:00.000Z",
    });
  });

  it("has an etag even when there is no draft", () => {
    // So a client's first write is the same three lines as its hundredth.
    expect(workflowDraft(undefined)).toEqual({
      etag: NO_DRAFT,
      definition: null,
      updatedAt: null,
    });
  });
});

describe("a published version", () => {
  it("carries the frozen document and its provenance", () => {
    expect(workflowVersion(version())).toEqual({
      version: 14,
      definition: { dsl_version: "1.0", nodes: [] },
      changeNote: "Added the review gate.",
      publishedAt: "2026-09-01T12:00:00.000Z",
      publishedBy: "user-1",
    });
  });

  it("keeps a null publisher, which is what deleting a person leaves behind", () => {
    // `on delete set null`: what was published cannot be rewritten, who published it can be
    // forgotten.
    expect(workflowVersion(version({ published_by: null })).publishedBy).toBeNull();
  });

  it("refuses to render a draft as a version", () => {
    // A programming mistake, not a request's — and a `null` version on the wire would be a
    // client reading an unnumbered row as v0.
    expect(() => workflowVersion(draft())).toThrow(/is a draft/);
  });
});

describe("a history row", () => {
  const row: PublishedVersionRow = {
    version: 13,
    published_at: PUBLISHED,
    published_by: "user-1",
    change_note: "First cut.",
    created_at: PUBLISHED,
  };

  it("carries no document", () => {
    expect(workflowVersionSummary(row, 14)).not.toHaveProperty("definition");
  });

  it("marks the version in force rather than the newest", () => {
    // The pointer, not `max(version)`: a workflow can carry several published versions while
    // an older one runs.
    expect(workflowVersionSummary(row, 13).isCurrent).toBe(true);
    expect(workflowVersionSummary(row, 14).isCurrent).toBe(false);
    expect(workflowVersionSummary(row, null).isCurrent).toBe(false);
  });
});

describe("the detail", () => {
  it("is a summary, the draft slot and the one version asked for", () => {
    const detail = workflowDetail(workflow(), draft(), version());

    expect(detail).toMatchObject(workflowSummary(workflow()));
    expect(detail.draft.definition).toEqual({ dsl_version: "1.0", nodes: [] });
    expect(detail.version?.version).toBe(14);
  });

  it("carries a null version for a workflow that has published nothing", () => {
    // Not an error: it is the state **+ New workflow** leaves behind, and the canvas opens on
    // the draft.
    const detail = workflowDetail(workflow({ current_version: null }), draft(), undefined);

    expect(detail.version).toBeNull();
    expect(detail.draft.etag).not.toBe(NO_DRAFT);
  });
});

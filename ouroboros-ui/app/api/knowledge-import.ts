/**
 * Rule-file import — mockup 14's **Import CLAUDE.md / .cursorrules** through `ouroboros-rest`
 * (BF.4, [#413](https://github.com/NobuData/ouroboros/issues/413)), drawn by BG.1
 * ([#417](https://github.com/NobuData/ouroboros/issues/417)).
 *
 * ### Two operations, and the second must quote the first
 *
 * The preview reads a repository's `CLAUDE.md`, `AGENTS.md`, `.cursorrules` and
 * `.github/copilot-instructions.md` and says what an import would write — counts per file and
 * kind, up to five samples of each, how many candidates dedupe against what the workspace already
 * knows — and a `fingerprint` of that plan. **It writes nothing.** The apply re-reads the files and
 * re-plans under a lock, and writes only when its plan's fingerprint is the one it was sent:
 * what is created is exactly what the preview showed, or nothing
 * (`409 knowledge_import_preview_stale`). That is why this client has no `import()` — an apply
 * without a preview is not an operation the contract offers.
 *
 * ### Nothing it writes is live
 *
 * Skills arrive `draft: true`, facts arrive `proposed`. The sheet says so in as many words
 * (`app/knowledge/import.ts`'s `NOTHING_ENABLED`), because it is the fact that makes **Apply** an
 * easy press.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in these paths and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why). Both operations are `owner` or `admin` — the same gate as
 * creating a skill — and the service is what enforces it.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** What a preview sends — the repository, `owner/name`. */
export type PreviewRuleImportBody = components["schemas"]["PreviewRuleImportBody"];

/** What an apply sends — the repository and the preview's fingerprint. */
export type ApplyRuleImportBody = components["schemas"]["ApplyRuleImportBody"];

/** What an apply with this fingerprint would write. */
export type RuleImportPreview = components["schemas"]["RuleImportPreview"];

/** The preview the apply matched, and every row it wrote. */
export type RuleImportResult = components["schemas"]["RuleImportResult"];

/** One of the four rules files, as probed — found or not, and what it would yield. */
export type RuleImportFile = components["schemas"]["RuleImportFile"];

/** The whole import, summed. */
export type RuleImportTotals = components["schemas"]["RuleImportTotals"];

/** A skill draft the import would write — a `create`, or an `update` to an earlier import's. */
export type RuleImportSkillSample = components["schemas"]["RuleImportSkillSample"];

/** A fact candidate the import would write, with the provenance it will carry. */
export type RuleImportFactSample = components["schemas"]["RuleImportFactSample"];

/** The rule-file import, as `ouroboros-rest` serves it. */
export const knowledgeImport = {
  /**
   * What importing a repository's rules files would create — before anything is written.
   *
   * @param body The repository.
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The preview. A repository with none of the four files is an empty preview
   *   (`totals.filesFound: 0`), not a failure.
   * @throws {ApiError} `403 forbidden` for a member, `409 detection_source_missing` when no
   *   connected source can read the repository, `422 knowledge_import_too_large` past the caps,
   *   `429 knowledge_import_rate_limited`, `502 knowledge_import_source_failed`.
   */
  async preview(body: PreviewRuleImportBody, client: ApiClient = api()): Promise<RuleImportPreview> {
    return unwrap(await client.POST("/api/v1/knowledge/import/preview", { body }));
  },

  /**
   * Create exactly what a preview showed.
   *
   * @param body The repository and the preview's fingerprint.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The preview it matched, and every skill and fact written.
   * @throws {ApiError} Everything the preview can answer, and `409 knowledge_import_preview_stale`
   *   when the files or the workspace changed since the preview — nothing was written; preview
   *   again.
   */
  async apply(body: ApplyRuleImportBody, client: ApiClient = api()): Promise<RuleImportResult> {
    return unwrap(await client.POST("/api/v1/knowledge/import/apply", { body }));
  },
};

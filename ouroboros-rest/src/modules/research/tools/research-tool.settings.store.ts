/**
 * The stored binding of {@link ResearchToolSettings} — V127's `research_tool_settings`, which
 * the enable flow writes (CN.3, [#629](https://github.com/NobuData/ouroboros/issues/629)).
 *
 * **A row is what "enabled" means.** A workspace with no row for a tool reads null here, and
 * every adapter answers the idle dot for null; a tool that needs no settings is enabled by a
 * row holding `{}`.
 *
 * **The credential is sealed on the way in and opened for one call on the way out.** It is
 * bound to the workspace and to {@link vaultRecordId}, so an envelope copied onto another
 * workspace's row — or another tool's — does not open. A credential that will not open reads
 * as *no credential*: the tool then reports its own honest failure (a refused key) instead of
 * the card failing to draw.
 */

import { Injectable, Logger } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import { SCHEMA_NAME } from "../../db/schema";
import { VaultService } from "../../vault/vault.service";
import type { ResearchToolConfig } from "./research-tool.config";
import { ResearchToolSettings, type ToolSettings } from "./research-tool.settings";

const schema = sql.id(SCHEMA_NAME);

/** What a save carries. */
export interface ToolSettingsWrite {
  /** The non-secret settings, already judged against the tool's schema. */
  readonly config: ResearchToolConfig;
  /** A new credential, or null to keep whatever is stored. */
  readonly secret: string | null;
  /** Who is saving. */
  readonly userId: string;
}

/**
 * The vault record a tool's credential is sealed for.
 *
 * @param slug - The tool.
 * @returns The record id bound into the ciphertext.
 */
export function vaultRecordId(slug: string): string {
  return `research-tool:${slug}`;
}

@Injectable()
export class StoredToolSettings extends ResearchToolSettings {
  private readonly logger = new Logger(StoredToolSettings.name);

  /**
   * @param database - The pool.
   * @param vault - What seals and opens a credential.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly vault: VaultService,
  ) {
    super();
  }

  /** @inheritdoc */
  override async settingsFor(organizationId: string, slug: string): Promise<ToolSettings | null> {
    const { rows } = await sql<{
      config: ResearchToolConfig;
      credentials_encrypted: string | null;
    }>`
      select s.config, s.credentials_encrypted
        from ${schema}.research_tool_settings s
       where s.organization_id = ${organizationId} and s.tool_slug = ${slug}
    `.execute(this.database.db);
    const row = rows[0];

    if (row === undefined) return null;

    return {
      config: row.config,
      secret: await this.open(organizationId, slug, row.credentials_encrypted),
    };
  }

  /**
   * Store a workspace's settings for a tool — the first time, or over what is there.
   *
   * @param organizationId - The workspace.
   * @param slug - The tool; a `research_tools` slug.
   * @param write - The configuration, the credential (null keeps the stored one) and who.
   */
  async store(organizationId: string, slug: string, write: ToolSettingsWrite): Promise<void> {
    const sealed =
      write.secret === null
        ? null
        : await this.vault.encryptText(organizationId, vaultRecordId(slug), write.secret);

    await sql`
      insert into ${schema}.research_tool_settings as s
        (organization_id, tool_slug, config, credentials_encrypted, updated_by)
      values (${organizationId}, ${slug}, ${JSON.stringify(write.config)}::jsonb, ${sealed},
              ${write.userId})
      on conflict (organization_id, tool_slug) do update
         set config = excluded.config,
             credentials_encrypted = coalesce(excluded.credentials_encrypted, s.credentials_encrypted),
             updated_by = excluded.updated_by
    `.execute(this.database.db);
  }

  /**
   * Open a stored credential.
   *
   * @param organizationId - The workspace it was sealed for.
   * @param slug - The tool it was sealed for.
   * @param envelope - The stored envelope, or null.
   * @returns The plaintext; null when nothing is stored or the envelope will not open.
   */
  private async open(
    organizationId: string,
    slug: string,
    envelope: string | null,
  ): Promise<string | null> {
    if (envelope === null) return null;

    try {
      return await this.vault.decryptText(organizationId, vaultRecordId(slug), envelope);
    } catch {
      this.logger.warn(`The stored credential for research tool ${slug} could not be opened.`);
      return null;
    }
  }
}

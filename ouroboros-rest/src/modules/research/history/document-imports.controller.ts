/**
 * `/api/v1/research/document-imports` — imported document sets, the history index's third
 * corpus (CL.5, [#618](https://github.com/NobuData/ouroboros/issues/618)).
 *
 * Every member reads; only an owner imports or removes. The workspace is the session's.
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../../auth/principal";
import type { Organization } from "../../db/schema";
import { Roles } from "../../tenancy/roles.guard";
import { CurrentTenant } from "../../tenancy/tenant.decorators";
import { CreateDocumentImportDto, DocumentImportParams } from "./document-imports.dto";
import type {
  DocumentImportDetailResource,
  DocumentImportListResource,
} from "./document-imports.resources";
import { DocumentImportsService } from "./document-imports.service";

@Controller("research/document-imports")
export class DocumentImportsController {
  /** @param imports - The sets. */
  constructor(private readonly imports: DocumentImportsService) {}

  /**
   * `GET /research/document-imports` — the workspace's imported sets, newest first.
   *
   * @param tenant - The workspace.
   * @returns The sets.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<DocumentImportListResource> {
    return this.imports.list(tenant.id);
  }

  /**
   * `POST /research/document-imports` — import a CSV or Markdown file as a set. Owner only.
   *
   * @param tenant - The workspace.
   * @param principal - The session, for who imported it.
   * @param body - Collection, name, title, description, format and the file's text.
   * @returns The set and its documents (`201`).
   */
  @Post()
  @Roles("owner")
  create(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() body: CreateDocumentImportDto,
  ): Promise<DocumentImportDetailResource> {
    return this.imports.create(tenant.id, principal.user.id, body);
  }

  /**
   * `GET /research/document-imports/{importId}` — one set and its documents.
   *
   * @param tenant - The workspace.
   * @param params - The set.
   * @returns The set.
   */
  @Get(":importId")
  get(
    @CurrentTenant() tenant: Organization,
    @Param() params: DocumentImportParams,
  ): Promise<DocumentImportDetailResource> {
    return this.imports.get(tenant.id, params.importId);
  }

  /**
   * `DELETE /research/document-imports/{importId}` — remove a set and its documents. Owner only.
   *
   * @param tenant - The workspace.
   * @param params - The set.
   * @returns Nothing (`204`).
   */
  @Delete(":importId")
  @Roles("owner")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentTenant() tenant: Organization,
    @Param() params: DocumentImportParams,
  ): Promise<void> {
    return this.imports.remove(tenant.id, params.importId);
  }
}

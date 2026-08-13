/**
 * `/api/v1/orgs/{orgId}/domains` — the email domains that resolve a workspace at sign-in.
 *
 * The set-primary operation is a `PATCH` on one domain rather than a verb of its own
 * (`POST …/primary`), because "which of these is primary" is a property of the row and
 * `{"isPrimary": true}` is what changing it looks like. It is a fourth operation, not a fourth
 * resource.
 *
 * **The path moved with the vocabulary.** These four were `/api/v1/tenants/{tenantId}/domains`
 * until [#714](https://github.com/NobuData/ouroboros/issues/714), and `/api/v1/tenants` no
 * longer exists at all — V006 dropped the table it read and the organization plugin serves
 * workspace CRUD. Leaving domains under a prefix whose parent resource was gone would have
 * been two names for one thing in one API, so they are addressed by the workspace the rest of
 * this module addresses.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from "@nestjs/common";

import { ConstraintViolationInterceptor } from "./constraints";
import { DomainsService } from "./domains.service";
import { PageQuery, type Page } from "./pagination";
import { ADMINISTRATORS, Roles } from "./roles.guard";
import type { DomainResource } from "./resources";
import { CreateDomainBody, DomainParams, OrgParams, UpdateDomainBody } from "./tenancy.dto";

@Controller("orgs/:orgId/domains")
@UseInterceptors(ConstraintViolationInterceptor)
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  /**
   * `GET …/domains` — one page of this workspace's domains, the primary first.
   *
   * @param params - The workspace's id.
   * @param query - `limit` and `offset`.
   * @returns The page.
   */
  @Get()
  list(@Param() params: OrgParams, @Query() query: PageQuery): Promise<Page<DomainResource>> {
    return this.domains.list(params.orgId, query);
  }

  /**
   * `POST …/domains` — claim a domain for this workspace.
   *
   * @param params - The workspace's id.
   * @param body - The domain, and whether it becomes the primary.
   * @returns The domain as it was stored, with `201`.
   */
  @Roles(...ADMINISTRATORS)
  @Post()
  add(@Param() params: OrgParams, @Body() body: CreateDomainBody): Promise<DomainResource> {
    return this.domains.add(params.orgId, body);
  }

  /**
   * `PATCH …/domains/{domainId}` — promote this domain to primary, or demote it.
   *
   * @param params - The workspace's id and the domain's.
   * @param body - `isPrimary`.
   * @returns The domain after the change.
   */
  @Roles(...ADMINISTRATORS)
  @Patch(":domainId")
  setPrimary(
    @Param() params: DomainParams,
    @Body() body: UpdateDomainBody,
  ): Promise<DomainResource> {
    return this.domains.setPrimary(params.orgId, params.domainId, body);
  }

  /**
   * `DELETE …/domains/{domainId}` — give the domain up.
   *
   * `204`, and no body: there is nothing to say about a row that no longer exists, and a
   * `200` carrying the deleted resource invites a client to keep using it.
   *
   * @param params - The workspace's id and the domain's.
   * @returns When it is gone.
   */
  @Roles(...ADMINISTRATORS)
  @Delete(":domainId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param() params: DomainParams): Promise<void> {
    return this.domains.remove(params.orgId, params.domainId);
  }
}

/**
 * `/api/v1/settings/webhooks` — outbound webhook management (BR.3,
 * [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * GET    /settings/webhooks                                     endpoints · N active · SIEM row · registry
 * POST   /settings/webhooks                                     create — answers with the secret, once
 * GET    /settings/webhooks/:id                                 one endpoint
 * PATCH  /settings/webhooks/:id                                 edit, enable, disable
 * DELETE /settings/webhooks/:id                                 delete with its log
 * POST   /settings/webhooks/:id/rotate-secret                   new secret, once
 * POST   /settings/webhooks/:id/ping                            a real test delivery, logged
 * GET    /settings/webhooks/:id/deliveries                      the delivery log
 * POST   /settings/webhooks/:id/deliveries/:deliveryId/redeliver   requeue a dead letter
 * ```
 *
 * **Owners and administrators only, people only** — every route is `@Roles(...ADMINISTRATORS)`,
 * reads included: an endpoint list names where this workspace's audit trail is sent, which is
 * itself a fact worth protecting, and no service account can re-point the SIEM.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { CreateWebhookDto, ListDeliveriesQuery, UpdateWebhookDto } from "./webhooks.dto";
import type {
  WebhookDeliveryPageResource,
  WebhookDeliveryResource,
  WebhookEndpointResource,
  WebhookListResource,
  WebhookSecretResource,
} from "./webhooks.resources";
import { WebhooksService } from "./webhooks.service";

@Controller("settings/webhooks")
@Roles(...ADMINISTRATORS)
export class WebhooksController {
  /**
   * @param webhooks - The operations.
   */
  constructor(private readonly webhooks: WebhooksService) {}

  /**
   * Every endpoint with its health, the counted *N active*, the SIEM row and the registry.
   *
   * @param tenant - The workspace.
   * @returns The list.
   */
  @Get()
  list(@CurrentTenant() tenant: Organization): Promise<WebhookListResource> {
    return this.webhooks.list(tenant.id);
  }

  /**
   * Create an endpoint. The answer carries its signing secret — the only time it ever will.
   *
   * @param tenant - The workspace.
   * @param principal - Who created it.
   * @param request - The endpoint.
   * @returns The endpoint and its secret, `201`.
   */
  @Post()
  create(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Body() request: CreateWebhookDto,
  ): Promise<WebhookSecretResource> {
    return this.webhooks.create(tenant.id, principal.user.id, request);
  }

  /**
   * One endpoint.
   *
   * @param tenant - The workspace.
   * @param id - The endpoint.
   * @returns The endpoint.
   */
  @Get(":id")
  read(
    @CurrentTenant() tenant: Organization,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<WebhookEndpointResource> {
    return this.webhooks.read(tenant.id, id);
  }

  /**
   * Edit, enable or disable an endpoint.
   *
   * @param tenant - The workspace.
   * @param principal - Who edited it.
   * @param id - The endpoint.
   * @param request - The fields to change.
   * @returns The endpoint as stored.
   */
  @Patch(":id")
  update(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() request: UpdateWebhookDto,
  ): Promise<WebhookEndpointResource> {
    return this.webhooks.update(tenant.id, principal.user.id, id, request);
  }

  /**
   * Delete an endpoint and its delivery log.
   *
   * @param tenant - The workspace.
   * @param principal - Who deleted it.
   * @param id - The endpoint.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.webhooks.remove(tenant.id, principal.user.id, id);
  }

  /**
   * Replace the signing secret. The old one stops signing immediately.
   *
   * @param tenant - The workspace.
   * @param principal - Who rotated it.
   * @param id - The endpoint.
   * @returns The endpoint and its new secret.
   */
  @Post(":id/rotate-secret")
  @HttpCode(HttpStatus.OK)
  rotate(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<WebhookSecretResource> {
    return this.webhooks.rotate(tenant.id, principal.user.id, id);
  }

  /**
   * Fire the `ping` test event now and answer with the delivery-log row it produced.
   *
   * @param tenant - The workspace.
   * @param id - The endpoint.
   * @returns The settled attempt.
   */
  @Post(":id/ping")
  @HttpCode(HttpStatus.OK)
  ping(
    @CurrentTenant() tenant: Organization,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<WebhookDeliveryResource> {
    return this.webhooks.ping(tenant.id, id);
  }

  /**
   * One page of the endpoint's delivery log, newest first.
   *
   * @param tenant - The workspace.
   * @param id - The endpoint.
   * @param query - The status filter and window.
   * @returns The page.
   */
  @Get(":id/deliveries")
  deliveries(
    @CurrentTenant() tenant: Organization,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListDeliveriesQuery,
  ): Promise<WebhookDeliveryPageResource> {
    return this.webhooks.deliveries(tenant.id, id, query);
  }

  /**
   * Queue a dead-lettered event again, with its original idempotency key.
   *
   * @param tenant - The workspace.
   * @param principal - Who redelivered it.
   * @param id - The endpoint.
   * @param deliveryId - The dead-lettered attempt.
   * @returns The new pending attempt, `202`.
   */
  @Post(":id/deliveries/:deliveryId/redeliver")
  @HttpCode(HttpStatus.ACCEPTED)
  redeliver(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("deliveryId", ParseUUIDPipe) deliveryId: string,
  ): Promise<WebhookDeliveryResource> {
    return this.webhooks.redeliver(tenant.id, principal.user.id, id, deliveryId);
  }
}

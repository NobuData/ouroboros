/**
 * Account approval's routes: the caller's status, and the application administrator's page.
 *
 * The decision at sign-in and the guard are not here — they are BetterAuth hooks and the global
 * guard (`auth/account.approval.ts`, `auth/session-or-service.guard.ts`). This module is what an
 * administrator does afterwards.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { MailModule } from "../mail/mail.module";
import { AccountController, AdminAccountsController } from "./accounts.controller";
import { ACCOUNT_DIRECTORY, BetterAuthAccountDirectory } from "./accounts.directory";
import { AccountsRepository } from "./accounts.repository";
import { AccountsService } from "./accounts.service";

@Module({
  imports: [DbModule, MailModule],
  controllers: [AccountController, AdminAccountsController],
  providers: [
    AccountsRepository,
    AccountsService,
    { provide: ACCOUNT_DIRECTORY, useClass: BetterAuthAccountDirectory },
  ],
})
export class AccountsModule {}

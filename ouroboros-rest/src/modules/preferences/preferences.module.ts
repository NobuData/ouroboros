/**
 * Preferences — per-person product settings, starting with the font scale
 * ([#649](https://github.com/NobuData/ouroboros/issues/649)).
 *
 * The smallest module in `src/modules/`, and the same three layers as the largest, because
 * the seams are the point rather than the size:
 *
 * ```
 * controller  route, request shape, nothing else   → preferences.controller.ts
 * service     the rules                            → preferences.service.ts
 * repository  the statements, and nothing else     → preferences.repository.ts
 * ```
 *
 * It imports `DbModule` for the reason every module with a repository does: the import is
 * the answer to "who can reach `user_preferences`", and `DbModule` is deliberately
 * non-global so the question has one.
 *
 * What it deliberately is not: a theme store (the theme is a browser fact the UI keeps in
 * `localStorage` alone — see `ouroboros-ui/app/theme.ts`), and a per-workspace settings
 * surface (that is tenancy's territory, scoped and role-guarded). A setting belongs here
 * exactly when it belongs to the person's own eyes and hands, whatever workspace they are
 * acting in.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { PreferencesController } from "./preferences.controller";
import { PreferencesRepository } from "./preferences.repository";
import { PreferencesService } from "./preferences.service";

@Module({
  imports: [DbModule],
  controllers: [PreferencesController],
  providers: [PreferencesService, PreferencesRepository],
  // Nothing is exported: the only way to a preference is the route, which is what keeps
  // "who read it" and "who changed it" questions with one answer.
})
export class PreferencesModule {}

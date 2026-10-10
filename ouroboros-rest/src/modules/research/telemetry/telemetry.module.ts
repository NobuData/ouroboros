/**
 * The telemetry tool's reads (CL.6, [#619](https://github.com/NobuData/ouroboros/issues/619)):
 * the read-only repository over the test, run and baseline planes, exported for the tool's
 * factory and for CM.4's watch (#623), which makes the same comparison.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../../db/db.module";
import { TelemetryRepository } from "./telemetry.repository";

@Module({
  imports: [DbModule],
  providers: [TelemetryRepository],
  exports: [TelemetryRepository],
})
export class TelemetryModule {}

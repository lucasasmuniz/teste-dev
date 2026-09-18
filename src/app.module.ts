import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ZipCodeModule } from './zip-code/zip-code.module.js';
import { ConfigModule } from './config.js';
import { ObservabilityModule } from './observability.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

@Module({
  imports: [ConfigModule, ObservabilityModule, ZipCodeModule],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}

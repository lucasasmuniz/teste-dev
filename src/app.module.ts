import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ZipCodeModule } from './zip-code/zip-code.module.js';
import { ConfigModule } from './config.js';
import { ObservabilityModule } from './observability.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';
import { RateLimitGuard, RateLimitModule } from './rate-limit.js';

@Module({
  imports: [ConfigModule, ObservabilityModule, RateLimitModule, ZipCodeModule],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}

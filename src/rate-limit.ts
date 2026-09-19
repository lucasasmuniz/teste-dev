import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CONFIG, ConfigModule, type Config } from './config.js';
import { RateLimited } from './problems.js';

export const RateLimitModule = ThrottlerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [CONFIG],
  useFactory: (config: Config) => ({
    throttlers: [
      { ttl: config.RATE_LIMIT_WINDOW_MS, limit: config.RATE_LIMIT_MAX },
    ],
  }),
});

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected async throwThrottlingException(): Promise<void> {
    throw new RateLimited();
  }
}

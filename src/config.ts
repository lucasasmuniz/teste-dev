import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const configSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    REQUEST_BUDGET_MS: z.coerce.number().int().positive().default(7000),
    CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
    CIRCUIT_COOLDOWN_MS: z.coerce.number().int().positive().default(30000),
    CACHE_FRESH_MS: z.coerce.number().int().positive().default(86_400_000),
    CACHE_EXPIRED_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(604_800_000),
    CACHE_ABSENCE_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
    CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(10000),
  })
  .refine((config) => config.CACHE_EXPIRED_WINDOW_MS > config.CACHE_FRESH_MS, {
    path: ['CACHE_EXPIRED_WINDOW_MS'],
    message: 'must be longer than CACHE_FRESH_MS',
  });

export const CONFIG = Symbol('CONFIG');

export class InvalidConfig extends Error {
  constructor(readonly issues: Record<string, ConfigIssue>) {
    super('invalid configuration');
  }
}

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [CONFIG],
})
export class ConfigModule {}

function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = configSchema.safeParse(env);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => {
    const variable = String(issue.path[0]);
    return [variable, { value: env[variable], error: issue.message }];
  });
  throw new InvalidConfig(Object.fromEntries(issues));
}

interface ConfigIssue {
  value: string | undefined;
  error: string;
}

export type Config = z.infer<typeof configSchema>;

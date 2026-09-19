import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  REQUEST_BUDGET_MS: z.coerce.number().int().positive().default(7000),
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

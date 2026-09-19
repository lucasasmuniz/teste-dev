import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CONFIG, type Config } from '../config.js';
import {
  ADDRESS_LOOKUPS,
  FailureReason,
  type AddressLookup,
  type LookupResult,
} from './address-lookup.js';
import type { CanonicalAddress } from './canonical-address.js';
import { ProvidersExhausted, type Attempt } from './problems.js';

@Injectable()
export class AddressResolver {
  private readonly timeoutMs: number;
  private readonly budgetMs: number;
  private nextStart = 0;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(ADDRESS_LOOKUPS) private readonly lookups: AddressLookup[],
    private readonly logger: PinoLogger,
  ) {
    this.timeoutMs = config.PROVIDER_TIMEOUT_MS;
    this.budgetMs = config.REQUEST_BUDGET_MS;
    logger.setContext(AddressResolver.name);
  }

  async resolve(zipCode: string): Promise<Resolution> {
    const startedAt = performance.now();
    const deadline = startedAt + this.budgetMs;
    const attempts: Attempt[] = [];

    for (const lookup of this.rotation()) {
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        this.logger.warn(
          { provider: lookup.provider, zipCode, result: FailureReason.Timeout },
          'provider skipped, request budget exhausted',
        );
        attempts.push({
          provider: lookup.provider,
          reason: FailureReason.Timeout,
        });
        continue;
      }
      const { result, durationMs } = await this.attempt(
        lookup,
        zipCode,
        attempts.length + 1,
        Math.min(this.timeoutMs, remainingMs),
      );
      if (result.ok) {
        this.summarize(zipCode, startedAt, 'ok', [
          ...attempts.map((attempt) => attempt.provider),
          lookup.provider,
        ]);
        return {
          address: result.address,
          provider: lookup.provider,
          durationMs,
        };
      }
      attempts.push({ provider: lookup.provider, reason: result.reason });
    }

    this.summarize(
      zipCode,
      startedAt,
      'providers_exhausted',
      attempts.map((attempt) => attempt.provider),
    );
    throw new ProvidersExhausted(attempts);
  }

  private rotation(): AddressLookup[] {
    const start = this.nextStart;
    this.nextStart = (start + 1) % this.lookups.length;
    return [...this.lookups.slice(start), ...this.lookups.slice(0, start)];
  }

  private async attempt(
    lookup: AddressLookup,
    zipCode: string,
    attemptNumber: number,
    timeoutMs: number,
  ): Promise<{ result: LookupResult; durationMs: number }> {
    const startedAt = performance.now();
    const result = await withTimeout(timeoutMs, (signal) =>
      lookup.lookup(zipCode, signal),
    );
    const durationMs = elapsedSince(startedAt);
    this.logger[result.ok ? 'info' : 'warn'](
      {
        provider: lookup.provider,
        zipCode,
        attempt: attemptNumber,
        result: result.ok ? 'ok' : result.reason,
        durationMs,
      },
      'provider attempt',
    );
    return { result, durationMs };
  }

  private summarize(
    zipCode: string,
    startedAt: number,
    result: 'ok' | 'providers_exhausted',
    providers: string[],
  ) {
    const answeredAtFirstTry = result === 'ok' && providers.length === 1;
    this.logger[answeredAtFirstTry ? 'info' : 'warn'](
      { zipCode, result, providers, durationMs: elapsedSince(startedAt) },
      'lookup summary',
    );
  }
}

async function withTimeout(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<LookupResult>,
): Promise<LookupResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = new Promise<LookupResult>((resolve) => {
    controller.signal.addEventListener('abort', () =>
      resolve({ ok: false, reason: FailureReason.Timeout }),
    );
  });
  try {
    return await Promise.race([run(controller.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export interface Resolution {
  address: CanonicalAddress;
  provider: string;
  durationMs: number;
}

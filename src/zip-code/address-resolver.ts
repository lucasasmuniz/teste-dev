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
import {
  ConfirmedAbsence,
  PartialAbsence,
  ProvidersExhausted,
  type Attempt,
} from './problems.js';

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

    const conclusion = concludeFrom(attempts);
    this.summarize(
      zipCode,
      startedAt,
      conclusion.result,
      attempts.map((attempt) => attempt.provider),
    );
    throw conclusion.problem;
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
    const answered = result.ok || result.reason === FailureReason.NotFound;
    this.logger[answered ? 'info' : 'warn'](
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
    result: 'ok' | Conclusion['result'],
    providers: string[],
  ) {
    const expected =
      (result === 'ok' && providers.length === 1) ||
      result === 'confirmed_absence';
    this.logger[expected ? 'info' : 'warn'](
      { zipCode, result, providers, durationMs: elapsedSince(startedAt) },
      'lookup summary',
    );
  }
}

function concludeFrom(attempts: Attempt[]): Conclusion {
  const notFoundCount = attempts.filter(
    (attempt) => attempt.reason === FailureReason.NotFound,
  ).length;
  if (notFoundCount > 0 && notFoundCount === attempts.length) {
    return {
      result: 'confirmed_absence',
      problem: new ConfirmedAbsence(attempts),
    };
  }
  if (notFoundCount > 0) {
    return {
      result: 'partial_absence',
      problem: new PartialAbsence(attempts),
    };
  }
  return {
    result: 'providers_exhausted',
    problem: new ProvidersExhausted(attempts),
  };
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

type Conclusion =
  | { result: 'confirmed_absence'; problem: ConfirmedAbsence }
  | { result: 'partial_absence'; problem: PartialAbsence }
  | { result: 'providers_exhausted'; problem: ProvidersExhausted };

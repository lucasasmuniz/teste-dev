import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CONFIG, type Config } from '../config.js';
import {
  ADDRESS_LOOKUPS,
  FailureReason,
  type AddressLookup,
} from './address-lookup.js';
import type { CanonicalAddress } from './canonical-address.js';
import { CircuitBreakers } from './circuit-breakers.js';
import {
  elapsedSince,
  GuardedLookup,
  RequestBudget,
} from './guarded-lookup.js';
import {
  ConfirmedAbsence,
  PartialAbsence,
  ProvidersExhausted,
  type Attempt,
} from './problems.js';

@Injectable()
export class AddressResolver {
  private readonly budgetMs: number;
  private readonly retryAfterSeconds: number;
  private readonly guarded: GuardedLookup[];
  private nextStart = 0;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(ADDRESS_LOOKUPS) lookups: AddressLookup[],
    breakers: CircuitBreakers,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(AddressResolver.name);
    this.budgetMs = config.REQUEST_BUDGET_MS;
    this.retryAfterSeconds = breakers.retryAfterSeconds;
    this.guarded = lookups.map(
      (lookup) =>
        new GuardedLookup(
          lookup,
          breakers.for(lookup.provider),
          config.PROVIDER_TIMEOUT_MS,
          logger,
        ),
    );
  }

  /**
   * Asks providers in round-robin order, falling back on failure or absence,
   * and returns within the request budget. Throws only the problem that
   * concludes the lookup: `ConfirmedAbsence`, `PartialAbsence` or
   * `ProvidersExhausted`.
   */
  async resolve(zipCode: string): Promise<Resolution> {
    const startedAt = performance.now();
    const budget = new RequestBudget(this.budgetMs);
    const attempts: Attempt[] = [];

    for (const guarded of this.rotation()) {
      const outcome = await guarded.lookup(zipCode, budget);
      if (outcome.ok) {
        this.summarize(zipCode, startedAt, 'ok', [
          ...attempts.map((attempt) => attempt.provider),
          guarded.provider,
        ]);
        return {
          address: outcome.address,
          provider: guarded.provider,
          durationMs: outcome.durationMs,
        };
      }
      attempts.push({ provider: guarded.provider, reason: outcome.reason });
    }

    const conclusion = concludeFrom(attempts, this.retryAfterSeconds);
    this.summarize(
      zipCode,
      startedAt,
      conclusion.result,
      attempts.map((attempt) => attempt.provider),
    );
    throw conclusion.problem;
  }

  private rotation(): GuardedLookup[] {
    const start = this.nextStart;
    this.nextStart = (start + 1) % this.guarded.length;
    return [...this.guarded.slice(start), ...this.guarded.slice(0, start)];
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

function concludeFrom(
  attempts: Attempt[],
  retryAfterSeconds: number,
): Conclusion {
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
    problem: new ProvidersExhausted(attempts, retryAfterSeconds),
  };
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

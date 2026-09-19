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
import { GuardedLookup, RequestBudget } from './guarded-lookup.js';
import type { Attempt } from './problems.js';

@Injectable()
export class AddressResolver {
  private readonly budgetMs: number;
  private readonly guarded: GuardedLookup[];
  private nextStart = 0;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(ADDRESS_LOOKUPS) lookups: AddressLookup[],
    breakers: CircuitBreakers,
    logger: PinoLogger,
  ) {
    logger.setContext(AddressResolver.name);
    this.budgetMs = config.REQUEST_BUDGET_MS;
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
   * within the request budget.
   */
  async resolve(zipCode: string): Promise<Resolution> {
    const budget = new RequestBudget(this.budgetMs);
    const attempts: Attempt[] = [];

    for (const guarded of this.rotation()) {
      const outcome = await guarded.lookup(zipCode, budget);
      if (outcome.ok) {
        return {
          result: Conclusion.Found,
          address: outcome.address,
          provider: guarded.provider,
          durationMs: outcome.durationMs,
          attempts,
        };
      }
      attempts.push({ provider: guarded.provider, reason: outcome.reason });
    }
    return { result: concludeFrom(attempts), attempts };
  }

  private rotation(): GuardedLookup[] {
    const start = this.nextStart;
    this.nextStart = (start + 1) % this.guarded.length;
    return [...this.guarded.slice(start), ...this.guarded.slice(0, start)];
  }
}

function concludeFrom(attempts: Attempt[]): Unresolved['result'] {
  const notFoundCount = attempts.filter(
    (attempt) => attempt.reason === FailureReason.NotFound,
  ).length;
  if (notFoundCount > 0 && notFoundCount === attempts.length) {
    return Conclusion.ConfirmedAbsence;
  }
  if (notFoundCount > 0) {
    return Conclusion.PartialAbsence;
  }
  return Conclusion.ProvidersExhausted;
}

export type Resolution =
  | {
      result: typeof Conclusion.Found;
      address: CanonicalAddress;
      provider: string;
      durationMs: number;
      attempts: Attempt[];
    }
  | Unresolved;

export interface Unresolved {
  result: Exclude<Conclusion, typeof Conclusion.Found>;
  attempts: Attempt[];
}

export const Conclusion = {
  Found: 'found',
  ConfirmedAbsence: 'confirmed_absence',
  PartialAbsence: 'partial_absence',
  ProvidersExhausted: 'providers_exhausted',
} as const;

export type Conclusion = (typeof Conclusion)[keyof typeof Conclusion];

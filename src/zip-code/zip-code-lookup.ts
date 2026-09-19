import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AddressCache, CachedKind } from './address-cache.js';
import {
  AddressResolver,
  Conclusion,
  type Unresolved,
} from './address-resolver.js';
import type { CanonicalAddress } from './canonical-address.js';
import { CircuitBreakers } from './circuit-breakers.js';
import { elapsedSince } from './guarded-lookup.js';
import {
  ConfirmedAbsence,
  PartialAbsence,
  ProvidersExhausted,
} from './problems.js';

@Injectable()
export class ZipCodeLookup {
  constructor(
    private readonly cache: AddressCache,
    private readonly resolver: AddressResolver,
    private readonly breakers: CircuitBreakers,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(ZipCodeLookup.name);
  }

  /**
   * Answers a zip code from the fresh cache or the providers, falling back to
   * an expired address only when every provider failed. Otherwise throws the
   * problem that concludes the lookup: `ConfirmedAbsence`, `PartialAbsence` or
   * `ProvidersExhausted`.
   */
  async lookup(zipCode: string): Promise<Answer> {
    const startedAt = performance.now();
    const decision = await this.decide(zipCode, startedAt);
    this.summarize({
      zipCode,
      result: decision.result,
      source:
        decision.result === Answered.Ok
          ? decision.answer.source
          : decision.source,
      providers: decision.providers,
      durationMs: elapsedSince(startedAt),
    });
    if (decision.result === Answered.Ok) {
      return decision.answer;
    }
    throw this.problemFor(decision);
  }

  private async decide(zipCode: string, startedAt: number): Promise<Decision> {
    const cached = await this.cache.read(zipCode);
    if (cached?.kind === CachedKind.ConfirmedAbsence) {
      return {
        result: Conclusion.ConfirmedAbsence,
        attempts: cached.attempts,
        source: Source.FreshCache,
        providers: [],
      };
    }
    if (cached?.fresh) {
      const { address, provider } = cached;
      return {
        result: Answered.Ok,
        answer: {
          source: Source.FreshCache,
          address,
          provider,
          durationMs: elapsedSince(startedAt),
        },
        providers: [],
      };
    }

    const resolution = await this.resolver.resolve(zipCode);
    const { attempts } = resolution;
    const providers = attempts.map((attempt) => attempt.provider);
    if (resolution.result === Conclusion.Found) {
      const { address, provider, durationMs } = resolution;
      await this.cache.storeAddress(zipCode, address, provider);
      return {
        result: Answered.Ok,
        answer: { source: Source.Provider, address, provider, durationMs },
        providers: [...providers, provider],
      };
    }
    if (resolution.result === Conclusion.ProvidersExhausted && cached) {
      const { address, provider, storedAt } = cached;
      return {
        result: Answered.Ok,
        answer: {
          source: Source.ExpiredCache,
          address,
          provider,
          durationMs: elapsedSince(startedAt),
          storedAt,
        },
        providers,
      };
    }
    if (resolution.result === Conclusion.ConfirmedAbsence) {
      await this.cache.storeConfirmedAbsence(zipCode, attempts);
    }
    return { ...resolution, source: Source.Provider, providers };
  }

  private problemFor(unresolved: Unresolved) {
    switch (unresolved.result) {
      case Conclusion.ConfirmedAbsence:
        return new ConfirmedAbsence(unresolved.attempts);
      case Conclusion.PartialAbsence:
        return new PartialAbsence(unresolved.attempts);
      case Conclusion.ProvidersExhausted:
        return new ProvidersExhausted(
          unresolved.attempts,
          this.breakers.retryAfterSeconds,
        );
    }
  }

  private summarize(summary: Summary) {
    const expected =
      summary.source === Source.FreshCache ||
      (summary.result === Answered.Ok &&
        summary.source === Source.Provider &&
        summary.providers.length === 1) ||
      summary.result === Conclusion.ConfirmedAbsence;
    this.logger[expected ? 'info' : 'warn'](summary, 'lookup summary');
  }
}

interface Summary {
  zipCode: string;
  result: Decision['result'];
  source: Source;
  providers: string[];
  durationMs: number;
}

export type Answer =
  | {
      source: typeof Source.Provider | typeof Source.FreshCache;
      address: CanonicalAddress;
      provider: string;
      durationMs: number;
    }
  | {
      source: typeof Source.ExpiredCache;
      address: CanonicalAddress;
      provider: string;
      durationMs: number;
      storedAt: number;
    };

type Decision =
  | { result: typeof Answered.Ok; answer: Answer; providers: string[] }
  | (Unresolved & { source: Source; providers: string[] });

export type Source = (typeof Source)[keyof typeof Source];

const Answered = {
  Ok: 'ok',
} as const;

export const Source = {
  Provider: 'provider',
  FreshCache: 'fresh_cache',
  ExpiredCache: 'expired_cache',
} as const;

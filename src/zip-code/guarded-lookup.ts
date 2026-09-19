import type { PinoLogger } from 'nestjs-pino';
import {
  FailureReason,
  type AddressLookup,
  type LookupResult,
} from './address-lookup.js';
import type { CanonicalAddress } from './canonical-address.js';
import {
  Health,
  type CircuitBreaker,
  type Permit,
} from './circuit-breakers.js';

/**
 * One provider behind its circuit, its concurrency cap, the request budget and
 * the attempt timeout. Never throws unless the adapter breaks its own promise
 * not to. Every call settles the circuit permit it took, and a provider it
 * skips comes back as `circuit_open`, `capped` or `timeout` without being
 * called. A full cap never waits for a free slot.
 */
export class GuardedLookup {
  private inFlight = 0;

  constructor(
    private readonly adapter: AddressLookup,
    private readonly breaker: CircuitBreaker,
    private readonly limits: AttemptLimits,
    private readonly logger: PinoLogger,
  ) {}

  get provider(): string {
    return this.adapter.provider;
  }

  async lookup(
    zipCode: string,
    budget: RequestBudget,
  ): Promise<GuardedOutcome> {
    const permit = this.breaker.tryAcquire();
    if (!permit) {
      return this.skip(
        zipCode,
        FailureReason.CircuitOpen,
        'provider skipped by circuit breaker',
      );
    }
    if (this.inFlight >= this.limits.maxConcurrency) {
      this.breaker.record(permit, Health.Neutral);
      return this.skip(
        zipCode,
        FailureReason.Capped,
        'provider skipped, concurrency cap reached',
      );
    }
    const remainingMs = budget.remainingMs();
    if (remainingMs <= 0) {
      this.breaker.record(permit, Health.Neutral);
      return this.skip(
        zipCode,
        FailureReason.Timeout,
        'provider skipped, request budget exhausted',
      );
    }
    return this.attempt(
      zipCode,
      budget.countAttempt(),
      Math.min(this.limits.timeoutMs, remainingMs),
      permit,
    );
  }

  private skip(
    zipCode: string,
    reason: FailureReason,
    message: string,
  ): GuardedOutcome {
    this.logger.warn(
      {
        provider: this.provider,
        zipCode,
        result: reason,
        circuit: this.breaker.state,
      },
      message,
    );
    return { ok: false, reason };
  }

  private async attempt(
    zipCode: string,
    attemptNumber: number,
    timeoutMs: number,
    permit: Permit,
  ): Promise<GuardedOutcome> {
    const circuit = this.breaker.state;
    const startedAt = performance.now();
    let health: Health = Health.Neutral;
    this.inFlight++;
    try {
      const result = await withTimeout(timeoutMs, (signal) =>
        this.adapter.lookup(zipCode, signal),
      );
      health = healthOf(result, timeoutMs < this.limits.timeoutMs);
      const durationMs = elapsedSince(startedAt);
      const answered = result.ok || result.reason === FailureReason.NotFound;
      this.logger[answered ? 'info' : 'warn'](
        {
          provider: this.provider,
          zipCode,
          attempt: attemptNumber,
          result: result.ok ? 'ok' : result.reason,
          durationMs,
          circuit,
        },
        'provider attempt',
      );
      return result.ok ? { ...result, durationMs } : result;
    } finally {
      this.inFlight--;
      this.breaker.record(permit, health);
    }
  }
}

export class RequestBudget {
  private readonly deadline: number;
  private attempts = 0;

  constructor(budgetMs: number) {
    this.deadline = performance.now() + budgetMs;
  }

  remainingMs(): number {
    return this.deadline - performance.now();
  }

  countAttempt(): number {
    return ++this.attempts;
  }
}

export function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function healthOf(result: LookupResult, cutShortByBudget: boolean): Health {
  if (result.ok) {
    return Health.Healthy;
  }
  switch (result.reason) {
    case FailureReason.NotFound:
      return Health.Healthy;
    case FailureReason.Timeout:
      return cutShortByBudget ? Health.Neutral : Health.Failing;
    case FailureReason.HttpError:
    case FailureReason.SchemaInvalid:
      return Health.Failing;
    case FailureReason.Capped:
    case FailureReason.CircuitOpen:
      return Health.Neutral;
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

interface AttemptLimits {
  timeoutMs: number;
  maxConcurrency: number;
}

export type GuardedOutcome =
  | { ok: true; address: CanonicalAddress; durationMs: number }
  | { ok: false; reason: FailureReason };

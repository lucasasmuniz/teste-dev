import { Inject, Injectable } from '@nestjs/common';
import assert from 'node:assert';
import { PinoLogger } from 'nestjs-pino';
import newrelic from 'newrelic';
import { CONFIG, type Config } from '../config.js';
import { ADDRESS_LOOKUPS, type AddressLookup } from './address-lookup.js';

export const CircuitState = {
  Closed: 'closed',
  Open: 'open',
  HalfOpen: 'half_open',
} as const;

export const Health = {
  Healthy: 'healthy',
  Failing: 'failing',
  Neutral: 'neutral',
} as const;

export const Permit = {
  Call: 'call',
  Probe: 'probe',
} as const;

@Injectable()
export class CircuitBreakers {
  readonly retryAfterSeconds: number;
  private readonly byProvider: Map<string, CircuitBreaker>;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(ADDRESS_LOOKUPS) lookups: AddressLookup[],
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(CircuitBreakers.name);
    this.retryAfterSeconds = Math.ceil(config.CIRCUIT_COOLDOWN_MS / 1000);
    this.byProvider = new Map(
      lookups.map(({ provider }) => [
        provider,
        new CircuitBreaker(
          config.CIRCUIT_FAILURE_THRESHOLD,
          config.CIRCUIT_COOLDOWN_MS,
          (from, to) => this.report({ provider, from, to }),
        ),
      ]),
    );
  }

  for(provider: string): CircuitBreaker {
    const breaker = this.byProvider.get(provider);
    assert(breaker, `no circuit breaker for provider ${provider}`);
    return breaker;
  }

  private report(change: StateChange) {
    this.logger[change.to === CircuitState.Open ? 'warn' : 'info'](
      change,
      'circuit state change',
    );
    newrelic.recordCustomEvent('CircuitStateChange', { ...change });
  }
}

export class CircuitBreaker {
  private current: CircuitState = CircuitState.Closed;
  private consecutiveFailures = 0;
  private openedAt = 0;
  private probeInFlight = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    private readonly onChange: (from: CircuitState, to: CircuitState) => void,
  ) {}

  get state(): CircuitState {
    return this.current;
  }

  tryAcquire(): Permit | null {
    if (
      this.current === CircuitState.Open &&
      performance.now() - this.openedAt >= this.cooldownMs
    ) {
      this.moveTo(CircuitState.HalfOpen);
    }
    if (this.current === CircuitState.Closed) {
      return Permit.Call;
    }
    if (this.current === CircuitState.HalfOpen && !this.probeInFlight) {
      this.probeInFlight = true;
      return Permit.Probe;
    }
    return null;
  }

  record(permit: Permit, health: Health) {
    if (permit === Permit.Probe) {
      this.probeInFlight = false;
    } else if (this.current !== CircuitState.Closed) {
      return;
    }
    if (health === Health.Healthy) {
      this.consecutiveFailures = 0;
      this.moveTo(CircuitState.Closed);
      return;
    }
    if (health === Health.Failing) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.openedAt = performance.now();
        this.moveTo(CircuitState.Open);
      }
    }
  }

  private moveTo(next: CircuitState) {
    const previous = this.current;
    this.current = next;
    if (previous !== next) {
      this.onChange(previous, next);
    }
  }
}

interface StateChange {
  provider: string;
  from: CircuitState;
  to: CircuitState;
}

export type CircuitState = (typeof CircuitState)[keyof typeof CircuitState];

export type Health = (typeof Health)[keyof typeof Health];

export type Permit = (typeof Permit)[keyof typeof Permit];

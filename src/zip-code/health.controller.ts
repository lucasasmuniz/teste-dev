import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CircuitBreakers, CircuitState } from './circuit-breakers.js';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly breakers: CircuitBreakers) {}

  @Get()
  health(): HealthReport {
    const circuits = this.breakers.states();
    return {
      status: statusOf(circuits.map(({ state }) => state)),
      providers: circuits.map(({ provider, state }) => ({
        name: provider,
        circuit: state,
      })),
    };
  }
}

function statusOf(states: CircuitState[]): HealthStatus {
  const closed = states.filter((state) => state === CircuitState.Closed);
  if (closed.length === states.length) {
    return HealthStatus.Ok;
  }
  return closed.length > 0 ? HealthStatus.Degraded : HealthStatus.Unavailable;
}

interface HealthReport {
  status: HealthStatus;
  providers: { name: string; circuit: CircuitState }[];
}

const HealthStatus = {
  Ok: 'ok',
  Degraded: 'degraded',
  Unavailable: 'unavailable',
} as const;

type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

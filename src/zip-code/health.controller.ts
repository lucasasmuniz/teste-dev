import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { schemaRef } from '../openapi.js';
import { CircuitBreakers, CircuitState } from './circuit-breakers.js';

const HealthStatus = {
  Ok: 'ok',
  Degraded: 'degraded',
  Unavailable: 'unavailable',
} as const;

const healthReport = z
  .object({
    status: z.enum(Object.values(HealthStatus)),
    providers: z.array(
      z.object({
        name: z.string(),
        circuit: z.enum(Object.values(CircuitState)),
      }),
    ),
  })
  .meta({ id: 'HealthReport' });

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly breakers: CircuitBreakers) {}

  @Get()
  @ApiOperation({
    summary: 'Circuit state of each provider',
    description:
      'Reports in-memory state and never asks a provider. `degraded` means a circuit is open but another provider is still reachable.',
  })
  @ApiOkResponse({ schema: schemaRef(healthReport) })
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

type HealthReport = z.infer<typeof healthReport>;

type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

import type { INestApplication } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import request from 'supertest';
import { AddressResolver } from '../src/zip-code/address-resolver.js';
import { createApp, getDistinctTimes, type LogLine } from './app.js';
import { failWith, FakeLookup } from './fake-lookups.js';
import {
  anyZipCode,
  BRASILAPI_URL,
  countProviderCalls,
  providerStubs,
  VIACEP_URL,
} from './provider-stubs.js';

function health(app: INestApplication) {
  return request(app.getHttpServer()).get('/health');
}

describe('health', () => {
  let app: INestApplication;
  let calls: Record<string, number>;

  beforeEach(async () => {
    ({ app } = await createApp());
    calls = countProviderCalls();
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports every circuit closed as ok, without asking any provider', async () => {
    const res = await health(app);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      providers: [
        { name: 'viacep', circuit: 'closed' },
        { name: 'brasilapi', circuit: 'closed' },
      ],
    });
    expect(calls).toEqual({ viacep: 0, brasilapi: 0 });
  });

  it('reports degraded mode while a circuit is open but another provider is still reachable', async () => {
    providerStubs.use(
      http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
      anyZipCode.brasilApiAnswers,
    );
    await getDistinctTimes(app, 10);
    const callsBefore = { ...calls };

    const res = await health(app);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'degraded',
      providers: [
        { name: 'viacep', circuit: 'open' },
        { name: 'brasilapi', circuit: 'closed' },
      ],
    });
    expect(calls).toEqual(callsBefore);
  });

  it('reports unavailable, still as 200, when no circuit is closed', async () => {
    providerStubs.use(
      http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
      http.get(BRASILAPI_URL, () => new HttpResponse(null, { status: 500 })),
    );
    await getDistinctTimes(app, 5);

    const res = await health(app);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'unavailable',
      providers: [
        { name: 'viacep', circuit: 'open' },
        { name: 'brasilapi', circuit: 'open' },
      ],
    });
  });
});

describe('health under the inbound rate limit', () => {
  let app: INestApplication;

  afterEach(async () => {
    vi.unstubAllEnvs();
    await app.close();
  });

  it('never throttles monitoring, even after the client ran out of quota', async () => {
    vi.stubEnv('RATE_LIMIT_MAX', '1');
    ({ app } = await createApp());
    await request(app.getHttpServer()).get('/cep/50680000');

    const statuses = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await health(app)).status);
    }

    expect(statuses).toEqual([200, 200, 200]);
  });
});

describe('health, on the clock', () => {
  let app: INestApplication;
  let logs: LogLine[];

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await app.close();
  });

  it('reports half_open once the cooldown is over, without probing or moving the circuit', async () => {
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', '30000');
    const failing = new FakeLookup('failing', failWith('http_error'));
    ({ app, logs } = await createApp({ lookups: [failing] }));
    vi.useFakeTimers({ toFake: ['performance'] });
    for (let i = 0; i < 5; i++) {
      await app.get(AddressResolver).resolve('50680000');
    }

    vi.advanceTimersByTime(29_999);
    expect((await health(app)).body).toEqual({
      status: 'unavailable',
      providers: [{ name: 'failing', circuit: 'open' }],
    });

    vi.advanceTimersByTime(1);
    expect((await health(app)).body).toEqual({
      status: 'unavailable',
      providers: [{ name: 'failing', circuit: 'half_open' }],
    });
    expect(failing.calls).toBe(5);
    expect(logs).not.toContainEqual(
      expect.objectContaining({ msg: 'circuit state change', to: 'half_open' }),
    );
  });
});

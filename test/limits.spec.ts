import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  AddressLookup,
  LookupResult,
} from '../src/zip-code/address-lookup.js';
import {
  AddressResolver,
  type Resolution,
} from '../src/zip-code/address-resolver.js';
import { createApp, type LogLine } from './app.js';
import { countProviderCalls } from './provider-stubs.js';

class ControlledLookup implements AddressLookup {
  calls = 0;
  private pending: ((result: LookupResult) => void)[] = [];

  constructor(readonly provider: string) {}

  lookup(): Promise<LookupResult> {
    this.calls++;
    return new Promise((resolve) => {
      this.pending.push(resolve);
    });
  }

  answerAll() {
    for (const answer of this.pending.splice(0)) {
      answer(found('50680000'));
    }
  }
}

class HealthyLookup implements AddressLookup {
  readonly provider = 'healthy';

  async lookup(zipCode: string): Promise<LookupResult> {
    return found(zipCode);
  }
}

describe('inbound rate limit', () => {
  let app: INestApplication;
  let logs: LogLine[];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await app.close();
  });

  it('answers 429 as problem+json once a client exceeds its limit, without asking any provider', async () => {
    vi.stubEnv('RATE_LIMIT_MAX', '2');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    ({ app, logs } = await createApp());
    const calls = countProviderCalls();
    const get = () => request(app.getHttpServer()).get('/cep/00000001');

    await get();
    await get();
    const callsBefore = { ...calls };
    const res = await get();

    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.body).toEqual({
      type: '/problems/rate-limited',
      title: 'Too many requests',
      status: 429,
      detail: expect.any(String),
      instance: '/cep/00000001',
    });
    expect(calls).toEqual(callsBefore);
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 30,
        msg: 'request rejected',
        problemType: '/problems/rate-limited',
        requestId: res.headers['request-id'],
      }),
    );
  });
});

describe('provider concurrency cap', () => {
  let app: INestApplication;
  let logs: LogLine[];

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await app.close();
  });

  function resolve() {
    return app.get(AddressResolver).resolve('50680000');
  }

  it('falls back without waiting when the cap is full, and never counts it against the circuit', async () => {
    vi.stubEnv('PROVIDER_MAX_CONCURRENCY', '1');
    vi.stubEnv('CIRCUIT_FAILURE_THRESHOLD', '2');
    const busy = new ControlledLookup('busy');
    ({ app, logs } = await createApp({
      lookups: [busy, new HealthyLookup()],
    }));
    const holding = resolve();

    const whileFull: Resolution[] = [];
    for (let i = 0; i < 6; i++) {
      whileFull.push(await resolve());
    }

    expect(busy.calls).toBe(1);
    expect(whileFull).toEqual(
      Array.from({ length: 6 }, () =>
        expect.objectContaining({ provider: 'healthy' }),
      ),
    );
    expect(whileFull).toContainEqual(
      expect.objectContaining({
        attempts: [{ provider: 'busy', reason: 'capped' }],
      }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 40,
        msg: 'provider skipped, concurrency cap reached',
        provider: 'busy',
        result: 'capped',
        circuit: 'closed',
      }),
    );

    busy.answerAll();
    await holding;
    const afterRelease = [resolve(), resolve()];
    busy.answerAll();
    await Promise.all(afterRelease);

    expect(busy.calls).toBe(2);
    expect(logs).not.toContainEqual(
      expect.objectContaining({ msg: 'circuit state change' }),
    );
  });

  it('frees the slot when the attempt times out, even if the adapter never settles', async () => {
    vi.stubEnv('PROVIDER_MAX_CONCURRENCY', '1');
    vi.stubEnv('PROVIDER_TIMEOUT_MS', '3000');
    const hanging = new ControlledLookup('hanging');
    ({ app, logs } = await createApp({
      lookups: [hanging, new HealthyLookup()],
    }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });

    const timingOut = resolve();
    await vi.advanceTimersByTimeAsync(3000);
    await timingOut;
    await resolve(); // round-robin turns back to 'hanging'
    const afterTimeout = resolve();
    await vi.advanceTimersByTimeAsync(3000);
    await afterTimeout;

    expect(hanging.calls).toBe(2);
  });
});

function found(zipCode: string): LookupResult {
  return {
    ok: true,
    address: {
      zipCode,
      street: null,
      complement: null,
      neighborhood: null,
      city: 'Recife',
      state: 'PE',
    },
  };
}

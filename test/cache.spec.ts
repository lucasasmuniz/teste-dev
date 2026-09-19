import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { INestApplication } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { http, HttpResponse } from 'msw';
import request from 'supertest';
import { createApp, type LogLine } from './app.js';
import {
  anyZipCode,
  BRASILAPI_URL,
  countProviderCalls,
  providerStubs,
  VIACEP_URL,
} from './provider-stubs.js';

describe('GET /cep/:cep through the cache', () => {
  let app: INestApplication;
  let logs: LogLine[];
  let calls: Record<string, number>;

  beforeEach(async () => {
    ({ app, logs } = await createApp());
    calls = countProviderCalls();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await app.close();
  });

  function get(zipCode: string) {
    return request(app.getHttpServer()).get(`/cep/${zipCode}`);
  }

  it('answers a repeated zip code from the fresh cache without calling any provider', async () => {
    const first = await get('50680000');

    const second = await get('50680000');

    expect(calls).toEqual({ viacep: 1, brasilapi: 0 });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.headers['address-provider']).toBe('viacep');
    expect(second.headers['server-timing']).toMatch(
      /^cache;desc="fresh";dur=\d+$/,
    );
    expect(second.headers.warning).toBeUndefined();
    expect(summariesOf(second.headers['request-id'])).toEqual([
      expect.objectContaining({
        level: 30,
        result: 'ok',
        source: 'fresh_cache',
        providers: [],
      }),
    ]);
  });

  it('shares one cache entry between a zip code written with and without separators', async () => {
    await get('50680000');

    const res = await get('50680-000');

    expect(res.status).toBe(200);
    expect(calls).toEqual({ viacep: 1, brasilapi: 0 });
  });

  it('answers a repeated confirmed absence from the cache, repeating the attempts it concluded from', async () => {
    const first = await get('00000001');

    const second = await get('00000001');

    expect(calls).toEqual({ viacep: 1, brasilapi: 1 });
    expect(second.status).toBe(404);
    expect(second.body).toEqual(first.body);
    expect(summariesOf(second.headers['request-id'])).toEqual([
      expect.objectContaining({
        level: 30,
        result: 'confirmed_absence',
        source: 'fresh_cache',
        providers: [],
      }),
    ]);
  });

  it('does not cache a partial absence, asking the providers again next time', async () => {
    providerStubs.use(
      http.get(BRASILAPI_URL, () => new HttpResponse(null, { status: 500 })),
    );
    await get('00000001');

    const res = await get('00000001');

    expect(res.status).toBe(404);
    expect(res.body.type).toBe('/problems/partial-absence');
    expect(calls).toEqual({ viacep: 2, brasilapi: 2 });
  });

  describe('with a confirmed absence cached', () => {
    const storedAt = new Date('2026-09-17T10:00:00.000Z');

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(storedAt);
      await get('00000001');
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('asks the providers again once its own TTL is over', async () => {
      vi.setSystemTime(storedAt.getTime() + hours(1) + minutes(1));

      await get('00000001');

      expect(calls).toEqual({ viacep: 2, brasilapi: 2 });
    });

    it('never serves it past its TTL, answering 503 when every provider fails', async () => {
      vi.setSystemTime(storedAt.getTime() + hours(1) + minutes(1));
      providerStubs.use(
        http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
        http.get(BRASILAPI_URL, () => new HttpResponse(null, { status: 500 })),
      );

      const res = await get('00000001');

      expect(res.status).toBe(503);
    });
  });

  describe('once the address is past its freshness', () => {
    const storedAt = new Date('2026-09-17T10:00:00.000Z');

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(storedAt);
      await get('50680000');
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('serves it as an expired address, marked in body and header, when every provider fails', async () => {
      vi.setSystemTime(storedAt.getTime() + hours(25));
      providerStubs.use(
        http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
        http.get(BRASILAPI_URL, () => new HttpResponse(null, { status: 500 })),
      );

      const res = await get('50680000');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        zipCode: '50680000',
        street: 'Rua São Mateus',
        complement: 'de 420/421 ao fim',
        neighborhood: 'Iputinga',
        city: 'Recife',
        state: 'PE',
        freshness: { status: 'expired', storedAt: '2026-09-17T10:00:00.000Z' },
      });
      expect(res.headers.warning).toBe('110 - "Response is Stale"');
      expect(res.headers['address-provider']).toBe('viacep');
      expect(res.headers['server-timing']).toMatch(
        /^cache;desc="expired";dur=\d+$/,
      );
      expect(summariesOf(res.headers['request-id'])).toEqual([
        expect.objectContaining({
          level: 40,
          result: 'ok',
          source: 'expired_cache',
          providers: ['brasilapi', 'viacep'],
        }),
      ]);
    });

    it('asks the providers again, without marking, while they can answer', async () => {
      vi.setSystemTime(storedAt.getTime() + hours(25));

      const res = await get('50680000');

      expect(res.status).toBe(200);
      expect(res.body.freshness).toBeUndefined();
      expect(res.headers.warning).toBeUndefined();
      expect(res.headers['address-provider']).toBe('brasilapi');
      expect(calls).toEqual({ viacep: 1, brasilapi: 1 });
    });

    it('stops serving it once the expiry window is over, answering 503', async () => {
      vi.setSystemTime(storedAt.getTime() + days(7) + minutes(1));
      providerStubs.use(
        http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
        http.get(BRASILAPI_URL, () => new HttpResponse(null, { status: 500 })),
      );

      const res = await get('50680000');

      expect(res.status).toBe(503);
      expect(res.body.type).toBe('/problems/providers-exhausted');
    });

    it('answers 404 rather than the expired address when a provider denies it and the other fails', async () => {
      vi.setSystemTime(storedAt.getTime() + hours(25));
      providerStubs.use(
        http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
        anyZipCode.brasilApiDenies,
      );

      const res = await get('50680000');

      expect(res.status).toBe(404);
      expect(res.body.type).toBe('/problems/partial-absence');
    });

    it('replaces it with a confirmed absence when every provider now denies the zip code', async () => {
      vi.setSystemTime(storedAt.getTime() + hours(25));
      providerStubs.use(anyZipCode.viaCepDenies, anyZipCode.brasilApiDenies);
      await get('50680000');
      providerStubs.use(
        http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
        http.get(BRASILAPI_URL, () => new HttpResponse(null, { status: 500 })),
      );

      const res = await get('50680000');

      expect(res.status).toBe(404);
      expect(res.body.type).toBe('/problems/confirmed-absence');
      expect(calls).toEqual({ viacep: 2, brasilapi: 1 });
    });
  });

  it('evicts the least recently used entry once the cache is full', async () => {
    await app.close();
    vi.stubEnv('CACHE_MAX_ENTRIES', '2');
    ({ app, logs } = await createApp());

    await get('50680000');
    await get('99990000');
    await get('50680000');
    await get('00000001');
    const recentlyUsed = await get('50680000');
    const leastRecentlyUsed = await get('99990000');

    expect(summariesOf(recentlyUsed.headers['request-id'])).toEqual([
      expect.objectContaining({ source: 'fresh_cache' }),
    ]);
    expect(summariesOf(leastRecentlyUsed.headers['request-id'])).toEqual([
      expect.objectContaining({ source: 'provider' }),
    ]);
  });

  describe('when the cache store fails', () => {
    beforeEach(() => {
      const store = app.get<Cache>(CACHE_MANAGER);
      vi.spyOn(store, 'get').mockRejectedValue(new Error('store down'));
      vi.spyOn(store, 'set').mockRejectedValue(new Error('store down'));
    });

    it('answers from the providers, logging that the cache is unavailable', async () => {
      const res = await get('50680000');

      expect(res.status).toBe(200);
      expect(res.headers['address-provider']).toBe('viacep');
      const requestLines = logs.filter(
        (l) => l.requestId === res.headers['request-id'],
      );
      expect(requestLines).toContainEqual(
        expect.objectContaining({
          level: 40,
          msg: 'cache unavailable',
          operation: 'read',
          zipCode: '50680000',
        }),
      );
      expect(requestLines).toContainEqual(
        expect.objectContaining({
          level: 40,
          msg: 'cache unavailable',
          operation: 'write',
          zipCode: '50680000',
        }),
      );
    });

    it('still concludes a confirmed absence', async () => {
      const res = await get('00000001');

      expect(res.status).toBe(404);
      expect(res.body.type).toBe('/problems/confirmed-absence');
    });
  });

  function summariesOf(requestId: string) {
    return logs.filter(
      (l) => l.requestId === requestId && l.msg === 'lookup summary',
    );
  }
});

function minutes(count: number): number {
  return count * 60 * 1000;
}

function hours(count: number): number {
  return minutes(count * 60);
}

function days(count: number): number {
  return hours(count * 24);
}

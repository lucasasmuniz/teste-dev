import type { INestApplication } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import request from 'supertest';
import { createApp, type LogLine } from './app.js';
import { BRASILAPI_URL, providerStubs, VIACEP_URL } from './provider-stubs.js';

describe('GET /cep/:cep', () => {
  let app: INestApplication;
  let logs: LogLine[];

  beforeEach(async () => {
    ({ app, logs } = await createApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('responds 200 with the address translated from the provider', async () => {
    const res = await request(app.getHttpServer()).get('/cep/50680000');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      zipCode: '50680000',
      street: 'Rua São Mateus',
      complement: 'de 420/421 ao fim',
      neighborhood: 'Iputinga',
      city: 'Recife',
      state: 'PE',
    });
  });

  it('answers a single-zip-code city without street or neighborhood, as a successful attempt', async () => {
    const res = await request(app.getHttpServer()).get('/cep/99990000');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      zipCode: '99990000',
      street: null,
      complement: null,
      neighborhood: null,
      city: 'Muliterno',
      state: 'RS',
    });
    expect(attemptsOf(res.headers['request-id'])).toEqual([
      expect.objectContaining({ level: 30, provider: 'viacep', result: 'ok' }),
    ]);
  });

  it('falls back invisibly when a provider answers outside its contract', async () => {
    providerStubs.use(
      http.get(VIACEP_URL, () =>
        HttpResponse.json({ cep: '50680-000', localidade: 42 }),
      ),
    );

    const res = await request(app.getHttpServer()).get('/cep/50680000');

    expect(res.status).toBe(200);
    expect(res.headers['address-provider']).toBe('brasilapi');
    expect(res.body.city).toBe('Recife');
    expect(attemptsOf(res.headers['request-id'])).toEqual([
      expect.objectContaining({
        level: 40,
        provider: 'viacep',
        result: 'schema_invalid',
      }),
      expect.objectContaining({
        level: 30,
        provider: 'brasilapi',
        result: 'ok',
      }),
    ]);
  });

  it('treats a 200 whose body is not JSON as outside the provider contract', async () => {
    providerStubs.use(
      http.get(VIACEP_URL, () => HttpResponse.html('<html>maintenance</html>')),
    );

    const res = await request(app.getHttpServer()).get('/cep/50680000');

    expect(res.status).toBe(200);
    expect(attemptsOf(res.headers['request-id'])).toEqual([
      expect.objectContaining({ provider: 'viacep', result: 'schema_invalid' }),
      expect.objectContaining({ provider: 'brasilapi', result: 'ok' }),
    ]);
  });

  it('falls back to the next provider when the first one fails, invisibly to the client', async () => {
    providerStubs.use(
      http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
    );

    const res = await request(app.getHttpServer()).get('/cep/50680000');

    expect(res.status).toBe(200);
    expect(res.headers['address-provider']).toBe('brasilapi');
    expect(res.body).toEqual({
      zipCode: '50680000',
      street: 'Rua São Mateus',
      complement: null,
      neighborhood: 'Iputinga',
      city: 'Recife',
      state: 'PE',
    });
  });

  it('alternates providers across requests, with the same output contract from both', async () => {
    const first = await request(app.getHttpServer()).get('/cep/99990000');
    const second = await request(app.getHttpServer()).get('/cep/99990000');

    expect(first.headers['address-provider']).toBe('viacep');
    expect(second.headers['address-provider']).toBe('brasilapi');
    expect(second.body).toEqual(first.body);
  });

  it('gives a complete address the same shape whichever provider answered', async () => {
    const fromViaCep = await request(app.getHttpServer()).get('/cep/50680000');
    const fromBrasilApi = await request(app.getHttpServer()).get(
      '/cep/50680000',
    );

    expect(fromBrasilApi.headers['address-provider']).toBe('brasilapi');
    expect(Object.keys(fromBrasilApi.body)).toEqual(
      Object.keys(fromViaCep.body),
    );
    expect(fromBrasilApi.body.complement).toBeNull();
  });

  it('exposes provider and attempt duration in Server-Timing', async () => {
    const res = await request(app.getHttpServer()).get('/cep/50680000');

    expect(res.headers['server-timing']).toMatch(
      /^provider;desc="viacep";dur=\d+$/,
    );
  });

  it('logs one summary per request with the providers tried in order', async () => {
    providerStubs.use(
      http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
    );

    const res = await request(app.getHttpServer()).get('/cep/50680000');

    expect(summariesOf(res.headers['request-id'])).toEqual([
      expect.objectContaining({
        level: 40,
        zipCode: '50680000',
        result: 'ok',
        providers: ['viacep', 'brasilapi'],
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it('logs the summary as info when the first provider answers', async () => {
    const res = await request(app.getHttpServer()).get('/cep/50680000');

    expect(summariesOf(res.headers['request-id'])).toEqual([
      expect.objectContaining({
        level: 30,
        result: 'ok',
        providers: ['viacep'],
      }),
    ]);
  });

  it('responds 503 detailing each provider when all of them fail', async () => {
    providerStubs.use(
      http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
      http.get(BRASILAPI_URL, () => HttpResponse.json({ cep: 50680000 })),
    );

    const res = await request(app.getHttpServer()).get('/cep/50680000');

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.headers['address-provider']).toBeUndefined();
    expect(res.body).toEqual({
      type: '/problems/providers-exhausted',
      title: 'No provider could answer',
      status: 503,
      detail: 'No provider returned a usable answer for this zip code.',
      attempts: [
        { provider: 'viacep', reason: 'http_error' },
        { provider: 'brasilapi', reason: 'schema_invalid' },
      ],
      instance: '/cep/50680000',
    });
    expect(summariesOf(res.headers['request-id'])).toEqual([
      expect.objectContaining({
        level: 40,
        result: 'providers_exhausted',
        providers: ['viacep', 'brasilapi'],
      }),
    ]);
  });

  it('treats a BrasilAPI 404 as an http_error for now', async () => {
    providerStubs.use(
      http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
    );

    const res = await request(app.getHttpServer()).get('/cep/00000001');

    expect(res.status).toBe(503);
    expect(res.body.attempts).toEqual([
      { provider: 'viacep', reason: 'http_error' },
      { provider: 'brasilapi', reason: 'http_error' },
    ]);
  });

  it.each(['50680-000', '50.680-000', '50680 000'])(
    'accepts separators in "%s" and responds with the normalized zip code',
    async (zipCode) => {
      const res = await request(app.getHttpServer()).get(
        `/cep/${encodeURIComponent(zipCode)}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.zipCode).toBe('50680000');
    },
  );

  it.each([
    '123',
    '013109301',
    'abcdefgh',
    'a1b2c3d4e5f6g7h8x',
    '01310_930',
    '01310-930-',
    '0-1-3-1-0-9-3-0',
    '01310--930',
    '0131-0930',
    '01310930 ',
    '01310\t930',
    '01310\n930',
    '01310\u00a0930',
    '\ufeff01310930',
    '01310\u3000930',
  ])(
    'rejects malformed zip code %j with 400 in problem+json',
    async (zipCode) => {
      const path = `/cep/${encodeURIComponent(zipCode)}`;
      const res = await request(app.getHttpServer()).get(path);

      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(
        /^application\/problem\+json/,
      );
      expect(res.body).toEqual({
        type: '/problems/malformed-zip-code',
        title: 'Malformed zip code',
        status: 400,
        detail:
          'The zip code must have 8 digits, optionally written as 01310-930, 01.310-930 or 01310 930.',
        instance: path,
      });
    },
  );

  it('logs the rejected zip code with the problem type, without treating it as an error', async () => {
    const res = await request(app.getHttpServer()).get('/cep/123');
    const requestId = res.headers['request-id'];

    const requestLines = logs.filter((l) => l.requestId === requestId);
    expect(requestLines).toContainEqual(
      expect.objectContaining({
        level: 30,
        msg: 'request rejected',
        problemType: '/problems/malformed-zip-code',
        status: 400,
        params: { cep: '123' },
      }),
    );
    expect(requestLines.some((l) => l.level >= 50)).toBe(false);
  });

  function attemptsOf(requestId: string) {
    return logs.filter(
      (l) => l.requestId === requestId && l.msg === 'provider attempt',
    );
  }

  function summariesOf(requestId: string) {
    return logs.filter(
      (l) => l.requestId === requestId && l.msg === 'lookup summary',
    );
  }
});

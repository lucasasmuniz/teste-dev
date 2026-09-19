import type { INestApplication } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import newrelic from 'newrelic';
import request from 'supertest';
import type {
  AddressLookup,
  FailureReason,
  LookupResult,
} from '../src/zip-code/address-lookup.js';
import { AddressResolver } from '../src/zip-code/address-resolver.js';
import { createApp, type LogLine } from './app.js';
import viaCep50680000 from './fixtures/viacep/50680000.json' with { type: 'json' };
import {
  anyZipCode,
  countProviderCalls,
  providerStubs,
  VIACEP_URL,
} from './provider-stubs.js';

class FakeLookup implements AddressLookup {
  calls = 0;

  constructor(
    readonly provider: string,
    public respond: (signal: AbortSignal) => Promise<LookupResult>,
  ) {}

  lookup(_zipCode: string, signal: AbortSignal): Promise<LookupResult> {
    this.calls++;
    return this.respond(signal);
  }
}

describe('circuit breaker', () => {
  let app: INestApplication;
  let logs: LogLine[];
  let calls: Record<string, number>;
  let nextZipCode = 10_000_000;

  beforeEach(async () => {
    ({ app, logs } = await createApp());
    calls = countProviderCalls();
  });

  afterEach(async () => {
    await app.close();
  });

  function get(zipCode: string) {
    return request(app.getHttpServer()).get(`/cep/${zipCode}`);
  }

  // A cached answer never reaches the provider, so a sweep of distinct zip
  // codes is what keeps the circuit under load.
  async function getDistinctTimes(times: number) {
    for (let i = 0; i < times; i++) {
      await getDistinct();
    }
  }

  function getDistinct() {
    return get(String(nextZipCode++));
  }

  it('never opens on repeated absence: it measures provider health, not whether data exists', async () => {
    providerStubs.use(anyZipCode.viaCepDenies, anyZipCode.brasilApiDenies);
    await getDistinctTimes(10);

    const res = await getDistinct();

    expect(calls).toEqual({ viacep: 11, brasilapi: 11 });
    expect(res.status).toBe(404);
    expect(res.body.type).toBe('/problems/confirmed-absence');
  });

  it('opens after five consecutive failures and stops calling the provider', async () => {
    providerStubs.use(
      http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
      anyZipCode.brasilApiAnswers,
    );
    await getDistinctTimes(10);

    const res = await getDistinct();

    expect(res.status).toBe(200);
    expect(calls.viacep).toBe(5);
    const requestLines = logs.filter(
      (line) => line.requestId === res.headers['request-id'],
    );
    expect(requestLines).toContainEqual(
      expect.objectContaining({
        msg: 'provider skipped by circuit breaker',
        level: 40,
        provider: 'viacep',
        result: 'circuit_open',
        circuit: 'open',
      }),
    );
    expect(requestLines).toContainEqual(
      expect.objectContaining({
        msg: 'provider attempt',
        provider: 'brasilapi',
        attempt: 1,
        circuit: 'closed',
      }),
    );
  });

  it('reads absence as partial when the other provider was skipped by its open circuit', async () => {
    providerStubs.use(
      http.get(VIACEP_URL, () => new HttpResponse(null, { status: 500 })),
      anyZipCode.brasilApiDenies,
    );
    await getDistinctTimes(5);

    const res = await getDistinct();

    expect(calls.viacep).toBe(5);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      type: '/problems/partial-absence',
      attempts: [
        { provider: 'brasilapi', reason: 'not_found' },
        { provider: 'viacep', reason: 'circuit_open' },
      ],
    });
  });

  it.each([
    ['ok', () => HttpResponse.json(viaCep50680000)],
    ['not_found', () => HttpResponse.json({ erro: 'true' })],
  ])(
    'counts only consecutive failures: an answer (%s) in between starts the count over',
    async (_answer, answer) => {
      const failure = () => new HttpResponse(null, { status: 500 });
      const script = [
        ...Array.from({ length: 4 }, () => failure),
        answer,
        ...Array.from({ length: 4 }, () => failure),
      ];
      providerStubs.use(
        http.get(VIACEP_URL, () => (script.shift() ?? failure)()),
        anyZipCode.brasilApiDenies,
      );

      await getDistinctTimes(10);

      expect(calls.viacep).toBe(10);
    },
  );
});

describe('circuit breaker, on the clock', () => {
  let app: INestApplication;
  let logs: LogLine[];

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await app.close();
  });

  async function start(lookups: AddressLookup[]) {
    ({ app, logs } = await createApp({ lookups }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  }

  function resolve(zipCode = '50680000') {
    return app.get(AddressResolver).resolve(zipCode);
  }

  async function resolveTimes(times: number) {
    for (let i = 0; i < times; i++) {
      await resolve();
    }
  }

  it('lets exactly one probe through after the cooldown, and closes when it answers', async () => {
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', '30000');
    const recovering = new FakeLookup('recovering', failWith('http_error'));
    await start([recovering]);
    await resolveTimes(5);

    await vi.advanceTimersByTimeAsync(29_999);
    await resolve();
    expect(recovering.calls).toBe(5);

    await vi.advanceTimersByTimeAsync(1);
    let answerProbe!: (result: LookupResult) => void;
    recovering.respond = () =>
      new Promise((resolve) => (answerProbe = resolve));
    const probing = resolve();
    const whileProbing = await resolve();
    expect(recovering.calls).toBe(6);
    expect(whileProbing).toMatchObject({
      attempts: [{ provider: 'recovering', reason: 'circuit_open' }],
    });

    answerProbe(await succeed());
    await expect(probing).resolves.toMatchObject({ provider: 'recovering' });
    recovering.respond = succeed;
    await resolveTimes(2);
    expect(recovering.calls).toBe(8);
  });

  it('reopens for a whole new cooldown when the probe fails', async () => {
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', '30000');
    const failing = new FakeLookup('failing', failWith('timeout'));
    await start([failing]);
    await resolveTimes(5);
    await vi.advanceTimersByTimeAsync(30_000);

    await resolve();
    await vi.advanceTimersByTimeAsync(29_999);
    await resolve();
    expect(failing.calls).toBe(6);

    await vi.advanceTimersByTimeAsync(1);
    await resolve();
    expect(failing.calls).toBe(7);
  });

  it('closes when the probe finds the zip code does not exist', async () => {
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', '30000');
    const denying = new FakeLookup('denying', failWith('http_error'));
    await start([denying]);
    await resolveTimes(5);
    await vi.advanceTimersByTimeAsync(30_000);

    denying.respond = failWith('not_found');
    await resolveTimes(3);

    expect(denying.calls).toBe(8);
  });

  it('ignores an answer that arrives after the circuit opened, waiting for the probe', async () => {
    const provider = new FakeLookup('provider', failWith('http_error'));
    await start([provider]);
    const late = answerLater(provider);
    const lateRequest = resolve();
    provider.respond = failWith('http_error');
    await resolveTimes(5);

    late.answer(await succeed());
    await lateRequest;
    await resolve();

    expect(provider.calls).toBe(6);
  });

  it('keeps a single probe even when an older attempt answers during it', async () => {
    vi.stubEnv('PROVIDER_TIMEOUT_MS', '3000');
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', '1000');
    const provider = new FakeLookup('provider', failWith('http_error'));
    await start([provider]);
    const late = answerLater(provider);
    const lateRequest = resolve();
    provider.respond = failWith('http_error');
    await resolveTimes(5);
    await vi.advanceTimersByTimeAsync(1000);
    answerLater(provider);
    void resolve();

    late.answer(await succeed());
    await lateRequest;
    await resolve();

    expect(provider.calls).toBe(7);
  });

  it('frees the probe even if the adapter breaks its promise not to throw', async () => {
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', '30000');
    const broken = new FakeLookup('broken', failWith('http_error'));
    await start([broken]);
    await resolveTimes(5);
    await vi.advanceTimersByTimeAsync(30_000);

    broken.respond = () => Promise.reject(new Error('adapter bug'));
    await expect(resolve()).rejects.toThrow('adapter bug');
    broken.respond = succeed;
    await resolve();

    expect(broken.calls).toBe(7);
  });

  it('reports an open circuit as such even when the request budget is also spent', async () => {
    vi.stubEnv('CIRCUIT_FAILURE_THRESHOLD', '1');
    vi.stubEnv('PROVIDER_TIMEOUT_MS', '8000');
    vi.stubEnv('REQUEST_BUDGET_MS', '7000');
    const failing = new FakeLookup('failing', failWith('http_error'));
    const hanging = new FakeLookup('hanging', hang);
    await start([failing, hanging]);
    const first = resolve();
    await vi.advanceTimersByTimeAsync(7000);
    await first;

    const second = resolve();
    await vi.advanceTimersByTimeAsync(7000);

    expect(await second).toMatchObject({
      attempts: [
        { provider: 'hanging', reason: 'timeout' },
        { provider: 'failing', reason: 'circuit_open' },
      ],
    });
  });

  it('gives the probe back when the request budget is spent before it goes out', async () => {
    vi.stubEnv('CIRCUIT_FAILURE_THRESHOLD', '1');
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', '1000');
    vi.stubEnv('PROVIDER_TIMEOUT_MS', '8000');
    vi.stubEnv('REQUEST_BUDGET_MS', '7000');
    const failing = new FakeLookup('failing', failWith('http_error'));
    const hanging = new FakeLookup('hanging', hang);
    await start([failing, hanging]);
    const first = resolve();
    await vi.advanceTimersByTimeAsync(7000);
    await first;

    const second = resolve();
    await vi.advanceTimersByTimeAsync(7000);
    await second;
    failing.respond = succeed;
    await resolve();

    expect(failing.calls).toBe(2);
  });

  it('counts a timeout when the provider had its whole timeout', async () => {
    vi.stubEnv('PROVIDER_TIMEOUT_MS', '3000');
    vi.stubEnv('REQUEST_BUDGET_MS', '7000');
    const hanging = new FakeLookup('hanging', hang);
    await start([hanging]);

    for (let i = 0; i < 6; i++) {
      const outcome = resolve();
      await vi.advanceTimersByTimeAsync(3000);
      await outcome;
    }

    expect(hanging.calls).toBe(5);
  });

  it('does not count a timeout the request budget cut short, since the wait was ours', async () => {
    vi.stubEnv('PROVIDER_TIMEOUT_MS', '3000');
    vi.stubEnv('REQUEST_BUDGET_MS', '2000');
    const hanging = new FakeLookup('hanging', hang);
    await start([hanging]);

    for (let i = 0; i < 6; i++) {
      const outcome = resolve();
      await vi.advanceTimersByTimeAsync(2000);
      await outcome;
    }

    expect(hanging.calls).toBe(6);
  });

  it('logs the circuit state each attempt was made in, and each provider it skipped', async () => {
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', '30000');
    const failing = new FakeLookup('failing', failWith('http_error'));
    await start([failing]);
    await resolveTimes(6);
    await vi.advanceTimersByTimeAsync(30_000);
    await resolve();

    const lines = logs.filter((line) => line.provider === 'failing');
    expect(
      lines.map(({ msg, result, circuit }) => ({ msg, result, circuit })),
    ).toEqual([
      ...Array.from({ length: 5 }, () => ({
        msg: 'provider attempt',
        result: 'http_error',
        circuit: 'closed',
      })),
      { msg: 'circuit state change', result: undefined, circuit: undefined },
      {
        msg: 'provider skipped by circuit breaker',
        result: 'circuit_open',
        circuit: 'open',
      },
      { msg: 'circuit state change', result: undefined, circuit: undefined },
      { msg: 'provider attempt', result: 'http_error', circuit: 'half_open' },
      { msg: 'circuit state change', result: undefined, circuit: undefined },
    ]);
  });

  it('logs every state change and reports it to New Relic', async () => {
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', '30000');
    const recordCustomEvent = vi.spyOn(newrelic, 'recordCustomEvent');
    const recovering = new FakeLookup('recovering', failWith('http_error'));
    await start([recovering]);
    await resolveTimes(5);
    await vi.advanceTimersByTimeAsync(30_000);
    recovering.respond = succeed;
    await resolve();

    const changes = [
      { provider: 'recovering', from: 'closed', to: 'open' },
      { provider: 'recovering', from: 'open', to: 'half_open' },
      { provider: 'recovering', from: 'half_open', to: 'closed' },
    ];
    expect(logs.filter((line) => line.msg === 'circuit state change')).toEqual([
      expect.objectContaining({ level: 40, ...changes[0] }),
      expect.objectContaining({ level: 30, ...changes[1] }),
      expect.objectContaining({ level: 30, ...changes[2] }),
    ]);
    expect(recordCustomEvent.mock.calls).toEqual(
      changes.map((change) => ['CircuitStateChange', change]),
    );
  });
});

async function succeed(): Promise<LookupResult> {
  return {
    ok: true,
    address: {
      zipCode: '50680000',
      street: null,
      complement: null,
      neighborhood: null,
      city: 'Recife',
      state: 'PE',
    },
  };
}

function failWith(reason: FailureReason) {
  return async (): Promise<LookupResult> => ({ ok: false, reason });
}

function answerLater(lookup: FakeLookup) {
  const pending = { answer: (_result: LookupResult) => {} };
  lookup.respond = () =>
    new Promise((resolve) => {
      pending.answer = resolve;
    });
  return pending;
}

function hang(): Promise<LookupResult> {
  return new Promise(() => {});
}

import type { INestApplication } from '@nestjs/common';
import type {
  AddressLookup,
  LookupResult,
} from '../src/zip-code/address-lookup.js';
import { AddressResolver } from '../src/zip-code/address-resolver.js';
import { ProvidersExhausted } from '../src/zip-code/problems.js';
import { createApp } from './app.js';

class HangingLookup implements AddressLookup {
  startedAt?: number;
  abortedAt?: number;

  constructor(readonly provider: string) {}

  lookup(_zipCode: string, signal: AbortSignal): Promise<LookupResult> {
    this.startedAt = performance.now();
    signal.addEventListener('abort', () => {
      this.abortedAt = performance.now();
    });
    return new Promise(() => {});
  }
}

class HealthyLookup implements AddressLookup {
  readonly provider = 'healthy';

  async lookup(zipCode: string): Promise<LookupResult> {
    return {
      ok: true,
      address: {
        zipCode,
        street: null,
        complement: null,
        neighborhood: null,
        city: 'Muliterno',
        state: 'RS',
      },
    };
  }
}

describe('request time budget', () => {
  let app: INestApplication;

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await app.close();
  });

  it('cuts a provider that ignores the abort signal when its attempt times out', async () => {
    vi.stubEnv('PROVIDER_TIMEOUT_MS', '3000');
    const hanging = new HangingLookup('hanging');
    ({ app } = await createApp({ lookups: [hanging, new HealthyLookup()] }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });

    const resolution = app.get(AddressResolver).resolve('99990000');
    await vi.advanceTimersByTimeAsync(3000);

    await expect(resolution).resolves.toMatchObject({ provider: 'healthy' });
    expect(hanging.abortedAt).toBe(3000);
  });

  it('gives the next provider only what is left of the budget, not a fresh timeout', async () => {
    vi.stubEnv('PROVIDER_TIMEOUT_MS', '6500');
    vi.stubEnv('REQUEST_BUDGET_MS', '7000');
    const first = new HangingLookup('first');
    const second = new HangingLookup('second');
    ({ app } = await createApp({ lookups: [first, second] }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });

    const outcome = app
      .get(AddressResolver)
      .resolve('50680000')
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(7000);

    expect(first.abortedAt! - first.startedAt!).toBe(6500);
    expect(second.abortedAt! - second.startedAt!).toBe(500);
    expect(await outcome).toBeInstanceOf(ProvidersExhausted);
    expect(await outcome).toMatchObject({
      extensions: {
        attempts: [
          { provider: 'first', reason: 'timeout' },
          { provider: 'second', reason: 'timeout' },
        ],
      },
    });
  });

  it('records a provider as timed out, without calling it, when the budget is already spent', async () => {
    vi.stubEnv('PROVIDER_TIMEOUT_MS', '7000');
    vi.stubEnv('REQUEST_BUDGET_MS', '7000');
    const first = new HangingLookup('first');
    const second = new HangingLookup('second');
    ({ app } = await createApp({ lookups: [first, second] }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });

    const outcome = app
      .get(AddressResolver)
      .resolve('50680000')
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(7000);

    expect(second.startedAt).toBeUndefined();
    expect(await outcome).toMatchObject({
      extensions: {
        attempts: [
          { provider: 'first', reason: 'timeout' },
          { provider: 'second', reason: 'timeout' },
        ],
      },
    });
  });
});

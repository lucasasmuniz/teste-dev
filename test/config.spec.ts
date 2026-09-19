import request from 'supertest';
import { createApp } from './app.js';

describe('configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('boots with no environment variable defined', async () => {
    vi.stubEnv('PORT', undefined);
    vi.stubEnv('LOG_LEVEL', undefined);
    vi.stubEnv('PROVIDER_TIMEOUT_MS', undefined);
    vi.stubEnv('REQUEST_BUDGET_MS', undefined);
    vi.stubEnv('CIRCUIT_FAILURE_THRESHOLD', undefined);
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', undefined);
    vi.stubEnv('CACHE_FRESH_MS', undefined);
    vi.stubEnv('CACHE_EXPIRED_WINDOW_MS', undefined);
    vi.stubEnv('CACHE_ABSENCE_TTL_MS', undefined);
    vi.stubEnv('CACHE_MAX_ENTRIES', undefined);
    vi.stubEnv('RATE_LIMIT_MAX', undefined);
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', undefined);
    vi.stubEnv('PROVIDER_MAX_CONCURRENCY', undefined);

    const { app } = await createApp();
    const res = await request(app.getHttpServer()).get('/cep/50680000');
    await app.close();

    expect(res.status).toBe(200);
  });

  it('refuses to boot with invalid variables, naming each one', async () => {
    vi.stubEnv('PORT', 'test');
    vi.stubEnv('LOG_LEVEL', 'test');
    vi.stubEnv('PROVIDER_TIMEOUT_MS', 'test');
    vi.stubEnv('REQUEST_BUDGET_MS', 'test');
    vi.stubEnv('CIRCUIT_FAILURE_THRESHOLD', 'test');
    vi.stubEnv('CIRCUIT_COOLDOWN_MS', 'test');
    vi.stubEnv('CACHE_FRESH_MS', 'test');
    vi.stubEnv('CACHE_EXPIRED_WINDOW_MS', 'test');
    vi.stubEnv('CACHE_ABSENCE_TTL_MS', 'test');
    vi.stubEnv('CACHE_MAX_ENTRIES', 'test');
    vi.stubEnv('RATE_LIMIT_MAX', 'test');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', 'test');
    vi.stubEnv('PROVIDER_MAX_CONCURRENCY', 'test');

    await expect(createApp()).rejects.toMatchObject({
      issues: {
        PORT: expect.objectContaining({ value: 'test' }),
        LOG_LEVEL: expect.objectContaining({ value: 'test' }),
        PROVIDER_TIMEOUT_MS: expect.objectContaining({ value: 'test' }),
        REQUEST_BUDGET_MS: expect.objectContaining({ value: 'test' }),
        CIRCUIT_FAILURE_THRESHOLD: expect.objectContaining({ value: 'test' }),
        CIRCUIT_COOLDOWN_MS: expect.objectContaining({ value: 'test' }),
        CACHE_FRESH_MS: expect.objectContaining({ value: 'test' }),
        CACHE_EXPIRED_WINDOW_MS: expect.objectContaining({ value: 'test' }),
        CACHE_ABSENCE_TTL_MS: expect.objectContaining({ value: 'test' }),
        CACHE_MAX_ENTRIES: expect.objectContaining({ value: 'test' }),
        RATE_LIMIT_MAX: expect.objectContaining({ value: 'test' }),
        RATE_LIMIT_WINDOW_MS: expect.objectContaining({ value: 'test' }),
        PROVIDER_MAX_CONCURRENCY: expect.objectContaining({ value: 'test' }),
      },
    });
  });

  it.each(['0', '65536', '3000.5', ''])('refuses PORT=%j', async (value) => {
    vi.stubEnv('PORT', value);

    await expect(createApp()).rejects.toMatchObject({
      issues: { PORT: expect.objectContaining({ value }) },
    });
  });
  it.each(['86400000', '3600000'])(
    'refuses an expiry window of %s ms, not longer than the 24h freshness',
    async (value) => {
      vi.stubEnv('CACHE_FRESH_MS', '86400000');
      vi.stubEnv('CACHE_EXPIRED_WINDOW_MS', value);

      await expect(createApp()).rejects.toMatchObject({
        issues: { CACHE_EXPIRED_WINDOW_MS: expect.objectContaining({ value }) },
      });
    },
  );
});

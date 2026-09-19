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

    await expect(createApp()).rejects.toMatchObject({
      issues: {
        PORT: expect.objectContaining({ value: 'test' }),
        LOG_LEVEL: expect.objectContaining({ value: 'test' }),
        PROVIDER_TIMEOUT_MS: expect.objectContaining({ value: 'test' }),
        REQUEST_BUDGET_MS: expect.objectContaining({ value: 'test' }),
      },
    });
  });

  it.each(['0', '65536', '3000.5', ''])('refuses PORT=%j', async (value) => {
    vi.stubEnv('PORT', value);

    await expect(createApp()).rejects.toMatchObject({
      issues: { PORT: expect.objectContaining({ value }) },
    });
  });
});

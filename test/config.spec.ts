import request from 'supertest';
import { createApp } from './app.js';

describe('configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('boots with no environment variable defined', async () => {
    vi.stubEnv('PORT', undefined);
    vi.stubEnv('LOG_LEVEL', undefined);

    const { app } = await createApp();
    const res = await request(app.getHttpServer()).get('/cep/01310930');
    await app.close();

    expect(res.status).toBe(200);
  });

  it('refuses to boot with invalid variables, naming each one', async () => {
    vi.stubEnv('PORT', 'test');
    vi.stubEnv('LOG_LEVEL', 'test');

    await expect(createApp()).rejects.toMatchObject({
      issues: {
        PORT: expect.objectContaining({ value: 'test' }),
        LOG_LEVEL: expect.objectContaining({ value: 'test' }),
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

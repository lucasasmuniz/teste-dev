import type { INestApplication } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import request from 'supertest';
import { createApp, type LogLine } from './app.js';
import { providerStubs, VIACEP_URL } from './provider-stubs.js';

describe('provider timeout', () => {
  let app: INestApplication;
  let logs: LogLine[];

  beforeEach(async () => {
    vi.stubEnv('PROVIDER_TIMEOUT_MS', '50');
    ({ app, logs } = await createApp());
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('aborts the request to a slow provider instead of abandoning it', async () => {
    let signal: AbortSignal | undefined;
    providerStubs.use(
      http.get(VIACEP_URL, ({ request }) => {
        signal = request.signal;
        return new Promise<Response>((resolve) => {
          request.signal.addEventListener('abort', () =>
            resolve(HttpResponse.error()),
          );
        });
      }),
    );

    const res = await request(app.getHttpServer()).get('/cep/50680000');

    expect(res.status).toBe(503);
    expect(signal?.aborted).toBe(true);
    expect(logs).toContainEqual(
      expect.objectContaining({
        requestId: res.headers['request-id'],
        msg: 'provider attempt',
        level: 40,
        provider: 'viacep',
        result: 'timeout',
      }),
    );
  });
});

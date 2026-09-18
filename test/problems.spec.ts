import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, ExplodeController, type LogLine } from './app.js';

describe('errors as application/problem+json', () => {
  let app: INestApplication;
  let logs: LogLine[];

  beforeEach(async () => {
    ({ app, logs } = await createApp({ controllers: [ExplodeController] }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('turns an unexpected error into a 500 without leaking message or stack', async () => {
    const res = await request(app.getHttpServer()).get('/explode');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual({
      type: '/problems/internal-error',
      title: 'Internal error',
      status: 500,
      instance: '/explode',
    });
    expect(res.text).not.toContain('internal secret');
  });

  it('turns a framework HTTP error into a generic problem+json', async () => {
    const res = await request(app.getHttpServer()).get(
      '/route-that-does-not-exist',
    );

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      instance: '/route-that-does-not-exist',
    });
  });

  it('logs a framework 5xx with its error, without leaking it in the body', async () => {
    const res = await request(app.getHttpServer()).get('/explode/http');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      instance: '/explode/http',
    });
    expect(res.text).not.toContain('framework secret');
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 50,
        msg: 'request failed',
        requestId: res.headers['request-id'],
        err: expect.objectContaining({ message: 'framework secret' }),
      }),
    );
  });
});

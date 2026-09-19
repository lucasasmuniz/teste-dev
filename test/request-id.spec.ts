import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, ExplodeController, type LogLine } from './app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request id', () => {
  let app: INestApplication;
  let logs: LogLine[];

  beforeEach(async () => {
    ({ app, logs } = await createApp({ controllers: [ExplodeController] }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('inherits the incoming Request-Id, echoes it and stamps it on every log line', async () => {
    const res = await request(app.getHttpServer())
      .get('/explode')
      .set('Request-Id', 'caller-42');

    expect(res.headers['request-id']).toBe('caller-42');

    const requestLines = () => logs.filter((l) => l.requestId === 'caller-42');
    await vi.waitFor(() =>
      expect(requestLines().map((l) => l.msg)).toEqual(
        expect.arrayContaining(['unexpected error', 'request errored']),
      ),
    );
    const error = requestLines().find((l) => l.msg === 'unexpected error');
    expect(error?.err?.stack).toContain('internal secret that must not leak');
  });

  it('generates an id when there is no incoming header', async () => {
    const res = await request(app.getHttpServer()).get('/cep/50680000');

    const id = res.headers['request-id'];
    expect(id).toMatch(UUID);
    await vi.waitFor(() =>
      expect(logs.some((l) => l.requestId === id)).toBe(true),
    );
  });

  it('discards an incoming Request-Id outside the accepted format and generates a new one', async () => {
    const res = await request(app.getHttpServer())
      .get('/cep/50680000')
      .set('Request-Id', 'x'.repeat(200));

    expect(res.headers['request-id']).toMatch(UUID);
  });
});

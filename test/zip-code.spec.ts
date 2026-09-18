import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, type LogLine } from './app.js';

describe('GET /cep/:cep', () => {
  let app: INestApplication;
  let logs: LogLine[];

  beforeEach(async () => {
    ({ app, logs } = await createApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('responds 200 with the canonical address', async () => {
    const res = await request(app.getHttpServer()).get('/cep/01310930');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      zipCode: '01310930',
      street: expect.any(String),
      complement: null,
      neighborhood: expect.any(String),
      city: expect.any(String),
      state: expect.stringMatching(/^[A-Z]{2}$/),
    });
  });

  it.each(['01310-930', '01.310-930', '01310 930'])(
    'accepts separators in "%s" and responds with the normalized zip code',
    async (zipCode) => {
      const res = await request(app.getHttpServer()).get(
        `/cep/${encodeURIComponent(zipCode)}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.zipCode).toBe('01310930');
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
});

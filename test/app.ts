import {
  Controller,
  Get,
  ServiceUnavailableException,
  type Type,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Writable } from 'node:stream';
import { AppModule } from '../src/app.module.js';
import { LOG_DESTINATION } from '../src/observability.js';

// nestjs-pino keeps one pino-http per process, bound to the first app's
// destination, so every app shares this one.
const logs: LogLine[] = [];
const destination = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    logs.push(JSON.parse(chunk.toString()) as LogLine);
    callback();
  },
});

@Controller('explode')
export class ExplodeController {
  @Get()
  explode(): never {
    throw new Error('internal secret that must not leak');
  }

  @Get('http')
  explodeHttp(): never {
    throw new ServiceUnavailableException('framework secret');
  }
}

export async function createApp({
  controllers = [],
}: { controllers?: Type[] } = {}) {
  logs.length = 0;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers,
  })
    .overrideProvider(LOG_DESTINATION)
    .useValue(destination)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, logs };
}

export interface LogLine {
  level: number;
  msg: string;
  requestId?: string;
  err?: { stack?: string };
  [field: string]: unknown;
}

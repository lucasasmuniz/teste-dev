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
import {
  ADDRESS_LOOKUPS,
  type AddressLookup,
} from '../src/zip-code/address-lookup.js';

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
  lookups,
}: { controllers?: Type[]; lookups?: AddressLookup[] } = {}) {
  logs.length = 0;

  const builder = Test.createTestingModule({
    imports: [AppModule],
    controllers,
  })
    .overrideProvider(LOG_DESTINATION)
    .useValue(destination);
  if (lookups) {
    builder.overrideProvider(ADDRESS_LOOKUPS).useValue(lookups);
  }
  const moduleRef = await builder.compile();

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

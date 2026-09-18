import { LoggerModule } from 'nestjs-pino';
import newrelic from 'newrelic';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { destination, type DestinationStream } from 'pino';
import { CONFIG, type Config } from './config.js';

export const LOG_DESTINATION = Symbol('LOG_DESTINATION');

const REQUEST_ID_HEADER = 'Request-Id';
const VALID_REQUEST_ID = /^[\w.:-]{1,128}$/;

export const ObservabilityModule = LoggerModule.forRootAsync({
  providers: [{ provide: LOG_DESTINATION, useFactory: () => destination(1) }],
  inject: [CONFIG, LOG_DESTINATION],
  useFactory: (config: Config, logDestination: DestinationStream) => ({
    pinoHttp: [
      {
        level: config.LOG_LEVEL,
        genReqId: resolveRequestId,
        quietReqLogger: true,
        customAttributeKeys: { reqId: 'requestId' },
        customLogLevel: (_req, res, err) =>
          err ? 'error' : severityFor(res.statusCode),
      },
      logDestination,
    ],
  }),
});

export function severityFor(status: number): 'error' | 'info' {
  return status >= 500 ? 'error' : 'info';
}

function resolveRequestId(req: IncomingMessage, res: ServerResponse) {
  const inherited = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const id =
    typeof inherited === 'string' && VALID_REQUEST_ID.test(inherited)
      ? inherited
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  newrelic.addCustomAttribute('requestId', id);
  return id;
}

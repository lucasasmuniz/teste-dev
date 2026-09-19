import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { STATUS_CODES } from 'node:http';
import { severityFor } from './observability.js';
import { Problem } from './problems.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    logger.setContext(ProblemDetailsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const { problem, log } = classify(exception, req);

    if (log) {
      this.logger[severityFor(problem.status)](log.fields, log.message);
    }
    res
      .status(problem.status)
      .type('application/problem+json')
      .json({ ...problem, instance: req.originalUrl });
  }
}

function classify(exception: unknown, req: Request): Outcome {
  if (exception instanceof Problem) {
    const { type, title, status, detail, extensions } = exception;
    return {
      problem: { ...extensions, type, title, status, detail },
      log: {
        fields: { problemType: type, status, detail, params: req.params },
        message:
          severityFor(status) === 'error'
            ? 'request failed'
            : 'request rejected',
      },
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      problem: {
        type: 'about:blank',
        title: STATUS_CODES[status] ?? '',
        status,
      },
      log:
        severityFor(status) === 'error'
          ? { fields: { err: exception, status }, message: 'request failed' }
          : undefined,
    };
  }
  return {
    problem: {
      type: '/problems/internal-error',
      title: 'Internal error',
      status: 500,
    },
    log: { fields: { err: exception }, message: 'unexpected error' },
  };
}

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  [extension: string]: unknown;
}

interface Outcome {
  problem: ProblemDetails;
  log?: { fields: Record<string, unknown>; message: string };
}

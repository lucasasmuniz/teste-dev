import { z } from 'zod';

export abstract class Problem extends Error {
  abstract readonly type: string;
  abstract readonly title: string;
  abstract readonly status: number;

  constructor(
    readonly detail: string,
    readonly extensions: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
  }
}

export class RateLimited extends Problem {
  readonly type = '/problems/rate-limited';
  readonly title = 'Too many requests';
  readonly status = 429;

  constructor() {
    super('This client exceeded its request limit; retry after Retry-After.');
  }
}

export function detailsOf(problem: Problem) {
  const { type, title, status, detail, extensions } = problem;
  return { ...extensions, type, title, status, detail };
}

export const problemDetails = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string(),
  })
  .meta({ id: 'ProblemDetails' });

export const INTERNAL_ERROR = {
  type: '/problems/internal-error',
  title: 'Internal error',
  status: 500,
};

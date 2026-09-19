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

import { Problem } from '../problems.js';
import type { FailureReason } from './address-lookup.js';

export class MalformedZipCode extends Problem {
  readonly type = '/problems/malformed-zip-code';
  readonly title = 'Malformed zip code';
  readonly status = 400;
}

export class ProvidersExhausted extends Problem {
  readonly type = '/problems/providers-exhausted';
  readonly title = 'No provider could answer';
  readonly status = 503;

  constructor(attempts: Attempt[]) {
    super('No provider returned a usable answer for this zip code.', {
      attempts,
    });
  }
}

export interface Attempt {
  provider: string;
  reason: FailureReason;
}

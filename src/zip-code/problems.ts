import { z } from 'zod';
import { Problem, problemDetails } from '../problems.js';
import { FailureReason } from './address-lookup.js';

export class MalformedZipCode extends Problem {
  readonly type = '/problems/malformed-zip-code';
  readonly title = 'Malformed zip code';
  readonly status = 400;
}

export class ProvidersExhausted extends Problem {
  readonly type = '/problems/providers-exhausted';
  readonly title = 'No provider could answer';
  readonly status = 503;

  constructor(attempts: Attempt[], retryAfterSeconds: number) {
    super(
      'No provider returned a usable answer for this zip code.',
      { attempts },
      { 'Retry-After': String(retryAfterSeconds) },
    );
  }
}

export class ConfirmedAbsence extends Problem {
  readonly type = '/problems/confirmed-absence';
  readonly title = 'Zip code does not exist';
  readonly status = 404;

  constructor(attempts: Attempt[]) {
    super('Every provider we reached does not know this zip code.', {
      attempts,
    });
  }
}

export class PartialAbsence extends Problem {
  readonly type = '/problems/partial-absence';
  readonly title = 'Zip code absence is unconfirmed';
  readonly status = 404;

  constructor(attempts: Attempt[]) {
    super(
      'A provider does not know this zip code, but another could not answer.',
      { attempts },
    );
  }
}

export type Attempt = z.infer<typeof attempt>;

const attempt = z.object({
  provider: z.string(),
  reason: z.enum(Object.values(FailureReason)),
});

export const providerProblemDetails = problemDetails
  .extend({ attempts: z.array(attempt) })
  .meta({ id: 'ProviderProblemDetails' });

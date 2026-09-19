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

export interface Attempt {
  provider: string;
  reason: FailureReason;
}

export abstract class Problem extends Error {
  abstract readonly type: string;
  abstract readonly title: string;
  abstract readonly status: number;

  constructor(readonly detail: string) {
    super(detail);
  }
}

export class MalformedZipCode extends Problem {
  readonly type = '/problems/malformed-zip-code';
  readonly title = 'Malformed zip code';
  readonly status = 400;
}

export abstract class Problem extends Error {
  abstract readonly type: string;
  abstract readonly title: string;
  abstract readonly status: number;

  constructor(
    readonly detail: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail);
  }
}

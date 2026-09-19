import type {
  AddressLookup,
  FailureReason,
  LookupResult,
} from '../src/zip-code/address-lookup.js';

export class FakeLookup implements AddressLookup {
  calls = 0;

  constructor(
    readonly provider: string,
    public respond: Respond,
  ) {}

  lookup(zipCode: string, signal: AbortSignal): Promise<LookupResult> {
    this.calls++;
    return this.respond(zipCode, signal);
  }
}

export async function succeed(zipCode: string): Promise<LookupResult> {
  return found(zipCode);
}

export function failWith(reason: FailureReason): Respond {
  return async () => ({ ok: false, reason });
}

export function found(zipCode: string): LookupResult {
  return {
    ok: true,
    address: {
      zipCode,
      street: null,
      complement: null,
      neighborhood: null,
      city: 'Recife',
      state: 'PE',
    },
  };
}

type Respond = (zipCode: string, signal: AbortSignal) => Promise<LookupResult>;

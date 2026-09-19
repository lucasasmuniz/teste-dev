import type { CanonicalAddress } from './canonical-address.js';

/**
 * The port every provider is reached through. **It never throws**: every
 * outcome comes back as a result, a promise the type cannot express.
 *
 * Implementers build the query and translate the response, passing `signal`
 * to the HTTP client; resilience lives outside.
 *
 * Consumers get a result once `signal` aborts. `not_found` is data about the
 * zip code, not a provider failure; `schema_invalid` means the provider broke
 * its own contract.
 */
export interface AddressLookup {
  readonly provider: string;
  lookup(zipCode: string, signal: AbortSignal): Promise<LookupResult>;
}

export type LookupResult =
  | { ok: true; address: CanonicalAddress }
  | { ok: false; reason: FailureReason };

export type FailureReason =
  'timeout' | 'http_error' | 'schema_invalid' | 'not_found' | 'capped';

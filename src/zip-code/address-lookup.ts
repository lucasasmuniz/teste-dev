import {
  canonicalAddress,
  type CanonicalAddress,
} from './canonical-address.js';

export const ADDRESS_LOOKUPS = Symbol('ADDRESS_LOOKUPS');
/**
 * The port every provider is reached through. **It never throws**: every
 * outcome comes back as a result, a promise the type cannot express.
 *
 * Implementers build the query and translate the response through
 * `toCanonicalAddress`, passing `signal` to the HTTP client; resilience lives
 * outside.
 *
 * Consumers get a result once `signal` aborts. `not_found` is data about the
 * zip code, not a provider failure; `schema_invalid` means the provider broke
 * its own contract or answered outside the canonical format.
 */
export interface AddressLookup {
  readonly provider: string;
  lookup(zipCode: string, signal: AbortSignal): Promise<LookupResult>;
}

export function toCanonicalAddress(fields: CanonicalAddress): LookupResult {
  const parsed = canonicalAddress.safeParse(fields);
  if (parsed.success) {
    return { ok: true, address: parsed.data };
  }
  return {
    ok: false,
    reason: FailureReason.SchemaInvalid,
    detail: parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  };
}

/** `detail` is evidence for the log, never for the client. */
export type LookupResult =
  | { ok: true; address: CanonicalAddress }
  | { ok: false; reason: FailureReason; detail?: string };

export const FailureReason = {
  Timeout: 'timeout',
  HttpError: 'http_error',
  SchemaInvalid: 'schema_invalid',
  NotFound: 'not_found',
  Capped: 'capped',
  CircuitOpen: 'circuit_open',
} as const;

export type FailureReason = (typeof FailureReason)[keyof typeof FailureReason];

import { z } from 'zod';
import {
  FailureReason,
  type AddressLookup,
  type LookupResult,
} from './address-lookup.js';
import { blankToNull } from './canonical-address.js';
import { fetchJson } from './fetch-json.js';

const BASE_URL = 'https://brasilapi.com.br/api/cep/v1';

const notFoundSchema = z.object({
  name: z.literal('CepPromiseError'),
  type: z.literal('service_error'),
});

const responseSchema = z.object({
  street: z.string(),
  neighborhood: z.string(),
  city: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/),
});

// Two known limits, accepted and not handled (ADR-0004): for a zip code that
// does not exist it may answer 200 with a made-up address (99999999 comes back
// as Sarandi/PR via open-cep), and its 404 service_error is the same whether
// its internal sources denied the zip code or were all down.
export class BrasilApiLookup implements AddressLookup {
  readonly provider = 'brasilapi';

  async lookup(zipCode: string, signal: AbortSignal): Promise<LookupResult> {
    const response = await fetchJson(`${BASE_URL}/${zipCode}`, signal);
    if (!response.ok) {
      return response;
    }
    if (
      response.status === 404 &&
      notFoundSchema.safeParse(response.body).success
    ) {
      return { ok: false, reason: FailureReason.NotFound };
    }
    if (response.status !== 200) {
      return { ok: false, reason: FailureReason.HttpError };
    }
    const parsed = responseSchema.safeParse(response.body);
    if (!parsed.success) {
      return { ok: false, reason: FailureReason.SchemaInvalid };
    }
    const { street, neighborhood, city, state } = parsed.data;
    return {
      ok: true,
      address: {
        zipCode,
        street: blankToNull(street),
        complement: null,
        neighborhood: blankToNull(neighborhood),
        city,
        state,
      },
    };
  }
}

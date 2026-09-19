import { z } from 'zod';
import {
  FailureReason,
  type AddressLookup,
  type LookupResult,
} from './address-lookup.js';
import { blankToNull } from './canonical-address.js';
import { fetchJson } from './fetch-json.js';

const BASE_URL = 'https://viacep.com.br/ws';

// ViaCEP denies with 200 and `erro` as the string "true", not a boolean.
const notFoundSchema = z.object({ erro: z.literal('true') });

const responseSchema = z.object({
  logradouro: z.string(),
  complemento: z.string(),
  bairro: z.string(),
  localidade: z.string().min(1),
  uf: z.string().regex(/^[A-Z]{2}$/),
});

export class ViaCepLookup implements AddressLookup {
  readonly provider = 'viacep';

  async lookup(zipCode: string, signal: AbortSignal): Promise<LookupResult> {
    const response = await fetchJson(`${BASE_URL}/${zipCode}/json/`, signal);
    if (!response.ok) {
      return response;
    }
    if (response.status !== 200) {
      return { ok: false, reason: FailureReason.HttpError };
    }
    if (notFoundSchema.safeParse(response.body).success) {
      return { ok: false, reason: FailureReason.NotFound };
    }
    const parsed = responseSchema.safeParse(response.body);
    if (!parsed.success) {
      return { ok: false, reason: FailureReason.SchemaInvalid };
    }
    const { logradouro, complemento, bairro, localidade, uf } = parsed.data;
    return {
      ok: true,
      address: {
        zipCode,
        street: blankToNull(logradouro),
        complement: blankToNull(complemento),
        neighborhood: blankToNull(bairro),
        city: localidade,
        state: uf,
      },
    };
  }
}

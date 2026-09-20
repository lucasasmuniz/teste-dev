import { z } from 'zod';
import {
  FailureReason,
  toCanonicalAddress,
  type AddressLookup,
  type LookupResult,
} from '../address-lookup.js';
import { blankToNull } from '../canonical-address.js';
import { fetchJson, outsideContract } from './fetch-json.js';

const BASE_URL = 'https://viacep.com.br/ws';

// ViaCEP denies with 200 and `erro` documented as a boolean, usually sent as
// the string "true" and sometimes as the boolean; both are absence.
const notFoundSchema = z.object({ erro: z.literal(['true', true]) });

const responseSchema = z.object({
  logradouro: z.string(),
  complemento: z.string(),
  bairro: z.string(),
  localidade: z.string(),
  uf: z.string(),
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
      return outsideContract(response.raw);
    }
    const { logradouro, complemento, bairro, localidade, uf } = parsed.data;
    return toCanonicalAddress({
      zipCode,
      street: blankToNull(logradouro),
      complement: blankToNull(complemento),
      neighborhood: blankToNull(bairro),
      city: localidade,
      state: uf,
    });
  }
}

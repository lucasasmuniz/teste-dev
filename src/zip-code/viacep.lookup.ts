import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AddressLookup, LookupResult } from './address-lookup.js';
import { blankToNull } from './canonical-address.js';
import { fetchJson } from './fetch-json.js';

const BASE_URL = 'https://viacep.com.br/ws';

const responseSchema = z.object({
  logradouro: z.string(),
  complemento: z.string(),
  bairro: z.string(),
  localidade: z.string().min(1),
  uf: z.string().regex(/^[A-Z]{2}$/),
});

@Injectable()
export class ViaCepLookup implements AddressLookup {
  readonly provider = 'viacep';

  async lookup(zipCode: string, signal: AbortSignal): Promise<LookupResult> {
    const response = await fetchJson(`${BASE_URL}/${zipCode}/json/`, signal);
    if (!response.ok) {
      return response;
    }
    if (response.status !== 200) {
      return { ok: false, reason: 'http_error' };
    }
    const parsed = responseSchema.safeParse(response.body);
    if (!parsed.success) {
      return { ok: false, reason: 'schema_invalid' };
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

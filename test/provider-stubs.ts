import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import brasilApi00000001 from './fixtures/brasilapi/00000001.json' with { type: 'json' };
import brasilApi50680000 from './fixtures/brasilapi/50680000.json' with { type: 'json' };
import brasilApi99990000 from './fixtures/brasilapi/99990000.json' with { type: 'json' };
import viaCep00000001 from './fixtures/viacep/00000001.json' with { type: 'json' };
import viaCep50680000 from './fixtures/viacep/50680000.json' with { type: 'json' };
import viaCep99990000 from './fixtures/viacep/99990000.json' with { type: 'json' };

const PROVIDER_HOSTS: Record<string, string> = {
  'viacep.com.br': 'viacep',
  'brasilapi.com.br': 'brasilapi',
};

export const VIACEP_URL = 'https://viacep.com.br/ws/:cep/json/';
export const BRASILAPI_URL = 'https://brasilapi.com.br/api/cep/v1/:cep';

const viaCepFixtures = {
  '00000001': viaCep00000001,
  '50680000': viaCep50680000,
  '99990000': viaCep99990000,
};

const brasilApiFixtures = {
  '50680000': brasilApi50680000,
  '99990000': brasilApi99990000,
};

export const anyZipCode = {
  viaCepDenies: http.get(VIACEP_URL, () => HttpResponse.json({ erro: 'true' })),
  brasilApiDenies: http.get(BRASILAPI_URL, () =>
    HttpResponse.json(brasilApi00000001, { status: 404 }),
  ),
  brasilApiAnswers: http.get(BRASILAPI_URL, () =>
    HttpResponse.json(brasilApi50680000),
  ),
};

export const providerStubs = setupServer(
  ...Object.entries(viaCepFixtures).map(([cep, fixture]) =>
    http.get(VIACEP_URL.replace(':cep', cep), () => HttpResponse.json(fixture)),
  ),
  ...Object.entries(brasilApiFixtures).map(([cep, fixture]) =>
    http.get(BRASILAPI_URL.replace(':cep', cep), () =>
      HttpResponse.json(fixture),
    ),
  ),
  http.get(BRASILAPI_URL.replace(':cep', '00000001'), () =>
    HttpResponse.json(brasilApi00000001, { status: 404 }),
  ),
);

export function countProviderCalls(): Record<string, number> {
  const calls: Record<string, number> = { viacep: 0, brasilapi: 0 };
  providerStubs.events.on('request:start', ({ request }) => {
    const provider = PROVIDER_HOSTS[new URL(request.url).hostname];
    if (provider) {
      calls[provider]++;
    }
  });
  return calls;
}

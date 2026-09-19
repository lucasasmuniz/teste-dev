import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import brasilApi00000001 from './fixtures/brasilapi/00000001.json' with { type: 'json' };
import brasilApi50680000 from './fixtures/brasilapi/50680000.json' with { type: 'json' };
import brasilApi99990000 from './fixtures/brasilapi/99990000.json' with { type: 'json' };
import viaCep50680000 from './fixtures/viacep/50680000.json' with { type: 'json' };
import viaCep99990000 from './fixtures/viacep/99990000.json' with { type: 'json' };

export const VIACEP_URL = 'https://viacep.com.br/ws/:cep/json/';
export const BRASILAPI_URL = 'https://brasilapi.com.br/api/cep/v1/:cep';

const viaCepFixtures = {
  '50680000': viaCep50680000,
  '99990000': viaCep99990000,
};

const brasilApiFixtures = {
  '50680000': brasilApi50680000,
  '99990000': brasilApi99990000,
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

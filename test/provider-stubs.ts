import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import viaCep50680000 from './fixtures/viacep/50680000.json' with { type: 'json' };
import viaCep99990000 from './fixtures/viacep/99990000.json' with { type: 'json' };

export const VIACEP_URL = 'https://viacep.com.br/ws/:cep/json/';

const viaCepFixtures = {
  '50680000': viaCep50680000,
  '99990000': viaCep99990000,
};

export const providerStubs = setupServer(
  ...Object.entries(viaCepFixtures).map(([cep, fixture]) =>
    http.get(VIACEP_URL.replace(':cep', cep), () => HttpResponse.json(fixture)),
  ),
);

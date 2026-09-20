import { applyDecorators } from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  type HeadersObject,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { schemaRef } from '../openapi.js';
import {
  detailsOf,
  INTERNAL_ERROR,
  problemDetails,
  RateLimited,
  type Problem,
} from '../problems.js';
import { FailureReason } from './address-lookup.js';
import {
  canonicalAddress,
  expiredAddress,
  type CanonicalAddress,
} from './canonical-address.js';
import {
  ConfirmedAbsence,
  MalformedZipCode,
  PartialAbsence,
  providerProblemDetails,
  ProvidersExhausted,
} from './problems.js';
import { MALFORMED_ZIP_CODE_MESSAGE } from './zip-code.js';

export function ApiZipCodeLookup() {
  return applyDecorators(
    ApiOperation({
      summary: 'Resolve a zip code into its canonical address',
      description:
        'Asks the providers in round-robin order, falling back on failure or absence. Which provider answered is internal topology: it stays out of the body and goes in the headers.',
    }),
    ApiParam({
      name: 'cep',
      description: MALFORMED_ZIP_CODE_MESSAGE,
      example: '50680-000',
    }),
    ApiHeader({
      name: 'Request-Id',
      required: false,
      description:
        'Inherited when it matches `[\\w.:-]{1,128}`, else generated.',
    }),
    ApiResponse({
      status: 200,
      description:
        'Address from a provider or the cache. With every provider down, an expired address is served with `freshness` and a `Warning` header.',
      headers: {
        ...EVERY_RESPONSE,
        'Address-Provider': { schema: { type: 'string', example: 'viacep' } },
        'Server-Timing': {
          schema: { type: 'string', example: 'provider;desc="viacep";dur=143' },
        },
        Warning: {
          description: 'Only on an expired address.',
          schema: { type: 'string', example: '110 - "Response is Stale"' },
        },
      },
      content: {
        'application/json': {
          schema: {
            oneOf: [schemaRef(canonicalAddress), schemaRef(expiredAddress)],
          },
          examples: {
            fresh: { value: FRESH_ADDRESS },
            expired: {
              value: {
                ...FRESH_ADDRESS,
                freshness: {
                  status: 'expired',
                  storedAt: '2026-09-14T12:00:00.000Z',
                },
              },
            },
          },
        },
      },
    }),
    problemResponse({
      status: 400,
      description: 'Malformed zip code; no provider was asked.',
      schema: problemDetails,
      examples: { malformed: new MalformedZipCode(MALFORMED_ZIP_CODE_MESSAGE) },
    }),
    problemResponse({
      status: 404,
      description:
        'Confirmed absence (every reachable provider denied) or partial absence (one denied, another could not answer).',
      schema: providerProblemDetails,
      examples: {
        confirmedAbsence: new ConfirmedAbsence([
          { provider: 'viacep', reason: FailureReason.NotFound },
          { provider: 'brasilapi', reason: FailureReason.NotFound },
        ]),
        partialAbsence: new PartialAbsence([
          { provider: 'viacep', reason: FailureReason.NotFound },
          { provider: 'brasilapi', reason: FailureReason.Timeout },
        ]),
      },
    }),
    problemResponse({
      status: 429,
      description: 'Client exceeded the request limit.',
      schema: problemDetails,
      examples: { rateLimited: new RateLimited() },
      headers: { ...REQUEST_ID, ...RETRY_AFTER },
    }),
    problemResponse({
      status: 503,
      description:
        'No provider answered and nothing is cached; `Retry-After` follows the circuit breaker cooldown.',
      schema: providerProblemDetails,
      examples: {
        providersExhausted: new ProvidersExhausted(
          [
            { provider: 'viacep', reason: FailureReason.Timeout },
            { provider: 'brasilapi', reason: FailureReason.CircuitOpen },
          ],
          30,
        ),
      },
      headers: { ...EVERY_RESPONSE, ...RETRY_AFTER },
    }),
    ApiResponse({
      status: 500,
      description:
        'Unexpected error; the body leaks nothing, the log carries it.',
      headers: EVERY_RESPONSE,
      content: {
        'application/problem+json': {
          schema: schemaRef(problemDetails),
          example: { ...INTERNAL_ERROR, instance: EXAMPLE_INSTANCE },
        },
      },
    }),
  );
}

function problemResponse({
  status,
  description,
  schema,
  examples,
  headers = EVERY_RESPONSE,
}: ProblemResponse) {
  return ApiResponse({
    status,
    description,
    headers,
    content: {
      'application/problem+json': {
        schema: schemaRef(schema),
        examples: Object.fromEntries(
          Object.entries(examples).map(([name, problem]) => [
            name,
            { value: { ...detailsOf(problem), instance: EXAMPLE_INSTANCE } },
          ]),
        ),
      },
    },
  });
}

interface ProblemResponse {
  status: number;
  description: string;
  schema: z.ZodType;
  examples: Record<string, Problem>;
  headers?: HeadersObject;
}

const EXAMPLE_INSTANCE = '/cep/50680000';

const FRESH_ADDRESS: CanonicalAddress = {
  zipCode: '50680000',
  street: 'Rua São Mateus',
  complement: 'de 420/421 ao fim',
  neighborhood: 'Iputinga',
  city: 'Recife',
  state: 'PE',
};

const REQUEST_ID: HeadersObject = {
  'Request-Id': {
    description: 'Correlates this response with the log lines it produced.',
    schema: { type: 'string' },
  },
};

// The input limit adds these to every response that got past it; the 429
// carries Retry-After instead.
const EVERY_RESPONSE: HeadersObject = {
  ...REQUEST_ID,
  'X-RateLimit-Limit': { schema: { type: 'integer' } },
  'X-RateLimit-Remaining': { schema: { type: 'integer' } },
  'X-RateLimit-Reset': {
    description: 'Seconds until the window resets.',
    schema: { type: 'integer' },
  },
};

const RETRY_AFTER: HeadersObject = {
  'Retry-After': {
    description: 'Seconds until a retry makes sense.',
    schema: { type: 'integer' },
  },
};

import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { CanonicalAddress } from './canonical-address.js';
import { Source, ZipCodeLookup, type Answer } from './zip-code-lookup.js';
import { ZipCodeParam } from './zip-code.js';

@Controller('cep')
export class ZipCodeController {
  constructor(private readonly zipCodeLookup: ZipCodeLookup) {}

  @Get(':cep')
  async lookup(
    @ZipCodeParam() zipCode: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CanonicalAddress | ExpiredAddress> {
    const answer = await this.zipCodeLookup.lookup(zipCode);
    const { headers, body } = present(answer);
    res.set({ 'Address-Provider': answer.provider, ...headers });
    return body;
  }
}

function present(answer: Answer): Presentation {
  const { address, provider, durationMs } = answer;
  switch (answer.source) {
    case Source.Provider:
      return {
        headers: {
          'Server-Timing': `provider;desc="${provider}";dur=${durationMs}`,
        },
        body: address,
      };
    case Source.FreshCache:
      return {
        headers: { 'Server-Timing': `cache;desc="fresh";dur=${durationMs}` },
        body: address,
      };
    case Source.ExpiredCache:
      return {
        headers: {
          'Server-Timing': `cache;desc="expired";dur=${durationMs}`,
          Warning: '110 - "Response is Stale"',
        },
        body: {
          ...address,
          freshness: {
            status: 'expired',
            storedAt: new Date(answer.storedAt).toISOString(),
          },
        },
      };
  }
}

interface ExpiredAddress extends CanonicalAddress {
  freshness: { status: 'expired'; storedAt: string };
}

interface Presentation {
  headers: Record<string, string>;
  body: CanonicalAddress | ExpiredAddress;
}

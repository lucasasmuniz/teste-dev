import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { CanonicalAddress } from './canonical-address.js';
import { AddressResolver } from './address-resolver.js';
import { ZipCodeParam } from './zip-code.js';

@Controller('cep')
export class ZipCodeController {
  constructor(private readonly addressResolver: AddressResolver) {}

  @Get(':cep')
  async lookup(
    @ZipCodeParam() zipCode: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CanonicalAddress> {
    const { address, provider, durationMs } =
      await this.addressResolver.resolve(zipCode);
    res.setHeader('Address-Provider', provider);
    res.setHeader(
      'Server-Timing',
      `provider;desc="${provider}";dur=${durationMs}`,
    );
    return address;
  }
}

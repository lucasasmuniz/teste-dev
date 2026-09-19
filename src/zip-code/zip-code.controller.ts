import { Controller, Get } from '@nestjs/common';
import type { CanonicalAddress } from './canonical-address.js';
import { AddressResolver } from './address-resolver.js';
import { ZipCodeParam } from './zip-code.js';

@Controller('cep')
export class ZipCodeController {
  constructor(private readonly addressResolver: AddressResolver) {}

  @Get(':cep')
  lookup(@ZipCodeParam() zipCode: string): Promise<CanonicalAddress> {
    return this.addressResolver.resolve(zipCode);
  }
}

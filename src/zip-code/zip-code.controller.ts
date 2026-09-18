import { Controller, Get } from '@nestjs/common';
import type { CanonicalAddress } from './canonical-address.js';
import { ZipCodeParam } from './zip-code.js';

@Controller('cep')
export class ZipCodeController {
  @Get(':cep')
  lookup(@ZipCodeParam() zipCode: string): CanonicalAddress {
    return {
      zipCode,
      street: 'Avenida Paulista',
      complement: null,
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
    };
  }
}

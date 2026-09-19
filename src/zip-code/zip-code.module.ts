import { Module } from '@nestjs/common';
import { ADDRESS_LOOKUPS } from './address-lookup.js';
import { AddressResolver } from './address-resolver.js';
import { BrasilApiLookup } from './brasilapi.lookup.js';
import { ViaCepLookup } from './viacep.lookup.js';
import { ZipCodeController } from './zip-code.controller.js';

@Module({
  controllers: [ZipCodeController],
  providers: [
    AddressResolver,
    {
      provide: ADDRESS_LOOKUPS,
      useFactory: () => [new ViaCepLookup(), new BrasilApiLookup()],
    },
  ],
})
export class ZipCodeModule {}

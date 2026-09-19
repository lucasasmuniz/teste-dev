import { Module } from '@nestjs/common';
import { ViaCepLookup } from './viacep.lookup.js';
import { ZipCodeController } from './zip-code.controller.js';
import { AddressResolver } from './address-resolver.js';

@Module({
  controllers: [ZipCodeController],
  providers: [AddressResolver, ViaCepLookup],
})
export class ZipCodeModule {}

import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { createKeyv } from 'cacheable';
import { CONFIG, type Config } from '../config.js';
import { AddressCache } from './address-cache.js';
import { ADDRESS_LOOKUPS } from './address-lookup.js';
import { AddressResolver } from './address-resolver.js';
import { BrasilApiLookup } from './brasilapi.lookup.js';
import { CircuitBreakers } from './circuit-breakers.js';
import { HealthController } from './health.controller.js';
import { ViaCepLookup } from './viacep.lookup.js';
import { ZipCodeController } from './zip-code.controller.js';
import { ZipCodeLookup } from './zip-code-lookup.js';

@Module({
  imports: [
    CacheModule.registerAsync({
      inject: [CONFIG],
      useFactory: (config: Config) => ({
        stores: [createKeyv({ lruSize: config.CACHE_MAX_ENTRIES })],
      }),
    }),
  ],
  controllers: [ZipCodeController, HealthController],
  providers: [
    AddressCache,
    AddressResolver,
    ZipCodeLookup,
    CircuitBreakers,
    {
      provide: ADDRESS_LOOKUPS,
      useFactory: () => [new ViaCepLookup(), new BrasilApiLookup()],
    },
  ],
})
export class ZipCodeModule {}

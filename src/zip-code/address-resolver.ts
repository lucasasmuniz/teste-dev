import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CONFIG, type Config } from '../config.js';
import { ProvidersExhausted } from '../problems.js';
import type { AddressLookup, LookupResult } from './address-lookup.js';
import type { CanonicalAddress } from './canonical-address.js';
import { ViaCepLookup } from './viacep.lookup.js';

@Injectable()
export class AddressResolver {
  private readonly timeoutMs: number;

  constructor(
    @Inject(CONFIG) config: Config,
    private readonly viaCep: ViaCepLookup,
    private readonly logger: PinoLogger,
  ) {
    this.timeoutMs = config.PROVIDER_TIMEOUT_MS;
    logger.setContext(AddressResolver.name);
  }

  async resolve(zipCode: string): Promise<CanonicalAddress> {
    const result = await this.attempt(this.viaCep, zipCode, 1);
    if (result.ok) {
      return result.address;
    }
    throw new ProvidersExhausted();
  }

  private async attempt(
    lookup: AddressLookup,
    zipCode: string,
    attemptNumber: number,
  ): Promise<LookupResult> {
    const startedAt = performance.now();
    const result = await this.withTimeout((signal) =>
      lookup.lookup(zipCode, signal),
    );
    this.logger[result.ok ? 'info' : 'warn'](
      {
        provider: lookup.provider,
        zipCode,
        attempt: attemptNumber,
        result: result.ok ? 'ok' : result.reason,
        durationMs: Math.round(performance.now() - startedAt),
      },
      'provider attempt',
    );
    return result;
  }

  private async withTimeout(
    run: (signal: AbortSignal) => Promise<LookupResult>,
  ): Promise<LookupResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const timedOut = new Promise<LookupResult>((resolve) => {
      controller.signal.addEventListener('abort', () =>
        resolve({ ok: false, reason: 'timeout' }),
      );
    });
    try {
      return await Promise.race([run(controller.signal), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}

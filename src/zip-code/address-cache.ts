import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PinoLogger } from 'nestjs-pino';
import { CONFIG, type Config } from '../config.js';
import type { CanonicalAddress } from './canonical-address.js';
import type { Attempt } from './problems.js';

@Injectable()
export class AddressCache {
  private readonly freshMs: number;
  private readonly expiredWindowMs: number;
  private readonly absenceTtlMs: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly store: Cache,
    @Inject(CONFIG) config: Config,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(AddressCache.name);
    this.freshMs = config.CACHE_FRESH_MS;
    this.expiredWindowMs = config.CACHE_EXPIRED_WINDOW_MS;
    this.absenceTtlMs = config.CACHE_ABSENCE_TTL_MS;
  }

  async read(zipCode: string): Promise<Cached | undefined> {
    let entry: Entry | undefined;
    try {
      entry = await this.store.get<Entry>(keyFor(zipCode));
    } catch (err) {
      this.reportUnavailable('read', zipCode, err);
      return undefined;
    }
    if (entry?.kind !== CachedKind.Address) {
      return entry;
    }
    return { ...entry, fresh: Date.now() - entry.storedAt < this.freshMs };
  }

  async storeAddress(
    zipCode: string,
    address: CanonicalAddress,
    provider: string,
  ): Promise<void> {
    const entry: Entry = {
      kind: CachedKind.Address,
      address,
      provider,
      storedAt: Date.now(),
    };
    // The store TTL is the expiry window; freshness is judged on read (ADR-0006).
    await this.write(zipCode, entry, this.expiredWindowMs);
  }

  async storeConfirmedAbsence(
    zipCode: string,
    attempts: Attempt[],
  ): Promise<void> {
    const entry: Entry = {
      kind: CachedKind.ConfirmedAbsence,
      attempts,
    };
    await this.write(zipCode, entry, this.absenceTtlMs);
  }

  private async write(zipCode: string, entry: Entry, ttlMs: number) {
    try {
      await this.store.set(keyFor(zipCode), entry, ttlMs);
    } catch (err) {
      this.reportUnavailable('write', zipCode, err);
    }
  }

  private reportUnavailable(
    operation: 'read' | 'write',
    zipCode: string,
    err: unknown,
  ) {
    this.logger.warn({ operation, zipCode, err }, 'cache unavailable');
  }
}

function keyFor(zipCode: string): string {
  return `zip-code:${zipCode}`;
}

interface StoredAddress {
  kind: typeof CachedKind.Address;
  address: CanonicalAddress;
  provider: string;
  storedAt: number;
}

interface StoredConfirmedAbsence {
  kind: typeof CachedKind.ConfirmedAbsence;
  attempts: Attempt[];
}

type Entry = StoredAddress | StoredConfirmedAbsence;

export type Cached =
  (StoredAddress & { fresh: boolean }) | StoredConfirmedAbsence;

export const CachedKind = {
  Address: 'address',
  ConfirmedAbsence: 'confirmed_absence',
} as const;

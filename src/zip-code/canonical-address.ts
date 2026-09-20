import { z } from 'zod';

// Format only, never plausibility: a rejection here is a provider failure and
// feeds the circuit, so a rule about the data itself (does this zip code
// belong to this state?) would open circuits over data (ADR-0004).
export const canonicalAddress = z
  .object({
    zipCode: z.string().regex(/^\d{8}$/),
    street: z.string().min(1).nullable(),
    complement: z.string().min(1).nullable(),
    neighborhood: z.string().min(1).nullable(),
    city: z.string().min(1),
    state: z.string().regex(/^[A-Z]{2}$/),
  })
  .meta({ id: 'CanonicalAddress' });

export const expiredAddress = canonicalAddress
  .extend({
    freshness: z.object({
      status: z.literal('expired'),
      storedAt: z.string().meta({ format: 'date-time' }),
    }),
  })
  .meta({
    id: 'ExpiredAddress',
    description:
      'Served only when every provider failed; stored at `storedAt`, past the freshness window.',
  });

export function blankToNull(value: string): string | null {
  return value === '' ? null : value;
}

export type CanonicalAddress = z.infer<typeof canonicalAddress>;

export type ExpiredAddress = z.infer<typeof expiredAddress>;

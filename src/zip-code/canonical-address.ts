export interface CanonicalAddress {
  zipCode: string;
  street: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
}

export function blankToNull(value: string): string | null {
  return value === '' ? null : value;
}

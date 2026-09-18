/** Every key is always present; `complement` is `null` when the provider has none. */
export interface CanonicalAddress {
  zipCode: string;
  street: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
}

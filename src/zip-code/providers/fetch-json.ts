import { FailureReason, type LookupResult } from '../address-lookup.js';

export async function fetchJson(
  url: string,
  signal: AbortSignal,
): Promise<FetchJsonResult> {
  try {
    const response = await fetch(url, { signal });
    const raw = await response.text();
    return { ok: true, status: response.status, body: parseJson(raw), raw };
  } catch {
    return {
      ok: false,
      reason: signal.aborted ? FailureReason.Timeout : FailureReason.HttpError,
    };
  }
}

// What the provider actually sent, so a contract breach can be diagnosed.
export function outsideContract(raw: string): LookupResult {
  return {
    ok: false,
    reason: FailureReason.SchemaInvalid,
    detail: raw.slice(0, DETAIL_MAX_LENGTH),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type FetchJsonResult =
  | { ok: true; status: number; body: unknown; raw: string }
  | {
      ok: false;
      reason: typeof FailureReason.Timeout | typeof FailureReason.HttpError;
    };

const DETAIL_MAX_LENGTH = 200;

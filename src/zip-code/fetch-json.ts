import type { FailureReason } from './address-lookup.js';

export async function fetchJson(
  url: string,
  signal: AbortSignal,
): Promise<FetchJsonResult> {
  try {
    const response = await fetch(url, { signal });
    const body = parseJson(await response.text());
    return { ok: true, status: response.status, body };
  } catch {
    return { ok: false, reason: signal.aborted ? 'timeout' : 'http_error' };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type FetchJsonResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; reason: Extract<FailureReason, 'timeout' | 'http_error'> };

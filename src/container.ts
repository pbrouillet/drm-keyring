import {
  MAX_NDRM_HEADER_BYTES,
  NDRM_CONTAINER_VERSION,
  NDRM_HEADER_PEEK_MAX_BYTES,
  NDRM_MAGIC,
} from './constants.js';
import { DrmContainerFormatError } from './errors.js';
import type { PersonalDrmEnvelope } from './types.js';

export function isNdrmFileName(fileName: string): boolean {
  return fileName.trim().toLowerCase().endsWith('.ndrm');
}

export function isNdrmContainerBytes(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 10) return false;
  const head = new Uint8Array(buffer, 0, 5);
  return (
    head[0] === NDRM_MAGIC[0] &&
    head[1] === NDRM_MAGIC[1] &&
    head[2] === NDRM_MAGIC[2] &&
    head[3] === NDRM_MAGIC[3] &&
    head[4] === NDRM_CONTAINER_VERSION
  );
}

function isValidParsedEnvelope<TInnerFormat extends string>(
  parsed: Partial<PersonalDrmEnvelope<TInnerFormat>> | null | undefined,
  allowedInnerFormats?: readonly TInnerFormat[]
): parsed is PersonalDrmEnvelope<TInnerFormat> {
  if (
    !parsed ||
    parsed.version !== 1 ||
    parsed.cipher !== 'AES-256-GCM' ||
    parsed.kdf !== 'PBKDF2-SHA256' ||
    typeof parsed.saltB64 !== 'string' ||
    typeof parsed.kekIvB64 !== 'string' ||
    typeof parsed.wrappedDekB64 !== 'string' ||
    typeof parsed.contentIvB64 !== 'string' ||
    typeof parsed.innerFormat !== 'string' ||
    parsed.innerFormat.trim().length === 0
  ) {
    return false;
  }

  if (allowedInnerFormats && allowedInnerFormats.length > 0) {
    return allowedInnerFormats.includes(parsed.innerFormat);
  }
  return true;
}

/**
 * Packs a PersonalDrmEnvelope and AES-256-GCM ciphertext into a self-contained portable `.ndrm` binary file
 * suitable for local backups or uploading to cloud storage without exposing plaintext.
 */
export function packNdrmContainer<TInnerFormat extends string = string>(
  envelope: PersonalDrmEnvelope<TInnerFormat>,
  ciphertext: ArrayBuffer
): ArrayBuffer {
  const headerBytes = new TextEncoder().encode(JSON.stringify(envelope));
  if (headerBytes.byteLength > MAX_NDRM_HEADER_BYTES) {
    throw new DrmContainerFormatError('DRM envelope header exceeds 64 KB limit.');
  }

  const totalLength = 9 + headerBytes.byteLength + ciphertext.byteLength;
  const out = new Uint8Array(totalLength);
  out.set(NDRM_MAGIC, 0);
  out[4] = NDRM_CONTAINER_VERSION;

  const view = new DataView(out.buffer);
  view.setUint32(5, headerBytes.byteLength, false); // Big-endian uint32

  out.set(headerBytes, 9);
  out.set(new Uint8Array(ciphertext), 9 + headerBytes.byteLength);
  return out.buffer;
}

export function unpackNdrmContainer<TInnerFormat extends string = string>(
  containerBytes: ArrayBuffer,
  options?: { allowedInnerFormats?: readonly TInnerFormat[] }
): {
  envelope: PersonalDrmEnvelope<TInnerFormat>;
  ciphertext: ArrayBuffer;
} {
  if (!isNdrmContainerBytes(containerBytes)) {
    throw new DrmContainerFormatError('File does not have a valid NDRM v1 header.');
  }

  const view = new DataView(containerBytes);
  const headerLength = view.getUint32(5, false);
  if (
    headerLength <= 2 ||
    headerLength > MAX_NDRM_HEADER_BYTES ||
    9 + headerLength >= containerBytes.byteLength
  ) {
    throw new DrmContainerFormatError('Corrupted NDRM header length.');
  }

  const headerSlice = new Uint8Array(containerBytes, 9, headerLength);
  let parsed: Partial<PersonalDrmEnvelope<TInnerFormat>>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(headerSlice)) as Partial<
      PersonalDrmEnvelope<TInnerFormat>
    >;
  } catch {
    throw new DrmContainerFormatError('Malformed NDRM JSON envelope.');
  }

  if (!isValidParsedEnvelope(parsed, options?.allowedInnerFormats)) {
    throw new DrmContainerFormatError('Incomplete NDRM cryptographic metadata.');
  }

  const ciphertext = containerBytes.slice(9 + headerLength);
  return {
    envelope: parsed,
    ciphertext,
  };
}

/**
 * Inspects a prefix byte slice (e.g. HTTP Range: bytes=0-65535) of a `.ndrm` container
 * and returns its parsed PersonalDrmEnvelope without requiring the trailing ciphertext.
 */
export function peekNdrmContainerEnvelope<TInnerFormat extends string = string>(
  prefixBytes: ArrayBuffer,
  options?: { allowedInnerFormats?: readonly TInnerFormat[] }
): PersonalDrmEnvelope<TInnerFormat> | null {
  if (!isNdrmContainerBytes(prefixBytes)) {
    return null;
  }

  const view = new DataView(prefixBytes);
  const headerLength = view.getUint32(5, false);
  if (
    headerLength <= 2 ||
    headerLength > MAX_NDRM_HEADER_BYTES ||
    9 + headerLength > prefixBytes.byteLength
  ) {
    return null;
  }

  const headerSlice = new Uint8Array(prefixBytes, 9, headerLength);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(headerSlice)) as Partial<
      PersonalDrmEnvelope<TInnerFormat>
    >;
    if (!isValidParsedEnvelope(parsed, options?.allowedInnerFormats)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildNdrmExportFileName(fileName: string, innerFormat: string): string {
  const lowerExt = innerFormat.trim().toLowerCase() || 'cbz';
  const trimmed = fileName.trim() || `volume.${lowerExt}`;
  if (trimmed.toLowerCase().endsWith('.ndrm')) {
    return trimmed;
  }
  const hasKnownInnerExt = /\.(cbz|cbr|pdf)$/i.test(trimmed);
  const withInner = hasKnownInnerExt ? trimmed : `${trimmed}.${lowerExt}`;
  return `${withInner}.ndrm`;
}

/**
 * Reads at most `maxBytes` from a Fetch `Response` stream and cancels the remainder
 * immediately so proxies returning `200 OK` instead of `206 Partial Content` never
 * pull full multi-hundred-MB payloads.
 */
export async function readResponsePrefixBytes(
  res: Response,
  maxBytes: number
): Promise<ArrayBuffer> {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const full = await res.arrayBuffer();
    return full.byteLength <= maxBytes ? full : full.slice(0, maxBytes);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalRead = 0;

  try {
    while (totalRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        const remaining = maxBytes - totalRead;
        const slice = value.byteLength <= remaining ? value : value.subarray(0, remaining);
        chunks.push(slice);
        totalRead += slice.byteLength;
      }
      if (totalRead >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore release errors after cancel
    }
  }

  const combined = new Uint8Array(totalRead);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

export interface PeekRemoteNdrmOptions<TInnerFormat extends string = string> {
  headers?: HeadersInit;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  allowedInnerFormats?: readonly TInnerFormat[];
  onHttpError?: (status: number, body: string) => Error | null;
}

/**
 * Fetches at most `maxBytes` (default 64 KB) of a remote `.ndrm` volume via HTTP Range
 * to inspect its PersonalDrmEnvelope without downloading the full payload.
 */
export async function peekRemoteNdrmEnvelope<TInnerFormat extends string = string>(
  url: string,
  options?: PeekRemoteNdrmOptions<TInnerFormat>
): Promise<PersonalDrmEnvelope<TInnerFormat> | null> {
  const parentSignal = options?.signal;
  if (parentSignal?.aborted) {
    const abortErr = new Error('Transfer paused or cancelled.');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  const maxBytes = Math.max(512, options?.maxBytes ?? NDRM_HEADER_PEEK_MAX_BYTES);
  const timeoutMs = Math.max(1_000, options?.timeoutMs ?? 15_000);
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;

  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => {
    controller.abort();
  };
  if (parentSignal) {
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timerId = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort();
    }
  }, timeoutMs);

  try {
    const headers = new Headers(options?.headers);
    if (!headers.has('Range')) {
      headers.set('Range', `bytes=0-${maxBytes - 1}`);
    }

    const res = await fetchFn(url, {
      headers,
      signal: controller.signal,
    });

    if (!res.ok && res.status !== 206) {
      if (options?.onHttpError) {
        const body = await res.text().catch(() => '');
        const customErr = options.onHttpError(res.status, body);
        if (customErr) {
          throw customErr;
        }
      }
      return null;
    }

    const prefix = await readResponsePrefixBytes(res, maxBytes);
    return peekNdrmContainerEnvelope(prefix, {
      allowedInnerFormats: options?.allowedInnerFormats,
    });
  } catch (err) {
    if (parentSignal?.aborted && !timedOut) {
      throw err;
    }
    throw err;
  } finally {
    clearTimeout(timerId);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

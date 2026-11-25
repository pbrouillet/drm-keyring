import type { PersonalDrmEnvelope } from './types.js';
export declare function isNdrmFileName(fileName: string): boolean;
export declare function isNdrmContainerBytes(buffer: ArrayBuffer): boolean;
/**
 * Packs a PersonalDrmEnvelope and AES-256-GCM ciphertext into a self-contained portable `.ndrm` binary file
 * suitable for local backups or uploading to cloud storage without exposing plaintext.
 */
export declare function packNdrmContainer<TInnerFormat extends string = string>(envelope: PersonalDrmEnvelope<TInnerFormat>, ciphertext: ArrayBuffer): ArrayBuffer;
export declare function unpackNdrmContainer<TInnerFormat extends string = string>(containerBytes: ArrayBuffer, options?: {
    allowedInnerFormats?: readonly TInnerFormat[];
}): {
    envelope: PersonalDrmEnvelope<TInnerFormat>;
    ciphertext: ArrayBuffer;
};
/**
 * Inspects a prefix byte slice (e.g. HTTP Range: bytes=0-65535) of a `.ndrm` container
 * and returns its parsed PersonalDrmEnvelope without requiring the trailing ciphertext.
 */
export declare function peekNdrmContainerEnvelope<TInnerFormat extends string = string>(prefixBytes: ArrayBuffer, options?: {
    allowedInnerFormats?: readonly TInnerFormat[];
}): PersonalDrmEnvelope<TInnerFormat> | null;
export declare function buildNdrmExportFileName(fileName: string, innerFormat: string): string;
/**
 * Reads at most `maxBytes` from a Fetch `Response` stream and cancels the remainder
 * immediately so proxies returning `200 OK` instead of `206 Partial Content` never
 * pull full multi-hundred-MB payloads.
 */
export declare function readResponsePrefixBytes(res: Response, maxBytes: number): Promise<ArrayBuffer>;
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
export declare function peekRemoteNdrmEnvelope<TInnerFormat extends string = string>(url: string, options?: PeekRemoteNdrmOptions<TInnerFormat>): Promise<PersonalDrmEnvelope<TInnerFormat> | null>;
//# sourceMappingURL=container.d.ts.map
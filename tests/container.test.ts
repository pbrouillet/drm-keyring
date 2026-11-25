import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNdrmExportFileName,
  decryptWithPersonalDrm,
  DrmContainerFormatError,
  encryptWithPersonalDrm,
  isNdrmContainerBytes,
  isNdrmFileName,
  packNdrmContainer,
  peekNdrmContainerEnvelope,
  peekRemoteNdrmEnvelope,
  unpackNdrmContainer,
} from '../src/index.js';

test('.ndrm container packing, filename helpers, prefix peeking, and format validation', async () => {
  const plaintext = new Uint8Array(1024).fill(0x42);
  const { envelope, ciphertext } = await encryptWithPersonalDrm(
    plaintext.slice().buffer,
    'container-test-passphrase',
    {
      innerFormat: 'CBZ',
      originalFileName: 'Astral_Cartographer #01 (2026).cbz',
      iterations: 10_000,
    }
  );

  const exportName = buildNdrmExportFileName('Astral_Cartographer #01 (2026).cbz', 'CBZ');
  assert.equal(exportName, 'Astral_Cartographer #01 (2026).cbz.ndrm');
  assert.equal(isNdrmFileName(exportName), true);
  assert.equal(isNdrmFileName('plain.cbz'), false);

  const packed = packNdrmContainer(envelope, ciphertext);
  assert.equal(isNdrmContainerBytes(packed), true);
  assert.equal(isNdrmContainerBytes(plaintext.buffer), false);

  // Prefix slice (1200 bytes) suffices for peekNdrmContainerEnvelope
  const peeked = peekNdrmContainerEnvelope(packed.slice(0, 1200));
  assert.deepEqual(peeked, envelope);
  assert.equal(peekNdrmContainerEnvelope(packed.slice(0, 12)), null);
  assert.equal(peekNdrmContainerEnvelope(plaintext.slice(0, 256).buffer), null);

  // allowedInnerFormats filter
  assert.equal(
    peekNdrmContainerEnvelope(packed.slice(0, 1200), { allowedInnerFormats: ['PDF'] }),
    null
  );
  assert.throws(
    () => unpackNdrmContainer(packed, { allowedInnerFormats: ['PDF'] }),
    (err: unknown) => err instanceof DrmContainerFormatError
  );

  const unpacked = unpackNdrmContainer(packed, { allowedInnerFormats: ['CBZ', 'CBR', 'PDF'] });
  assert.deepEqual(unpacked.envelope, envelope);

  const decrypted = await decryptWithPersonalDrm(
    unpacked.ciphertext,
    unpacked.envelope,
    'container-test-passphrase'
  );
  assert.deepEqual(Array.from(new Uint8Array(decrypted)), Array.from(plaintext));
});

test('peekRemoteNdrmEnvelope handles 206 Range responses, 200 OK 64 KB stream capping, HTTP errors, and AbortSignal', async () => {
  const plaintext = new Uint8Array(4096).fill(0x55);
  const { envelope, ciphertext } = await encryptWithPersonalDrm(
    plaintext.slice().buffer,
    'remote-peek-passphrase',
    {
      innerFormat: 'CBZ',
      originalFileName: 'Heavy_Volume.cbz',
      iterations: 10_000,
    }
  );
  const packed = new Uint8Array(packNdrmContainer(envelope, ciphertext));

  // 1) 200 OK proxy fallback must cancel stream right after 64 KB
  let chunksPulled = 0;
  let streamCancelled = false;
  const peekedFromStream = await peekRemoteNdrmEnvelope('https://example.test/file.ndrm', {
    fetchImpl: (async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Range'), 'bytes=0-65535');
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunksPulled += 1;
          if (chunksPulled === 1) {
            controller.enqueue(packed);
          } else if (chunksPulled === 2) {
            controller.enqueue(new Uint8Array(70_000).fill(0xaa));
          } else {
            controller.enqueue(new Uint8Array(1_048_576).fill(0xbb));
          }
        },
        cancel() {
          streamCancelled = true;
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch,
  });

  assert.ok(peekedFromStream);
  assert.equal(peekedFromStream.plaintextSha256, envelope.plaintextSha256);
  assert.equal(streamCancelled, true);
  assert.ok(chunksPulled <= 3);

  // 2) Custom HTTP error propagation (e.g. 401 -> auth error)
  await assert.rejects(
    () =>
      peekRemoteNdrmEnvelope('https://example.test/file.ndrm', {
        fetchImpl: (async () => new Response('unauthorized', { status: 401 })) as typeof fetch,
        onHttpError: (status) =>
          status === 401 ? new Error('CustomAuthExpired') : null,
      }),
    /CustomAuthExpired/
  );

  // 3) Pre-aborted AbortSignal cancels immediately without calling fetch
  let fetchCalled = false;
  const abortController = new AbortController();
  abortController.abort();
  await assert.rejects(
    () =>
      peekRemoteNdrmEnvelope('https://example.test/file.ndrm', {
        signal: abortController.signal,
        fetchImpl: (async () => {
          fetchCalled = true;
          return new Response('', { status: 200 });
        }) as typeof fetch,
      }),
    (err: unknown) => err instanceof Error && err.name === 'AbortError'
  );
  assert.equal(fetchCalled, false);
});

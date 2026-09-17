import type { KvNamespaceLike, R2BucketLike, R2ObjectBodyLike } from './bindings'

// In-memory stand-ins for the Workers KV and R2 bindings, for tests. They
// mimic the parts of the real APIs the adapters rely on: values are copied
// on write, metadata goes through JSON (KV serializes it), `get` of a
// missing key returns null, and R2 rejects a put whose sha256 doesn't match.

function copyBytes(value: ArrayBuffer | ArrayBufferView | string): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice())
      controller.close()
    },
  })
}

export interface InMemoryKv extends KvNamespaceLike {
  entries: Map<string, { value: Uint8Array; metadata: unknown }>
}

export function createInMemoryKv(): InMemoryKv {
  const entries = new Map<string, { value: Uint8Array; metadata: unknown }>()

  const getWithMetadata = async (key: string, options: { type: 'stream' | 'arrayBuffer' }) => {
    const entry = entries.get(key)
    if (!entry) return { value: null, metadata: null }
    const value = options.type === 'stream' ? streamOf(entry.value) : entry.value.slice().buffer
    return { value, metadata: entry.metadata }
  }

  return {
    entries,
    async put(key, value, options) {
      const metadata = options?.metadata === undefined ? null : JSON.parse(JSON.stringify(options.metadata))
      entries.set(key, { value: copyBytes(value), metadata })
    },
    getWithMetadata: getWithMetadata as KvNamespaceLike['getWithMetadata'],
    async delete(key) {
      entries.delete(key)
    },
  }
}

export interface InMemoryR2 extends R2BucketLike {
  objects: Map<
    string,
    { value: Uint8Array; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>; uploaded: Date }
  >
}

async function hexSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createInMemoryR2(): InMemoryR2 {
  const objects: InMemoryR2['objects'] = new Map()
  return {
    objects,
    async put(key, value, options) {
      const bytes = copyBytes(value)
      if (options?.sha256 && options.sha256 !== (await hexSha256(bytes))) {
        throw new Error('put: The SHA-256 checksum you specified did not match what we received.')
      }
      objects.set(key, {
        value: bytes,
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
        uploaded: new Date(),
      })
      return { key, size: bytes.byteLength }
    },
    async get(key): Promise<R2ObjectBodyLike | null> {
      const object = objects.get(key)
      if (!object) return null
      return {
        body: streamOf(object.value),
        size: object.value.byteLength,
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
        uploaded: object.uploaded,
      }
    },
    async delete(key) {
      objects.delete(key)
    },
  }
}

/** Minimal valid-looking file headers for each allowed upload type. */
export const SAMPLE_FILES = {
  png: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  ),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]),
  webp: Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x1a, 0x00, 0x00, 0x00]),
    Buffer.from('WEBPVP8L'),
    Buffer.from([0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00]),
  ]),
  pdf: Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  ),
  html: Buffer.from('<!doctype html><script>alert(document.cookie)</script>'),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'),
  gif: Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary'),
} as const

/** `size` bytes that start with `header` (zero-padded), for size-cap tests. */
export function paddedFile(header: Uint8Array, size: number): Buffer {
  const file = Buffer.alloc(size)
  file.set(header.subarray(0, Math.min(header.byteLength, size)))
  return file
}

export async function readBody(body: ReadableStream<Uint8Array> | Uint8Array): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body)
  return Buffer.from(await new Response(body).arrayBuffer())
}

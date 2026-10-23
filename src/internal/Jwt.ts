/** @module Decodes JWTs (RFC 7519), and verifies their signatures (RFC 7515) with WebCrypto. */

/** Algorithms that `verify` accepts, with their WebCrypto parameters. */
export const algorithms = {
  ES256: {
    import: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { hash: 'SHA-256', name: 'ECDSA' },
  },
  RS256: {
    import: { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
} as const

/** A JWS algorithm that `verify` accepts. */
export type Algorithm = keyof typeof algorithms

/** Returns the `aud` claim as a list. A missing claim returns an empty list. */
export function audiences(payload: Decoded['payload']): readonly string[] {
  const aud = payload['aud']
  if (typeof aud === 'string') return [aud]
  if (Array.isArray(aud)) return aud.filter((value): value is string => typeof value === 'string')
  return []
}

/** Returns the header and claims of `token`, or `undefined` when it is not a compact JWS. */
export function decode(token: string): Decoded | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined

  try {
    return { header: segment(parts[0] ?? ''), payload: segment(parts[1] ?? '') }
  } catch {
    return undefined
  }
}

/** Decoded segments of a compact JWS. */
export type Decoded = {
  /** The protected header. */
  header: Readonly<Record<string, unknown>>
  /** The claims. Not verified. */
  payload: Readonly<Record<string, unknown>>
}

/**
 * Returns whether the signature of `token` verifies with `key`. ES256 signatures are the raw
 * `r || s` form that JWS and WebCrypto share.
 */
export async function verify(options: {
  algorithm: Algorithm
  key: CryptoKey
  token: string
}): Promise<boolean> {
  const parts = options.token.split('.')
  if (parts.length !== 3) return false

  try {
    return await crypto.subtle.verify(
      algorithms[options.algorithm].verify,
      options.key,
      bytes(parts[2] ?? ''),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )
  } catch {
    return false
  }
}

/** Decodes a base64url string (RFC 4648 §5). */
function bytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

/** Parses one base64url segment as a JSON object. Throws for any other value. */
function segment(value: string): Readonly<Record<string, unknown>> {
  const json: unknown = JSON.parse(new TextDecoder().decode(bytes(value)))
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    throw new Error('Expected a JSON object.')
  return json as Readonly<Record<string, unknown>>
}

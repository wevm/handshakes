/** @module Decodes JWTs (RFC 7519) without verifying them, for claims that serve logs, errors, and `aud` checks. */

/** Decoded segments of a compact JWS. */
export type Decoded = {
  /** The protected header. */
  header: Readonly<Record<string, unknown>>
  /** The claims. Not verified. */
  payload: Readonly<Record<string, unknown>>
}

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

/** Parses one base64url segment as a JSON object. Throws for any other value. */
function segment(value: string): Readonly<Record<string, unknown>> {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const json: unknown = JSON.parse(new TextDecoder().decode(bytes))

  if (typeof json !== 'object' || json === null || Array.isArray(json))
    throw new Error('Expected a JSON object.')
  return json as Readonly<Record<string, unknown>>
}

/** @module Fetches and caches the signing keys (JWKS) of OIDC issuers, for subject token verification. */
import * as Jwt from '../../internal/Jwt.js'

/** Returns a key cache. One cache serves one server, for the life of its instance. */
export function create(options: create.Options) {
  const timeout = options.timeout ?? 10_000
  const ttl = options.ttl ?? 600_000
  const pending = new Map<string, Promise<readonly JsonWebKey[]>>()
  const sets = new Map<
    string,
    { failed: boolean; fetchedAt: number; keys: readonly JsonWebKey[] }
  >()

  /**
   * Returns the keys of `issuer`, from the cache or from its discovery document. Concurrent callers
   * share one request. A failed request caches an empty set for a minute, so bad tokens cannot
   * flood the issuer, and a refresh for an unknown `kid` runs at most once a minute.
   */
  async function keys(issuer: string, refresh: boolean): Promise<readonly JsonWebKey[]> {
    const cached = sets.get(issuer)
    const age = refresh || cached?.failed ? 60_000 : ttl
    if (cached && Date.now() - cached.fetchedAt < age) return cached.keys

    const current = pending.get(issuer)
    if (current) return current

    const request = (async () => {
      const set = await load(issuer).catch(() => undefined)
      sets.set(issuer, { failed: !set, fetchedAt: Date.now(), keys: set ?? [] })
      return set ?? []
    })().finally(() => pending.delete(issuer))
    pending.set(issuer, request)
    return request
  }

  /** Fetches the keys of `issuer`, from `jwks_uri` of its discovery document, else `/.well-known/jwks`. */
  async function load(issuer: string): Promise<readonly JsonWebKey[]> {
    const base = issuer.replace(/\/$/, '')
    const uri = await (async () => {
      try {
        const response = await options.fetch(`${base}/.well-known/openid-configuration`, {
          signal: AbortSignal.timeout(timeout),
        })
        if (!response.ok) return undefined
        const body = (await response.json()) as { jwks_uri?: unknown }
        return typeof body.jwks_uri === 'string' ? body.jwks_uri : undefined
      } catch {
        return undefined
      }
    })()

    const response = await options.fetch(uri ?? `${base}/.well-known/jwks`, {
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok) throw new Error(`The keys of ${issuer} returned HTTP ${response.status}.`)
    const body = (await response.json()) as { keys?: unknown }
    return Array.isArray(body.keys) ? (body.keys as JsonWebKey[]) : []
  }

  return {
    /** Returns the verification key of `issuer` for `kid`, or `undefined` when the issuer has none. */
    async key(input: { algorithm: Jwt.Algorithm; issuer: string; kid: string | undefined }) {
      const find = (set: readonly JsonWebKey[]) =>
        set.find(
          (entry) =>
            (input.kid === undefined || (entry as { kid?: string }).kid === input.kid) &&
            entry.kty === (input.algorithm === 'ES256' ? 'EC' : 'RSA'),
        )

      const jwk = find(await keys(input.issuer, false)) ?? find(await keys(input.issuer, true))
      if (!jwk) return undefined

      // Only the public parameters are imported. `alg`, `use`, and `key_ops` can conflict with WebCrypto.
      const fields = jwk.kty === 'EC' ? ['crv', 'kty', 'x', 'y'] : ['e', 'kty', 'n']
      const material: JsonWebKey = Object.fromEntries(
        fields.map((field) => [field, jwk[field as keyof JsonWebKey]]),
      )
      return crypto.subtle.importKey(
        'jwk',
        material,
        Jwt.algorithms[input.algorithm].import,
        false,
        ['verify'],
      )
    },
  }
}

export declare namespace create {
  type Options = {
    fetch: typeof globalThis.fetch
    /** How long a key request may take, in milliseconds. Default: 10000. */
    timeout?: number | undefined
    /** How long a key set stays cached, in milliseconds. Default: 600000. */
    ttl?: number | undefined
  }
}

/** A key cache. */
export type Jwks = ReturnType<typeof create>

/**
 * @module Verifies a subject token (RFC 8693) against trust policies: the signature with the keys of
 * its issuer, then `iss`, `aud`, time, and claims. Shared by `Server` and the Better Auth adapter.
 */
import * as Jwt from '../../internal/Jwt.js'
import type * as Policy from '../Policy.js'
import type * as Jwks from './Jwks.js'

/** Subject token types that the exchange accepts. */
export const types = [
  'urn:ietf:params:oauth:token-type:jwt',
  'urn:ietf:params:oauth:token-type:id_token',
] as const

/** Throws a `TypeError` for a policy without claims, which would match every token of its issuer. */
export function check(policies: readonly Policy.Policy[]): void {
  for (const policy of policies)
    if (Object.keys(policy.claims).length === 0)
      throw new TypeError(
        `The policy ${policy.id} has no claims, so it matches every token of ${policy.issuer}. Add a claim that names the workload, such as \`repository_id\`.`,
      )
}

/** Allowed difference between clocks for `nbf` and `iat`, in seconds. */
const leeway = 60

/** The result of a verification. Refusals use RFC 6749 §5.2 errors. */
export type Result =
  | {
      claims: Readonly<Record<string, unknown>>
      /** The latest expiry of the issued credential, in milliseconds since the epoch. */
      expiresAt: number
      ok: true
      policy: Policy.Policy
      /** The RFC 8707 resources of the request. Each is a resource of the policy. */
      resources: readonly string[]
      scopes: readonly string[]
    }
  | {
      error: 'invalid_grant' | 'invalid_request' | 'invalid_scope' | 'invalid_target'
      errorDescription: string
      ok: false
    }

/**
 * Verifies a subject token. Every refusal of the token itself returns the same `invalid_grant`
 * description, so a caller cannot learn which check failed or which policies exist.
 */
export async function verify(options: {
  jwks: Jwks.Jwks
  maxLifetime: number
  policies: readonly Policy.Policy[]
  /** RFC 8707 resources of the request. */
  resources?: readonly string[] | undefined
  scope?: string | undefined
  subjectToken: string | undefined
  subjectTokenType: string | undefined
}): Promise<Result> {
  if (!options.subjectToken)
    return { error: 'invalid_request', errorDescription: 'subject_token is required.', ok: false }
  if (!types.includes(options.subjectTokenType as (typeof types)[number]))
    return {
      error: 'invalid_request',
      errorDescription: `subject_token_type must be one of ${types.join(', ')}.`,
      ok: false,
    }

  const refused = {
    error: 'invalid_grant',
    errorDescription: 'The subject token matches no trust policy.',
    ok: false,
  } as const

  const decoded = Jwt.decode(options.subjectToken)
  if (!decoded) return refused

  const algorithm = decoded.header['alg']
  const issuer = decoded.payload['iss']
  if (!Jwt.accepts(algorithm) || typeof issuer !== 'string') return refused

  // Only issuers that a policy names are contacted, so a token cannot direct requests elsewhere.
  // A policy without claims would match every token of its issuer, such as every GitHub repository.
  const candidates = options.policies.filter(
    (policy) => policy.issuer === issuer && Object.keys(policy.claims).length > 0,
  )
  if (candidates.length === 0) return refused

  const kid = typeof decoded.header['kid'] === 'string' ? decoded.header['kid'] : undefined
  const key = await options.jwks.key({ algorithm, issuer, kid })
  if (!key || !(await Jwt.verify({ algorithm, key, token: options.subjectToken }))) return refused

  const now = Date.now() / 1000
  const exp = decoded.payload['exp']
  const nbf = decoded.payload['nbf']
  if (typeof exp !== 'number' || exp <= now) return refused
  if (typeof nbf === 'number' && nbf > now + leeway) return refused

  const audiences = Jwt.audiences(decoded.payload)
  const iat = decoded.payload['iat']
  const policy = candidates.find(
    (entry) =>
      audiences.includes(entry.audience) &&
      (entry.maxAge === undefined ||
        (typeof iat === 'number' && iat >= now - entry.maxAge - leeway)) &&
      Object.entries(entry.claims).every((claim) => {
        const value = decoded.payload[claim[0]]
        const actual = typeof value === 'number' ? String(value) : value
        return (
          typeof actual === 'string' &&
          (typeof claim[1] === 'string' ? [claim[1]] : claim[1]).includes(actual)
        )
      }),
  )
  if (!policy) return refused

  const requested = options.scope?.split(' ').filter(Boolean)
  if (requested?.some((scope) => !policy.scopes.includes(scope)))
    return {
      error: 'invalid_scope',
      errorDescription: 'The requested scope exceeds the scopes of the trust policy.',
      ok: false,
    }

  const resources = options.resources ?? []
  if (resources.some((resource) => !(policy.resources ?? []).includes(resource)))
    return {
      error: 'invalid_target',
      errorDescription:
        'The requested resource is not a resource of the trust policy. Request a resource that the policy lists.',
      ok: false,
    }

  const lifetime = policy.maxLifetime ?? options.maxLifetime
  return {
    claims: decoded.payload,
    expiresAt: Math.min(exp * 1000, Date.now() + lifetime * 1000),
    ok: true,
    policy,
    resources,
    scopes: requested && requested.length > 0 ? requested : policy.scopes,
  }
}

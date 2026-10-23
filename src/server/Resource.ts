/**
 * @module Verification of the bearer tokens that an API receives: RFC 9068 access tokens of trusted
 * authorization servers, and platform subject tokens that a trust policy accepts. It also serves the
 * RFC 9728 metadata and the RFC 6750 challenge.
 */
import * as Jwt from '../internal/Jwt.js'
import * as Jwks from './internal/Jwks.js'
import * as Subject from './internal/Subject.js'
import type * as Policy from './Policy.js'

/** Allowed difference between clocks for `nbf`, in seconds. */
const leeway = 60

/** Returns a verifier for one API. Creating it sends no request. */
export function create(options: create.Options): Resource {
  const authorizationServers = options.authorizationServers ?? []
  const jwks = Jwks.create({ fetch: options.fetch ?? globalThis.fetch })
  const policies = options.policies ?? []
  const required = options.scopes ?? []

  Subject.check(policies)

  // A subject token for another API must not pass here, so each policy names this API.
  for (const policy of policies)
    if (policy.audience !== options.resource)
      throw new TypeError(
        `The audience of policy ${policy.id} must be ${options.resource}. Set the audience of the policy to the resource, or create one \`Resource\` for each audience.`,
      )

  const resource = new URL(options.resource)
  const path = resource.pathname === '/' ? '' : resource.pathname
  // RFC 9728 §3.1 inserts the well-known suffix before the path of the resource.
  const metadataUrl = `${resource.origin}/.well-known/oauth-protected-resource${path}`

  /** Verifies an RFC 9068 access token (`typ: at+jwt`) of a trusted authorization server. */
  async function accessToken(token: string, decoded: Jwt.Decoded): Promise<Valid | Invalid> {
    const invalid = { error: 'invalid_token', status: 'invalid' } as const

    // An ID token signed with the same key has another `typ`, so it never passes as an access token.
    const type = String(decoded.header['typ'] ?? '').toLowerCase()
    if (type !== 'at+jwt' && type !== 'application/at+jwt') return invalid

    const algorithm = decoded.header['alg']
    const issuer = decoded.payload['iss']
    if (algorithm !== 'RS256' && algorithm !== 'ES256') return invalid
    if (typeof issuer !== 'string') return invalid

    const kid = typeof decoded.header['kid'] === 'string' ? decoded.header['kid'] : undefined
    const key = await jwks.key({ algorithm, issuer, kid })
    if (!key || !(await Jwt.verify({ algorithm, key, token }))) return invalid

    const now = Date.now() / 1000
    const exp = decoded.payload['exp']
    const nbf = decoded.payload['nbf']
    const sub = decoded.payload['sub']
    if (typeof exp !== 'number' || exp <= now) return invalid
    if (typeof nbf === 'number' && nbf > now + leeway) return invalid
    if (!Jwt.audiences(decoded.payload).includes(options.resource)) return invalid

    const scope = decoded.payload['scope']
    return check({
      claims: decoded.payload,
      expiresAt: exp * 1000,
      issuer,
      scopes: typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [],
      // RFC 9068 §2.2 requires `sub`. A client credentials token carries the client ID there.
      subject: typeof sub === 'string' ? sub : '',
    })
  }

  /** Accepts the principal when it holds every required scope (RFC 6750 §3.1). */
  function check(principal: Principal): Valid | Invalid {
    const missing = required.filter((scope) => !principal.scopes.includes(scope))
    if (missing.length > 0) return { error: 'insufficient_scope', status: 'invalid' }
    return { principal, status: 'valid' }
  }

  return {
    challenge(result) {
      const parameters = [
        `resource_metadata="${metadataUrl}"`,
        ...(result.error ? [`error="${result.error}"`] : []),
        ...(required.length > 0 ? [`scope="${required.join(' ')}"`] : []),
      ]
      return new Response(null, {
        headers: { 'www-authenticate': `Bearer ${parameters.join(', ')}` },
        // RFC 6750 §3.1 returns 403 for insufficient scope, and 401 otherwise.
        status: result.error === 'insufficient_scope' ? 403 : 401,
      })
    },
    metadata() {
      const scopes = [...new Set([...required, ...policies.flatMap((policy) => policy.scopes)])]
      return Response.json({
        ...(authorizationServers.length > 0 ? { authorization_servers: authorizationServers } : {}),
        bearer_methods_supported: ['header'],
        resource: options.resource,
        ...(scopes.length > 0 ? { scopes_supported: scopes } : {}),
      })
    },
    metadataUrl,
    async verify(request) {
      const header = request.headers.get('authorization') ?? ''
      const match = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)\s*$/i.exec(header)
      // RFC 6750 §3.1: a request without credentials receives a challenge without an error code.
      if (!header) return { status: 'invalid' }
      if (!match?.[1]) return { error: 'invalid_request', status: 'invalid' }

      const token = match[1]
      const decoded = Jwt.decode(token)
      const issuer = decoded?.payload['iss']
      if (!decoded || typeof issuer !== 'string')
        return { error: 'invalid_token', status: 'invalid' }

      if (authorizationServers.includes(issuer)) return accessToken(token, decoded)

      const result = await Subject.verify({
        jwks,
        // The API checks the subject token itself. Its own `exp` is the only limit.
        maxLifetime: Number.POSITIVE_INFINITY,
        policies,
        subjectToken: token,
        subjectTokenType: Subject.types[0],
      })
      if (!result.ok) return { error: 'invalid_token', status: 'invalid' }

      const sub = result.claims['sub']
      return check({
        claims: result.claims,
        expiresAt: result.expiresAt,
        issuer,
        policy: result.policy,
        scopes: result.scopes,
        subject: typeof sub === 'string' ? sub : '',
      })
    },
  }
}

export declare namespace create {
  type Options = {
    /** Issuers whose RFC 9068 access tokens the API accepts. Their keys come from their discovery documents. */
    authorizationServers?: readonly string[] | undefined
    /** Default: `globalThis.fetch`, for requests to the keys of issuers. */
    fetch?: typeof globalThis.fetch | undefined
    /** Trust policies for platform subject tokens that the API accepts without an exchange. The audience of each must be `resource`. */
    policies?: readonly Policy.Policy[] | undefined
    /** The resource identifier of the API (RFC 9728 §1.2). Every accepted token has it as `aud`. */
    resource: string
    /** Scopes that every request needs. */
    scopes?: readonly string[] | undefined
  }
}

/** A refused request. */
export type Invalid = {
  /** RFC 6750 §3.1 error code. Absent when the request has no credentials. */
  error?: 'insufficient_scope' | 'invalid_request' | 'invalid_token' | undefined
  status: 'invalid'
}

/** The verified caller. */
export type Principal = {
  /** Verified claims of the token. */
  claims: Readonly<Record<string, unknown>>
  /** When the token expires, in milliseconds since the epoch. */
  expiresAt: number
  /** `iss` of the token. */
  issuer: string
  /** The policy that accepted a subject token. Absent for an access token. */
  policy?: Policy.Policy | undefined
  /** Scopes of the token. For a subject token, the scopes of the policy. */
  scopes: readonly string[]
  /** `sub` of the token. */
  subject: string
}

/** A verifier for one API. */
export type Resource = {
  /** Returns the RFC 6750 challenge: `403` for `insufficient_scope`, else `401`, with `resource_metadata` (RFC 9728 §5.1). */
  challenge: (result: Invalid) => Response
  /** Returns the RFC 9728 metadata response. Serve it at `metadataUrl`. */
  metadata: () => Response
  /** URL of the metadata: the well-known path of the resource (RFC 9728 §3.1). */
  metadataUrl: string
  /** Verifies the bearer token of the request. Returns `invalid` for a bad token, and never throws for one. */
  verify: (request: Request) => Promise<Valid | Invalid>
}

/** An accepted request. */
export type Valid = {
  principal: Principal
  status: 'valid'
}

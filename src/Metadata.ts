/** @module Discovery of OAuth endpoints: authorization server metadata (RFC 8414, OpenID Connect Discovery). */

/** The endpoints and capabilities of an authorization server. */
export type AuthorizationServer = {
  /** RFC 8628 device authorization endpoint. */
  deviceAuthorizationEndpoint?: string | undefined
  /** Grant types that the server supports. Empty when the metadata lists none. */
  grantTypesSupported: readonly string[]
  /** The issuer identifier. */
  issuer: string
  /** RFC 7009 revocation endpoint. */
  revocationEndpoint?: string | undefined
  /** The token endpoint. */
  tokenEndpoint: string
}

/**
 * Returns the metadata of an authorization server. Reads RFC 8414 metadata, then OpenID Connect
 * Discovery. The `issuer` of the metadata must equal `options.issuer` (RFC 8414 §3.3).
 */
export async function authorizationServer(
  options: authorizationServer.Options,
): Promise<AuthorizationServer> {
  const fetch = options.fetch ?? globalThis.fetch
  const issuer = new URL(options.issuer)
  const path = issuer.pathname === '/' ? '' : issuer.pathname

  // RFC 8414 §3.1 inserts the well-known suffix before the path. OpenID Connect appends it.
  const urls = [
    `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
    `${issuer.origin}${path}/.well-known/openid-configuration`,
  ]

  for (const url of urls) {
    const body = await (async () => {
      try {
        const response = await fetch(url, { headers: { accept: 'application/json' } })
        if (!response.ok) return undefined
        return (await response.json()) as Record<string, unknown>
      } catch (cause) {
        throw new NotFoundError({ cause, issuer: options.issuer })
      }
    })()
    if (!body) continue

    if (body['issuer'] !== options.issuer || typeof body['token_endpoint'] !== 'string')
      throw new NotFoundError({ issuer: options.issuer })

    const string = (key: string) => (typeof body[key] === 'string' ? body[key] : undefined)
    const grants = body['grant_types_supported']
    return {
      deviceAuthorizationEndpoint: string('device_authorization_endpoint'),
      grantTypesSupported: Array.isArray(grants)
        ? grants.filter((grant): grant is string => typeof grant === 'string')
        : [],
      issuer: options.issuer,
      revocationEndpoint: string('revocation_endpoint'),
      tokenEndpoint: body['token_endpoint'],
    }
  }

  throw new NotFoundError({ issuer: options.issuer })
}

export declare namespace authorizationServer {
  type Options = {
    /** Default: `globalThis.fetch`. */
    fetch?: typeof globalThis.fetch | undefined
    /** The issuer identifier, such as `https://auth.example.com`. */
    issuer: string
  }
  type ErrorType = NotFoundError
}

/** Explicit endpoints, for servers without metadata. */
export type Endpoints = {
  /** RFC 8628 device authorization endpoint. */
  deviceAuthorization?: string | undefined
  /** RFC 7009 revocation endpoint. */
  revocation?: string | undefined
  /** The token endpoint. */
  token: string
}

/** Thrown when the issuer serves no valid metadata. */
export class NotFoundError extends Error {
  override name = 'Metadata.NotFoundError'

  /** The issuer. */
  readonly issuer: string

  constructor(options: NotFoundError.Options) {
    super(`The issuer ${options.issuer} serves no authorization server metadata.`, {
      cause: options.cause,
    })
    this.issuer = options.issuer
  }
}

export declare namespace NotFoundError {
  type Options = {
    cause?: unknown
    issuer: string
  }
}

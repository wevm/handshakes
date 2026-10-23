/**
 * @module Discovery of OAuth endpoints: authorization server metadata (RFC 8414, OpenID Connect
 * Discovery), protected resource metadata (RFC 9728), and the `WWW-Authenticate` challenge of an API.
 */
import * as Errors from './internal/Errors.js'

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

/** The parameters of a `Bearer` challenge (RFC 6750 §3, RFC 9728 §5.1). */
export type Challenge = {
  /** RFC 6750 error code, such as `invalid_token` or `insufficient_scope`. */
  error?: string | undefined
  /** URL of the RFC 9728 metadata of the API. */
  resourceMetadata?: string | undefined
  /** Space-separated scopes that the API needs. */
  scope?: string | undefined
}

/**
 * Returns the parameters of the `Bearer` challenge in the `WWW-Authenticate` header of `response`,
 * or `undefined` when the response has none.
 */
export function challenge(response: Response): Challenge | undefined {
  const header = response.headers.get('www-authenticate')
  if (!header) return undefined

  // A header can hold several challenges, such as `DPoP` and `Bearer`. Parameters follow their scheme.
  const pattern = /([!#$%&'*+.^_`|~0-9A-Za-z-]+)(?:\s*=\s*("(?:[^"\\]|\\.)*"|[^\s,]*))?/g
  const parameters: Record<string, string> = {}
  let bearer = false
  let scheme: string | undefined
  for (const match of header.matchAll(pattern)) {
    const name = match[1] ?? ''
    const value = match[2]
    if (value === undefined) {
      scheme = name.toLowerCase()
      if (scheme === 'bearer') bearer = true
      continue
    }
    if (scheme !== 'bearer') continue
    parameters[name.toLowerCase()] = value.startsWith('"')
      ? value.slice(1, -1).replace(/\\(.)/g, '$1')
      : value
  }
  if (!bearer) return undefined

  return {
    error: parameters['error'],
    resourceMetadata: parameters['resource_metadata'],
    scope: parameters['scope'],
  }
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

/** The metadata of a protected resource (RFC 9728). */
export type ProtectedResource = {
  /** Issuers of the authorization servers that issue tokens for the resource. */
  authorizationServers: readonly string[]
  /** The resource identifier. */
  resource: string
  /** Scopes that the resource uses. Empty when the metadata lists none. */
  scopesSupported: readonly string[]
}

/**
 * Returns the metadata of a protected resource, from `url` or from the well-known path of `resource`
 * (RFC 9728 §3.1). When `options.resource` is set, the `resource` of the metadata must equal it
 * (RFC 9728 §3.3). Without it, the caller must check the returned `resource`.
 */
export async function protectedResource(
  options: protectedResource.Options,
): Promise<ProtectedResource> {
  const fetch = options.fetch ?? globalThis.fetch
  const url =
    options.url ??
    (() => {
      const resource = new URL(options.resource ?? '')
      const path = resource.pathname === '/' ? '' : resource.pathname
      return `${resource.origin}/.well-known/oauth-protected-resource${path}`
    })()

  const body = await (async () => {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) return undefined
      return (await response.json()) as Record<string, unknown>
    } catch (cause) {
      throw new ResourceNotFoundError({ cause, resource: options.resource ?? url })
    }
  })()
  const resource = body?.['resource']
  if (!body || typeof resource !== 'string')
    throw new ResourceNotFoundError({ resource: options.resource ?? url })
  if (options.resource !== undefined && resource !== options.resource)
    throw new ResourceNotFoundError({ resource: options.resource })

  const strings = (key: string) => {
    const value = body[key]
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : []
  }
  return {
    authorizationServers: strings('authorization_servers'),
    resource,
    scopesSupported: strings('scopes_supported'),
  }
}

export declare namespace protectedResource {
  type Options =
    | {
        /** Default: `globalThis.fetch`. */
        fetch?: typeof globalThis.fetch | undefined
        /** The expected resource identifier, such as `https://api.example.com`. */
        resource: string
        /** URL of the metadata, such as `resource_metadata` of a challenge. Default: the well-known URL of `resource`. */
        url?: string | undefined
      }
    | {
        /** Default: `globalThis.fetch`. */
        fetch?: typeof globalThis.fetch | undefined
        resource?: undefined
        /** URL of the metadata, such as `resource_metadata` of a challenge. */
        url: string
      }
  type ErrorType = ResourceNotFoundError
}

/** Thrown when the issuer serves no valid metadata. */
export class NotFoundError extends Errors.BaseError {
  override name = 'Metadata.NotFoundError'

  /** The issuer. */
  readonly issuer: string

  constructor(options: NotFoundError.Options) {
    super(`The issuer ${options.issuer} serves no authorization server metadata.`, {
      cause: options.cause,
      steps: [
        'Check that `issuer` equals the `issuer` of the metadata of the server, with no trailing slash.',
        'For a server without metadata, set `endpoints`.',
      ],
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

/** Thrown when the resource serves no valid metadata. */
export class ResourceNotFoundError extends Errors.BaseError {
  override name = 'Metadata.ResourceNotFoundError'

  /** The resource identifier. */
  readonly resource: string

  constructor(options: ResourceNotFoundError.Options) {
    super(`The resource ${options.resource} serves no protected resource metadata.`, {
      cause: options.cause,
      steps: [
        'Check that the API serves RFC 9728 metadata at `/.well-known/oauth-protected-resource`, with this `resource`.',
        'Or set `issuer` in a profile for the API.',
      ],
    })
    this.resource = options.resource
  }
}

export declare namespace ResourceNotFoundError {
  type Options = {
    cause?: unknown
    resource: string
  }
}

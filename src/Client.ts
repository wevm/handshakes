/**
 * @module A client for one API. It resolves an access token in a fixed order: a cached token, an
 * exchange of a detected subject token (RFC 8693), a stored grant (refreshed under the store lock),
 * then an interactive device grant (RFC 8628).
 */
import * as DeviceGrant from './DeviceGrant.js'
import * as Exchange from './Exchange.js'
import * as Grant from './Grant.js'
import * as Identity from './Identity.js'
import * as Errors from './internal/Errors.js'
import * as Jwt from './internal/Jwt.js'
import * as OAuth from './internal/OAuth.js'
import * as Metadata from './Metadata.js'
import * as Source from './Source.js'
import * as Store from './Store.js'

/** An access token and how the client got it. */
export type AccessToken = {
  /** When the token expires, in milliseconds since the epoch. */
  expiresAt: number
  /** `exchange`: from a subject token. `grant`: from a stored or new grant. */
  method: 'exchange' | 'grant'
  /** Space-separated scopes, when the server returns them. */
  scope?: string | undefined
  /** The authorization scheme of the token. */
  type: 'Bearer'
  /** The token. */
  value: string
}

/** Thrown when no method applies: no source detects, no grant is stored, and the client is not interactive. */
export class AuthorizationRequiredError extends Errors.BaseError {
  override name = 'Client.AuthorizationRequiredError'

  /** The issuer, or the token endpoint. */
  readonly issuer: string

  constructor(options: { issuer: string }) {
    super(`Authorization is required for ${options.issuer}.`, {
      steps: [
        'On a device, run `authorize` (`handshakes authorize` in the CLI) to run the device grant.',
        'In CI, check that the platform is detected with `handshakes status`.',
      ],
    })
    this.issuer = options.issuer
  }
}

/** A client for one API. */
export type Client = {
  /** Runs the device grant (RFC 8628) and stores the grant. */
  authorize: (options?: DeviceGrant.wait.Options) => Promise<Grant.Grant>
  /**
   * `fetch` with `Authorization: Bearer`. After a 401, retries once with a new token. Returns a
   * redirect response unfollowed. Throws `Client.ResourceError` for a URL outside `resource`.
   */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  /** Removes the cached access token. */
  invalidate: () => void
  /** Revokes the refresh token (RFC 7009) and deletes the stored grant. */
  revoke: () => Promise<void>
  /** The method that applies, the subject, and the expiry. Never includes a token value. */
  status: () => Promise<Status>
  /** Returns the cached access token, or requests a new one. */
  token: () => Promise<AccessToken>
}

/** Returns a client for one API. Creating it sends no request. */
export function create(options: create.Options): Client {
  if (!options.issuer && !options.endpoints) throw new TypeError('Set `issuer` or `endpoints`.')

  const env = options.env ?? processEnv()
  const fetch = options.fetch ?? globalThis.fetch
  const issuer = options.issuer ?? options.endpoints?.token ?? ''
  const store = options.store ?? Store.memory()
  const key = Grant.key({
    clientId: options.clientId,
    issuer,
    resource: options.resource,
    tokenEndpoint: options.endpoints?.token,
  })
  const sources = options.sources ?? Source.defaults

  let cached: (AccessToken & { issuedAt: number }) | undefined
  let metadata: Promise<Metadata.Endpoints> | undefined
  let pending: Promise<AccessToken> | undefined

  /** Returns the endpoints, from `options.endpoints` or the metadata of the issuer, read once. */
  function endpoints(): Promise<Metadata.Endpoints> {
    if (options.endpoints) return Promise.resolve(options.endpoints)
    metadata ??= Metadata.authorizationServer({ fetch, issuer }).then((server) => ({
      deviceAuthorization: server.deviceAuthorizationEndpoint,
      revocation: server.revocationEndpoint,
      token: server.tokenEndpoint,
    }))
    return metadata
  }

  /** Returns whether `token` runs the device grant. Default: stdin is a TTY and `CI` is not set. */
  function interactive(): boolean {
    return (
      options.interactive ??
      (env['CI'] === undefined &&
        (globalThis as { process?: { stdin?: { isTTY?: boolean } } }).process?.stdin?.isTTY ===
          true)
    )
  }

  /** Caches the access token of `grant`, and returns it. */
  function use(grant: Grant.Grant): AccessToken {
    cached = {
      expiresAt: grant.expiresAt,
      issuedAt: grant.issuedAt,
      method: 'grant',
      type: 'Bearer',
      value: grant.accessToken,
      ...(grant.scope ? { scope: grant.scope } : {}),
    }
    const { issuedAt: _, ...token } = cached
    return token
  }

  /**
   * Returns the stored grant, refreshed when it expires soon. The refresh runs under the store lock,
   * and reads the grant again inside it, so only one process uses a refresh token.
   */
  async function stored(): Promise<Grant.Grant | undefined> {
    const grant = await store.get(key)
    // A custom store can return a grant of another resource. It is never sent.
    if (!grant || grant.resource !== options.resource) return undefined
    if (!Grant.expiring(grant, { now: Date.now() })) return grant
    if (!grant.refreshToken) return undefined

    return store.lock(key, async () => {
      const current = await store.get(key)
      if (!current) return undefined
      if (!Grant.expiring(current, { now: Date.now() })) return current
      if (!current.refreshToken || !options.clientId) return undefined

      const now = Date.now()
      const result = await OAuth.post({
        body: {
          client_id: options.clientId,
          client_secret: options.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
        },
        fetch,
        url: (await endpoints()).token,
      })

      // RFC 6749 §5.2: `invalid_grant` means the refresh token is expired or revoked.
      if (!result.ok && result.error === 'invalid_grant') {
        await store.delete(key)
        return undefined
      }
      if (!result.ok) throw new RejectedError({ ...result, request: 'refresh' })

      const next = Grant.fromResponse(result.body, {
        clientId: options.clientId,
        issuer,
        now,
        refreshToken: current.refreshToken,
        resource: options.resource,
      })
      await store.set(key, next)
      return next
    })
  }

  async function authorize(waitOptions: DeviceGrant.wait.Options = {}): Promise<Grant.Grant> {
    if (!options.clientId)
      throw new TypeError(
        'Set `clientId` to run the device grant. Use the ID of a client that the server registers for the device grant.',
      )

    const grant = await DeviceGrant.start({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      endpoints: await endpoints(),
      fetch,
      issuer,
      resource: options.resource,
      scope: options.scope,
    })
    ;(options.onDeviceCode ?? printCode)({
      expiresAt: grant.expiresAt,
      userCode: grant.userCode,
      verificationUri: grant.verificationUri,
      ...(grant.verificationUriComplete
        ? { verificationUriComplete: grant.verificationUriComplete }
        : {}),
    })

    const result = await grant.wait(waitOptions)
    await store.set(key, result)
    use(result)
    return result
  }

  /** Exchanges the subject token of `source` for an access token, and caches it. */
  async function exchange(source: Source.Source): Promise<AccessToken> {
    const audience = perSource(options.subjectAudience, source) ?? options.issuer
    if (!audience) throw new TypeError('Set `subjectAudience` or `issuer`.')

    const subject = await Identity.token({ audience, env, fetch, sources: [source] })
    const issued = await Exchange.request({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      endpoint: (await endpoints()).token,
      fetch,
      parameters: perSource(options.parameters, source),
      resource: options.resource,
      scope: options.scope,
      subjectExpiresAt: subject.expiresAt,
      subjectToken: subject.value,
    })

    cached = {
      expiresAt: issued.expiresAt,
      issuedAt: issued.issuedAt,
      method: 'exchange',
      type: 'Bearer',
      value: issued.accessToken,
      ...(issued.scope ? { scope: issued.scope } : {}),
    }
    const { issuedAt: _, ...token } = cached
    return token
  }

  async function token(): Promise<AccessToken> {
    if (cached && !Grant.expiring(cached, { now: Date.now() })) {
      const { issuedAt: _, ...current } = cached
      return current
    }
    if (pending) return pending

    pending = (async () => {
      // A detected source that fails throws, and the client tries no other method.
      const source = sources.find((entry) => entry.detect(env))
      if (source) return exchange(source)

      const grant = await stored()
      if (grant) return use(grant)

      if (interactive()) return use(await authorize())

      throw new AuthorizationRequiredError({ issuer })
    })().finally(() => {
      pending = undefined
    })
    return pending
  }

  return {
    authorize,
    async fetch(input, init) {
      // The request is copied before the first attempt, so a retry can send its body again.
      const request = new Request(input, init)
      const retry = request.clone()

      if (options.resource !== undefined && !within(request.url, options.resource))
        throw new ResourceError({ resource: options.resource, url: request.url })

      const send = async (target: Request) => {
        const access = await token()
        const headers = new Headers(target.headers)
        headers.set('authorization', `${access.type} ${access.value}`)
        // A redirect could carry the token to another resource, so the caller receives it instead.
        return fetch(new Request(target, { headers, redirect: 'manual' }))
      }

      const response = await send(request)
      if (response.status !== 401) return response

      cached = undefined
      return send(retry)
    },
    invalidate() {
      cached = undefined
    },
    async revoke() {
      cached = undefined
      const grant = await store.get(key)
      await store.delete(key)
      if (!grant?.refreshToken) return

      const revocation = (await endpoints()).revocation
      if (!revocation) return

      const result = await OAuth.post({
        body: {
          client_id: grant.clientId,
          client_secret: options.clientSecret,
          token: grant.refreshToken,
          token_type_hint: 'refresh_token',
        },
        fetch,
        url: revocation,
      })

      // A token that the server no longer knows is revoked already. Some servers return 400 for it.
      if (!result.ok && result.status >= 500)
        throw new RejectedError({ ...result, request: 'revoke' })
    },
    async status() {
      const source = sources.find((entry) => entry.detect(env))
      if (source)
        return {
          method: 'exchange',
          source: source.name,
          ...(cached?.method === 'exchange' ? { expiresAt: cached.expiresAt } : {}),
        }

      const grant = await store.get(key)
      if (!grant)
        return {
          checked: sources.map((entry) => entry.name),
          interactive: interactive(),
          method: 'none',
        }

      const subject = Jwt.decode(grant.accessToken)?.payload['sub']
      return {
        expiresAt: grant.expiresAt,
        method: 'grant',
        refreshable: grant.refreshToken !== undefined,
        ...(typeof subject === 'string' ? { subject } : {}),
      }
    },
    token,
  }
}

export declare namespace create {
  type Options = {
    /** OAuth client for the device grant and refresh. Required on a device, such as a laptop. */
    clientId?: string | undefined
    /** Client secret, for servers that require one, such as Google. */
    clientSecret?: string | undefined
    /** Explicit endpoints, for servers without metadata. */
    endpoints?: Metadata.Endpoints | undefined
    /** Environment of the running code. Default: `process.env`. */
    env?: Source.Env | undefined
    /** Used for every request. Default: `globalThis.fetch`. */
    fetch?: typeof globalThis.fetch | undefined
    /** Runs `authorize` when no stored grant applies. Default: `true` when stdin is a TTY and `CI` is not set. */
    interactive?: boolean | undefined
    /** The authorization server. Required unless `endpoints` is set. */
    issuer?: string | undefined
    /** Receives the user code during `authorize`. Default: prints it to stderr. */
    onDeviceCode?: ((code: DeviceGrant.Code) => void) | undefined
    /** Extra fields of the token exchange, such as OpenRouter's `federation_policy_id`. */
    parameters?: PerSource<Readonly<Record<string, string>>> | undefined
    /** RFC 8707 resource of the access token. */
    resource?: string | undefined
    /** Space-separated scopes. */
    scope?: string | undefined
    /** Sources of subject tokens, in priority order. Default: `Source.defaults`. */
    sources?: readonly Source.Source[] | undefined
    /** Where grants persist. Default: `Store.memory()`. */
    store?: Store.Store | undefined
    /** `aud` of the subject token. Default: `issuer`. */
    subjectAudience?: PerSource<string> | undefined
  }
}

/**
 * Reads the RFC 9728 metadata of an API, then returns a client for the first authorization server
 * that it names, with the API as the RFC 8707 resource.
 *
 * With `url`, it sends one `GET` without credentials and reads `resource_metadata` from the challenge
 * (RFC 9728 §5). The URL must lie within the resource of the metadata, so an API cannot direct
 * tokens to another resource.
 */
export async function discover(options: discover.Options): Promise<Client> {
  const fetch = options.fetch ?? globalThis.fetch

  const metadata = await (async () => {
    if (options.resource !== undefined)
      return Metadata.protectedResource({ fetch, resource: options.resource })

    const response = await fetch(options.url, { method: 'GET' })
    await response.body?.cancel()
    const url = Metadata.challenge(response)?.resourceMetadata
    if (!url) throw new DiscoveryError({ url: options.url })

    const found = await Metadata.protectedResource({ fetch, url })
    if (!within(options.url, found.resource)) throw new DiscoveryError({ url: options.url })
    return found
  })()

  const issuer = metadata.authorizationServers[0]
  if (!issuer) throw new DiscoveryError({ url: options.resource ?? options.url })

  const { resource: _, url: __, ...rest } = options
  return create({ ...rest, fetch, issuer, resource: metadata.resource })
}

export declare namespace discover {
  type Options = Omit<create.Options, 'endpoints' | 'issuer' | 'resource'> &
    (
      | {
          /** The resource identifier of the API, such as `https://api.example.com`. */
          resource: string
          url?: undefined
        }
      | {
          resource?: undefined
          /** A URL of the API. Its challenge names the metadata. */
          url: string
        }
    )
  type ErrorType = DiscoveryError | Metadata.ResourceNotFoundError
}

/** Thrown when an API names no authorization server, or names metadata of another resource. */
export class DiscoveryError extends Errors.BaseError {
  override name = 'Client.DiscoveryError'

  /** The URL or resource of the API. */
  readonly url: string

  constructor(options: { url: string }) {
    super(`The API at ${options.url} names no authorization server for itself.`, {
      steps: [
        'Check that the API returns `WWW-Authenticate: Bearer resource_metadata=…` without a token (RFC 9728).',
        'Or set `issuer` in a profile for the API.',
      ],
    })
    this.url = options.url
  }
}

/**
 * A value, or a function of the detected source, such as the per-provider `audience` of Google STS.
 * A function returns `undefined` for a source that takes the default.
 */
export type PerSource<value> = value | ((source: Source.Source) => value | undefined)

/** Thrown when the token or revocation endpoint rejects a request with an RFC 6749 §5.2 error. */
export class RejectedError extends Errors.BaseError {
  override name = 'Client.RejectedError'

  /** RFC 6749 `error`. */
  readonly error: string
  /** RFC 6749 `error_description`. */
  readonly errorDescription: string | undefined
  /** HTTP status of the response. */
  readonly status: number

  constructor(options: {
    error: string
    errorDescription: string | undefined
    request: 'refresh' | 'revoke'
    status: number
  }) {
    super(
      options.errorDescription
        ? `The server rejected the request: ${options.error} (${options.errorDescription}).`
        : `The server rejected the request: ${options.error}.`,
      { steps: Errors.oauth(options.error, options.request) },
    )
    this.error = options.error
    this.errorDescription = options.errorDescription
    this.status = options.status
  }
}

/** Thrown when `fetch` receives a URL outside the `resource` of the client. */
export class ResourceError extends Errors.BaseError {
  override name = 'Client.ResourceError'

  /** The resource of the client. */
  readonly resource: string
  /** The URL of the request. */
  readonly url: string

  constructor(options: { resource: string; url: string }) {
    super(`The URL ${options.url} is outside the resource ${options.resource}.`, {
      steps: [
        'Send the request to a URL at or below the resource, which the access token is for.',
        'For another API, create a client with that API as its `resource`.',
      ],
    })
    this.resource = options.resource
    this.url = options.url
  }
}

/** The method that applies for a client. */
export type Status =
  | {
      /** When the cached access token expires, when one is cached. */
      expiresAt?: number | undefined
      method: 'exchange'
      /** Name of the detected source. */
      source: string
    }
  | {
      /** When the access token expires, in milliseconds since the epoch. */
      expiresAt: number
      method: 'grant'
      /** Whether the grant has a refresh token. */
      refreshable: boolean
      /** `sub` of the access token, when it is a JWT. */
      subject?: string | undefined
    }
  | {
      /** Names of the sources that were checked. */
      checked: readonly string[]
      /** Whether the client runs the device grant when a token is requested. */
      interactive: boolean
      method: 'none'
    }

/** Returns the value of a `PerSource` option for `source`. */
function perSource<value>(
  option: PerSource<value> | undefined,
  source: Source.Source,
): value | undefined {
  return typeof option === 'function'
    ? (option as (source: Source.Source) => value | undefined)(source)
    : option
}

/** Prints the user code and the verification page to stderr. */
function printCode(code: DeviceGrant.Code): void {
  console.error(
    `Open ${code.verificationUriComplete ?? code.verificationUri} and confirm ${code.userCode}.`,
  )
}

/** Returns `process.env` where the runtime has one, else an empty environment. */
function processEnv(): Source.Env {
  return (globalThis as { process?: { env?: Source.Env } }).process?.env ?? {}
}

/** Returns whether `url` has the origin of `resource`, and a path at or below its path. */
function within(url: string, resource: string): boolean {
  const target = new URL(url)
  const base = new URL(resource)
  if (target.origin !== base.origin) return false

  const path = base.pathname.replace(/\/$/, '')
  return target.pathname === path || target.pathname.startsWith(`${path}/`)
}

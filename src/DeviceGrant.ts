/** @module The device authorization grant (RFC 8628): sign-in for a program without a browser of its own. */
import * as Grant from './Grant.js'
import * as OAuth from './internal/OAuth.js'
import * as Metadata from './Metadata.js'

/** The user code and the page where the user approves it. */
export type Code = {
  /** When the user code expires, in milliseconds since the epoch. */
  expiresAt: number
  /** The code that the user confirms on the verification page. */
  userCode: string
  /** The verification page. */
  verificationUri: string
  /** The verification page with the user code filled in, when the server returns one. */
  verificationUriComplete?: string | undefined
}

/** Thrown when the user denies the code. */
export class DeniedError extends Error {
  override name = 'DeviceGrant.DeniedError'

  constructor() {
    super('The user denied the device code.')
  }
}

/** A started device grant. */
export type DeviceGrant = Code & {
  /**
   * Polls the token endpoint at the interval of the server, and slows down when the server sends
   * `slow_down`. Resolves with the grant after approval.
   */
  wait: (options?: wait.Options) => Promise<Grant.Grant>
}

export declare namespace wait {
  type Options = {
    /** Stops polling. */
    signal?: AbortSignal | undefined
  }
}

/** Thrown when the code expires before the user approves it. */
export class ExpiredError extends Error {
  override name = 'DeviceGrant.ExpiredError'

  constructor() {
    super('The device code expired before approval.')
  }
}

/** Thrown when the server rejects a request with an RFC 6749 §5.2 error other than a pending state. */
export class RejectedError extends Error {
  override name = 'DeviceGrant.RejectedError'

  /** RFC 6749 `error`. */
  readonly error: string
  /** RFC 6749 `error_description`. */
  readonly errorDescription: string | undefined
  /** HTTP status of the response. */
  readonly status: number

  constructor(options: RejectedError.Options) {
    super(
      options.errorDescription
        ? `The server rejected the device grant: ${options.error} (${options.errorDescription}).`
        : `The server rejected the device grant: ${options.error}.`,
    )
    this.error = options.error
    this.errorDescription = options.errorDescription
    this.status = options.status
  }
}

export declare namespace RejectedError {
  type Options = {
    error: string
    errorDescription: string | undefined
    status: number
  }
}

/** Requests a device code (RFC 8628 §3.1), and returns the user code and a `wait` function. */
export async function start(options: start.Options): Promise<DeviceGrant> {
  const fetch = options.fetch ?? globalThis.fetch
  const endpoints = await resolve(options, fetch)

  const result = await OAuth.post({
    body: {
      client_id: options.clientId,
      client_secret: options.clientSecret,
      resource: options.resource,
      scope: options.scope,
    },
    fetch,
    url: endpoints.deviceAuthorization,
  })
  if (!result.ok) throw new RejectedError(result)

  const body = result.body
  const deviceCode = body['device_code']
  const userCode = body['user_code']
  const verificationUri = body['verification_uri']
  const expiresIn = body['expires_in']
  if (
    typeof deviceCode !== 'string' ||
    typeof userCode !== 'string' ||
    typeof verificationUri !== 'string' ||
    typeof expiresIn !== 'number'
  )
    throw new RejectedError({
      error: 'invalid_response',
      errorDescription: 'The device authorization response is incomplete.',
      status: 200,
    })

  const expiresAt = Date.now() + expiresIn * 1000
  const verificationUriComplete =
    typeof body['verification_uri_complete'] === 'string'
      ? body['verification_uri_complete']
      : undefined

  return {
    expiresAt,
    userCode,
    verificationUri,
    ...(verificationUriComplete ? { verificationUriComplete } : {}),
    async wait(waitOptions = {}) {
      // RFC 8628 §3.5: a missing interval means 5 seconds, and `slow_down` adds 5 seconds.
      let interval = (typeof body['interval'] === 'number' ? body['interval'] : 5) * 1000

      while (true) {
        await sleep(interval, waitOptions.signal)
        if (Date.now() >= expiresAt) throw new ExpiredError()

        const now = Date.now()
        const poll = await OAuth.post({
          body: {
            client_id: options.clientId,
            client_secret: options.clientSecret,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          },
          fetch,
          url: endpoints.token,
        })

        if (poll.ok)
          return Grant.fromResponse(poll.body, {
            clientId: options.clientId,
            issuer: endpoints.issuer,
            now,
          })
        if (poll.error === 'authorization_pending') continue
        if (poll.error === 'slow_down') {
          interval += 5000
          continue
        }
        if (poll.error === 'access_denied') throw new DeniedError()
        if (poll.error === 'expired_token') throw new ExpiredError()
        throw new RejectedError(poll)
      }
    },
  }
}

export declare namespace start {
  type Options = {
    /** The OAuth client. */
    clientId: string
    /** Client secret, for servers that require one on the device grant, such as Google. */
    clientSecret?: string | undefined
    /** Explicit endpoints, for servers without metadata. */
    endpoints?: Metadata.Endpoints | undefined
    /** Default: `globalThis.fetch`. */
    fetch?: typeof globalThis.fetch | undefined
    /** The authorization server. Required unless `endpoints` is set. */
    issuer?: string | undefined
    /** RFC 8707 resource of the access token. */
    resource?: string | undefined
    /** Space-separated scopes. */
    scope?: string | undefined
  }
  type ErrorType = Metadata.NotFoundError | RejectedError | UnsupportedError
}

/** Thrown when the server has no device authorization endpoint. */
export class UnsupportedError extends Error {
  override name = 'DeviceGrant.UnsupportedError'

  constructor() {
    super('The server has no device authorization endpoint.')
  }
}

/** Returns the endpoints of the grant from `options.endpoints`, else from the metadata of the issuer. */
async function resolve(
  options: start.Options,
  fetch: typeof globalThis.fetch,
): Promise<{ deviceAuthorization: string; issuer: string; token: string }> {
  if (options.endpoints) {
    if (!options.endpoints.deviceAuthorization) throw new UnsupportedError()
    return {
      deviceAuthorization: options.endpoints.deviceAuthorization,
      issuer: options.issuer ?? options.endpoints.token,
      token: options.endpoints.token,
    }
  }

  if (!options.issuer) throw new TypeError('Set `issuer` or `endpoints`.')
  const metadata = await Metadata.authorizationServer({ fetch, issuer: options.issuer })
  if (!metadata.deviceAuthorizationEndpoint) throw new UnsupportedError()
  return {
    deviceAuthorization: metadata.deviceAuthorizationEndpoint,
    issuer: metadata.issuer,
    token: metadata.tokenEndpoint,
  }
}

/** Resolves after `ms`, or rejects with the reason of `signal`. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)

    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

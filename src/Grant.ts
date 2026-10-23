/** @module An authorization grant: the access token and refresh token that a token endpoint issues. */
import * as Errors from './internal/Errors.js'

/**
 * Returns whether a token expires soon enough to replace: when 60 seconds or 20% of its lifetime
 * remain, whichever is more.
 */
export function expiring(
  token: Pick<Grant, 'expiresAt' | 'issuedAt'>,
  options: expiring.Options,
): boolean {
  const margin = Math.max(60_000, (token.expiresAt - token.issuedAt) * 0.2)
  return token.expiresAt - options.now <= margin
}

export declare namespace expiring {
  type Options = {
    /** The current time, in milliseconds since the epoch. */
    now: number
  }
}

/** Returns `grant` unchanged, typed as a grant. */
export function from(grant: Grant): Grant {
  return grant
}

/**
 * Returns the grant of an RFC 6749 §5.1 token response. A response without a new `refresh_token`
 * keeps `options.refreshToken`.
 */
export function fromResponse(
  body: Readonly<Record<string, unknown>>,
  options: fromResponse.Options,
): Grant {
  const accessToken = body['access_token']
  const expiresIn = body['expires_in']
  if (typeof accessToken !== 'string' || typeof expiresIn !== 'number')
    throw new InvalidResponseError()

  const refreshToken =
    typeof body['refresh_token'] === 'string' ? body['refresh_token'] : options.refreshToken
  const scope = typeof body['scope'] === 'string' ? body['scope'] : undefined

  return {
    accessToken,
    clientId: options.clientId,
    expiresAt: options.now + expiresIn * 1000,
    issuedAt: options.now,
    issuer: options.issuer,
    ...(refreshToken ? { refreshToken } : {}),
    ...(scope ? { scope } : {}),
  }
}

export declare namespace fromResponse {
  type Options = {
    clientId: string
    issuer: string
    /** The time of the request, in milliseconds since the epoch. */
    now: number
    /** The refresh token of the grant that a refresh replaces. */
    refreshToken?: string | undefined
  }
}

/** A stored authorization grant. */
export type Grant = {
  /** The access token. */
  accessToken: string
  /** The client that the grant belongs to. */
  clientId: string
  /** When the access token expires, in milliseconds since the epoch. */
  expiresAt: number
  /** When the access token was issued, in milliseconds since the epoch. */
  issuedAt: number
  /** The issuer, or the token endpoint for a server without metadata. */
  issuer: string
  /** The refresh token. Absent when the server issues none. */
  refreshToken?: string | undefined
  /** Space-separated scopes of the access token. */
  scope?: string | undefined
}

/** Thrown when a token response is not a valid RFC 6749 §5.1 response. */
export class InvalidResponseError extends Errors.BaseError {
  override name = 'Grant.InvalidResponseError'

  constructor() {
    super('The token response has no `access_token` or `expires_in`.', {
      steps: [
        'Check that the token endpoint returns an RFC 6749 §5.1 response with `expires_in`.',
        'For a GitHub App, turn on the expiration of user tokens.',
      ],
    })
  }
}

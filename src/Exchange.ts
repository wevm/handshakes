/** @module The token exchange (RFC 8693): trades a subject token for an access token at a token endpoint. */
import * as Errors from './internal/Errors.js'
import * as OAuth from './internal/OAuth.js'

/** An access token that a token exchange issued. */
export type Issued = {
  /** The access token. */
  accessToken: string
  /** When the access token expires, in milliseconds since the epoch. */
  expiresAt: number
  /** When the access token was issued, in milliseconds since the epoch. */
  issuedAt: number
  /** `issued_token_type` of the response. */
  issuedTokenType: string
  /** Space-separated scopes, when the server returns them. */
  scope?: string | undefined
}

/** Thrown when the token endpoint rejects the exchange with an RFC 6749 §5.2 error. */
export class RejectedError extends Errors.BaseError {
  override name = 'Exchange.RejectedError'

  /** RFC 6749 `error`, such as `invalid_grant`. */
  readonly error: string
  /** RFC 6749 `error_description`. */
  readonly errorDescription: string | undefined
  /** HTTP status of the response. */
  readonly status: number

  constructor(options: { error: string; errorDescription: string | undefined; status: number }) {
    super(
      options.errorDescription
        ? `The server rejected the token exchange: ${options.error} (${options.errorDescription}).`
        : `The server rejected the token exchange: ${options.error}.`,
      { steps: Errors.oauth(options.error, 'exchange') },
    )
    this.error = options.error
    this.errorDescription = options.errorDescription
    this.status = options.status
  }
}

/**
 * Exchanges a subject token for an access token (RFC 8693 §2.1). A response without `expires_in`
 * expires with the subject token.
 */
export async function request(options: request.Options): Promise<Issued> {
  const now = Date.now()
  const result = await OAuth.post({
    // Extra parameters come before the fields of the grant, so they cannot replace them.
    body: {
      audience: options.audience,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      requested_token_type:
        options.requestedTokenType ?? 'urn:ietf:params:oauth:token-type:access_token',
      resource: options.resource,
      scope: options.scope,
      ...options.parameters,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: options.subjectToken,
      subject_token_type: options.subjectTokenType ?? 'urn:ietf:params:oauth:token-type:jwt',
    },
    fetch: options.fetch ?? globalThis.fetch,
    url: options.endpoint,
  })
  if (!result.ok) throw new RejectedError(result)

  const body = result.body
  const accessToken = body['access_token']
  if (typeof accessToken !== 'string')
    throw new RejectedError({
      error: 'invalid_response',
      errorDescription: 'The response has no access_token.',
      status: 200,
    })

  const expiresIn = body['expires_in']
  const expiresAt = Math.min(
    typeof expiresIn === 'number' ? now + expiresIn * 1000 : Number.POSITIVE_INFINITY,
    options.subjectExpiresAt ?? Number.POSITIVE_INFINITY,
  )
  if (!Number.isFinite(expiresAt))
    throw new RejectedError({
      error: 'invalid_response',
      errorDescription: 'The response has no expires_in.',
      status: 200,
    })

  const scope = typeof body['scope'] === 'string' && body['scope'] ? body['scope'] : undefined
  return {
    accessToken,
    expiresAt,
    issuedAt: now,
    issuedTokenType:
      typeof body['issued_token_type'] === 'string'
        ? body['issued_token_type']
        : 'urn:ietf:params:oauth:token-type:access_token',
    ...(scope ? { scope } : {}),
  }
}

export declare namespace request {
  type Options = {
    /** RFC 8693 `audience` field, such as the provider name of Google STS. */
    audience?: string | undefined
    clientId?: string | undefined
    clientSecret?: string | undefined
    /** The token endpoint. */
    endpoint: string
    /** Default: `globalThis.fetch`. */
    fetch?: typeof globalThis.fetch | undefined
    /** Extra fields, such as OpenRouter's `federation_policy_id`. */
    parameters?: Readonly<Record<string, string>> | undefined
    /** Default: `urn:ietf:params:oauth:token-type:access_token`. */
    requestedTokenType?: string | undefined
    /** RFC 8707 resource. */
    resource?: string | undefined
    /** Space-separated scopes. */
    scope?: string | undefined
    /** When the subject token expires. The access token is cached no longer. */
    subjectExpiresAt?: number | undefined
    /** The subject token. */
    subjectToken: string
    /** Default: `urn:ietf:params:oauth:token-type:jwt`. */
    subjectTokenType?: string | undefined
  }
  type ErrorType = RejectedError
}

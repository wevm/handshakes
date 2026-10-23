/** @module The base of the errors that Handshakes throws: what failed, then the steps that resolve it. */

/**
 * An error whose message states what failed, then the steps that resolve it. `details` and
 * `steps` hold the two parts, so a CLI or an agent can render them separately.
 */
export class BaseError extends Error {
  /** What failed, without the steps. */
  readonly details: string
  /** The steps that resolve the error, in order. Empty when no step applies. */
  readonly steps: readonly string[]

  constructor(details: string, options: BaseError.Options = {}) {
    super(format(details, options.steps ?? []), { cause: options.cause })
    this.details = details
    this.steps = options.steps ?? []
  }
}

export declare namespace BaseError {
  type Options = {
    /** The error that caused this one. */
    cause?: unknown
    /** The steps that resolve the error, in order. Each is one imperative sentence. */
    steps?: readonly string[] | undefined
  }
}

/** Returns the message of `error` on one line, for output that cannot hold line breaks. */
export function inline(error: Error): string {
  if (!(error instanceof BaseError) || error.steps.length === 0) return error.message
  if (error.steps.length === 1) return `${error.details} To resolve: ${error.steps[0]}`
  return `${error.details} To resolve: ${error.steps.map((step, index) => `${index + 1}. ${step}`).join(' ')}`
}

/** Returns the steps for an RFC 6749 §5.2 error that the server returned for `request`. */
export function oauth(
  error: string,
  request: 'device' | 'exchange' | 'refresh' | 'revoke',
): readonly string[] {
  if (error === 'invalid_client')
    return [
      'Check that `clientId` names a client that the server registers.',
      'If the server requires a client secret, set `clientSecret`.',
    ]
  if (error === 'invalid_scope')
    return ['Request only scopes that the client, or the trust policy, allows.']
  if (error === 'invalid_target')
    return ['Check `resource`, and that the server allows the client to request it (RFC 8707).']
  if (error === 'unauthorized_client' || error === 'unsupported_grant_type')
    return ['Check that the server supports this grant, and that it registers the client for it.']
  if (error === 'invalid_grant' && request === 'exchange')
    return [
      'Check that a trust policy on the server matches the issuer, audience, and claims of the subject token.',
      'Check that the subject token has not expired.',
    ]
  if (error === 'invalid_grant' && request === 'refresh')
    return ['Run `authorize` (`handshakes authorize` in the CLI) to start a new grant.']
  return ['Read `errorDescription`, and the documentation of the server for this error.']
}

/** Returns the message with its steps: one step after `To resolve:`, or a numbered list. */
function format(details: string, steps: readonly string[]): string {
  if (steps.length === 0) return details
  if (steps.length === 1) return `${details}\n\nTo resolve: ${steps[0]}`
  return `${details}\n\nTo resolve:\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`
}

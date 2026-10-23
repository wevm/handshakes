/**
 * @module The RFC 8693 token endpoint as a fetch handler. It verifies the subject token against trust
 * policies, and the host issues the credential through `issue`.
 */
import * as Jwks from './internal/Jwks.js'
import * as Subject from './internal/Subject.js'
import type * as Policy from './Policy.js'

/** Grant type of the token exchange (RFC 8693 §2.1). */
const grantType = 'urn:ietf:params:oauth:grant-type:token-exchange'

/** Largest token request body, in bytes. A subject token is a few kilobytes. */
const maxBody = 65_536

/** Token type of an issued access token (RFC 8693 §3). */
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token'

/** Returns a token endpoint. Creating it sends no request. */
export function create(options: create.Options): Server {
  const fetch = options.fetch ?? globalThis.fetch
  const jwks = Jwks.create({ fetch })
  const maxLifetime = options.maxLifetime ?? 900

  if (typeof options.policies !== 'function') Subject.check(options.policies)

  const issuer = new URL(options.issuer)
  const path = issuer.pathname.replace(/\/$/, '')
  // RFC 8414 §3.1 inserts the well-known suffix before the path of the issuer.
  const metadataPath = `/.well-known/oauth-authorization-server${path}`
  const tokenPath = `${path}/oauth2/token`

  async function token(request: Request): Promise<Response> {
    const type = request.headers.get('content-type') ?? ''
    if (!type.startsWith('application/x-www-form-urlencoded'))
      return error(400, 'invalid_request', 'The request must be application/x-www-form-urlencoded.')

    const text = await read(request, maxBody)
    if (text === undefined)
      return error(
        400,
        'invalid_request',
        `The request body exceeds ${maxBody} bytes. Send only the token exchange fields.`,
      )
    const form = new URLSearchParams(text)
    if (form.get('grant_type') !== grantType)
      return error(400, 'unsupported_grant_type', `grant_type must be ${grantType}.`)

    const requested = form.get('requested_token_type')
    if (requested && requested !== accessTokenType)
      return error(400, 'invalid_request', `requested_token_type must be ${accessTokenType}.`)

    const policies =
      typeof options.policies === 'function' ? await options.policies(request) : options.policies
    const result = await Subject.verify({
      jwks,
      maxLifetime,
      policies,
      // RFC 8693 §2.1: `resource` and `audience` both name where the client uses the token.
      resources: [...form.getAll('resource'), ...form.getAll('audience')],
      scope: form.get('scope') ?? undefined,
      subjectToken: form.get('subject_token') ?? undefined,
      subjectTokenType: form.get('subject_token_type') ?? undefined,
    })
    if (!result.ok) return error(400, result.error, result.errorDescription)

    const issued = await options.issue({
      claims: result.claims,
      expiresAt: result.expiresAt,
      policy: result.policy,
      request,
      resources: result.resources,
      scopes: result.scopes,
    })
    // The credential must not outlive the subject token. A later expiry is a defect of `issue`.
    if (issued.expiresAt > result.expiresAt)
      throw new Error(
        '`issue` returned a credential that expires after `expiresAt`. Return an `expiresAt` of at most `IssueContext.expiresAt`.',
      )

    return Response.json(
      {
        access_token: issued.accessToken,
        expires_in: Math.max(0, Math.floor((issued.expiresAt - Date.now()) / 1000)),
        issued_token_type: accessTokenType,
        scope: (issued.scopes ?? result.scopes).join(' '),
        token_type: 'Bearer',
      },
      { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
    )
  }

  return {
    async fetch(request) {
      const url = new URL(request.url)

      if (request.method === 'GET' && url.pathname === metadataPath)
        return Response.json({
          grant_types_supported: [grantType],
          issuer: options.issuer,
          token_endpoint: `${issuer.origin}${tokenPath}`,
          token_endpoint_auth_methods_supported: ['none'],
        })

      if (request.method === 'POST' && url.pathname === tokenPath) {
        try {
          return await token(request)
        } catch {
          // Errors of `issue` or of a key request never reach the client in detail.
          return error(500, 'server_error', 'The token exchange failed.')
        }
      }

      return error(404, 'invalid_request', 'Not found.')
    },
  }
}

export declare namespace create {
  type Options = {
    /** Default: `globalThis.fetch`, for requests to the keys of issuers. */
    fetch?: typeof globalThis.fetch | undefined
    /** Mints the credential that the response returns. */
    issue: (context: IssueContext) => Promise<Issued>
    /** The issuer of the metadata. The token endpoint is `<issuer>/oauth2/token`. */
    issuer: string
    /** Longest lifetime of an issued credential, in seconds, when the policy sets none. Default: 900. */
    maxLifetime?: number | undefined
    /** Trust policies, or a function that loads them for a request, such as from a database. */
    policies: readonly Policy.Policy[] | ((request: Request) => Promise<readonly Policy.Policy[]>)
  }
}

/** Inputs of `issue`. */
export type IssueContext = {
  /** Verified claims of the subject token. */
  claims: Readonly<Record<string, unknown>>
  /**
   * The latest expiry of the credential, in milliseconds since the epoch: the subject token's
   * `exp`, capped by the lifetime of the policy.
   */
  expiresAt: number
  /** The matched policy. */
  policy: Policy.Policy
  /** The token request. */
  request: Request
  /** RFC 8707 resources that the request names, each a resource of the policy. Empty when it names none. */
  resources: readonly string[]
  /** Scopes of the credential: the requested scopes, else the scopes of the policy. */
  scopes: readonly string[]
}

/** The credential that `issue` returns. */
export type Issued = {
  /** The credential, such as an API key. */
  accessToken: string
  /** When the credential expires, in milliseconds since the epoch. At most `IssueContext.expiresAt`. */
  expiresAt: number
  /** Scopes of the credential. Default: `IssueContext.scopes`. */
  scopes?: readonly string[] | undefined
}

/** A token endpoint. */
export type Server = {
  /** Serves the token endpoint and the metadata. Other paths return `404`. */
  fetch: (request: Request) => Promise<Response>
}

/** Returns an RFC 6749 §5.2 error response. */
function error(status: number, code: string, description: string): Response {
  return Response.json(
    { error: code, error_description: description },
    { headers: { 'cache-control': 'no-store' }, status },
  )
}

/** Returns the body of `request` as text, or `undefined` when it exceeds `limit` bytes. */
async function read(request: Request, limit: number): Promise<string | undefined> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return undefined
  if (!request.body) return ''

  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

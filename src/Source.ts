/** @module Sources of subject tokens: the platforms that sign an OIDC token for the running code. */
import * as Jwt from './internal/Jwt.js'

/** Thrown when a detected source cannot return a token. `hint` states the fix. */
export class RequestError extends Error {
  override name = 'Source.RequestError'

  /** The change that makes the source work, such as a missing permission. */
  readonly hint: string | undefined
  /** Name of the source, such as `githubActions`. */
  readonly source: string

  constructor(options: RequestError.Options) {
    super(options.hint ? `${options.message} ${options.hint}` : options.message, {
      cause: options.cause,
    })
    this.hint = options.hint
    this.source = options.source
  }
}

export declare namespace RequestError {
  type Options = {
    /** The error of the request that failed, if any. */
    cause?: unknown
    /** The change that makes the source work. */
    hint?: string | undefined
    /** What failed. Never contains a token value. */
    message: string
    /** Name of the source. */
    source: string
  }
}

/** Inputs of `Source.token`. */
export type Context = {
  /** `aud` that the token must carry. */
  audience: string
  /** Environment of the running code. */
  env: Env
  /** Sends the requests of the source. */
  fetch: typeof globalThis.fetch
}

/** Environment variables, such as `process.env`. */
export type Env = Readonly<Record<string, string | undefined>>

/** A platform that signs an OIDC token for the running code. */
export type Source = {
  /** Returns whether the code runs on this platform. Reads environment variables only, with no I/O. */
  detect: (env: Env) => boolean
  /** Name in `Token.source`, `status`, and errors, such as `githubActions`. */
  name: string
  /** Returns a JWT for `context.audience`. Throws `Source.RequestError`. */
  token: (context: Context) => Promise<string>
}

/** Returns `source` unchanged, typed as a source. */
export function from(source: Source): Source {
  return source
}

/**
 * Google Cloud. Requests an identity token from the metadata server, for any audience.
 * Detects Cloud Run and Cloud Functions through `K_SERVICE`. Compute Engine and GKE set no
 * variable, so list `Source.gcp()` explicitly there.
 */
export function gcp(options: gcp.Options = {}): Source {
  const name = 'gcp'

  return {
    detect: (env) => env['K_SERVICE'] !== undefined,
    name,
    async token(context) {
      const host =
        options.metadataHost ?? context.env['GCE_METADATA_HOST'] ?? 'metadata.google.internal'
      const url = new URL(
        `http://${host}/computeMetadata/v1/instance/service-accounts/default/identity`,
      )
      url.searchParams.set('audience', context.audience)
      url.searchParams.set('format', 'full')

      const response = await request(context, name, url, {
        headers: { 'metadata-flavor': 'Google' },
      })
      return (await response.text()).trim()
    },
  }
}

export declare namespace gcp {
  type Options = {
    /** Host of the metadata server. Default: `GCE_METADATA_HOST`, else `metadata.google.internal`. */
    metadataHost?: string | undefined
  }
}

/** GitHub Actions. Requests a token from the runner for any audience. Needs `permissions: id-token: write`. */
export function githubActions(): Source {
  const name = 'githubActions'

  return {
    detect: (env) => env['GITHUB_ACTIONS'] === 'true',
    name,
    async token(context) {
      const url = context.env['ACTIONS_ID_TOKEN_REQUEST_URL']
      const requestToken = context.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
      if (!url || !requestToken)
        throw new RequestError({
          hint: 'Add `permissions: id-token: write` to the job.',
          message: 'ACTIONS_ID_TOKEN_REQUEST_URL is not set.',
          source: name,
        })

      const target = new URL(url)
      target.searchParams.set('audience', context.audience)

      const response = await request(context, name, target, {
        headers: { authorization: `Bearer ${requestToken}` },
      })
      const body = (await response.json()) as { value?: unknown }
      if (typeof body.value !== 'string')
        throw new RequestError({ message: 'The token response has no `value`.', source: name })
      return body.value
    },
  }
}

/**
 * GitLab CI. Reads the token that `id_tokens` in `.gitlab-ci.yml` declares. The audience is fixed
 * in that file, so the token must already carry the requested audience.
 */
export function gitlab(options: gitlab.Options = {}): Source {
  const name = 'gitlab'

  return {
    detect: (env) => env['GITLAB_CI'] === 'true',
    name,
    async token(context) {
      const variable = options.variable ?? gitlabVariable(context.audience)
      const value = context.env[variable]
      if (!value)
        throw new RequestError({
          hint: `Declare \`${variable}\` under \`id_tokens\` in .gitlab-ci.yml, with \`aud: ${context.audience}\`.`,
          message: `${variable} is not set.`,
          source: name,
        })
      return value
    },
  }
}

export declare namespace gitlab {
  type Options = {
    /** Variable that holds the token. Default: `<AUD>_ID_TOKEN`, the convention of Python `id`. */
    variable?: string | undefined
  }
}

/**
 * Vercel. Reads the token of the current request in Vercel Functions, else `VERCEL_OIDC_TOKEN`.
 * A token for another audience is exchanged at Vercel for one with the requested `aud`.
 */
export function vercel(options: vercel.Options = {}): Source {
  const name = 'vercel'

  return {
    detect: (env) =>
      env['VERCEL'] === '1' ||
      env['VERCEL_OIDC_TOKEN'] !== undefined ||
      vercelRequestToken() !== undefined,
    name,
    async token(context) {
      const current = vercelRequestToken() ?? context.env['VERCEL_OIDC_TOKEN']
      if (!current)
        throw new RequestError({
          hint: 'Call it inside a request on Vercel Functions, or run `vercel env pull` for local development.',
          message: 'No Vercel OIDC token is available.',
          source: name,
        })

      const decoded = Jwt.decode(current)
      if (decoded && Jwt.audiences(decoded.payload).includes(context.audience)) return current

      const response = await request(
        context,
        name,
        new URL(options.exchangeUrl ?? 'https://oidc.vercel.com/~token'),
        {
          body: JSON.stringify({ aud: context.audience, token: current }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      const body = (await response.json()) as { token?: unknown }
      if (typeof body.token !== 'string')
        throw new RequestError({ message: 'The exchange response has no `token`.', source: name })
      return body.token
    },
  }
}

export declare namespace vercel {
  type Options = {
    /** Endpoint that exchanges a token for another audience. Default: `https://oidc.vercel.com/~token`. */
    exchangeUrl?: string | undefined
  }
}

/** The default sources, in priority order. The order is observable: the first detected source wins. */
export const defaults: readonly Source[] = [vercel(), githubActions(), gitlab(), gcp()]

/** Returns the GitLab variable name for an audience: uppercase, with `_` for other characters. */
function gitlabVariable(audience: string): string {
  const name = audience
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/^[0-9]/, '_')
  return `${name}_ID_TOKEN`
}

/** Sends a request for a source, and throws `Source.RequestError` for a failure or an error status. */
async function request(
  context: Context,
  source: string,
  url: URL,
  init: RequestInit,
): Promise<Response> {
  const response = await (async () => {
    try {
      return await context.fetch(url, init)
    } catch (cause) {
      throw new RequestError({ cause, message: `The request to ${url.origin} failed.`, source })
    }
  })()

  if (!response.ok)
    throw new RequestError({
      message: `The request to ${url.origin} returned HTTP ${response.status}.`,
      source,
    })
  return response
}

/** Returns the OIDC token of the current request in Vercel Functions, if any. */
function vercelRequestToken(): string | undefined {
  type Context = { get?: () => { headers?: Record<string, string | undefined> } | undefined }
  const context = (globalThis as Record<symbol, Context | undefined>)[
    Symbol.for('@vercel/request-context')
  ]
  return context?.get?.()?.headers?.['x-vercel-oidc-token']
}

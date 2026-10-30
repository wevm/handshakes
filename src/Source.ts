/** @module Sources of subject tokens: the platforms that sign an OIDC token for the running code. */
import * as Errors from './internal/Errors.js'
import * as Jwt from './internal/Jwt.js'

/** Thrown when a detected source cannot return a token. `steps` states the fix. */
export class RequestError extends Errors.BaseError {
  override name = 'Source.RequestError'

  /** Name of the source, such as `githubActions`. */
  readonly source: string

  constructor(options: RequestError.Options) {
    super(options.message, { cause: options.cause, steps: options.steps })
    this.source = options.source
  }
}

export declare namespace RequestError {
  type Options = {
    /** The error of the request that failed, if any. */
    cause?: unknown
    /** The steps that make the source work, such as a missing permission. */
    steps: readonly string[]
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

/**
 * Azure managed identity. On App Service, Functions, and Container Apps, requests a token from
 * `IDENTITY_ENDPOINT`. Elsewhere, such as a virtual machine, requests one from the instance
 * metadata service (IMDS). The audience is the `resource` of the request.
 */
export function azure(options: azure.Options = {}): Source {
  const name = 'azure'

  return {
    detect: (env) =>
      options.detect === 'always' ||
      (env['IDENTITY_ENDPOINT'] !== undefined && env['IDENTITY_HEADER'] !== undefined),
    name,
    async token(context) {
      const endpoint = context.env['IDENTITY_ENDPOINT']
      const header = context.env['IDENTITY_HEADER']

      const target = (() => {
        if (endpoint && header)
          return {
            headers: { 'x-identity-header': header },
            url: new URL(endpoint),
            version: '2019-08-01',
          }
        return {
          headers: { metadata: 'true' },
          url: new URL(
            `http://${options.metadataHost ?? '169.254.169.254'}/metadata/identity/oauth2/token`,
          ),
          version: '2018-02-01',
        }
      })()
      target.url.searchParams.set('api-version', target.version)
      target.url.searchParams.set('resource', context.audience)
      if (options.clientId) target.url.searchParams.set('client_id', options.clientId)

      const response = await request(context, name, target.url, { headers: target.headers })
      const body = (await response.json()) as { access_token?: unknown }
      if (typeof body.access_token !== 'string')
        throw new RequestError({
          message: 'The token response has no `access_token`.',
          source: name,
          steps: ['Check that a managed identity is assigned to the resource, then run it again.'],
        })
      return body.access_token
    },
  }
}

export declare namespace azure {
  type Options = {
    /** Client ID of a user-assigned managed identity. Default: the system-assigned identity. */
    clientId?: string | undefined
    /**
     * How the source detects Azure. `env` detects `IDENTITY_ENDPOINT` and `IDENTITY_HEADER`. `always`
     * detects on every platform, for virtual machines, which set no variable. A detected source that
     * fails throws, so list an `always` source last. `Source.defaults` uses `env`. Default: `env`.
     */
    detect?: 'always' | 'env' | undefined
    /** Host of the instance metadata service. Default: `169.254.169.254`. */
    metadataHost?: string | undefined
  }
}

/**
 * CircleCI. Reads `CIRCLE_OIDC_TOKEN_V2`, whose `aud` is the ID of the CircleCI organization. Another
 * audience needs `circleci run oidc get` in the job, and a token passed through `Source.file`.
 */
export function circleci(): Source {
  const name = 'circleci'

  return {
    detect: (env) => env['CIRCLECI'] === 'true',
    name,
    async token(context) {
      const value = context.env['CIRCLE_OIDC_TOKEN_V2']
      if (!value)
        throw new RequestError({
          steps: ['Check that CircleCI issues OIDC tokens to this job.'],
          message: 'CIRCLE_OIDC_TOKEN_V2 is not set.',
          source: name,
        })
      return value
    },
  }
}

/** Returns `source` unchanged, typed as a source. */
export function from(source: Source): Source {
  return source
}

/**
 * Google Cloud. Requests an identity token from the metadata server, for any audience.
 * Detects Cloud Run and Cloud Functions through `K_SERVICE`. Compute Engine and GKE set no
 * variable, so list `Source.gcp({ detect: 'always' })` last in `sources` there.
 */
export function gcp(options: gcp.Options = {}): Source {
  const name = 'gcp'

  return {
    detect: (env) => options.detect === 'always' || env['K_SERVICE'] !== undefined,
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
    /**
     * How the source detects Google Cloud. `env` detects `K_SERVICE`. `always` detects on every
     * platform, for Compute Engine and GKE. A detected source that fails throws, so list an `always`
     * source last. `Source.defaults` uses `env`. Default: `env`.
     */
    detect?: 'always' | 'env' | undefined
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
          steps: ['Add `permissions: id-token: write` to the job, or to the workflow.'],
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
        throw new RequestError({
          message: 'The token response has no `value`.',
          source: name,
          steps: ['Check that the runner supports OIDC tokens, then run the job again.'],
        })
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
          steps: [
            `Declare \`${variable}\` under \`id_tokens\` in .gitlab-ci.yml, with \`aud: ${context.audience}\`.`,
          ],
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
          steps: [
            'On Vercel Functions, request the token inside a request.',
            'For local development, run `vercel env pull` to write `VERCEL_OIDC_TOKEN`.',
          ],
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
        throw new RequestError({
          message: 'The exchange response has no `token`.',
          source: name,
          steps: ['Check that the project enables OIDC federation in its Vercel settings.'],
        })
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
export const defaults: readonly Source[] = [
  vercel(),
  githubActions(),
  gitlab(),
  circleci(),
  azure(),
  gcp(),
]

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
      throw new RequestError({
        cause,
        message: `The request to ${url.origin} failed.`,
        source,
        steps: ['Check the network access of the job to this host, then run it again.'],
      })
    }
  })()

  if (!response.ok)
    throw new RequestError({
      message: `The request to ${url.origin} returned HTTP ${response.status}.`,
      source,
      steps:
        response.status === 401 || response.status === 403
          ? [
              'Check that the job may request OIDC tokens, such as `permissions: id-token: write` on GitHub Actions.',
            ]
          : ['Run the job again. If the error persists, check the status page of the platform.'],
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

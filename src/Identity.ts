/** @module The subject token of the running code: the OIDC token that its platform signs. */
import * as Errors from './internal/Errors.js'
import * as Jwt from './internal/Jwt.js'
import * as Source from './Source.js'

/** Thrown when the token of a source carries another `aud` than the requested one. */
export class AudienceError extends Errors.BaseError {
  override name = 'Identity.AudienceError'

  /** The requested audience. */
  readonly expected: string
  /** The `aud` values of the token. */
  readonly received: readonly string[]
  /** Name of the source. */
  readonly source: string

  constructor(options: AudienceError.Options) {
    super(
      `The ${options.source} token has aud ${JSON.stringify(options.received)}, not ${JSON.stringify(options.expected)}.`,
      {
        steps: [
          `Configure the platform to issue the token for ${JSON.stringify(options.expected)}, such as \`id_tokens\` in .gitlab-ci.yml.`,
          'Or request the audience that the token carries, through `audience` or `subjectAudience`.',
        ],
      },
    )
    this.expected = options.expected
    this.received = options.received
    this.source = options.source
  }
}

export declare namespace AudienceError {
  type Options = {
    expected: string
    received: readonly string[]
    source: string
  }
}

/** Returns the first source that detects its platform. Reads environment variables only. */
export function detect(options: detect.Options = {}): Source.Source | undefined {
  const env = options.env ?? processEnv()
  return (options.sources ?? Source.defaults).find((source) => source.detect(env))
}

export declare namespace detect {
  type Options = {
    /** Default: `process.env`. */
    env?: Source.Env | undefined
    /** Default: `Source.defaults`. */
    sources?: readonly Source.Source[] | undefined
  }
}

/** Thrown when no source detects its platform. */
export class NotFoundError extends Errors.BaseError {
  override name = 'Identity.NotFoundError'

  /** The requested audience. */
  readonly audience: string
  /** Names of the sources that were checked, in order. */
  readonly checked: readonly string[]

  constructor(options: NotFoundError.Options) {
    super(
      `No source detected its platform for audience ${options.audience}. Checked: ${options.checked.join(', ') || 'none'}.`,
      {
        steps: [
          'Run the code on a platform that issues OIDC tokens, such as GitHub Actions or Vercel.',
          'On another platform, pass a custom source in `sources`, built with `Source.from`.',
        ],
      },
    )
    this.audience = options.audience
    this.checked = options.checked
  }
}

export declare namespace NotFoundError {
  type Options = {
    audience: string
    checked: readonly string[]
  }
}

/**
 * Returns the subject token of the first source that detects its platform. A detected source that
 * fails throws, and the next source is never tried. The token must carry `audience` as `aud`.
 */
export async function token(options: token.Options): Promise<Token> {
  const env = options.env ?? processEnv()
  const sources = options.sources ?? Source.defaults

  const source = sources.find((entry) => entry.detect(env))
  if (!source)
    throw new NotFoundError({
      audience: options.audience,
      checked: sources.map((entry) => entry.name),
    })

  const value = await source.token({
    audience: options.audience,
    env,
    fetch: options.fetch ?? globalThis.fetch,
  })

  const decoded = Jwt.decode(value)
  const exp = decoded?.payload['exp']
  if (!decoded || typeof exp !== 'number')
    throw new Source.RequestError({
      message: 'The source returned a value that is not a JWT with `exp`.',
      source: source.name,
      steps: [
        'Check that the source returns an OIDC token, such as the file that `Source.file` reads.',
      ],
    })

  const received = Jwt.audiences(decoded.payload)
  if (!received.includes(options.audience))
    throw new AudienceError({ expected: options.audience, received, source: source.name })

  return { claims: decoded.payload, expiresAt: exp * 1000, source: source.name, value }
}

export declare namespace token {
  type Options = {
    /** `aud` of the token. Required, so a token for one service never reaches another. */
    audience: string
    /** Default: `process.env`. */
    env?: Source.Env | undefined
    /** Default: `globalThis.fetch`. */
    fetch?: typeof globalThis.fetch | undefined
    /** Sources in priority order. Default: `Source.defaults`. */
    sources?: readonly Source.Source[] | undefined
  }
  type ErrorType = AudienceError | NotFoundError | Source.RequestError
}

/** A subject token and its decoded claims. */
export type Token = {
  /** The claims, not verified. For logs and errors only. */
  claims: Readonly<Record<string, unknown>>
  /** When the token expires, in milliseconds since the epoch. */
  expiresAt: number
  /** Name of the source, such as `githubActions`. */
  source: string
  /** The JWT. */
  value: string
}

/** Returns `process.env` where the runtime has one, else an empty environment. */
function processEnv(): Source.Env {
  return (globalThis as { process?: { env?: Source.Env } }).process?.env ?? {}
}

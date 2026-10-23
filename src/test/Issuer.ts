/**
 * @module A local OIDC issuer for integration tests. It signs real RS256 tokens with the claims of a
 * platform, and serves the endpoints that the platform sources call, so sources run unchanged.
 */
import * as Crypto from 'node:crypto'
import * as Http from 'node:http'

/** A running issuer. */
export type Issuer = {
  /** Stops the server. */
  close: () => Promise<void>
  /** Returns the environment variables that make the source of `preset` request tokens from this issuer. */
  env: (options: env.Options) => Promise<Readonly<Record<string, string>>>
  /** Returns a signed token with the claims of `preset`. */
  sign: (options: sign.Options) => Promise<string>
  /** Origin of the issuer, which is also `iss`. */
  url: string
}

/** Platforms whose claims and endpoints the issuer copies. */
export type Preset = 'circleci' | 'gcp' | 'githubActions' | 'gitlab' | 'vercel'

export declare namespace env {
  type Options = {
    /** `aud` of a token that the environment holds directly (CircleCI, GitLab, Vercel). Default for CircleCI: the organization ID. Default for Vercel: `https://vercel.com/acme`. */
    audience?: string | undefined
    preset: Preset
  }
}

export declare namespace sign {
  type Options = {
    /** `aud` of the token. */
    audience: string
    /** Claims that replace or add to the claims of the preset. */
    claims?: Readonly<Record<string, unknown>> | undefined
    /** Lifetime in seconds. Default: 300. */
    expiresIn?: number | undefined
    preset: Preset
  }
}

/** Starts an issuer on a random port of `127.0.0.1`. */
export async function create(): Promise<Issuer> {
  const keys = (await crypto.subtle.generateKey(
    {
      hash: 'SHA-256',
      modulusLength: 2048,
      name: 'RSASSA-PKCS1-v1_5',
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const kid = Crypto.randomUUID()
  const jwk = {
    ...(await crypto.subtle.exportKey('jwk', keys.publicKey)),
    alg: 'RS256',
    kid,
    use: 'sig',
  }
  const requestToken = Crypto.randomUUID()

  const server = Http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.')
  const host = `127.0.0.1:${address.port}`
  const url = `http://${host}`

  async function sign(options: sign.Options): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', kid, typ: 'JWT' }
    const payload = {
      ...presets[options.preset],
      aud: options.audience,
      exp: now + (options.expiresIn ?? 300),
      iat: now,
      iss: url,
      jti: Crypto.randomUUID(),
      nbf: now,
      ...options.claims,
    }

    const input = `${encode(header)}.${encode(payload)}`
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keys.privateKey,
      new TextEncoder().encode(input),
    )
    return `${input}.${Buffer.from(signature).toString('base64url')}`
  }

  async function verify(token: string): Promise<Record<string, unknown> | undefined> {
    const [header, payload, signature] = token.split('.')
    if (!header || !payload || !signature) return undefined

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      keys.publicKey,
      Buffer.from(signature, 'base64url'),
      new TextEncoder().encode(`${header}.${payload}`),
    )
    if (!valid) return undefined
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  }

  server.on('request', (request, response) => {
    void (async () => {
      const target = new URL(request.url ?? '/', url)
      const audience = target.searchParams.get('audience') ?? ''

      if (target.pathname === '/.well-known/openid-configuration')
        return json(response, 200, { issuer: url, jwks_uri: `${url}/.well-known/jwks` })

      if (target.pathname === '/.well-known/jwks') return json(response, 200, { keys: [jwk] })

      // GitHub's token request endpoint, which `ACTIONS_ID_TOKEN_REQUEST_URL` names.
      if (target.pathname === '/github/token') {
        if (request.headers.authorization !== `Bearer ${requestToken}`)
          return json(response, 401, { message: 'Bad credentials' })
        return json(response, 200, { value: await sign({ audience, preset: 'githubActions' }) })
      }

      // The identity endpoint of the Google Cloud metadata server.
      if (target.pathname === '/computeMetadata/v1/instance/service-accounts/default/identity') {
        if (request.headers['metadata-flavor'] !== 'Google') return text(response, 403, 'Forbidden')
        return text(response, 200, await sign({ audience, preset: 'gcp' }))
      }

      // Vercel's exchange of a token for another audience.
      if (target.pathname === '/vercel/token' && request.method === 'POST') {
        const body = JSON.parse(await read(request)) as { aud?: string; token?: string }
        const claims = body.token ? await verify(body.token) : undefined
        if (!claims || !body.aud) return json(response, 401, { error: 'invalid_token' })
        return json(response, 200, {
          token: await sign({
            audience: body.aud,
            claims: { ...claims, aud: body.aud },
            preset: 'vercel',
          }),
        })
      }

      return json(response, 404, { error: 'not_found' })
    })()
  })

  return {
    // Clients keep connections alive, so `close` ends them instead of waiting for them to idle.
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
    async env(options) {
      if (options.preset === 'circleci')
        return {
          CIRCLECI: 'true',
          CIRCLE_OIDC_TOKEN_V2: await sign({
            audience: options.audience ?? 'b6a6b6f0-0000-4000-8000-000000000000',
            preset: 'circleci',
          }),
        }

      if (options.preset === 'gcp') return { GCE_METADATA_HOST: host, K_SERVICE: 'app' }

      if (options.preset === 'githubActions')
        return {
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken,
          ACTIONS_ID_TOKEN_REQUEST_URL: `${url}/github/token?api-version=2.0`,
          GITHUB_ACTIONS: 'true',
        }

      if (options.preset === 'gitlab') {
        const audience = options.audience ?? url
        const variable = `${audience
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '_')
          .replace(/^[0-9]/, '_')}_ID_TOKEN`
        return { GITLAB_CI: 'true', [variable]: await sign({ audience, preset: 'gitlab' }) }
      }

      return {
        VERCEL: '1',
        VERCEL_OIDC_TOKEN: await sign({
          audience: options.audience ?? 'https://vercel.com/acme',
          preset: 'vercel',
        }),
      }
    },
    sign,
    url,
  }
}

/** Claims of each platform, with fixed sample values. */
const presets: Record<Preset, Readonly<Record<string, unknown>>> = {
  circleci: {
    'oidc.circleci.com/project-id': 'c1d2e3f4-0000-4000-8000-000000000000',
    'oidc.circleci.com/vcs-origin': 'github.com/acme/app',
    'oidc.circleci.com/vcs-ref': 'refs/heads/main',
    sub: 'org/b6a6b6f0-0000-4000-8000-000000000000/project/c1d2e3f4-0000-4000-8000-000000000000/user/a1b2c3d4-0000-4000-8000-000000000000',
  },
  gcp: {
    azp: '104857600000000000000',
    email: 'ci@acme.iam.gserviceaccount.com',
    email_verified: true,
    sub: '104857600000000000000',
  },
  githubActions: {
    event_name: 'push',
    ref: 'refs/heads/main',
    repository: 'acme/app',
    repository_id: '812345',
    repository_owner: 'acme',
    repository_owner_id: '67890',
    runner_environment: 'github-hosted',
    sub: 'repo:acme/app:ref:refs/heads/main',
    workflow: 'CI',
  },
  gitlab: {
    namespace_id: '67890',
    namespace_path: 'acme',
    project_id: '812345',
    project_path: 'acme/app',
    ref: 'main',
    ref_type: 'branch',
    sub: 'project_path:acme/app:ref_type:branch:ref:main',
  },
  vercel: {
    environment: 'production',
    owner: 'acme',
    owner_id: 'team_acme',
    project: 'app',
    project_id: 'prj_app',
    sub: 'owner:acme:project:app:environment:production',
  },
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function json(response: Http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function read(request: Http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => (body += chunk))
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function text(response: Http.ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain' }).end(body)
}

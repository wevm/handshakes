/** @module A local Better Auth authorization server for integration tests, on a random port. */
import * as Http from 'node:http'
import { oauthDeviceAuthorization, oauthProvider } from '@better-auth/oauth-provider'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { getSchema } from 'better-auth/db'
import { toNodeHandler } from 'better-auth/node'
import { jwt } from 'better-auth/plugins/jwt'
import { tokenExchange } from 'handshakes/better-auth'
import type { Policy } from 'handshakes/server'

/**
 * Starts the server, registers a public client for the device grant, and returns the server's URL,
 * the client ID, and helpers. Each call has its own in-memory database, so tests share no state.
 */
export async function create(options: create.Options = {}): Promise<create.ReturnType> {
  const server = Http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.')
  const url = `http://127.0.0.1:${address.port}`

  const config = {
    basePath: '/',
    baseURL: url,
    emailAndPassword: { enabled: true },
    plugins: [
      // `Resource` accepts RS256 and ES256. Better Auth signs with EdDSA by default.
      jwt({ jwks: { keyPairConfig: { alg: 'ES256' } }, jwt: { issuer: url } }),
      // Access tokens of the exchange must end before subject tokens of the test issuer, which live for 300 seconds.
      oauthProvider({
        consentPage: '/consent',
        loginPage: '/login',
        m2mAccessTokenExpiresIn: 240,
        // RFC 8707 resources receive RFC 9068 JWT access tokens.
        clientRegistrationDefaultResources: options.resources ?? [],
        resources: [...(options.resources ?? [])],
        scopes: ['data:read', 'data:write', 'email', 'offline_access', 'openid', 'profile'],
      }),
      // The shortest interval keeps device grant tests fast. RFC 8628 defaults to 5 seconds.
      oauthDeviceAuthorization({ interval: '1s', verificationUri: '/device' }),
      tokenExchange(),
    ],
    // A fixed secret is safe for a server that lives only for one test file.
    secret: 'handshakes-test-secret-handshakes-test-secret',
  } satisfies BetterAuthOptions

  // The memory adapter needs every table of the configuration to exist before the first write.
  const tables = Object.fromEntries(Object.keys(getSchema(config)).map((name) => [name, []]))
  const auth = betterAuth({ ...config, database: memoryAdapter(tables) })

  server.on('request', toNodeHandler(auth))

  // One test user approves every device code, through the same HTTP endpoints as a browser.
  const cookie = await (async () => {
    const response = await fetch(`${url}/sign-up/email`, {
      body: JSON.stringify({
        email: 'test@example.com',
        name: 'Test',
        password: 'handshakes-test-password',
      }),
      headers: { 'content-type': 'application/json', origin: url },
      method: 'POST',
    })
    return response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
  })()

  // Better Auth registers a client only for a signed-in user.
  const client = await auth.api.adminCreateOAuthClient({
    body: {
      client_name: 'Handshakes test',
      grant_types: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
      scope: 'openid email offline_access',
      skip_consent: true,
      token_endpoint_auth_method: 'none',
    },
    headers: new Headers({ cookie }),
  })

  // A public client for the token exchange. Its trust policies authorize it, not a secret.
  const exchangeClient = await auth.api.adminCreateOAuthClient({
    body: {
      client_name: 'Handshakes exchange test',
      grant_types: ['urn:ietf:params:oauth:grant-type:token-exchange'],
      scope: 'data:read data:write',
      skip_consent: true,
      token_endpoint_auth_method: 'none',
    },
    headers: new Headers({ cookie }),
  })

  return {
    async approve(userCode) {
      const headers = { cookie, origin: url }

      // Opening the device page binds the code to the signed-in user.
      const verify = await fetch(`${url}/device?user_code=${encodeURIComponent(userCode)}`, {
        headers,
      })
      if (!verify.ok) throw new Error(`GET /device returned HTTP ${verify.status}.`)

      const approve = await fetch(`${url}/device/approve`, {
        body: JSON.stringify({ userCode }),
        headers: { ...headers, 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!approve.ok) throw new Error(`POST /device/approve returned HTTP ${approve.status}.`)
    },
    clientId: client.client_id,
    // Clients keep connections alive, so `close` ends them instead of waiting for them to idle.
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
    exchangeClientId: exchangeClient.client_id,
    async trust(policy) {
      await auth.api.createTrustPolicy({ body: { ...policy, clientId: exchangeClient.client_id } })
    },
    url,
  }
}

export declare namespace create {
  type Options = {
    /** RFC 8707 resource identifiers, which receive JWT access tokens. */
    resources?: readonly string[] | undefined
  }
  type ReturnType = {
    /** Approves a user code as the signed-in test user, as the device page does. */
    approve: (userCode: string) => Promise<void>
    /** ID of a public client with the device grant and refresh tokens. */
    clientId: string
    /** Stops the server. */
    close: () => Promise<void>
    /** ID of a public client with only the token exchange grant. */
    exchangeClientId: string
    /** Stores `policy` in the `trustPolicy` table, for the exchange client. */
    trust: (policy: Policy.Policy) => Promise<void>
    /** The origin of the server, which is also its issuer. */
    url: string
  }
}

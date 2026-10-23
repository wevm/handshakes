/** @module A local Better Auth authorization server for integration tests, on a random port. */
import * as Http from 'node:http'
import { oauthDeviceAuthorization, oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { toNodeHandler } from 'better-auth/node'
import { jwt } from 'better-auth/plugins/jwt'

/**
 * Starts the server and returns its URL and a `close` function.
 * Each call has its own in-memory database, so tests do not share state.
 */
export async function create(): Promise<create.ReturnType> {
  const server = Http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.')
  const url = `http://127.0.0.1:${address.port}`

  const auth = betterAuth({
    basePath: '/',
    baseURL: url,
    database: memoryAdapter({}),
    emailAndPassword: { enabled: true },
    plugins: [
      jwt({ jwt: { issuer: url } }),
      oauthProvider({ consentPage: '/consent', loginPage: '/login' }),
      oauthDeviceAuthorization({ verificationUri: '/device' }),
    ],
    // A fixed secret is safe for a server that lives only for one test file.
    secret: 'handshakes-test-secret-handshakes-test-secret',
  })

  server.on('request', toNodeHandler(auth))

  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    url,
  }
}

export declare namespace create {
  type ReturnType = {
    /** Stops the server. */
    close: () => Promise<void>
    /** The origin of the server, which is also its issuer. */
    url: string
  }
}

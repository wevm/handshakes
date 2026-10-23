/** @module Checks that the local Better Auth server serves the endpoints that Handshakes calls. */
import * as Server from './Server.js'

describe('create', () => {
  let server: Server.create.ReturnType

  beforeAll(async () => {
    server = await Server.create()
  })

  afterAll(async () => {
    await server.close()
  })

  test('serves authorization server metadata', async () => {
    const response = await fetch(`${server.url}/.well-known/oauth-authorization-server`)
    const metadata = (await response.json()) as Record<string, unknown>

    // The port changes on every run, so endpoints are compared without the origin.
    const relative = (value: unknown) => String(value).replace(server.url, '')

    expect(response.status).toMatchInlineSnapshot(`200`)
    expect(relative(metadata['issuer'])).toMatchInlineSnapshot(`""`)
    expect(relative(metadata['token_endpoint'])).toMatchInlineSnapshot(`"/oauth2/token"`)
    expect(relative(metadata['device_authorization_endpoint'])).toMatchInlineSnapshot(
      `"/device/code"`,
    )
    expect(relative(metadata['revocation_endpoint'])).toMatchInlineSnapshot(`"/oauth2/revoke"`)
    expect(metadata['grant_types_supported']).toMatchInlineSnapshot(`
      [
        "authorization_code",
        "client_credentials",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:device_code",
      ]
    `)
  })
})

/** @module Resolves access tokens through stored grants and the device grant, against a local Better Auth server. */
import { Client, Store } from 'handshakes'
import * as Server from '../test/Server.js'

let server: Server.create.ReturnType

beforeAll(async () => {
  server = await Server.create()
})

afterAll(async () => {
  await server.close()
})

/** Returns a client of the local server that approves each device code as the test user. */
function create(options: Partial<Client.create.Options> = {}) {
  const approvals: Promise<void>[] = []
  const client = Client.create({
    clientId: server.clientId,
    interactive: true,
    issuer: server.url,
    onDeviceCode: (code) => approvals.push(server.approve(code.userCode)),
    scope: 'openid email offline_access',
    ...options,
  })
  return { approvals, client }
}

/** Returns the status of a userinfo request with `accessToken`. */
async function userinfo(accessToken: string): Promise<number> {
  const response = await fetch(`${server.url}/oauth2/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  return response.status
}

describe('authorize', () => {
  test('runs the device grant and stores the grant', async () => {
    const store = Store.memory()
    const { approvals, client } = create({ store })

    const grant = await client.authorize()

    expect(approvals.length).toMatchInlineSnapshot(`1`)
    expect(grant.scope).toMatchInlineSnapshot(`"openid email offline_access"`)
    expect(grant.refreshToken).toEqual(expect.any(String))
    expect(await userinfo(grant.accessToken)).toMatchInlineSnapshot(`200`)
    expect((await store.get(`${server.url} ${server.clientId}`))?.accessToken).toBe(
      grant.accessToken,
    )
  })
})

describe('token', () => {
  test('runs the device grant when interactive and no grant is stored', async () => {
    const { approvals, client } = create()

    const token = await client.token()

    expect(approvals.length).toMatchInlineSnapshot(`1`)
    expect(token.method).toMatchInlineSnapshot(`"grant"`)
    expect(token.type).toMatchInlineSnapshot(`"Bearer"`)
  })

  test('returns the stored grant of another client with the same store', async () => {
    const store = Store.memory()
    const grant = await create({ store }).client.authorize()
    const { approvals, client } = create({ interactive: false, store })

    const token = await client.token()

    expect(token.value).toBe(grant.accessToken)
    expect(approvals.length).toMatchInlineSnapshot(`0`)
  })

  test('refreshes an expiring grant, and the server rejects the old refresh token', async () => {
    const store = Store.memory()
    const key = `${server.url} ${server.clientId}`
    const grant = await create({ store }).client.authorize()
    await store.set(key, { ...grant, expiresAt: Date.now() })
    const { client } = create({ interactive: false, store })

    const token = await client.token()

    const refreshed = await store.get(key)
    expect(token.value).not.toBe(grant.accessToken)
    expect(refreshed?.refreshToken).not.toBe(grant.refreshToken)
    expect(await userinfo(token.value)).toMatchInlineSnapshot(`200`)

    const reuse = await fetch(`${server.url}/oauth2/token`, {
      body: new URLSearchParams({
        client_id: server.clientId,
        grant_type: 'refresh_token',
        refresh_token: grant.refreshToken!,
      }),
      method: 'POST',
    })
    expect(reuse.status).toMatchInlineSnapshot(`400`)
  })

  test('throws when no grant is stored and the client is not interactive', async () => {
    const { client } = create({ interactive: false })

    const error = (await client.token().catch((error: Error) => error)) as Error

    // The port changes on every run, so the issuer is replaced.
    expect(error.name).toMatchInlineSnapshot(`"Client.AuthorizationRequiredError"`)
    expect(error.message.replace(server.url, '<issuer>')).toMatchInlineSnapshot(
      `"Authorization is required for <issuer>. Run the device grant with \`authorize\`."`,
    )
  })

  test('deletes a grant whose refresh token the server rejects', async () => {
    const store = Store.memory()
    const key = `${server.url} ${server.clientId}`
    const grant = await create({ store }).client.authorize()
    await store.set(key, { ...grant, expiresAt: Date.now(), refreshToken: 'unknown' })
    const { client } = create({ interactive: false, store })

    await expect(client.token()).rejects.toThrow(Client.AuthorizationRequiredError)
    expect(await store.get(key)).toMatchInlineSnapshot(`undefined`)
  })

  test('shares one request between concurrent calls', async () => {
    const { approvals, client } = create()

    const [first, second] = await Promise.all([client.token(), client.token()])

    expect(first.value).toBe(second.value)
    expect(approvals.length).toMatchInlineSnapshot(`1`)
  })
})

describe('fetch', () => {
  test('sends the access token as a bearer token', async () => {
    const { client } = create()

    const response = await client.fetch(`${server.url}/oauth2/userinfo`)

    expect(response.status).toMatchInlineSnapshot(`200`)
    expect(((await response.json()) as { email: string }).email).toMatchInlineSnapshot(
      `"test@example.com"`,
    )
  })
})

describe('revoke', () => {
  test('revokes the refresh token and deletes the grant', async () => {
    const store = Store.memory()
    const key = `${server.url} ${server.clientId}`
    const { client } = create({ store })
    const grant = await client.authorize()

    await client.revoke()

    expect(await store.get(key)).toMatchInlineSnapshot(`undefined`)
    expect(await userinfo(grant.accessToken)).toMatchInlineSnapshot(`401`)
  })
})

describe('status', () => {
  test('describes the stored grant without token values', async () => {
    const { client } = create()
    await client.authorize()

    expect(await client.status()).toMatchInlineSnapshot(
      { expiresAt: expect.any(Number) },
      `
      {
        "expiresAt": Any<Number>,
        "method": "grant",
        "refreshable": true,
      }
    `,
    )
  })

  test('describes a client without a grant', async () => {
    const { client } = create({ interactive: false })

    expect(await client.status()).toMatchInlineSnapshot(`
      {
        "checked": [],
        "interactive": false,
        "method": "none",
      }
    `)
  })
})

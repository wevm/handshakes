/** @module Exchanges subject tokens of the local issuer at a local Better Auth server with the plugin. */
import { Client } from 'handshakes'
import { Policy } from 'handshakes/server'
import { Issuer } from 'handshakes/test'
import * as Server from '../../test/Server.js'

describe('tokenExchange', () => {
  let issuer: Issuer.Issuer
  let other: Issuer.Issuer
  let server: Server.create.ReturnType

  beforeAll(async () => {
    issuer = await Issuer.create()
    other = await Issuer.create()
    server = await Server.create()
    await server.trust(
      Policy.githubActions({
        audience: server.url,
        issuer: issuer.url,
        ref: 'refs/heads/main',
        repositoryId: '812345',
        scopes: ['data:read'],
      }),
    )
    await server.trust(
      Policy.githubActions({
        audience: server.url,
        issuer: issuer.url,
        maxAge: 600,
        repositoryId: '812346',
        scopes: ['data:read'],
      }),
    )
  })

  afterAll(async () => {
    await Promise.all([issuer.close(), other.close(), server.close()])
  })

  /** Sends a token exchange request with `fields`, and returns the status and the JSON body. */
  async function exchange(fields: Record<string, string>) {
    const response = await fetch(`${server.url}/oauth2/token`, {
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        ...fields,
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    })
    return { body: (await response.json()) as Record<string, unknown>, status: response.status }
  }

  test('advertises the grant in the metadata', async () => {
    const response = await fetch(`${server.url}/.well-known/oauth-authorization-server`)
    const metadata = (await response.json()) as { grant_types_supported: string[] }

    expect(
      metadata.grant_types_supported.includes('urn:ietf:params:oauth:grant-type:token-exchange'),
    ).toMatchInlineSnapshot(`true`)
  })

  test('issues an access token to Client for a subject token that matches a policy', async () => {
    const client = Client.create({
      env: await issuer.env({ preset: 'githubActions' }),
      issuer: server.url,
    })

    const token = await client.token()

    expect(token.method).toMatchInlineSnapshot(`"exchange"`)
    expect(token.scope).toMatchInlineSnapshot(`"data:read"`)
    expect(token.expiresAt <= Date.now() + 240_000).toMatchInlineSnapshot(`true`)
  })

  test('responds with the issued token type', async () => {
    const subjectToken = await issuer.sign({ audience: server.url, preset: 'githubActions' })

    const result = await exchange({ subject_token: subjectToken })

    expect(result.status).toMatchInlineSnapshot(`200`)
    expect(result.body['issued_token_type']).toMatchInlineSnapshot(
      `"urn:ietf:params:oauth:token-type:access_token"`,
    )
    expect(result.body['token_type']).toMatchInlineSnapshot(`"Bearer"`)
  })

  test.each([
    ['another repository', { claims: { repository_id: '999999' } }],
    ['another ref', { claims: { ref: 'refs/heads/dev' } }],
    ['another audience', { audience: 'https://other.example.com' }],
    ['an expired token', { expiresIn: -10 }],
  ] as const)('refuses %s', async (_, options) => {
    const subjectToken = await issuer.sign({
      audience: server.url,
      preset: 'githubActions',
      ...options,
    })

    const result = await exchange({ subject_token: subjectToken })

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "invalid_grant",
          "error_description": "The subject token matches no trust policy.",
        },
        "status": 400,
      }
    `)
  })

  test('applies the maxAge of a stored policy', async () => {
    const claims = { repository_id: '812346' }

    const fresh = await exchange({
      subject_token: await issuer.sign({ audience: server.url, claims, preset: 'githubActions' }),
    })
    const old = await exchange({
      subject_token: await issuer.sign({
        audience: server.url,
        claims: { ...claims, iat: Math.floor(Date.now() / 1000) - 900 },
        preset: 'githubActions',
      }),
    })

    expect(fresh.status).toMatchInlineSnapshot(`200`)
    expect(old.body['error']).toMatchInlineSnapshot(`"invalid_grant"`)
  })

  test('refuses a token of an issuer that no policy names', async () => {
    const subjectToken = await other.sign({ audience: server.url, preset: 'githubActions' })

    const result = await exchange({ subject_token: subjectToken })

    expect(result.body['error']).toMatchInlineSnapshot(`"invalid_grant"`)
  })

  test('refuses an unsigned token', async () => {
    const signed = await issuer.sign({ audience: server.url, preset: 'githubActions' })
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')

    const result = await exchange({ subject_token: `${header}.${signed.split('.')[1]}.` })

    expect(result.body['error']).toMatchInlineSnapshot(`"invalid_grant"`)
  })

  test('refuses a subject token that expires before the access token', async () => {
    const subjectToken = await issuer.sign({
      audience: server.url,
      expiresIn: 60,
      preset: 'githubActions',
    })

    const result = await exchange({ subject_token: subjectToken })

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "invalid_grant",
          "error_description": "The subject token expires before the access token that the server issues. Request a subject token with a longer lifetime.",
        },
        "status": 400,
      }
    `)
  })

  test('refuses a resource that the policy does not list', async () => {
    const subjectToken = await issuer.sign({ audience: server.url, preset: 'githubActions' })

    const result = await exchange({
      resource: 'https://other.example.com',
      subject_token: subjectToken,
    })

    expect(result.body['error']).toMatchInlineSnapshot(`"invalid_target"`)
  })

  test('refuses a client that is not the client of the policy', async () => {
    const subjectToken = await issuer.sign({ audience: server.url, preset: 'githubActions' })

    const result = await exchange({ client_id: server.clientId, subject_token: subjectToken })

    expect(result.body['error']).toMatchInlineSnapshot(`"invalid_grant"`)
  })

  test('rejects a stored policy without claims', async () => {
    const policy = Policy.from({
      audience: server.url,
      claims: {},
      id: 'any',
      issuer: issuer.url,
      scopes: ['data:read'],
    })

    await expect(server.trust(policy)).rejects.toThrowErrorMatchingInlineSnapshot(
      `[APIError: [body] claims must name at least one claim.]`,
    )
  })

  test('rejects a stored policy with a maxLifetime below m2mAccessTokenExpiresIn', async () => {
    const policy = Policy.githubActions({
      audience: server.url,
      issuer: issuer.url,
      maxLifetime: 120,
      repositoryId: '812346',
      scopes: ['data:read'],
    })

    await expect(server.trust(policy)).rejects.toThrowErrorMatchingInlineSnapshot(
      `[APIError: The policy githubActions:812346:* sets \`maxLifetime\` to 120 seconds, but Better Auth issues every access token of the exchange for \`m2mAccessTokenExpiresIn\`, 240 seconds. Remove \`maxLifetime\` from the policy, or set \`m2mAccessTokenExpiresIn\` to 120 or less.]`,
    )
  })

  test('rejects a policy in code with a maxLifetime below m2mAccessTokenExpiresIn', async () => {
    const policy = Policy.githubActions({
      audience: 'https://auth.example.com',
      clientId: 'ci',
      issuer: issuer.url,
      maxLifetime: 120,
      repositoryId: '812346',
      scopes: ['data:read'],
    })

    await expect(Server.create({ policies: [policy] })).rejects.toThrowErrorMatchingInlineSnapshot(
      `[TypeError: The policy githubActions:812346:* sets \`maxLifetime\` to 120 seconds, but Better Auth issues every access token of the exchange for \`m2mAccessTokenExpiresIn\`, 240 seconds. Remove \`maxLifetime\` from the policy, or set \`m2mAccessTokenExpiresIn\` to 120 or less.]`,
    )
  })

  test('issues an access token for a policy with a maxLifetime of m2mAccessTokenExpiresIn', async () => {
    await server.trust(
      Policy.githubActions({
        audience: server.url,
        issuer: issuer.url,
        maxLifetime: 240,
        repositoryId: '812347',
        scopes: ['data:read'],
      }),
    )
    const subjectToken = await issuer.sign({
      audience: server.url,
      claims: { repository_id: '812347' },
      preset: 'githubActions',
    })

    const result = await exchange({ subject_token: subjectToken })

    expect(result.status).toMatchInlineSnapshot(`200`)
    expect(result.body['expires_in']).toMatchInlineSnapshot(`240`)
  })
})

/** @module Exchanges subject tokens of the local issuer at the token endpoint, and checks every refusal. */
import { Policy, Server } from 'handshakes/server'
import { Issuer } from 'handshakes/test'
import * as Http from '../../test/Http.js'

describe('create', () => {
  let issued: Server.IssueContext[]
  let issuer: Issuer.Issuer
  let other: Issuer.Issuer
  let server: Awaited<ReturnType<typeof Http.serve>>

  beforeAll(async () => {
    issued = []
    issuer = await Issuer.create()
    other = await Issuer.create()
    server = await Http.serve(
      (url) =>
        Server.create({
          issue: async (context) => {
            issued.push(context)
            return { accessToken: `key_${issued.length}`, expiresAt: context.expiresAt }
          },
          issuer: url,
          policies: [
            Policy.githubActions({
              audience: url,
              issuer: issuer.url,
              ref: 'refs/heads/main',
              repositoryId: '812345',
              scopes: ['data:read', 'data:write'],
            }),
          ],
        }).fetch,
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
      method: 'POST',
    })
    return { body: (await response.json()) as Record<string, unknown>, status: response.status }
  }

  test('serves authorization server metadata', async () => {
    const metadata = (await (
      await fetch(`${server.url}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>

    expect(metadata['issuer'] === server.url).toMatchInlineSnapshot(`true`)
    expect(String(metadata['token_endpoint']).replace(server.url, '')).toMatchInlineSnapshot(
      `"/oauth2/token"`,
    )
    expect(metadata['grant_types_supported']).toMatchInlineSnapshot(`
      [
        "urn:ietf:params:oauth:grant-type:token-exchange",
      ]
    `)
  })

  test('exchanges a subject token that matches a policy', async () => {
    const subjectToken = await issuer.sign({ audience: server.url, preset: 'githubActions' })

    const result = await exchange({ subject_token: subjectToken })

    expect(result.status).toMatchInlineSnapshot(`200`)
    expect(result.body).toMatchInlineSnapshot(
      {
        access_token: expect.any(String),
        expires_in: expect.any(Number),
      },
      `
      {
        "access_token": Any<String>,
        "expires_in": Any<Number>,
        "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "scope": "data:read data:write",
        "token_type": "Bearer",
      }
    `,
    )
    expect(issued.at(-1)?.claims['repository_id']).toMatchInlineSnapshot(`"812345"`)
  })

  test('caps the lifetime at the expiry of the subject token', async () => {
    const subjectToken = await issuer.sign({
      audience: server.url,
      expiresIn: 120,
      preset: 'githubActions',
    })

    const result = await exchange({ subject_token: subjectToken })

    expect((result.body['expires_in'] as number) <= 120).toMatchInlineSnapshot(`true`)
  })

  test('issues a requested subset of the scopes', async () => {
    const subjectToken = await issuer.sign({ audience: server.url, preset: 'githubActions' })

    const result = await exchange({ scope: 'data:read', subject_token: subjectToken })

    expect(result.body['scope']).toMatchInlineSnapshot(`"data:read"`)
  })

  test('rejects scopes beyond the policy', async () => {
    const subjectToken = await issuer.sign({ audience: server.url, preset: 'githubActions' })

    const result = await exchange({ scope: 'admin', subject_token: subjectToken })

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "invalid_scope",
          "error_description": "The requested scope exceeds the scopes of the trust policy.",
        },
        "status": 400,
      }
    `)
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

  test('refuses a token of an issuer that no policy names', async () => {
    const subjectToken = await other.sign({ audience: server.url, preset: 'githubActions' })

    const result = await exchange({ subject_token: subjectToken })

    expect(result.status).toMatchInlineSnapshot(`400`)
  })

  test('refuses a token signed by another key', async () => {
    const subjectToken = await other.sign({
      audience: server.url,
      claims: { iss: issuer.url },
      preset: 'githubActions',
    })

    const result = await exchange({ subject_token: subjectToken })

    expect(result.status).toMatchInlineSnapshot(`400`)
  })

  test('refuses an unsigned token', async () => {
    const signed = await issuer.sign({ audience: server.url, preset: 'githubActions' })
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')

    const result = await exchange({ subject_token: `${header}.${signed.split('.')[1]}.` })

    expect(result.status).toMatchInlineSnapshot(`400`)
  })

  test('rejects another grant type', async () => {
    const result = await exchange({ grant_type: 'client_credentials' })

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "unsupported_grant_type",
          "error_description": "grant_type must be urn:ietf:params:oauth:grant-type:token-exchange.",
        },
        "status": 400,
      }
    `)
  })

  test('rejects a request without a subject token', async () => {
    const result = await exchange({})

    expect(result).toMatchInlineSnapshot(`
      {
        "body": {
          "error": "invalid_request",
          "error_description": "subject_token is required.",
        },
        "status": 400,
      }
    `)
  })
})
